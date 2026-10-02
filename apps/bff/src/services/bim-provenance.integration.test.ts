import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";
import { createApp } from "../index";
import { getDatabasePool } from "../db/client";
import { getBimIndexJob } from "../db/bim-index-store";
import { generateAndStoreFrag, getViewerSource } from "./documents.service";
import { findBimDerivative, getDerivativeBimContext, getFragContentSha256, upsertBimDerivative } from "./bim-derivatives.service";
import { createAuthoringIfcFixture } from "./fixtures/bim-authoring-ifc.fixture";
import { toBimRevisionId } from "./bim-revision-identity";
import { clearJwksCacheForTests } from "../security/keycloak-jwt";

test("exact IFC → real FRAG → persistent authoring → guarded viewer delivery", { skip: !process.env.DATABASE_URL }, async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cde-provenance-"));
  const project = `TEST-PROVENANCE-${crypto.randomUUID().toUpperCase()}`;
  const sourcePath = `/${project}/Modelo.ifc`;
  const a = createAuthoringIfcFixture();
  const b = createAuthoringIfcFixture({ height: 2 });
  const revisionA = toBimRevisionId(a), revisionB = toBimRevisionId(b);
  const files = new Map<string, Buffer>([[sourcePath, a]]);
  let etag = "A", ifcDownloads = 0;
  const env = { BFF_DATA_DIR: root, USE_NEXTCLOUD_MOCK: "false", USE_OPENPROJECT_MOCK: "true",
    NEXTCLOUD_BASE_URL: "http://nextcloud.invalid", CORS_ALLOWED_ORIGINS: "http://localhost:3000",
    KEYCLOAK_ISSUER: "http://provenance.invalid/realms/test", KEYCLOAK_AUDIENCE: "provenance-test", KEYCLOAK_JWKS_URI: "",
    BFF_AUTO_GENERATE_FRAG_ON_VIEWER_SOURCE: "false", BFF_QUEUE_FRAG_ON_VIEWER_SOURCE: "false" };
  const before = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.mock.method(NextcloudAdapter.prototype, "listDocuments", async () => [{ name: "Modelo.ifc", fileId: "fixture-file", etag }]);
  t.mock.method(NextcloudAdapter.prototype, "fileExists", async (file: string) => files.has(file));
  t.mock.method(NextcloudAdapter.prototype, "createFolder", async () => {});
  t.mock.method(NextcloudAdapter.prototype, "downloadFile", async (file: string) => {
    const buffer = files.get(file);
    if (!buffer) throw new Error("Fixture file missing");
    if (file === sourcePath) {
      ifcDownloads++;
      // Change current immediately after acquisition: generation/indexing must both retain A.
      files.set(sourcePath, b);
    }
    return { buffer, contentType: "application/octet-stream", fileName: path.posix.basename(file), size: buffer.length };
  });
  t.mock.method(NextcloudAdapter.prototype, "uploadFile", async (file: string, bytes: Buffer) => { files.set(file, Buffer.from(bytes)); });
  const pool = getDatabasePool();
  const waitForRevision = async (revision: string) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await pool.query(`select count(*)::int as n from cde_bim_authoring_contexts c
        join cde_bim_authoring_members m on m.context_id=c.id where c.project_code=$1 and c.revision_id=$2`, [project, revision]);
      const job = await getBimIndexJob({ projectCode: project, documentPath: sourcePath, sourceHash: etag });
      if (result.rows[0].n === 188 && job?.status === "ready") return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.fail("Authoring index did not persist the source revision");
  };
  let appServer: http.Server | undefined, jwks: http.Server | undefined;
  try {
    let firstPath = "";
    await t.test("generation persists source digest and indexes the same acquired IFC despite current changing", async (t) => {
      const hash = t.mock.method(crypto, "createHash");
      const result = await generateAndStoreFrag(sourcePath);
      // One IFC content hash + one FRAG integrity hash + existing metadata-based derivative ID.
      assert.equal(hash.mock.callCount(), 3);
      firstPath = result.fragPath;
      const record = findBimDerivative({ sourcePath, versionKey: "A" })!;
      assert.equal(record.sourceBimRevisionId, revisionA);
      assert.equal(record.fragContentSha256, getFragContentSha256(files.get(firstPath)!));
      const metadata = JSON.parse(files.get(`${firstPath}.meta.json`)!.toString());
      assert.equal(metadata.sourceBimRevisionId, revisionA);
      assert.equal(metadata.fragContentSha256, record.fragContentSha256);
      await waitForRevision(revisionA);
      assert.equal(ifcDownloads, 1);
      assert.notEqual(revisionA, revisionB);
    });
    await t.test("changed valid IFC produces independent provenance and authoring revision", async () => {
      etag = "B";
      await generateAndStoreFrag(sourcePath);
      const record = findBimDerivative({ sourcePath, versionKey: "B" })!;
      assert.equal(record.sourceBimRevisionId, revisionB);
      assert.notEqual(record.fragPath, firstPath);
      await waitForRevision(revisionB);
      await waitForRevision(revisionA);
      assert.equal(ifcDownloads, 2);
    });
    await t.test("viewer-source follows requested derivative A even with authoring revision B present", async () => {
      etag = "A";
      const source = await getViewerSource(sourcePath);
      assert.deepEqual(source.bimContext, { projectCode: project, modelKey: sourcePath, revisionId: revisionA });
      assert.equal(source.fragPath, firstPath);
      assert.ok(new URL(source.modelUrl).searchParams.get("expectedFragSha256"));
      assert.equal(ifcDownloads, 2);
    });
    await t.test("legacy or invalid persisted provenance never creates canonical context", async () => {
      const record = findBimDerivative({ sourcePath, versionKey: "A" })!;
      for (const sourceBimRevisionId of [undefined, "etag", `${revisionA}\n`]) {
        upsertBimDerivative({ ...record, sourceBimRevisionId });
        const source = await getViewerSource(sourcePath);
        assert.equal(source.kind, "frag");
        assert.equal(source.bimContext, undefined);
        assert.equal(new URL(source.modelUrl).searchParams.has("expectedFragSha256"), false);
      }
      assert.equal(getDerivativeBimContext({ ...record, fragContentSha256: undefined }), undefined);
      upsertBimDerivative(record);
    });
    await t.test("IFC direct stays available without claiming a verified context", async () => {
      const source = await getViewerSource(sourcePath, "historical-test");
      assert.equal(source.kind, "ifc");
      assert.equal(source.bimContext, undefined);
    });
    await t.test("auto-generated viewer source carries the newly produced artifact context", async () => {
      etag = "C";
      process.env.BFF_AUTO_GENERATE_FRAG_ON_VIEWER_SOURCE = "true";
      const source = await getViewerSource(sourcePath);
      assert.equal(source.generated, true);
      assert.equal(source.bimContext?.revisionId, revisionB);
      assert.equal(source.bimContext?.modelKey, sourcePath);
      await waitForRevision(revisionB);
      assert.equal(ifcDownloads, 3);
      process.env.BFF_AUTO_GENERATE_FRAG_ON_VIEWER_SOURCE = "false";
      etag = "A";
    });
    await t.test("HTTP guarded delivery returns exact FRAG and rejects replacement at same path", async () => {
      const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
      jwks = http.createServer((_req, res) => {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ keys: [{ ...keys.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" }] }));
      });
      await new Promise<void>((resolve) => jwks!.listen(0, "127.0.0.1", resolve));
      process.env.KEYCLOAK_JWKS_URI = `http://127.0.0.1:${(jwks.address() as AddressInfo).port}/certs`;
      clearJwksCacheForTests();
      appServer = createApp().listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => appServer!.once("listening", resolve));
      const base = `http://127.0.0.1:${(appServer.address() as AddressInfo).port}`;
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const data = `${encode({ alg: "RS256", kid: "test" })}.${encode({ sub: "test", iss: env.KEYCLOAK_ISSUER,
        aud: env.KEYCLOAK_AUDIENCE, exp: Math.floor(Date.now()/1000)+300, groups: [`/${project}_VIEWER`], realm_access: { roles: ["viewer"] } })}`;
      const token = `${data}.${crypto.sign("RSA-SHA256", Buffer.from(data), keys.privateKey).toString("base64url")}`;
      const headers = { Authorization: `Bearer ${token}` };
      // Source changes immediately after download; response context must still describe acquired A.
      files.set(sourcePath, a);
      const direct = await fetch(`${base}/api/documents/content?path=${encodeURIComponent(sourcePath)}`, {
        headers: { ...headers, Origin: "http://localhost:3000" }
      });
      assert.equal(direct.status, 200);
      assert.deepEqual(Buffer.from(await direct.arrayBuffer()), a);
      assert.deepEqual(JSON.parse(decodeURIComponent(direct.headers.get("x-bim-context")!)), {
        projectCode: project, modelKey: sourcePath, revisionId: revisionA
      });
      assert.match(direct.headers.get("access-control-expose-headers")!, /X-Bim-Context/i);
      assert.equal(direct.headers.get("cache-control"), "no-store");
      const directB = await fetch(`${base}/api/documents/content?path=${encodeURIComponent(sourcePath)}`, { headers });
      assert.deepEqual(Buffer.from(await directB.arrayBuffer()), b);
      assert.equal(JSON.parse(decodeURIComponent(directB.headers.get("x-bim-context")!)).revisionId, revisionB);
      const sourceResponse = await fetch(`${base}/api/documents/viewer-source?documentPath=${encodeURIComponent(sourcePath)}`, { headers });
      assert.equal(sourceResponse.status, 200);
      const source = (await sourceResponse.json()).data;
      assert.equal(source.bimContext.revisionId, revisionA);
      const uri = new URL(source.modelUrl);
      const response = await fetch(`${base}${uri.pathname}${uri.search}`, { headers });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), files.get(firstPath));
      files.set(firstPath, Buffer.from("replacement"));
      assert.equal((await fetch(`${base}${uri.pathname}${uri.search}`, { headers })).status, 409);
      uri.searchParams.delete("expectedFragSha256");
      assert.equal((await fetch(`${base}${uri.pathname}${uri.search}`, { headers })).status, 200);
      uri.searchParams.set("expectedFragSha256", "invalid");
      assert.equal((await fetch(`${base}${uri.pathname}${uri.search}`, { headers })).status, 400);
    });
  } finally {
    if (appServer) await new Promise<void>((resolve) => appServer!.close(() => resolve()));
    if (jwks) await new Promise<void>((resolve) => jwks!.close(() => resolve()));
    clearJwksCacheForTests();
    // Synthetic project only, in disposable PostgreSQL.
    for (const table of ["cde_bim_authoring_contexts", "cde_bim_models", "cde_bim_index_jobs"]) {
      await pool.query(`delete from ${table} where project_code=$1`, [project]);
    }
    await pool.end();
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
