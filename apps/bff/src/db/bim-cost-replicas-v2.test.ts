import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStoredReplicaConsolidator } from './bim-cost-replicas';
import { createStoredReplicaConsolidatorV2, type EvidenceSource, type StoredOwnerObservation } from './bim-cost-replicas-v2';
const source = (id:number, method='singleton_fallback'): EvidenceSource => ({model_key:'model',canonical_model_key:'model' as EvidenceSource['canonical_model_key'],
  project_code:'P',revision_id:'sha256:test' as EvidenceSource['revision_id'],element_key:`entity:${id}`,resolution_method:method,root_local_id:null,
  member_ids:[id],graphical_ids:[id],composition_evidence:{affectedLocalIds:[1,2],missingLocalIds:[],issues:['conflicting_tag'],corroboration:{},
    relations:[{relationLocalId:3,relationType:'IfcRelAggregates',parentLocalId:1,childLocalIds:[2]}]}});
const quantity=(id=1,value:number|null=40.578):StoredOwnerObservation=>({model_key:'model',local_id:id,occurrence_index:17,kind:'quantity',numeric_value:value,raw_value:value});
const unit=(raw:unknown='m2'):StoredOwnerObservation=>({...quantity(),occurrence_index:16,kind:'unit',numeric_value:null,raw_value:raw});
const input={model:[{localId:1,value:40.578,candidates:1}]};
test('@1 remains blocked; @2 evaluates unique stored owner without changing authoring membership',()=>{
  const sources=[source(1),source(2)],before=structuredClone(sources);
  assert.equal(createStoredReplicaConsolidator(sources)(input,'m2','stored_parameter')[0].quantity,null);
  const r=createStoredReplicaConsolidatorV2(sources,[quantity(),unit()])(input,'m2','stored_parameter')[0];
  assert.equal(r.quantity,40.578);assert.equal(r.evaluationBasis,'exclusive_entity_observation');assert.deepEqual(r.memberLocalIds,[1]);
  assert.deepEqual(r.quantityEvidence,{localId:1,occurrenceIndex:17,componentLocalIds:[1,2]});assert.deepEqual(sources,before);
});
for(const pattern of ['conflicting','equal_other_owner','duplicate','missing','unit_conflict','unit_duplicate','unit_placeholder','missing_member','cycle','missing_provenance','source_mismatch','classification_duplicate'] as const){
  test(`@2 fails closed: ${pattern}`,()=>{
    const sources=[source(1),source(2)],obs=[quantity(),unit()],entries=structuredClone(input);
    if(pattern==='conflicting')obs.push(quantity(2,1));
    if(pattern==='equal_other_owner')obs.push(quantity(2));
    if(pattern==='duplicate')obs.push({...quantity(),occurrence_index:18});
    if(pattern==='missing'||pattern==='missing_provenance')obs.splice(0,1);
    if(pattern==='unit_conflict')obs[1]=unit('m3');
    if(pattern==='unit_duplicate')obs.push({...unit(),occurrence_index:19});
    if(pattern==='unit_placeholder')obs[1]=unit('--');
    if(pattern==='missing_member')sources.pop();
    if(pattern==='cycle')sources[0].composition_evidence={...sources[0].composition_evidence!,issues:['cycle']};
    if(pattern==='classification_duplicate')entries.model[0].candidates=2;
    const run=createStoredReplicaConsolidatorV2(sources,obs);
    if(pattern==='source_mismatch')assert.throws(()=>run(entries,'m2','ifc_quantity'));
    else assert.equal(run(entries,'m2','stored_parameter')[0].quantity,null);
  });
}
test('standalone one quantity and legitimate equal-value elements remain separate',()=>{
  const r=createStoredReplicaConsolidatorV2([source(1,'standalone'),source(2,'standalone')],[])({model:[...input.model,{localId:2,value:40.578,candidates:1}]},'m2','stored_parameter');
  assert.equal(r.length,2);assert.equal(r.reduce((n,r)=>n+r.quantity!,0),81.156);
});
for(const method of ['corroborated_aggregate','corroborated_export_split'])test(`unchanged replicated composition ${method}`,()=>{
  const s={...source(1,method),member_ids:[1,2],graphical_ids:[1,2],root_local_id:method==='corroborated_aggregate'?1:null,representative_local_id:1};
  const r=createStoredReplicaConsolidatorV2([s],[])({model:[...input.model,{localId:2,value:40.578,candidates:1}]},'m2','stored_parameter')[0];
  assert.equal(r.quantity,40.578);assert.equal(r.replicaCount,1);
});
test('same local IDs in other models cannot corroborate a component',()=>{
  const s=source(2);s.model_key='other';s.canonical_model_key='other' as typeof s.canonical_model_key;
  assert.equal(createStoredReplicaConsolidatorV2([source(1),s],[quantity(),unit()])(input,'m2','stored_parameter')[0].quantity,null);
});
test('IfcRelNests ports do not equate authoring confidence and evaluability',()=>{
  const sources=[source(1),source(2)];for(const s of sources)s.composition_evidence={...s.composition_evidence!,issues:['unsupported_relation_type','missing_tag'],relations:[{relationLocalId:3,relationType:'IfcRelNests',parentLocalId:1,childLocalIds:[2]}]};
  assert.equal(createStoredReplicaConsolidatorV2(sources,[quantity(),unit()])(input,'m2','stored_parameter')[0].quantity,40.578);
});
