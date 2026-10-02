import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
import { createStoredReplicaConsolidator, type ReplicaSource } from "./bim-cost-replicas";
import type { BimProcessingContext } from "../services/bim-revision-identity";
const evidence = JSON.parse(fs.readFileSync("src/services/fixtures/bim-oci-3f-evidence.json", "utf8")) as {
  context: BimProcessingContext;
  authoringElements: { element_key: string; resolution_method: string; root_local_id: number | null }[];
  members: { localId: number; authoringKey: string; geometryStatus: string; metradoNumeric: number }[];
};
const sources: ReplicaSource[] = evidence.authoringElements.map(a => ({ ...a,
  model_key: evidence.context.modelKey, project_code: evidence.context.projectCode,
  canonical_model_key: evidence.context.modelKey, revision_id: evidence.context.revisionId,
  member_ids: evidence.members.filter(m => m.authoringKey === a.element_key).map(m => m.localId),
  graphical_ids: evidence.members.filter(m => m.authoringKey === a.element_key && m.geometryStatus === "present").map(m => m.localId)
}));
const observations = () => ({ [evidence.context.modelKey]: evidence.members.map(m => ({ localId: m.localId, value: m.metradoNumeric, candidates: 1 })) });
test("real OCI: 115 observations -> 7 logical quantities, 112 graphical memberships", () => {
  const rows = createStoredReplicaConsolidator(sources)(observations(), "m3", "stored_parameter");
  assert.equal(rows.length, 7); assert.ok(rows.every(r => r.status === "resolved"));
  assert.equal(rows.reduce((sum, r) => sum + r.graphicalLocalIds.length, 0), 112);
  assert.equal(rows.reduce((sum, r) => sum + r.replicaCount, 0), 108);
  assert.equal(Number(rows.reduce((sum, r) => sum + r.quantity!, 0).toFixed(3)), 1842.105);
  const a5 = rows.find(r => r.identityKey === "aggregate:209862")!;
  assert.equal(a5.memberLocalIds.length, 73); assert.equal(a5.graphicalLocalIds.length, 72);
  assert.equal(a5.representativeLocalId, 209862); assert.equal(a5.quantity, 156.616);
  assert.equal(a5.replicaCount, 72);
});
for (const kind of ["conflict", "missing", "duplicate", "split", "unit", "fallback", "root"] as const) {
  test(`strict policy rejects ${kind}; never silently substitutes root or zero`, () => {
    const input = observations(), changed = structuredClone(sources);
    const entries = input[evidence.context.modelKey];
    if (kind === "conflict") entries[0].value++;
    if (kind === "missing") entries[0].value = NaN;
    if (kind === "duplicate") entries[0].candidates = 2;
    if (kind === "split") entries.shift();
    if (kind === "fallback") changed[0].resolution_method = "singleton_fallback";
    if (kind === "root") changed[0].root_local_id = null;
    const rows = createStoredReplicaConsolidator(changed)(input, kind === "unit" ? "-" : "m3", "stored_parameter");
    assert.equal(rows[0].quantity, null); assert.equal(rows[0].status, "ambiguous");
  });
}
test("equal values in separate authoring identities are not deduplicated", () => {
  const members = [1,2].map(id => ({ ...sources[0], element_key: `entity:${id}`, member_ids: [id], graphical_ids: [id], root_local_id: id, resolution_method: "standalone" }));
  const rows = createStoredReplicaConsolidator(members)({ [evidence.context.modelKey]: [1,2].map(localId => ({ localId, value: 10, candidates: 1 })) }, "m3", "stored_parameter");
  assert.equal(rows.length, 2); assert.equal(rows.reduce((sum,r) => sum + r.quantity!,0),20);
});
test("missing and ambiguous model/revision transport cannot merge observations", () => {
  assert.throws(() => createStoredReplicaConsolidator([])(observations(), "m3", "stored_parameter"));
  assert.throws(() => createStoredReplicaConsolidator([...sources, ...sources])(observations(), "m3", "stored_parameter"));
});
test("stored policy rejects semantic IFC quantities and viewer geometry even when numbers coincide", () => {
  for (const source of ["ifc_quantity", "viewer_geometry"] as const) {
    assert.throws(() => createStoredReplicaConsolidator(sources)(observations(), "m3", source), /cannot consume/);
  }
});
