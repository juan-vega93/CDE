import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveGraphicalRepresentation as resolve, type GraphicalFact, type GraphicalRelation } from './bim-graphical-representation';
import { prepareBimIfcInput } from './bim-revision-identity';

// Synthetic context only: no claim that these bytes constitute a valid IFC.
const context = prepareBimIfcInput({ projectCode: 'TEST', documentPath: '/TEST/model.ifc', ifcBuffer: new Uint8Array([1]) }).context;
const fact = (localId: number, geometryStatus: GraphicalFact['geometryStatus'] = 'absent'): GraphicalFact => ({localId,geometryStatus});
const edge = (parentLocalId: number, childLocalIds: number[], relationLocalId = parentLocalId + 1000, relationType = 'IfcRelAggregates'): GraphicalRelation => ({parentLocalId,childLocalIds,relationLocalId,relationType});
const result = (ids: number[], facts: GraphicalFact[], edges: GraphicalRelation[]) => resolve(context,ids,facts,edges).results;

test('EST confirmed five pairs; standalone remains direct; authoring identity is not an input', () => {
  const pairs = [[125,145,147],[697,710,711],[758,771,772],[819,832,833],[1246,1291,1293]];
  const facts = [fact(83541,'present'), ...pairs.flatMap(([p,c]) => [fact(p),fact(c,'present')])];
  const rows = result([83541,...pairs.map(p=>p[0])],facts,pairs.map(([p,c,r])=>edge(p,[c],r)));
  for (const [p,c,r] of pairs) {
    const row=rows.find(row=>row.semanticLocalId===p)!;
    assert.equal(row.resolution,'structural_delegate');
    assert.deepEqual(row.graphicalLocalIds,[c]);
    assert.equal(row.evidence.relations[0].relationLocalId,r);
  }
  assert.equal(rows.find(row=>row.semanticLocalId===83541)!.resolution,'direct');
});
test('multiple children: only confirmed geometry, recursively; duplicate evidence deduplicates', () => {
  const e=edge(1,[2,2,3,4]);
  assert.deepEqual(result([1],[fact(1),fact(2,'present'),fact(3,'unknown'),fact(4),fact(5,'present')],
    [e,e,edge(4,[5])])[0].graphicalLocalIds,[2,5]);
});
test('cycle fails closed, even when another branch has geometry', () => {
  const row=result([1],[fact(1),fact(2),fact(3,'present')],[edge(1,[2,3]),edge(2,[1])])[0];
  assert.equal(row.evidence.reason,'cycle'); assert.deepEqual(row.graphicalLocalIds,[]);
});
test('direct geometry wins over structural delegation and cycles', () => {
  const row=result([1],[fact(1,'present'),fact(2,'present')],[edge(1,[1,2])])[0];
  assert.equal(row.resolution,'direct'); assert.deepEqual(row.graphicalLocalIds,[1]);
});
test('unsupported nests and missing facts never delegate', () => {
  assert.equal(result([1],[fact(1),fact(2,'present')],[edge(1,[2],99,'IfcRelNests')])[0].resolution,'unresolved');
  assert.equal(result([1],[fact(1)],[edge(1,[2])])[0].resolution,'unresolved');
});
test('deterministic output, shared child and diamond are not cycles', () => {
  const facts=[fact(1),fact(2),fact(3),fact(4,'present')];
  const edges=[edge(1,[3,2]),edge(2,[4]),edge(3,[4])];
  assert.deepEqual(result([1,1],facts,edges),result([1],facts.slice().reverse(),edges.slice().reverse()));
  assert.deepEqual(result([1],facts,edges)[0].graphicalLocalIds,[4]);
});
test('revision context retained in evidence envelope; no global cross-context cache', () => {
  const other={...context,projectCode:'OTHER'};
  assert.deepEqual(resolve(other,[1],[fact(1)],[]).context,other);
  assert.equal(result([1],[fact(1)],[])[0].resolution,'unresolved');
});
