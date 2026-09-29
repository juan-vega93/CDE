import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareBimIfcInput, toBimRevisionId, type BimRevisionId } from "./bim-revision-identity";
import { toCanonicalBimModelKey } from "./bim-model-identity";
import { resolveAuthoringElements } from "./bim-authoring-resolver";
import { createOciAuthoringFixture } from "./fixtures/bim-authoring-oci.fixture";

test("same bytes produce a deterministic SHA-256 matching a known vector", () => {
  const bytes = Buffer.from("abc");
  assert.equal(toBimRevisionId(bytes), "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  assert.equal(toBimRevisionId(bytes), toBimRevisionId(Buffer.from(bytes)));
  assert.match(toBimRevisionId(bytes), /^sha256:[0-9a-f]{64}$/);
});

test("one changed byte changes revision identity", () => {
  assert.notEqual(toBimRevisionId(Buffer.from([0, 1, 2])), toBimRevisionId(Buffer.from([0, 1, 3])));
});

test("hashes exact bytes without newline normalization", () => {
  assert.notEqual(toBimRevisionId(Buffer.from("ABC")), toBimRevisionId(Buffer.from("ABC\n")));
  assert.notEqual(toBimRevisionId(Buffer.from("ABC\n")), toBimRevisionId(Buffer.from("ABC\r\n")));
});

test("rejects empty buffers and non-byte input", () => {
  for (const bytes of [Buffer.alloc(0), new Uint8Array(0)]) {
    assert.throws(() => toBimRevisionId(bytes), /non-empty IFC bytes/);
  }
  assert.throws(() => {
    // @ts-expect-error Text/metadata is not an IFC byte buffer.
    toBimRevisionId("current");
  }, /non-empty IFC bytes/);
});

test("typed-array slices hash only their visible bytes, including Buffer slices", () => {
  for (const bytes of [new Uint8Array([9, 97, 98, 99, 9]), Buffer.from([9, 97, 98, 99, 9])]) {
    assert.equal(toBimRevisionId(bytes.subarray(1, 4)), toBimRevisionId(Buffer.from("abc")));
  }
});

test("metadata and logical model identity are independent from content revision", () => {
  const first = { projectCode: "P1", documentPath: "/A.ifc", ifcBuffer: Buffer.from("abc"), filename: "A", sourceHash: "etag1", versionKey: "v1", modelKey: "frag:/a.ifc", runtimeModelId: "runtime1", sourceVersion: "current" };
  const second = { ...first, documentPath: "/B.ifc", filename: "B", sourceHash: "etag2", versionKey: "v2", modelKey: "ifc:/b.ifc", runtimeModelId: "runtime2", sourceVersion: "old" };
  const a = prepareBimIfcInput(first), b = prepareBimIfcInput(second);
  assert.equal(a.context.revisionId, b.context.revisionId);
  assert.notEqual(a.context.modelKey, b.context.modelKey);
  assert.deepEqual(a.context, { projectCode: "P1", modelKey: toCanonicalBimModelKey("/A.ifc"), revisionId: toBimRevisionId(first.ifcBuffer) });
  assert.deepEqual(Object.keys(a.context).sort(), ["modelKey", "projectCode", "revisionId"]);
});

test("processing snapshot retains hashed bytes when caller buffer changes during awaits", async () => {
  const input = { projectCode: "P1", documentPath: "/A.ifc", ifcBuffer: Buffer.from("abc") };
  const prepared = prepareBimIfcInput(input);
  const expected = toBimRevisionId(input.ifcBuffer);
  input.ifcBuffer.fill(0);
  await Promise.resolve();
  assert.deepEqual(prepared.ifcBytes, new Uint8Array([97, 98, 99]));
  assert.equal(prepared.context.revisionId, expected);
  assert.equal(toBimRevisionId(prepared.ifcBytes), prepared.context.revisionId);
  assert.ok(Object.isFrozen(prepared.context));
});

test("processing rejects missing project, URL-only paths and empty content", () => {
  const input = { projectCode: "P1", documentPath: "/A.ifc", ifcBuffer: Buffer.from("abc") };
  assert.throws(() => prepareBimIfcInput({ ...input, projectCode: " " }), /projectCode/);
  assert.throws(() => prepareBimIfcInput({ ...input, documentPath: "https://example.test/A.ifc" }));
  assert.throws(() => prepareBimIfcInput({ ...input, ifcBuffer: Buffer.alloc(0) }), /non-empty/);
});

test("branded revision cannot be replaced by a model key or arbitrary string", () => {
  const revision = toBimRevisionId(Buffer.from("abc"));
  // @ts-expect-error Model and content identity are different dimensions.
  const modelAsRevision: BimRevisionId = toCanonicalBimModelKey("/A.ifc");
  // @ts-expect-error Arbitrary strings are not computed content identities.
  const arbitraryRevision: BimRevisionId = "current";
  assert.notEqual(revision, modelAsRevision);
  assert.notEqual(revision, arbitraryRevision);
});

test("canonical processing context preserves OCI resolver results without claiming fixture digest reproduction", () => {
  const fixture = createOciAuthoringFixture();
  assert.match(fixture.context.revisionId, /^sha256:[0-9a-f]{64}$/);
  // Synthetic bytes exercise the context contract, not the provenance of OCI facts.
  const { context } = prepareBimIfcInput({ projectCode: fixture.context.projectCode, documentPath: "/AR3173/Modelo.ifc", ifcBuffer: Buffer.from("synthetic context test") });
  const original = resolveAuthoringElements(fixture);
  const result = resolveAuthoringElements({ ...fixture, context });
  assert.deepEqual(result, { ...original, context });
  assert.equal(result.elements.length, 9);
});
