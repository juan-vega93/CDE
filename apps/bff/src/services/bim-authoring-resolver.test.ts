import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveAuthoringElements,
  type AuthoringEntityFact,
  type AuthoringResolutionIssue,
  type CompositionRelationFact
} from "./bim-authoring-resolver";
import { createOciAuthoringFixture, OCI_CONTEXT, OCI_COMPOSITIONS } from "./fixtures/bim-authoring-oci.fixture";

const fact = (localId: number, overrides: Partial<AuthoringEntityFact> = {}): AuthoringEntityFact => ({
  localId, ifcClass: "IfcSlab", tag: "42", authoringElementId: "42",
  sourceContainer: "source.rvt", geometryStatus: "present", ...overrides
});
const relation = (parentLocalId: number, childLocalIds: number[], overrides: Partial<CompositionRelationFact> = {}): CompositionRelationFact => ({
  relationLocalId: 100 + parentLocalId, relationType: "IfcRelAggregates",
  parentLocalId, childLocalIds, ...overrides
});
const resolve = (entities: AuthoringEntityFact[], relations: CompositionRelationFact[] = []) =>
  resolveAuthoringElements({ context: OCI_CONTEXT, entities, relations });
function fallback(entities: AuthoringEntityFact[], relations: CompositionRelationFact[], issue: AuthoringResolutionIssue) {
  const result = resolve(entities, relations);
  assert.equal(result.elements.length, entities.length);
  for (const entity of entities) assert.equal(result.identityKeyByLocalId[entity.localId], `entity:${entity.localId}`);
  assert.ok(result.elements.every((element) => element.resolutionMethod === "singleton_fallback"));
  assert.ok(result.elements.every((element) => element.resolutionStatus === "fallback"));
  assert.ok(result.diagnostics.some((evidence) => evidence.issues.includes(issue)));
  return result;
}

test("OCI: 187 IFC entities resolve to exactly eight compositions and one standalone", () => {
  const fixture = createOciAuthoringFixture(), result = resolveAuthoringElements(fixture);
  assert.equal(fixture.entities.length, 187);
  assert.equal(result.elements.length, 9);
  assert.equal(result.elements.filter((e) => e.resolutionMethod === "corroborated_aggregate").length, 8);
  assert.equal(Object.keys(result.identityKeyByLocalId).length, 187);
  assert.deepEqual(result.elements.flatMap((e) => e.memberLocalIds).sort((a, b) => a - b),
    fixture.entities.map((e) => e.localId).sort((a, b) => a - b));
  assert.deepEqual(result.diagnostics, []);
});

test("OCI: 179 graphical members, 178 children, eight absent roots and present B3", () => {
  const fixture = createOciAuthoringFixture(), result = resolveAuthoringElements(fixture);
  assert.equal(result.elements.reduce((n, e) => n + e.graphicalLocalIds.length, 0), 179);
  assert.equal(OCI_COMPOSITIONS.reduce((n, group) => n + group.children.length, 0), 178);
  assert.equal(fixture.entities.filter((e) => e.geometryStatus === "absent").length, 8);
  assert.equal(result.elements.reduce((n, e) => n + e.geometryUnknownLocalIds.length, 0), 0);
  for (const group of OCI_COMPOSITIONS) {
    const element = result.elements.find((e) => e.rootLocalId === group.root)!;
    assert.deepEqual(element.graphicalLocalIds, [...group.children]);
    assert.equal(element.compositionEvidence.relations[0].relationLocalId, group.relation);
  }
});

test("OCI: each A1 child and its root resolve to aggregate:303839", () => {
  const result = resolveAuthoringElements(createOciAuthoringFixture());
  for (const id of [303708, 303729, 303750, 303771, 303792, 303813, 303834, 303839]) {
    assert.equal(result.identityKeyByLocalId[id], "aggregate:303839");
  }
});

test("OCI: A5 contains its 72 real children and root; B3 remains standalone", () => {
  const result = resolveAuthoringElements(createOciAuthoringFixture());
  const a5 = result.elements.find((e) => e.rootLocalId === 202224)!;
  assert.equal(a5.memberLocalIds.length, 73);
  assert.equal(a5.graphicalLocalIds.length, 72);
  assert.equal(a5.authoringElementId, "1177591");
  const b3 = result.elements.find((e) => e.identityKey === "entity:308027")!;
  assert.equal(b3.resolutionMethod, "standalone");
  assert.equal(b3.rootLocalId, undefined);
  assert.deepEqual(b3.memberLocalIds, [308027]);
  assert.deepEqual(b3.graphicalLocalIds, [308027]);
});

test("same Tag in disconnected corroborated compositions does not merge them", () => {
  const result = resolve([1, 2, 3, 4].map((id) => fact(id)), [relation(1, [2]), relation(3, [4])]);
  assert.deepEqual(result.elements.map((e) => e.identityKey), ["aggregate:1", "aggregate:3"]);
});

test("same authoring ID, Tag, Name and similar GlobalIds without a relation do not group", () => {
  const result = resolve([fact(1, { name: "same", globalId: "similar-1" }), fact(2, { name: "same", globalId: "similar-2" })]);
  assert.deepEqual(result.elements.map((e) => e.identityKey), ["entity:1", "entity:2"]);
});

test("Metrado is irrelevant to membership and is not part of the output contract", () => {
  const input = [fact(1), fact(2)];
  const quantities = input.map((entity) => ({ ...entity, Metrado: 156.616 }));
  assert.deepEqual(resolve(quantities), resolve(input));
  quantities[1].Metrado = 999;
  assert.deepEqual(resolve(quantities, [relation(1, [2])]), resolve(input, [relation(1, [2])]));
});

for (const [field, value, issue] of [
  ["authoringElementId", "different", "conflicting_authoring_id"],
  ["tag", "different", "conflicting_tag"],
  ["sourceContainer", "other.rvt", "conflicting_source_container"]
] as const) {
  test(`contradictory ${field} falls back without choosing a winning value`, () => {
    fallback([fact(1), fact(2, { [field]: value })], [relation(1, [2])], issue);
  });
}

test("internally inconsistent ID and Tag do not group even when all entities agree", () => {
  fallback([fact(1, { tag: "other" }), fact(2, { tag: "other" })], [relation(1, [2])], "tag_authoring_id_mismatch");
});

for (const [field, issue] of [
  ["authoringElementId", "missing_authoring_id"],
  ["tag", "missing_tag"],
  ["sourceContainer", "missing_source_container"]
] as const) {
  test(`missing ${field} is insufficient evidence even with matching Names`, () => {
    fallback([fact(1, { name: "same" }), fact(2, { name: "same", [field]: " " })], [relation(1, [2])], issue);
  });
}

test("Name is optional corroboration and never the only proof", () => {
  fallback([fact(1, { name: "same", tag: undefined, authoringElementId: undefined }),
    fact(2, { name: "same", tag: undefined, authoringElementId: undefined })], [relation(1, [2])], "missing_authoring_id");
  const result = resolve([fact(1, { name: "root" }), fact(2, { name: "piece" })], [relation(1, [2])]);
  assert.equal(result.elements[0].identityKey, "aggregate:1");
  assert.equal(result.elements[0].compositionEvidence.corroboration.commonName, undefined);
});

test("a cycle falls back for all affected entities", () => {
  fallback([fact(1), fact(2), fact(3)], [relation(1, [2]), relation(2, [3]), relation(3, [1])], "cycle");
});
test("self-relation is a cycle, not an aggregate singleton", () => {
  fallback([fact(1)], [relation(1, [1])], "cycle");
});
test("multiple parents invalidate the connected composition", () => {
  fallback([fact(1), fact(2), fact(3)], [relation(1, [3]), relation(2, [3])], "multiple_parents");
});
test("unsupported nesting cannot be treated as corroborated aggregation", () => {
  fallback([fact(1), fact(2)], [relation(1, [2], { relationType: "IfcRelNests" })], "unsupported_relation_type");
});
test("unsupported edges attached to a valid-looking aggregate prevent partial grouping", () => {
  fallback([fact(1), fact(2), fact(3)], [relation(1, [2]), relation(2, [3], { relationType: "IfcRelNests" })], "unsupported_relation_type");
});

test("absent and unknown remain semantic members without trusting representation/legacy flags", () => {
  const input = [fact(1, { geometryStatus: "absent", hasRepresentation: false }),
    { ...fact(2, { geometryStatus: "unknown", hasRepresentation: true }), has_geometry: true }, fact(3)];
  const result = resolve(input, [relation(1, [2, 3])]).elements[0];
  assert.deepEqual(result.memberLocalIds, [1, 2, 3]);
  assert.deepEqual(result.graphicalLocalIds, [3]);
  assert.deepEqual(result.geometryUnknownLocalIds, [2]);
});

test("OCI input/relation/children order does not change the serialized result", () => {
  const fixture = createOciAuthoringFixture();
  const expected = JSON.stringify(resolveAuthoringElements(fixture));
  const reordered = { ...fixture, entities: [...fixture.entities].reverse(),
    relations: [...fixture.relations].reverse().map((r) => ({ ...r, childLocalIds: [...r.childLocalIds].reverse() })) };
  assert.equal(JSON.stringify(resolveAuthoringElements(reordered)), expected);
});

test("an invalid composition leaves independent compositions and unrelated entities intact", () => {
  const result = resolve([1, 2, 3, 4, 5].map((id) => fact(id)),
    [relation(1, [2]), relation(3, [4], { relationType: "IfcRelNests" })]);
  assert.deepEqual(result.elements.map((e) => [e.identityKey, e.resolutionMethod]), [
    ["aggregate:1", "corroborated_aggregate"], ["entity:3", "singleton_fallback"],
    ["entity:4", "singleton_fallback"], ["entity:5", "standalone"]
  ]);
});

test("missing parent and children are diagnosed and existing members remain resolvable", () => {
  const result = fallback([fact(2)], [relation(1, [2, 3])], "missing_entity");
  assert.deepEqual(result.diagnostics[0].missingLocalIds, [1, 3]);
  assert.deepEqual(Object.keys(result.identityKeyByLocalId), ["2"]);
});
test("empty children, duplicate children and invalid references are not valid relations", () => {
  fallback([fact(1)], [relation(1, [])], "empty_children");
  fallback([fact(1), fact(2)], [relation(1, [2, 2])], "duplicate_child");
  fallback([fact(1), fact(2)], [relation(1, [2, -1])], "invalid_member_id");
  fallback([fact(1), fact(2)], [relation(1, [2], { relationLocalId: 0 })], "invalid_relation_id");
});
test("duplicate relation IDs invalidate affected components even when disconnected", () => {
  fallback([1, 2, 3, 4].map((id) => fact(id)), [relation(1, [2]), relation(3, [4], { relationLocalId: 101 })], "duplicate_relation_id");
});
test("relations with no supplied entities still produce diagnostics without phantom members", () => {
  const result = resolve([], [relation(1, [2]), relation(-1, [-2])]);
  assert.deepEqual(result.elements, []);
  assert.deepEqual(result.identityKeyByLocalId, {});
  assert.equal(result.diagnostics.length, 2);
});
test("invalid graph diagnostics are deterministic under input permutation", () => {
  const facts = [1, 2, 3, 4, 5].map((id) => fact(id));
  const relations = [relation(1, [2, 3]), relation(2, [1]), relation(4, [5], { relationType: "IfcRelNests" })];
  assert.equal(JSON.stringify(resolve(facts, relations)), JSON.stringify(resolve([...facts].reverse(),
    [...relations].reverse().map((r) => ({ ...r, childLocalIds: [...r.childLocalIds].reverse() })))));
});
test("a nested aggregate tree groups only when every level corroborates the same authorship", () => {
  const result = resolve([1, 2, 3].map((id) => fact(id)), [relation(1, [2]), relation(2, [3])]);
  assert.deepEqual(result.elements[0].memberLocalIds, [1, 2, 3]);
  assert.equal(result.elements[0].identityKey, "aggregate:1");
  assert.equal(result.elements[0].compositionEvidence.relations.length, 2);
});
test("keys are revision-scoped; model/revision contexts are preserved, never merged", () => {
  const input = { context: OCI_CONTEXT, entities: [fact(1), fact(2)], relations: [relation(1, [2])] };
  const first = resolveAuthoringElements(input);
  for (const key of ["projectCode", "modelKey", "revisionId"] as const) {
    const other = resolveAuthoringElements({ ...input, context: { ...OCI_CONTEXT, [key]: "other" } });
    assert.equal(other.elements[0].identityKey, first.elements[0].identityKey);
    assert.notDeepEqual(other.context, first.context);
    assert.throws(() => resolveAuthoringElements({ ...input,
      entities: [fact(1, { context: other.context }), fact(2)] }), /one model\/revision/);
    assert.throws(() => resolveAuthoringElements({ ...input,
      relations: [relation(1, [2], { context: other.context })] }), /one model\/revision/);
  }
});
test("unresolvable input identity namespaces fail explicitly", () => {
  assert.throws(() => resolve([fact(1), fact(1)]), /duplicate/);
  assert.throws(() => resolve([fact(0)]), /Invalid/);
  assert.throws(() => resolveAuthoringElements({ context: { ...OCI_CONTEXT, revisionId: " " }, entities: [], relations: [] }), /context/);
});
test("resolution never mutates deeply frozen input facts or arrays", () => {
  function freeze(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  const fixture = createOciAuthoringFixture();
  const before = JSON.stringify(fixture);
  freeze(fixture);
  const result = resolveAuthoringElements(fixture);
  assert.equal(result.elements.length, 9);
  assert.equal(JSON.stringify(fixture), before);
});
