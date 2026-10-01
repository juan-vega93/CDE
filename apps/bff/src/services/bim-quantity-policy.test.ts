import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluateQuantityPolicy as evaluate, type QuantityPolicy } from "./bim-quantity-policy";
import { createQuantityObservation as create, type QuantityObservationInput } from "./bim-quantity-provenance";
import { isBimRevisionId, type BimProcessingContext } from "./bim-revision-identity";
import { toCanonicalBimModelKey } from "./bim-model-identity";
import { OCI_COMPOSITIONS } from "./fixtures/bim-authoring-oci.fixture";

const revisionId = `sha256:${"a".repeat(64)}`;
if (!isBimRevisionId(revisionId)) throw new Error("Invalid fixture revision");
const context: BimProcessingContext = { projectCode: "TEST", modelKey: toCanonicalBimModelKey("/TEST/model.ifc"), revisionId };
const unit = (raw: string) => ({ kind: "explicit" as const, raw, evidence: { propertySet: "Datos_Partida", propertyName: "Unidad Medida" } });
const target = { source: "stored_parameter" as const, propertySet: "Datos_Partida", propertyName: "Metrado" };
const policy = (strategy: "entity-sum" | "authoring-root-only" | "authoring-single-observation" = "entity-sum", extra: Partial<QuantityPolicy> = {}): QuantityPolicy => ({
  policyId: `quantity-policy/${strategy}`, version: 1, purpose: "diagnostic", target,
  numericRequirement: "finite", units: { kind: "exact", raw: "m3" }, operation: "sum", ...extra
});
const observation = (localId: number, rawValue: string | number, extra: Partial<QuantityObservationInput> = {}) => create({
  context, localId, rawValue, origin: target, occurrenceIndex: 0, unit: unit("m3"), ...extra
});
const composition = () => ["root", "child", "child"].map((role, i) => observation(i + 1, 100, {
  authoring: { identityKey: "composition:1", role: role as "root" | "child" }
}));
const has = (result: ReturnType<typeof evaluate>, code: string) => result.diagnostics.some((d) => d.code === code);

test("ENTITY_SUM sums every eligible observation, including equal values", () => {
  const r = evaluate([observation(1,10),observation(2,10),observation(3,20)],policy());
  assert.equal(r.status,"resolved"); assert.equal(r.value,40); assert.equal(r.includedObservationKeys.length,3);
});
test("root and replicated children are 300 under ENTITY_SUM, not deduplicated", () => {
  assert.equal(evaluate(composition(),policy()).value,300);
});
test("ROOT_ONLY is explicitly diagnostic and selects exactly the root", () => {
  const data = composition(); const r=evaluate(data,policy("authoring-root-only"));
  assert.equal(r.value,100); assert.equal(r.policy.purpose,"diagnostic");
  assert.deepEqual(r.includedObservationKeys,[data[0].observationKey]);
  assert.equal(r.trace.filter((t)=>t.reason==="child_not_selected").length,2);
});
test("different child values are not silently max/min alternatives to the root", () => {
  const data=composition(); const other=observation(2,999,{authoring:data[1].authoring});
  assert.equal(evaluate([data[0],other],policy("authoring-root-only")).value,100);
  assert.equal(evaluate([data[0],other],policy()).value,1099);
});
test("two root occurrences are ambiguous even with equal values", () => {
  const data=composition(); data.push(observation(1,100,{occurrenceIndex:1,authoring:data[0].authoring}));
  const r=evaluate(data,policy("authoring-root-only"));
  assert.equal(r.status,"ambiguous"); assert.equal(r.value,undefined); assert.ok(has(r,"multiple_authoring_observations"));
  assert.equal(r.includedObservationKeys.length,0);
});
test("SINGLE_OBSERVATION refuses root/child replicas", () => {
  const r=evaluate(composition(),policy("authoring-single-observation"));
  assert.equal(r.status,"ambiguous"); assert.equal(r.value,undefined);
});
test("SINGLE_OBSERVATION accepts exactly one eligible observation without choosing a role", () => {
  const r=evaluate([composition()[1]],policy("authoring-single-observation"));
  assert.equal(r.status,"resolved"); assert.equal(r.value,100);
});
test("ROOT_ONLY includes standalone", () => {
  const r=evaluate([observation(7,12,{authoring:{identityKey:"single:7",role:"standalone"}})],policy("authoring-root-only"));
  assert.equal(r.value,12);
});
for(const strategy of ["authoring-root-only","authoring-single-observation"] as const){
  test(`${strategy}: missing authoring is not inferred`,()=>{
    const r=evaluate([observation(1,10)],policy(strategy));
    assert.equal(r.status,"not_evaluable"); assert.ok(has(r,"missing_authoring")); assert.equal(r.value,undefined);
  });
  test(`${strategy}: zero eligible observations in an observed group is explicit`,()=>{
    const r=evaluate([observation(1,"invalid",{authoring:{identityKey:"ae",role:"root"}})],policy(strategy));
    assert.equal(r.status,"not_evaluable"); assert.ok(has(r,"zero_authoring_observations"));
  });
}
test("root absence cannot become zero or a child fallback",()=>{
  const r=evaluate(composition().slice(1),policy("authoring-root-only"));
  assert.equal(r.status,"not_evaluable"); assert.equal(r.value,undefined); assert.ok(has(r,"zero_authoring_observations"));
});
test("source and complete structural property identity prevent accidental mixing",()=>{
  const data=[observation(1,10),observation(1,10,{origin:{source:"ifc_quantity",quantitySet:"Datos_Partida",quantityName:"Metrado",quantityType:"IfcQuantityVolume"}}),
    observation(1,10,{origin:{...target,propertySet:"Other"}}),observation(1,10,{origin:{source:"viewer_geometry",metric:"volume",calculation:"test"}})];
  const r=evaluate(data,policy()); assert.equal(r.value,10);
  assert.equal(r.trace.filter(t=>t.reason==="source_mismatch").length,2);
  assert.equal(r.trace.filter(t=>t.reason==="quantity_mismatch").length,1);
});
test("IFC target matches set/name/type; geometry target matches metric/calculation",()=>{
  const q={source:"ifc_quantity" as const,quantitySet:"Qto",quantityName:"Volume",quantityType:"IfcQuantityVolume" as const};
  const g={source:"viewer_geometry" as const,metric:"volume" as const,calculation:"existing-calculation"};
  const data=[observation(1,2,{origin:q}),observation(2,4,{origin:{...q,quantityType:"IfcQuantityArea"}}),observation(3,8,{origin:g})];
  assert.equal(evaluate(data,policy("entity-sum",{target:q})).value,2);
  assert.equal(evaluate(data,policy("entity-sum",{target:g})).value,8);
});
test("invalid numeric stays in trace and zero remains eligible",()=>{
  const data=[observation(1,"invalid"),observation(2,0)]; const r=evaluate(data,policy());
  assert.equal(r.value,0); assert.equal(r.eligibleObservationCount,1);
  assert.equal(r.trace.find(t=>t.observationKey===data[0].observationKey)?.reason,"invalid_numeric");
});
test("unit mismatch blocks the whole total, never publishes a partial sum",()=>{
  const r=evaluate([observation(1,10),observation(2,20,{unit:unit("ft3")})],policy());
  assert.equal(r.status,"not_evaluable"); assert.equal(r.value,undefined); assert.ok(has(r,"unit_mismatch"));
  assert.equal(r.includedObservationKeys.length,0);
});
test("unknown unit needs explicit permission and may not mix with explicit units",()=>{
  const unknown=observation(1,5,{unit:{kind:"unknown"}});
  assert.ok(has(evaluate([unknown],policy()),"unit_unknown"));
  const allow=policy("entity-sum",{units:{kind:"uniform",allowAllUnknown:true}});
  assert.equal(evaluate([unknown],allow).value,5);
  assert.deepEqual(evaluate([unknown],allow).unit,{kind:"unknown"});
  assert.ok(has(evaluate([unknown],policy("entity-sum",{units:{kind:"uniform",allowAllUnknown:false}})),"unit_unknown"));
  assert.ok(has(evaluate([unknown,observation(2,5)],allow),"unit_mismatch"));
  assert.ok(has(evaluate([observation(1,5),observation(2,5,{unit:unit("ft3")})],allow),"unit_mismatch"));
});
test("uniform explicit units resolve without normalization or conversion",()=>{
  const r=evaluate([observation(1,2,{unit:unit("ft3")})],policy("entity-sum",{units:{kind:"uniform",allowAllUnknown:false}}));
  assert.equal(r.value,2); assert.deepEqual(r.unit,{kind:"explicit",raw:"ft3"});
});
for(const field of ["projectCode","modelKey","revisionId"] as const){
  test(`mixed ${field} is rejected before filtering`,()=>{
    const changed={...context,[field]:field==="revisionId"?`sha256:${"b".repeat(64)}`:field==="modelKey"?toCanonicalBimModelKey("/TEST/other.ifc"):"OTHER"} as BimProcessingContext;
    const r=evaluate([observation(1,10),observation(2,20,{context:changed})],policy());
    assert.equal(r.status,"not_evaluable"); assert.ok(has(r,"mixed_context")); assert.equal(r.value,undefined);
  });
}
test("deterministic full result under input permutations, including floating-point sum",()=>{
  const data=[observation(1,1e16),observation(2,-1e16),observation(3,1),observation(4,"invalid")];
  assert.deepEqual(evaluate(data,policy()),evaluate([...data].reverse(),policy()));
  assert.deepEqual(evaluate(composition(),policy("authoring-single-observation")),evaluate(composition().reverse(),policy("authoring-single-observation")));
});
test("duplicate observation keys are ambiguous, not deduplicated or counted twice",()=>{
  const a=observation(1,10),b=observation(1,"invalid");
  const r=evaluate([a,b],policy()); assert.equal(r.status,"ambiguous"); assert.equal(r.trace.length,2);
  assert.ok(has(r,"duplicate_observation_key")); assert.deepEqual(r,evaluate([b,a],policy()));
});
test("trace accounts for every input and records version and inclusion reason",()=>{
  const data=[observation(1,10),observation(2,"bad")]; const r=evaluate(data,policy());
  assert.equal(r.trace.length,data.length); assert.equal(r.inputObservationCount,2);
  assert.deepEqual(new Set(r.trace.map(t=>t.observationKey)),new Set(data.map(o=>o.observationKey)));
  assert.equal(r.trace.find(t=>t.disposition==="included")?.reason,"entity_sum"); assert.equal(r.policy.version,1);
});
test("unsupported versions are not silently evaluated using v1 semantics",()=>{
  const r=evaluate([observation(1,10)],{...policy(),version:2} as unknown as QuantityPolicy);
  assert.equal(r.status,"not_evaluable"); assert.ok(has(r,"unsupported_policy"));
});
test("conflicting roles and multiple roots are ambiguous",()=>{
  const a=composition()[0]; const b=observation(1,10,{occurrenceIndex:1,authoring:{identityKey:"composition:1",role:"child"}});
  assert.ok(has(evaluate([a,b],policy("authoring-root-only")),"inconsistent_authoring_roles"));
  assert.ok(has(evaluate([a,observation(9,10,{authoring:a.authoring})],policy("authoring-root-only")),"inconsistent_authoring_roles"));
});
test("empty input and non-finite totals do not become a resolved zero",()=>{
  assert.equal(evaluate([],policy()).status,"not_evaluable");
  const r=evaluate([observation(1,Number.MAX_VALUE),observation(2,Number.MAX_VALUE)],policy());
  assert.equal(r.value,undefined); assert.ok(has(r,"numeric_overflow"));
});
test("synthetic quantities on OCI root/child IDs compare policies, not real OCI totals",()=>{
  const group=OCI_COMPOSITIONS[3];
  const data=[group.root,...group.children].map((localId,i)=>observation(localId,100,{authoring:{identityKey:`aggregate:${group.root}`,role:i===0?"root":"child"}}));
  assert.equal(evaluate(data,policy()).value,800);
  assert.equal(evaluate(data,policy("authoring-root-only")).value,100);
  assert.equal(evaluate(data,policy("authoring-single-observation")).status,"ambiguous");
});
test("evaluation does not mutate input or retain mutable policy objects",()=>{
  const data=Object.freeze(composition()); const p=policy(); const before=JSON.stringify([data,p]);
  const r=evaluate(data,p); assert.equal(JSON.stringify([data,p]),before);
  assert.notEqual(r.policy,p); assert.notEqual(r.policy.target,p.target); assert.notEqual(r.policy.units,p.units);
});
test("one ambiguous group with another valid group never returns a partial total",()=>{
  const data=[...composition(),observation(10,50,{authoring:{identityKey:"single:10",role:"standalone"}})];
  const r=evaluate(data,policy("authoring-single-observation"));
  assert.equal(r.status,"ambiguous"); assert.equal(r.value,undefined); assert.deepEqual(r.includedObservationKeys,[]);
  assert.equal(r.trace.length,4);
});
test("units are checked before authoring selection, including excluded children",()=>{
  const data=composition(); data[1]=observation(2,100,{authoring:data[1].authoring,unit:unit("ft3")});
  const r=evaluate(data,policy("authoring-root-only"));
  assert.equal(r.status,"not_evaluable"); assert.ok(has(r,"unit_mismatch")); assert.equal(r.value,undefined);
});
