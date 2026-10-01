import assert from "node:assert/strict";
import { test } from "node:test";
import { createQuantityObservation as create, normalizeQuantityNumericValue as numeric,
  type QuantityObservationInput, type QuantityOrigin } from "./bim-quantity-provenance";
import { toCanonicalBimModelKey } from "./bim-model-identity";
import { isBimRevisionId, type BimProcessingContext } from "./bim-revision-identity";
import { createOciAuthoringFixture, OCI_COMPOSITIONS } from "./fixtures/bim-authoring-oci.fixture";

const revision = `sha256:${"a".repeat(64)}`;
if (!isBimRevisionId(revision)) throw new Error("Invalid test revision");
const context: BimProcessingContext = {
  projectCode: "AR3173", modelKey: toCanonicalBimModelKey("/AR3173/test.ifc"), revisionId: revision
};
const stored: QuantityOrigin = { source: "stored_parameter", propertySet: "Datos_Partida", propertyName: "Metrado" };
const input = (overrides: Partial<QuantityObservationInput> = {}): QuantityObservationInput => ({
  context, localId: 303708, origin: stored, occurrenceIndex: 0, rawValue: "123.45", ...overrides
});

test("stored property preserves source, entity, property identity and raw form", () => {
  const observation = create(input());
  assert.deepEqual(observation.context, context);
  assert.equal(observation.localId, 303708);
  assert.deepEqual(observation.origin, stored);
  assert.equal(observation.source, "stored_parameter");
  assert.equal(observation.rawValue, "123.45");
  assert.equal(observation.numericValue, 123.45);
  assert.equal(observation.authoring, undefined);
});
test("equal values in different entities remain separate", () => {
  const observations = [1, 2].map((localId) => create(input({ localId, rawValue: 100 })));
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0].observationKey, observations[1].observationKey);
});
test("root and child enrichment never removes observations or becomes the owner", () => {
  const observations = (["root", "child"] as const).map((role, index) => create(input({
    localId: index + 1, authoring: { identityKey: "same-authoring-element", role }
  })));
  assert.equal(observations.length, 2);
  assert.notEqual(observations[0].observationKey, observations[1].observationKey);
  assert.equal(create(input({ authoring: { identityKey: "enrichment", role: "child" } })).observationKey, create(input()).observationKey);
});
test("IFC quantity fixture retains structural type; same value/property source stays distinct", () => {
  // Synthetic already-extracted IfcElementQuantity/IfcQuantityVolume fixture.
  const qto = { expressID: 500, Name: "Qto_SlabBaseQuantities", Quantities: [
    { expressID: 501, Name: "NetVolume", type: "IfcQuantityVolume" as const, VolumeValue: 123.45 }
  ] };
  const quantity = qto.Quantities[0];
  const observation = create(input({ rawValue: quantity.VolumeValue, origin: {
    source: "ifc_quantity", quantitySet: qto.Name, quantityName: quantity.Name,
    quantityType: quantity.type, quantitySetLocalId: qto.expressID, quantityLocalId: quantity.expressID
  } }));
  assert.equal(observation.source, "ifc_quantity");
  assert.equal(observation.origin.source === "ifc_quantity" && observation.origin.quantityType, "IfcQuantityVolume");
  assert.notEqual(observation.observationKey, create(input({ rawValue: 123.45 })).observationKey);
});
test("viewer geometry is represented without computing geometry or inferring its unit", () => {
  const observation = create(input({ origin: { source: "viewer_geometry", metric: "volume", calculation: "FragmentsModel.getItemsVolume" }, rawValue: 123.45 }));
  assert.equal(observation.source, "viewer_geometry");
  assert.deepEqual(observation.unit, { kind: "unknown" });
  assert.notEqual(observation.observationKey, create(input()).observationKey);
});
for (const rawValue of ["123.45", 123.45, "123,45", "abc", "", " 123.45 ", "1,234", "1e3", "12m3", true, null, NaN, Infinity]) {
  test(`raw preservation and conservative numeric availability: ${String(rawValue)}`, () => {
    const observation = create(input({ rawValue }));
    assert.ok(Object.is(observation.rawValue, rawValue));
    const valid = rawValue === "123.45" || rawValue === 123.45;
    assert.equal("numericValue" in observation, valid);
    if (valid) assert.equal(observation.numericValue, 123.45);
  });
}
test("finite negative and zero values are not rejected by business assumptions", () => {
  assert.equal(numeric("-12.5"), -12.5); assert.equal(numeric("0"), 0);
});
test("unit requires evidence; no default Metrado unit and no conversion", () => {
  assert.deepEqual(create(input()).unit, { kind: "unknown" });
  const unit = { kind: "explicit" as const, raw: "m3", evidence: { propertySet: "Datos_Partida", propertyName: "Unidad Medida" } };
  assert.deepEqual(create(input({ unit })).unit, unit);
  assert.equal(create(input({ unit })).numericValue, 123.45);
});
test("revision/model/project isolate observations without hashing or resolving authoring", () => {
  const otherRevision = `sha256:${"b".repeat(64)}`;
  if (!isBimRevisionId(otherRevision)) throw new Error("Invalid test revision");
  const contexts = [context, { ...context, revisionId: otherRevision },
    { ...context, modelKey: toCanonicalBimModelKey("/AR3173/other.ifc") }, { ...context, projectCode: "OTHER" }];
  assert.equal(new Set(contexts.map((ctx) => create(input({ context: ctx })).observationKey)).size, 4);
});
test("same-entity repeated observations and homonymous properties remain distinguishable", () => {
  const a = create(input()), b = create(input({ occurrenceIndex: 1 }));
  const c = create(input({ origin: { ...stored, propertySet: "Other" } }));
  assert.equal(new Set([a.observationKey, b.observationKey, c.observationKey]).size, 3);
  assert.equal(a.observationKey, create(input({ rawValue: 999 })).observationKey);
  assert.equal(a.observationKey, create(input({ origin: { propertyName: "Metrado", source: "stored_parameter", propertySet: "Datos_Partida" } })).observationKey);
});
test("OCI topology supports 187 separate observations with SYNTHETIC values, not audited quantities", () => {
  const fixture = createOciAuthoringFixture();
  // OCI identity fixture explicitly excludes quantities. Reuse ONLY native IDs;
  // do not reuse its legacy modelKey or claim these values/context are OCI evidence.
  const observations = fixture.entities.map(({ localId }) => create(input({ localId, rawValue: 100 })));
  assert.equal(observations.length, 187);
  assert.equal(new Set(observations.map((o) => o.observationKey)).size, 187);
  for (const group of OCI_COMPOSITIONS) {
    assert.ok(observations.some((o) => o.localId === group.root));
    for (const child of group.children) assert.ok(observations.some((o) => o.localId === child));
  }
});
test("builder snapshots input without mutating it and rejects invalid occurrence identity", () => {
  const ctx = { ...context }; const observation = create(input({ context: ctx }));
  ctx.projectCode = "changed";
  assert.equal(observation.context.projectCode, "AR3173");
  assert.equal(Object.isFrozen(observation), true);
  assert.throws(() => create(input({ occurrenceIndex: -1 })), /occurrenceIndex/);
  assert.throws(() => create(input({ localId: 0 })), /localId/);
});
