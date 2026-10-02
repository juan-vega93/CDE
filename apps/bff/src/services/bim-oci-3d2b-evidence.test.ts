import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createQuantityObservation } from "./bim-quantity-provenance";
import { evaluateQuantityPolicy, type QuantityPolicy } from "./bim-quantity-policy";
import type { BimProcessingContext } from "./bim-revision-identity";

// Captured from the ONE authorized IFC processing, not a synthetic IFC or production rule.
const evidence = JSON.parse(readFileSync("src/services/fixtures/bim-oci-3d2b-evidence.json", "utf8").replace(/^\uFEFF/, "")) as {
  context: BimProcessingContext;
  entities: { localId: number; authoringKey: string; role: "root" | "child" | "standalone"; geometryStatus: string; metradoRaw: string }[];
};
const target = { source: "stored_parameter" as const, propertySet: "Datos_Partida", propertyName: "Metrado" };
const observations = evidence.entities.map((entity) => createQuantityObservation({
  context: evidence.context, localId: entity.localId, origin: target, occurrenceIndex: 0,
  rawValue: entity.metradoRaw, unit: { kind: "unknown" },
  authoring: { identityKey: entity.authoringKey, role: entity.role }
}));
function evaluate(strategy: "entity-sum" | "authoring-root-only" | "authoring-single-observation") {
  const policy: QuantityPolicy = { policyId: `quantity-policy/${strategy}`, version: 1, purpose: "diagnostic", target,
    numericRequirement: "finite", units: { kind: "uniform", allowAllUnknown: true }, operation: "sum" };
  return evaluateQuantityPolicy(observations, policy);
}
test("real OCI snapshot: 115 semantic / 112 present / seven authoring elements", () => {
  assert.equal(evidence.entities.length, 115);
  assert.equal(evidence.entities.filter(e => e.geometryStatus === "present").length, 112);
  assert.equal(new Set(evidence.entities.map(e => e.authoringKey)).size, 7);
});
test("real OCI: replicated observations inflate entity sum; root diagnostic does not match Revit", () => {
  const entity = evaluate("entity-sum"), root = evaluate("authoring-root-only");
  assert.equal(entity.status, "resolved"); assert.equal(root.status, "resolved");
  assert.ok(Math.abs(entity.value! - 25305.046) < 1e-8);
  assert.ok(Math.abs(root.value! - 1842.105) < 1e-8);
  const externalRevitReference = 1874.96;
  assert.ok(Math.abs((root.value! - externalRevitReference) - (-32.855)) < 1e-8);
  console.log(JSON.stringify({ entitySum: entity.value, rootDiagnostic: root.value, externalRevitReference,
    delta: root.value! - externalRevitReference, productionPolicyAuthorized: false }));
});
test("real OCI: single-observation is ambiguous, never silently zero", () => {
  const result = evaluate("authoring-single-observation");
  assert.equal(result.status, "ambiguous"); assert.equal(result.value, undefined);
  assert.equal(result.diagnostics.filter(d => d.code === "multiple_authoring_observations").length, 3);
});
