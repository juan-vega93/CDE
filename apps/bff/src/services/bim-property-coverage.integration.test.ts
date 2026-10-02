import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { after, test } from "node:test";
import * as WEBIFC from "web-ifc";
import { getDatabasePool } from "../db/client";
import { getBimElementProperties, getBimPropertyCatalog, getBimPropertyIndex, queryBimPropertyLocalIds, queryBimPropertyAuditRecords, getBimCost5DAggregation } from "../db/bim-index-store";
import { indexBimPropertiesFromBuffer, readAdaptiveIfcPropertySets } from "./bim-property-indexer.service";
import { createPropertyCoverageIfcFixture } from "./fixtures/bim-property-coverage-ifc.fixture";

const enabled = Boolean(process.env.DATABASE_URL);
const projectCode = `TEST-COVERAGE-${randomUUID()}`;
const modelKey = "/TEST/coverage.ifc";
after(async () => {
  if (!enabled) return;
  const pool = getDatabasePool();
  try {
    for (const table of ["cde_bim_authoring_contexts", "cde_bim_models", "cde_bim_index_jobs"]) await pool.query(`delete from ${table} where project_code=$1`, [projectCode]);
  } finally { await pool.end(); }
});

// Independent oracle for this fixture's flat scalar sets. Reflects the runtime
// inspector's supported collections/fields, not production flattening/caps.
async function observableFixtureProperties(bytes: Buffer) {
  const api = new WEBIFC.IfcAPI(); let model = -1;
  try {
    api.SetWasmPath(path.dirname(require.resolve("web-ifc/web-ifc-node.wasm")) + path.sep, true);
    await api.Init(undefined, true); model = api.OpenModel(bytes);
    const sets = [
      ...await api.properties.getPropertySets(model, 303839, true, true),
      ...await api.properties.getPropertySets(model, 303839, true, false)
    ];
    const observed = sets.flatMap((set) => {
      const category = api.GetNameFromTypeCode(set.type) === "IfcElementQuantity" ? "quantity" : "pset";
      return (set.HasProperties ?? set.Quantities).map((p: { Name: { value: string }; NominalValue?: { value: unknown }; VolumeValue?: { value: unknown }; AreaValue?: { value: unknown } }) => ({
        category, set: set.Name.value as string, name: p.Name.value,
        value: String((p.NominalValue ?? p.VolumeValue ?? p.AreaValue)!.value)
      }));
    });
    const adaptive = await readAdaptiveIfcPropertySets({ readPropertySets: (recursive, typed) => api.properties.getPropertySets(model, 303839, recursive, typed) });
    assert.equal(adaptive.length, sets.length, "adaptive merge must retain every distinct set");
    return observed as { category: string; set: string; name: string; value: string }[];
  } finally { if (model >= 0) api.CloseModel(model); api.Dispose(); }
}

test("property coverage reaches persistent SmartView, QA and 5D consumers", { skip: !enabled }, async (t) => {
  const bytes = createPropertyCoverageIfcFixture();
  // Oracle has its own test model; the processing invocation must still open once.
  const observed = await observableFixtureProperties(bytes);
  const open = t.mock.method(WEBIFC.IfcAPI.prototype, "OpenModel");
  const result = await indexBimPropertiesFromBuffer({ projectCode, modelKey, documentPath: modelKey, documentName: "coverage.ifc", ifcBuffer: bytes });
  assert.equal(open.mock.callCount(), 1);
  const persisted = await getBimElementProperties({ projectCode, modelKey, localId: 303839 });
  assert.ok(persisted);
  const indexed = persisted.propertySets.flatMap((s) => s.properties.map((p) => ({ set: s.name, name: p.name, value: String(p.value) })));
  const categoryBySet = new Map(observed.map((p) => [p.set, p.category]));
  const signature = (p: { category?: string; set: string; name: string; value: string }) => JSON.stringify([p.category ?? (p.set === "Atributos IFC" ? "attribute" : categoryBySet.get(p.set)), p.set, p.name, p.value]);
  await t.test("observable scalar sets match persisted coverage, with explained synthetic attribute extras", () => {
    const actual = new Set(indexed.map(signature));
    const expected = new Set(observed.map(signature));
    const missing = [...expected].filter((key) => !actual.has(key));
    const extras = [...actual].filter((key) => !expected.has(key));
    t.diagnostic(JSON.stringify({ localId: 303839, observablePropertyCount: expected.size, indexedPropertyCount: actual.size, missingFromIndex: missing, extraInIndex: extras }));
    assert.deepEqual(missing, []);
    assert.deepEqual(extras.sort(), [signature({ set: "Atributos IFC", name: "IFC Class", value: "IfcSlab" }), signature({ set: "Atributos IFC", name: "Express ID", value: "303839" })].sort());
    assert.ok(persisted.name); assert.ok(persisted.globalId); assert.equal(persisted.ifcClass, "IfcSlab");
  });
  await t.test("instance, arbitrary custom, type, standard and quantities persist beyond both old caps", () => {
    for (const [set, name, value] of [
      ["Datos_Partida", "Metrado", "123.45"], ["MiPsetPersonalizado", "MiParametro", "arbitrary-custom"],
      ["CustomTypePset", "TypeParameter", "type-custom"], ["Pset_SlabCommon", "IsExternal", "false"],
      ["Qto_SlabBaseQuantities", "NetVolume", "120"], ["Datos_Partida", "Field120", "value120"],
      ["CustomSet63", "Parameter", "value63"], ["Descripcion del elemento", "ID elemento", "1693104"]
    ]) assert.ok(indexed.some((p) => p.set === set && p.name === name && p.value === value), `${set}.${name}`);
  });
  await t.test("SmartView catalog and filters expose both custom properties", async () => {
    const catalog = await getBimPropertyCatalog({ projectCode, modelKeys: [modelKey] });
    const index = await getBimPropertyIndex({ projectCode, modelKeys: [modelKey] });
    for (const [setName, propertyName, propertyValue] of [["Datos_Partida", "Metrado", "123.45"], ["MiPsetPersonalizado", "MiParametro", "arbitrary-custom"]]) {
      assert.ok(catalog.propertiesBySet[setName]?.includes(propertyName));
      assert.ok(index.propertiesBySet[setName]?.includes(propertyName));
      assert.deepEqual(await queryBimPropertyLocalIds({ projectCode, modelKeys: [modelKey], property: { setName, propertyName }, propertyValue }), { [modelKey]: [303839] });
    }
  });
  await t.test("QA custom property is retrievable through the audit query", async () => {
    const rows = await queryBimPropertyAuditRecords({ projectCode, modelKeys: [modelKey], property: { setName: "MiPsetPersonalizado", propertyName: "MiParametro" }, operator: "equals", value: "arbitrary-custom", maxResults: 500 });
    assert.deepEqual(rows.filter((r) => r.matches).map((r) => r.localId), [303839]);
    assert.deepEqual(rows.find((r) => r.localId === 303839)?.values, ["arbitrary-custom"]);
  });
  await t.test("5D mapped Metrado is reachable without changing aggregation semantics", async () => {
    const data = await getBimCost5DAggregation({ projectCode, modelKeys: [modelKey], itemId: { setName: "Datos_Partida", propertyName: "Partida" }, quantity: { setName: "Datos_Partida", propertyName: "Metrado" } });
    assert.equal(data.rows.find((r) => r.itemId === "TEST-COVERAGE")?.quantity, 123.45);
  });
  await t.test("provenance remains independently extracted with native IDs and occurrences", () => {
    const root = result.quantityObservations.filter((o) => o.localId === 303839);
    assert.equal(root.length, observed.length);
    assert.equal(new Set(root.map((o) => o.observationKey)).size, root.length);
    assert.ok(root.some((o) => o.origin.source === "stored_parameter" && o.origin.propertySet === "Datos_Partida" && o.numericValue === 123.45));
  });
});
