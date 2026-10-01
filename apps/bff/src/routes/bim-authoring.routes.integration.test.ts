import assert from "node:assert/strict";
import crypto from "node:crypto";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { createApp } from "../index";
import { getDatabasePool } from "../db/client";
import { replaceAuthoringElementIndex } from "../db/bim-authoring-store";
import { resolveAuthoringElements } from "../services/bim-authoring-resolver";
import { toCanonicalBimModelKey } from "../services/bim-model-identity";
import { isBimRevisionId, type BimProcessingContext } from "../services/bim-revision-identity";
import { createOciAuthoringFixture } from "../services/fixtures/bim-authoring-oci.fixture";
import { clearJwksCacheForTests } from "../security/keycloak-jwt";

// Same real HTTP + locally signed JWT/JWKS pattern as bff-security.test.ts.
test("authoring API with real project authorization and PostgreSQL", { skip: !process.env.DATABASE_URL }, async (t) => {
  const project = `TEST-API-${crypto.randomUUID().toUpperCase()}`;
  const otherProject = `${project}-B`;
  const fixture = createOciAuthoringFixture();
  const revisionId = fixture.context.revisionId;
  assert.ok(isBimRevisionId(revisionId));
  const context: BimProcessingContext = { projectCode: project,
    modelKey: toCanonicalBimModelKey("/AR3173/Modelo.ifc"), revisionId };
  const anotherRevision = `sha256:${"b".repeat(64)}`;
  assert.ok(isBimRevisionId(anotherRevision));
  const variants: BimProcessingContext[] = [
    { ...context, revisionId: anotherRevision },
    { ...context, modelKey: toCanonicalBimModelKey("/AR3173/Other.ifc") },
    { ...context, modelKey: toCanonicalBimModelKey("/AR3173/modelo.ifc") },
    { ...context, projectCode: otherProject }
  ];
  const pool = getDatabasePool();
  const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const issuer = "http://authoring-test.invalid/realms/test";
  const audience = "authoring-api-test";
  const jwks = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "authoring", alg: "RS256", use: "sig" }] }));
  });
  let server: http.Server | undefined;
  const env = { KEYCLOAK_ISSUER: issuer, KEYCLOAK_AUDIENCE: audience, KEYCLOAK_JWKS_URI: "",
    USE_NEXTCLOUD_MOCK: "true", USE_OPENPROJECT_MOCK: "true",
    CORS_ALLOWED_ORIGINS: "http://localhost:3000", NEXTCLOUD_BASE_URL: "http://nextcloud.invalid" };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  try {
    await replaceAuthoringElementIndex(resolveAuthoringElements({ ...fixture, context }));
    for (const [index, scope] of variants.entries()) {
      await replaceAuthoringElementIndex(resolveAuthoringElements({ context: scope, relations: [],
        entities: [{ localId: 303708, ifcClass: "IfcSlab", authoringElementId: `variant-${index}`, geometryStatus: "unknown" }] }));
    }
    await new Promise<void>((resolve) => jwks.listen(0, "127.0.0.1", resolve));
    env.KEYCLOAK_JWKS_URI = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/certs`;
    Object.assign(process.env, env);
    clearJwksCacheForTests();
    server = createApp().listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server!.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/bim-index/authoring/resolve`;
    const sign = (groups = [`/${project}_VIEWER`], admin = false) => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const payload = { sub: "authoring-test", preferred_username: "authoring-test", iss: issuer, aud: audience,
        exp: Math.floor(Date.now() / 1000) + 300, groups, realm_access: { roles: admin ? ["system-admin"] : ["viewer"] } };
      const data = `${encode({ alg: "RS256", kid: "authoring" })}.${encode(payload)}`;
      return `${data}.${crypto.sign("RSA-SHA256", Buffer.from(data), keys.privateKey).toString("base64url")}`;
    };
    const request = (changes: Record<string, string> = {}, token: string | null = sign()) => fetch(`${base}?${new URLSearchParams({ ...context, localId: "303708", ...changes })}`,
      { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const get = async (changes: Record<string, string> = {}, token?: string) => {
      const response = await request(changes, token);
      assert.equal(response.status, 200);
      return (await response.json()).data;
    };
    await t.test("child returns every semantic member in one SQL statement and a small response", async (t) => {
      const query = t.mock.method(pool, "query");
      const data = await get();
      assert.equal(query.mock.callCount(), 1);
      assert.deepEqual(data.context, context);
      assert.equal(data.authoringElement.identityKey, "aggregate:303839");
      assert.equal(data.authoringElement.authoringElementId, "1693104");
      assert.equal(data.members.length, 8);
      assert.equal(data.members.filter((m: { geometryStatus: string }) => m.geometryStatus === "present").length, 7);
      assert.deepEqual(data.members.find((m: { localId: number }) => m.localId === 303839), { localId: 303839, geometryStatus: "absent" });
      assert.deepEqual(Object.keys(data).sort(), ["authoringElement", "context", "members"]);
      assert.equal("compositionEvidence" in data.authoringElement, false);
    });
    await t.test("root and child resolve to exactly the same response", async () => {
      assert.deepEqual(await get({ localId: "303839" }), await get());
    });
    await t.test("standalone uses the same contract", async () => {
      const data = await get({ localId: "308027" });
      assert.equal(data.authoringElement.resolutionMethod, "standalone");
      assert.equal(data.authoringElement.authoringElementId, "1698042");
      assert.deepEqual(data.members, [{ localId: 308027, geometryStatus: "present" }]);
    });
    for (const [index, scope] of variants.entries()) {
      await t.test(`${["revision", "model", "case-sensitive model", "project"][index]} isolation preserves unknown membership`, async () => {
        const data = await get(scope, sign([`/${scope.projectCode}_VIEWER`]));
        assert.deepEqual(data.context, scope);
        assert.equal(data.authoringElement.authoringElementId, `variant-${index}`);
        assert.deepEqual(data.members, [{ localId: 303708, geometryStatus: "unknown" }]);
        assert.equal((await get()).authoringElement.identityKey, "aggregate:303839");
      });
    }
    await t.test("invalid identities are rejected before SQL", async (t) => {
      const query = t.mock.method(pool, "query");
      const invalid: Record<string, string>[] = [
        { revisionId: "etag" }, { revisionId: `sha256:${"A".repeat(64)}` }, { revisionId: `${revisionId}\n` },
        { modelKey: "frag:/AR3173/Modelo.ifc" }, { modelKey: "ifc:/AR3173/Modelo.ifc" },
        { modelKey: "AR3173/Modelo.ifc" }, { modelKey: "/AR3173/Modelo.ifc/" },
        { localId: "" }, { localId: "0" }, { localId: "-1" }, { localId: "1.2" }, { localId: "1\n" },
        { localId: "1e3" }, { localId: "2147483648" }, { sourceHash: "legacy" },
        { runtimeModelId: "runtime" }, { sourceVersion: "v1" }
      ];
      for (const changes of invalid) assert.equal((await request(changes)).status, 400);
      const duplicated = await fetch(`${base}?${new URLSearchParams({ ...context, localId: "303708" })}&localId=303839`,
        { headers: { Authorization: `Bearer ${sign()}` } });
      assert.equal(duplicated.status, 400);
      assert.equal((await request({ projectCode: "" }, sign([], true))).status, 400);
      assert.equal(query.mock.callCount(), 0);
    });
    await t.test("missing localId and missing context share the existing 404 contract", async () => {
      const missingMember = await request({ localId: "1" });
      const missingContext = await request({ revisionId: `sha256:${"c".repeat(64)}` });
      assert.equal(missingMember.status, 404);
      assert.equal(missingContext.status, 404);
      assert.deepEqual(await missingMember.json(), await missingContext.json());
    });
    await t.test("JWT and project authorization cannot be bypassed and do not query SQL", async (t) => {
      const query = t.mock.method(pool, "query");
      assert.equal((await request({}, null)).status, 401);
      assert.equal((await request({}, "invalid.jwt.token")).status, 401);
      assert.equal((await request({}, sign([]))).status, 403);
      assert.equal((await request({ projectCode: otherProject })).status, 403);
      assert.equal((await request({ projectCode: "" })).status, 403);
      assert.equal(query.mock.callCount(), 0);
    });
    await t.test("database errors never expose SQL or stack traces", async (t) => {
      t.mock.method(pool, "query", () => { throw new Error("secret SQL detail"); });
      const response = await request();
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), { success: false, message: "No se pudo resolver el elemento de autoria" });
    });
  } finally {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await new Promise<void>((resolve) => jwks.close(() => resolve()));
    clearJwksCacheForTests();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await pool.query("delete from cde_bim_authoring_contexts where project_code = any($1::text[])", [[project, otherProject]]);
    await pool.end();
  }
});
