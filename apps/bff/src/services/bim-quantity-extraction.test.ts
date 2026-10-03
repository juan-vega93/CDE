import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import Module from "node:module";
import { test } from "node:test";
import * as WEBIFC from "web-ifc";
import * as store from "../db/bim-index-store";
import * as authoringStore from "../db/bim-authoring-store";
import * as extraction from "./bim-quantity-extraction";
import * as resolver from "./bim-authoring-resolver";
import { prepareBimIfcInput } from "./bim-revision-identity";
import { evaluateQuantityPolicy, type QuantityPolicy } from "./bim-quantity-policy";
import { createQuantityIfcFixture } from "./fixtures/bim-quantity-ifc.fixture";

test("IFC logical and boolean values preserve their meanings with real web-ifc", async (t) => {
  const cases = [
    ["IFCLOGICAL(.T.)", true], ["IFCLOGICAL(.F.)", false], ["IFCLOGICAL(.U.)", ".U."],
    ["IFCBOOLEAN(.T.)", true], ["IFCBOOLEAN(.F.)", false]
  ] as const;
  const lines = cases.map(([value], i) => `#${4000000 + i}=IFCPROPERTYSINGLEVALUE('Flag${i}',$,${value},$);`);
  lines.push(
    "#4000010=IFCPROPERTYSET('0000000000000000400010',$,'LogicalEvidence',$,(#4000000,#4000001,#4000002,#4000003,#4000004));",
    "#4000011=IFCRELDEFINESBYPROPERTIES('0000000000000000400011',$,$,$,(#303839,#308027),#4000010);"
  );
  const bytes = Buffer.from(createQuantityIfcFixture().toString().replace("\nENDSEC;\nEND-ISO", `\n${lines.join("\n")}\nENDSEC;\nEND-ISO`));
  const prepared = prepareBimIfcInput({ projectCode: "TEST", documentPath: "/TEST/logical.ifc", ifcBuffer: bytes });
  const api = new WEBIFC.IfcAPI(); let id = -1;
  try {
    api.SetWasmPath(path.dirname(require.resolve("web-ifc/web-ifc-node.wasm")) + path.sep, true);
    await api.Init(undefined, true); id = api.OpenModel(prepared.ifcBytes);
    assert.ok(id >= 0);
    const authoring = resolver.resolveAuthoringElements({ context: prepared.context, entities: [], relations: [] });
    const result = extraction.extractIfcQuantityObservations(api, id, prepared.context, authoring);
    assert.deepEqual(result.quantityExtractionDiagnostics, []);
    const flags = result.quantityObservations.filter((o) => o.origin.source === "stored_parameter" && o.origin.propertySet === "LogicalEvidence");
    assert.equal(flags.length, 10, "both assignments retain every occurrence");
    assert.equal(new Set(flags.map((o) => o.observationKey)).size, 10);
    for (const [i, [token, expected]] of cases.entries()) await t.test(token, () => {
      const value = api.GetLine(id, 4000000 + i).NominalValue;
      assert.equal(value.name, token.startsWith("IFCLOGICAL") ? "IFCLOGICAL" : "IFCBOOLEAN");
      assert.equal(value.value, expected === ".U." ? undefined : expected);
      const occurrences = flags.filter((o) => o.origin.source === "stored_parameter" && o.origin.propertyLocalId === 4000000 + i);
      assert.equal(occurrences.length, 2);
      assert.ok(occurrences.every((o) => o.rawValue === expected && o.numericValue === undefined));
    });
    await t.test("unsupported scalar is diagnosed, not coerced into logical unknown", () => {
      const getLine = api.GetLine.bind(api);
      t.mock.method(api, "GetLine", (...args: Parameters<typeof api.GetLine>) => {
        const line = getLine(...args);
        return args[1] === 4000002 ? { ...line, NominalValue: { name: "UNSUPPORTED", value: undefined } } : line;
      });
      const unsupported = extraction.extractIfcQuantityObservations(api, id, prepared.context, authoring);
      assert.deepEqual(unsupported.quantityExtractionDiagnostics, [303839, 308027].map((localId) => ({ localId, nativeId: 4000002, reason: "unsupported_scalar" })));
      assert.equal(unsupported.quantityObservations.length, result.quantityObservations.length - 2);
    });
  } finally { if (id >= 0) api.CloseModel(id); api.Dispose(); }
});

test("real IFC pipeline extracts provenance alongside unchanged legacy output", async (t) => {
  const payloads: unknown[] = [];
  // CJS module boundary only: real web-ifc/indexer; no production injection seam.
  const modules = Module as unknown as { _load: (request: string, ...args: unknown[]) => unknown };
  const load = modules._load;
  const extract = t.mock.fn(extraction.extractIfcQuantityObservations);
  const resolve = t.mock.fn(resolver.resolveAuthoringElements);
  const persist = t.mock.fn(async (...args: unknown[]) => { void args; });
  let disabled = true;
  t.mock.method(modules, "_load", function (request: string, ...args: unknown[]) {
    if (request === "../db/bim-quantity-store") return { replaceGenerationQuantityObservations: persist };
    if (request === "../db/bim-index-generations") return {
      createBimIndexGeneration: async () => "test-generation",
      failBimIndexGeneration: async () => undefined,
      publishBimIndexGeneration: async () => undefined
    };
    if (request === "../db/bim-index-store") return { ...store,
      upsertBimIndexJob: async () => undefined, getBimIndexJob: async () => ({ status: "processing" }),
      upsertBimModel: async () => ({ id: "test-model" }),
      bulkUpsertBimElements: async (_id: string, elements: unknown) => { payloads.push(elements); } };
    if (request === "../db/bim-authoring-store") return { ...authoringStore, replaceAuthoringElementIndex: async () => undefined };
    if (request === "./bim-authoring-resolver") return { ...resolver, resolveAuthoringElements: resolve };
    if (request === "./bim-quantity-extraction") return { ...extraction, extractIfcQuantityObservations: (...args: Parameters<typeof extract>) => disabled ? { quantityObservations: [], quantityExtractionDiagnostics: [] } : extract(...args) };
    return load.call(Module, request, ...args);
  });
  const { indexBimPropertiesFromBuffer, indexPreparedBimProperties } = await import("./bim-property-indexer.service.js");
  const input = { projectCode: "TEST", documentPath: "/TEST/quantity.ifc", documentName: "quantity.ifc", modelKey: "legacy-alias", ifcBuffer: createQuantityIfcFixture() };
  // Baseline = identical legacy pipeline with the new observer disabled, DB mocked.
  await indexBimPropertiesFromBuffer(input);
  const baseline = structuredClone(payloads); payloads.length = 0;
  disabled = false;
  resolve.mock.resetCalls();
  persist.mock.resetCalls();
  const open = t.mock.method(WEBIFC.IfcAPI.prototype, "OpenModel");
  const hash = t.mock.method(crypto, "createHash");
  const prepared = prepareBimIfcInput(input);
  const result = await indexPreparedBimProperties(input, prepared);
  const observations = result.quantityObservations;
  await t.test("one open, hash, resolver and extraction; prepared context passed directly", () => {
    assert.equal(open.mock.callCount(), 1);
    assert.equal(hash.mock.calls.filter((c) => c.arguments[0] === "sha256").length, 1);
    assert.equal(resolve.mock.callCount(), 1); assert.equal(extract.mock.callCount(), 1);
    assert.equal(extract.mock.calls[0].arguments[2], prepared.context);
    assert.equal(result.context, prepared.context);
    assert.ok(observations.every((o) => JSON.stringify(o.context) === JSON.stringify(prepared.context)));
  });
  await t.test("legacy batches unchanged; exact extracted provenance passed once to generation persistence", () => {
    assert.deepEqual(payloads, baseline);
    assert.ok(!JSON.stringify(payloads).includes("observationKey"));
    assert.deepEqual(result.quantityExtractionDiagnostics, []);
    assert.equal(persist.mock.callCount(), 1);
    assert.equal(persist.mock.calls[0].arguments[1], prepared.context);
    assert.equal(persist.mock.calls[0].arguments[2], observations);
  });
  const stored = observations.filter((o) => o.origin.source === "stored_parameter" && o.origin.propertySet === "Datos_Partida");
  await t.test("real stored parameter replicated across root, seven children and standalone", () => {
    assert.equal(stored.length, 9);
    assert.ok(stored.every((o) => o.source === "stored_parameter" && o.rawValue === 100 && o.numericValue === 100));
    assert.deepEqual(stored.find((o) => o.localId === 303839)?.origin, { source: "stored_parameter", propertySet: "Datos_Partida", propertyName: "Metrado", propertySetLocalId: 2000002, propertyLocalId: 2000001, valueField: "NominalValue" });
  });
  await t.test("real IFC simple quantity types and native IDs are separate from properties", () => {
    const q = observations.filter((o) => o.origin.source === "ifc_quantity");
    assert.equal(q.length, 6);
    assert.deepEqual(q.map((o) => o.origin.source === "ifc_quantity" && o.origin.quantityType), ["IfcQuantityVolume", "IfcQuantityArea", "IfcQuantityLength", "IfcQuantityCount", "IfcQuantityWeight", "IfcQuantityTime"]);
    assert.deepEqual(q[0].origin, { source: "ifc_quantity", quantitySet: "Qto_SlabBaseQuantities", quantityName: "NetVolume", quantityType: "IfcQuantityVolume", quantitySetLocalId: 2000010, quantityLocalId: 2000004 });
    assert.equal(q[0].numericValue, 90);
    assert.ok(stored.some((o) => o.localId === q[0].localId));
    assert.ok(observations.every((o) => o.source !== "viewer_geometry"));
  });
  await t.test("distinct homonymous occurrences survive legacy dedup", () => {
    const dup = observations.filter((o) => o.origin.source === "stored_parameter" && o.origin.propertySet === "DuplicateSet");
    assert.equal(dup.length, 2); assert.equal(dup[0].rawValue, dup[1].rawValue);
    assert.notEqual(dup[0].occurrenceIndex, dup[1].occurrenceIndex);
    assert.notEqual(dup[0].observationKey, dup[1].observationKey);
    const root = (payloads.flat() as { localId: number; properties: { setName: string }[] }[]).find((e) => e.localId === 303839)!;
    assert.equal(root.properties.filter((p) => p.setName === "DuplicateSet").length, 1);
  });
  await t.test("authoring roles come from the resolver and unmatched project observations survive", () => {
    assert.equal(stored.find((o) => o.localId === 303839)?.authoring?.role, "root");
    assert.equal(stored.find((o) => o.localId === 303708)?.authoring?.role, "child");
    assert.equal(stored.find((o) => o.localId === 308027)?.authoring?.role, "standalone");
    assert.equal(stored.find((o) => o.localId === 303708)?.authoring?.identityKey, "aggregate:303839");
    const raw = observations.find((o) => o.localId === 7)!;
    assert.equal(raw.authoring, undefined); assert.equal(raw.rawValue, " 123,45 "); assert.equal(raw.numericValue, undefined);
  });
  await t.test("explicit IFC unit evidence retained; absent unit not inferred from quantity or project", () => {
    assert.deepEqual(stored[0].unit, { kind: "explicit", raw: "CUBIC_METRE", evidence: { ifcUnitLocalId: 2000000 } });
    const area = observations.find((o) => o.origin.source === "ifc_quantity" && o.origin.quantityType === "IfcQuantityArea")!;
    assert.deepEqual(area.unit, { kind: "unknown" });
  });
  await t.test("3B policies consume real extraction without selecting a contractual policy", () => {
    const policy: QuantityPolicy = { policyId: "quantity-policy/entity-sum", version: 1, purpose: "diagnostic", target: { source: "stored_parameter", propertySet: "Datos_Partida", propertyName: "Metrado" }, numericRequirement: "finite", units: { kind: "exact", raw: "CUBIC_METRE" }, operation: "sum" };
    assert.equal(evaluateQuantityPolicy(observations, policy).value, 900);
    assert.equal(evaluateQuantityPolicy(observations, { ...policy, policyId: "quantity-policy/authoring-root-only" }).value, 200);
    assert.equal(evaluateQuantityPolicy(observations, { ...policy, policyId: "quantity-policy/authoring-single-observation" }).status, "ambiguous");
  });
  await t.test("same bytes yield stable observation keys and values", async () => {
    assert.deepEqual((await indexPreparedBimProperties(input, prepared)).quantityObservations, observations);
  });
  await t.test("type assignments and nested single properties preserve zero, null and boolean", () => {
    const typed = observations.filter((o) => o.origin.source === "stored_parameter" && o.origin.propertySet === "TypeData");
    assert.equal(typed.length, 3);
    assert.deepEqual(typed.map((o) => o.rawValue), [0, null, true]);
    assert.deepEqual(typed.map((o) => o.numericValue), [0, undefined, undefined]);
    assert.ok(typed.every((o) => o.localId === 308027 && o.authoring?.role === "standalone"));
  });
  await t.test("explicit prefix and derived unit evidence are encoded without conversion", () => {
    const units = observations.filter((o) => o.origin.source === "stored_parameter" && o.origin.propertySet === "UnitEvidence");
    assert.deepEqual(units.map((o) => o.numericValue), [5, 5]);
    assert.deepEqual(units[0].unit, { kind: "explicit", raw: JSON.stringify({ ifcType: "IfcDerivedUnit", unitType: "USERDEFINED", userDefinedType: "test cubic length", components: [{ unit: "METRE", exponent: 3 }] }), evidence: { ifcUnitLocalId: 2000061 } });
    assert.deepEqual(units[1].unit, { kind: "explicit", raw: "MILLI.METRE", evidence: { ifcUnitLocalId: 2000063 } });
  });
});

test("installed IFC4X3 schema extracts IfcQuantityNumber without guessing its type", async () => {
  const prepared = prepareBimIfcInput({ projectCode: "TEST", documentPath: "/TEST/number.ifc", ifcBuffer: createQuantityIfcFixture("IFC4X3_ADD2") });
  const api = new WEBIFC.IfcAPI(); let id = -1;
  try {
    api.SetWasmPath(path.dirname(require.resolve("web-ifc/web-ifc-node.wasm")) + path.sep, true);
    await api.Init(undefined, true); id = api.OpenModel(prepared.ifcBytes);
    assert.ok(id >= 0);
    const authoring = resolver.resolveAuthoringElements({ context: prepared.context, entities: [], relations: [] });
    const result = extraction.extractIfcQuantityObservations(api, id, prepared.context, authoring);
    const number = result.quantityObservations.find((o) => o.origin.source === "ifc_quantity" && o.origin.quantityType === "IfcQuantityNumber");
    assert.equal(number?.numericValue, 7);
    assert.equal(number?.authoring, undefined);
  } finally { if (id >= 0) api.CloseModel(id); api.Dispose(); }
});
