import assert from "node:assert/strict";
import { test } from "node:test";
import { toCanonicalBimModelKey } from "./bim-model-identity";
import { resolveAuthoringElements } from "./bim-authoring-resolver";
import { createOciAuthoringFixture } from "./fixtures/bim-authoring-oci.fixture";

test("canonical document identity is deterministic and idempotent", () => {
  const key = toCanonicalBimModelKey("/AR3173/Modelo.ifc");
  assert.equal(key, "/AR3173/Modelo.ifc");
  assert.equal(toCanonicalBimModelKey("/AR3173/Modelo.ifc"), key);
  assert.equal(toCanonicalBimModelKey(key), key);
});

test("normalizes only documentary boundary whitespace and leading/trailing slash", () => {
  assert.equal(toCanonicalBimModelKey(" AR3173/Modelo.ifc/ "), "/AR3173/Modelo.ifc");
});

test("IFC and FRAG sources share identity through their authoritative documentPath", () => {
  const sources = ["ifc", "frag"].map((kind) => ({ kind, documentPath: "/AR3173/Modelo.ifc" }));
  assert.equal(toCanonicalBimModelKey(sources[0].documentPath), toCanonicalBimModelKey(sources[1].documentPath));
});

test("preserves case and separates case-distinct documents", () => {
  assert.notEqual(toCanonicalBimModelKey("/AR3173/Modelo.ifc"), toCanonicalBimModelKey("/AR3173/modelo.ifc"));
});

test("separates different documentary paths", () => {
  assert.notEqual(toCanonicalBimModelKey("/AR3173/A.ifc"), toCanonicalBimModelKey("/AR3173/B.ifc"));
});

test("revision, representation and runtime metadata are not inputs", () => {
  const first = { documentPath: "/AR3173/Modelo.ifc", sourceHash: "a", revisionId: "r1", versionKey: "v1", runtimeModelId: "runtime1" };
  const second = { ...first, sourceHash: "b", revisionId: "r2", versionKey: "v2", runtimeModelId: "runtime2" };
  assert.equal(toCanonicalBimModelKey(first.documentPath), toCanonicalBimModelKey(second.documentPath));
  assert.throws(() => {
    // @ts-expect-error Only a documentary path is accepted, never source/runtime objects.
    toCanonicalBimModelKey(first);
  });
});

test("missing documentPath never falls back to modelUrl", () => {
  const source: { documentPath?: string; modelUrl: string } = { modelUrl: "https://example.test/model.ifc" };
  for (const missing of [source.documentPath, null, "", "   "]) {
    assert.throws(() => toCanonicalBimModelKey(missing), /documentPath is required/);
  }
});

test("rejects external, temporary and protocol-relative URLs", () => {
  for (const url of ["https://example.test/model.ifc?token=1", "blob:https://example.test/id", "file:///model.ifc", "data:application/octet-stream,IFC", "//example.test/model.ifc"]) {
    assert.throws(() => toCanonicalBimModelKey(url), /not a URL or source key/);
  }
});

test("legacy source keys require an authoritative documentPath, not implicit conversion", () => {
  for (const key of ["ifc:/AR3173/Modelo.ifc", "frag:/AR3173/Modelo.ifc", "IFC:/AR3173/Modelo.ifc"]) {
    assert.throws(() => toCanonicalBimModelKey(key), /not a URL or source key/);
  }
});

test("rejects root, dot segments, repeated separators, backslashes and NUL", () => {
  for (const path of ["/", "/AR3173/../Modelo.ifc", "/AR3173/./Modelo.ifc", "/AR3173//Modelo.ifc", "/AR3173/Modelo.ifc//", "C:\\Modelo.ifc", "/AR3173/Model\0.ifc"]) {
    assert.throws(() => toCanonicalBimModelKey(path));
  }
});

test("does not decode, strip query/hash characters or normalize Unicode", () => {
  for (const path of ["/AR3173/A%2FB.ifc", "/AR3173/A?x=1#B.ifc", "/AR3173/Modèle.ifc", "/AR3173/Mode\u0300le.ifc"]) {
    assert.equal(toCanonicalBimModelKey(path), path);
  }
  assert.notEqual(toCanonicalBimModelKey("/AR3173/A%2FB.ifc"), toCanonicalBimModelKey("/AR3173/A/B.ifc"));
});

test("canonical context preserves all OCI authoring resolution results", () => {
  const fixture = createOciAuthoringFixture();
  const legacyResult = resolveAuthoringElements(fixture);
  const context = { ...fixture.context, modelKey: toCanonicalBimModelKey("/AR3173/100021-JYS01-000-ZZZ-IFC-OCI-E4-070001.ifc") };
  const result = resolveAuthoringElements({ ...fixture, context });
  assert.deepEqual(result, { ...legacyResult, context });
  assert.equal(result.elements.length, 9);
  assert.equal(result.elements.reduce((sum, element) => sum + element.graphicalLocalIds.length, 0), 179);
});
