import assert from 'node:assert/strict';
import fs from 'node:fs';
import {test} from 'node:test';
import {resolveAuthoringElements,type AuthoringEntityFact} from './bim-authoring-resolver';
import type {BimProcessingContext} from './bim-revision-identity';
import {createStoredReplicaConsolidator,type ReplicaSource} from '../db/bim-cost-replicas';
const fixture=JSON.parse(fs.readFileSync('src/services/fixtures/bim-oci-3k-evidence.json','utf8')) as {
  context:BimProcessingContext;splitFacts:AuthoringEntityFact[];
  quantities:{localId:number;authoringKey:string;rootLocalId:number|null;method:string;partida:string;unit:string;metrado:number;geometryStatus:string}[];
};
const resolve=(entities:AuthoringEntityFact[],context=fixture.context)=>resolveAuthoringElements({context,entities,relations:[]});
type MutableFact = {-readonly [K in keyof AuthoringEntityFact]:AuthoringEntityFact[K]};
const pair=():MutableFact[]=>structuredClone(fixture.splitFacts.filter(f=>f.authoringElementId==='1020025'));
test('real 1020025: two exported bodies form one rootless AE with explicit representative',()=>{
  const r=resolve(pair());assert.equal(r.elements.length,1);const e=r.elements[0];
  assert.equal(e.identityKey,'export-split:173301');assert.equal(e.rootLocalId,undefined);assert.equal(e.representativeLocalId,173301);
  assert.deepEqual(e.memberLocalIds,[173301,173302]);assert.deepEqual(e.graphicalLocalIds,e.memberLocalIds);
  assert.equal(e.resolutionMethod,'corroborated_export_split');assert.deepEqual(e.compositionEvidence.relations,[]);
  assert.deepEqual(resolve(pair().reverse()),r,'enumeration order does not choose the representative');
});
test('all seven real export splits: 40 IFC members -> 7 AE without losing geometry',()=>{
  const r=resolve(fixture.splitFacts);assert.equal(r.elements.length,7);
  assert.equal(r.elements.reduce((n,e)=>n+e.memberLocalIds.length,0),40);
  assert.equal(r.elements.reduce((n,e)=>n+e.graphicalLocalIds.length,0),40);
});
for(const missing of ['typeLocalId','spatialLocalId','placementRelativeTo','relativePlacement','objectType','predefinedType'] as const){
  test(`fail closed when native ${missing} is inconsistent`,()=>{
    const f=pair();f[1].exportStructure={...f[1].exportStructure!,[missing]:typeof f[1].exportStructure![missing]==='number'?999:'other'};
    assert.equal(resolve(f).elements.length,2);
  });
}
for(const field of ['tag','authoringElementId','sourceContainer','name','globalId','exportStructure','geometryStatus'] as const){
  test(`fail closed with missing ${field}`,()=>{const f=pair();delete f[1][field];
    if(field==='geometryStatus')assert.throws(()=>resolve(f),/Invalid geometryStatus/);
    else assert.equal(resolve(f).elements.length,2);
  });
}
test('same type and quantity with distinct native author identity never merge',()=>{
  const f=pair().map(e=>({...e,Metrado:116.076}));f[1].tag='other';f[1].authoringElementId='other';
  assert.equal(resolve(f).elements.length,2);
  f[1].authoringElementId='1020025';assert.equal(resolve(f).elements.length,2,'copied custom ID cannot override native Tag');
});
test('quantity is not an input to split identity; conflicts remain for quantity policy to reject',()=>{
  const f=pair().map((e,i)=>({...e,Metrado:i?999:116.076}));assert.deepEqual(resolve(f),resolve(pair()));
});
test('missing ordinal, duplicate GlobalId or representation does not corroborate an export split',()=>{
  for(const kind of ['ordinal','guid','shape']){const f=pair();
    if(kind==='ordinal')f[1].name=f[1].name!.replace(/:2$/,':3');
    if(kind==='guid')f[1].globalId=f[0].globalId;
    if(kind==='shape')f[1].exportStructure={...f[1].exportStructure!,representationLocalId:f[0].exportStructure!.representationLocalId};
    assert.equal(resolve(f).elements.length,2);
  }
});
test('same local keys in another revision have independent context',()=>{
  const a=resolve(pair()),b=resolve(pair(),{...fixture.context,revisionId:('sha256:'+'a'.repeat(64)) as BimProcessingContext['revisionId']});
  assert.notDeepEqual(a.context,b.context);assert.equal(a.elements[0].identityKey,b.elements[0].identityKey);
});
function sources(after:boolean):ReplicaSource[]{
  const splits=resolve(fixture.splitFacts),groups=new Map<string,typeof fixture.quantities>();
  for(const q of fixture.quantities){const key=after?splits.identityKeyByLocalId[q.localId]??q.authoringKey:q.authoringKey;const group=groups.get(key)??[];group.push(q);groups.set(key,group);}
  return [...groups].map(([key,rows])=>{const split=splits.elements.find(e=>e.identityKey===key);return {
    project_code:fixture.context.projectCode,model_key:fixture.context.modelKey,canonical_model_key:fixture.context.modelKey,revision_id:fixture.context.revisionId,
    element_key:key,resolution_method:split?.resolutionMethod??rows[0].method,root_local_id:split?null:rows[0].rootLocalId,
    representative_local_id:split?.representativeLocalId,member_ids:rows.map(q=>q.localId),graphical_ids:rows.filter(q=>q.geometryStatus==='present').map(q=>q.localId)
  };});
}
for(const [partida,before,after,count] of [['0.2.1.8',1371.738,1255.662,64],['0.2.1.3',1842.105,1842.105,7],['0.2.1.7',14140.986,7499.866,386]] as const){
  test(`published OCI quantities ${partida}: resolver before/after, no numeric dedup`,()=>{
    const q=fixture.quantities.filter(e=>e.partida===partida),obs={[fixture.context.modelKey]:q.map(e=>({localId:e.localId,value:e.metrado,candidates:1}))};
    for(const changed of [false,true]){const rows=createStoredReplicaConsolidator(sources(changed))(obs,q[0].unit,'stored_parameter');
      assert.deepEqual(rows.filter(r=>r.status!=='resolved').map(r=>r.identityKey).sort(),partida==='0.2.1.7'?['entity:385943','entity:386762','entity:387948']:[]);
      assert.equal(Number(rows.reduce((n,r)=>n+r.quantity!,0).toFixed(3)),changed?after:before);if(changed)assert.equal(rows.length,count);
    }
  });
}
test('rootless replica policy rejects differing values, incomplete membership and absent representative',()=>{
  const source=sources(true).find(s=>s.element_key==='export-split:173301')!;
  for(const kind of ['value','missing','representative']){const s={...source};const obs=[{localId:173301,value:116.076,candidates:1},{localId:173302,value:116.076,candidates:1}];
    if(kind==='value')obs[1].value=100;if(kind==='missing')obs.pop();if(kind==='representative')s.representative_local_id=null;
    const [r]=createStoredReplicaConsolidator([s])({[fixture.context.modelKey]:obs},'m2','stored_parameter');assert.equal(r.status,'ambiguous');assert.equal(r.quantity,null);
  }
});
