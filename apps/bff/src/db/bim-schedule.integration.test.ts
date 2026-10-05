import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {test} from 'node:test';
import {getDatabasePool} from './client';
import {upsertBimModel,bulkUpsertBimElements} from './bim-index-store';
import {createBimIndexGeneration,publishBimIndexGeneration} from './bim-index-generations';
import {replaceAuthoringElementIndex} from './bim-authoring-store';
import {resolveAuthoringElements} from '../services/bim-authoring-resolver';
import {toCanonicalBimModelKey} from '../services/bim-model-identity';
import {getBimSchedule,type ScheduleColumn} from './bim-schedule';
import type {BimRevisionId} from '../services/bim-revision-identity';

test('SQL schedule pages 1/30/70: bounded JS, constant queries, dynamic columns, conflicts and publication isolation',{skip:!process.env.DATABASE_URL},async(t)=>{
  const pool=getDatabasePool(),projectCode=`TEST-SCHEDULE-${randomUUID()}`;
  const context={projectCode,modelKey:toCanonicalBimModelKey('/schedule.ifc'),revisionId:`sha256:${'a'.repeat(64)}` as BimRevisionId};
  const columns:ScheduleColumn[]=[{id:'value',label:'Value',source:'stored_parameter',setName:'Custom',propertyName:'Free parameter'}];
  try {
    const model=await upsertBimModel({projectCode,modelKey:context.modelKey,documentPath:context.modelKey,documentName:'schedule.ifc',status:'processing'});
    const generationId=await createBimIndexGeneration(model.id,context);
    const entities=Array.from({length:7100},(_,i)=>({localId:i+1,ifcClass:'IfcWall',geometryStatus:'present' as const}));
    for(let offset=0;offset<entities.length;offset+=500)await bulkUpsertBimElements(model.id,entities.slice(offset,offset+500).map(e=>({...e,name:`Element ${e.localId}`,levelName:'Level 1',typeName:'Wall type',properties:[
      {setName:'Custom',name:'Free parameter',value:`v${e.localId}`},{setName:'Location',name:'Sector',value:'A'}
    ]})),{generationId});
    await replaceAuthoringElementIndex(resolveAuthoringElements({context,entities,relations:[]}));
    await publishBimIndexGeneration({generationId,context,elementCount:7100,propertyCount:14200});
    const client=await pool.connect();client.release();const spy=t.mock.method(client,'query');
    const pages=[];
    for(const offset of [0,2900,6900]){
      spy.mock.resetCalls();const page=await getBimSchedule({projectCode,columns,offset,limit:100});pages.push(page);
      const reads=spy.mock.calls.filter(c=>!/^(begin|commit|rollback)/i.test(String(c.arguments[0])));
      assert.equal(reads.length,2);assert.equal(page.total,7100);assert.equal(page.rows.length,100);
      const result=await (reads[1].result as unknown as Promise<{rowCount:number}>);assert.equal(result.rowCount,100,'JS receives only requested logical page');
      assert.ok(page.rows.every(r=>r.cells.value.status==='resolved'&&r.memberLocalIds.length===1));
    }
    spy.mock.restore();
    assert.equal(new Set(pages.flatMap(p=>p.rows.map(r=>r.key))).size,300);
    assert.deepEqual((await getBimSchedule({projectCode,columns,offset:2900})).rows,pages[1].rows);
    assert.equal((await getBimSchedule({projectCode,columns,filters:{withoutPartida:true}})).total,7100);
    assert.equal((await getBimSchedule({projectCode,columns,filters:{logicalIfcClass:'IfcRoof'}})).total,0);
    assert.equal((await getBimSchedule({projectCode,columns,filters:{sector:'A',level:'Level 1',elementType:'Wall type'}})).total,7100);
    const pending=await createBimIndexGeneration(model.id,context);assert.ok(pending);
    assert.equal((await getBimSchedule({projectCode,columns})).total,7100);
    await assert.rejects(()=>getBimSchedule({projectCode,columns:[{...columns[0],setName:'Qto_WallBaseQuantities'}]}));
    const roofContext={...context,modelKey:toCanonicalBimModelKey('/roof.ifc')};
    const roofModel=await upsertBimModel({projectCode,modelKey:roofContext.modelKey,documentPath:roofContext.modelKey,documentName:'roof.ifc',status:'processing'});
    const roofGeneration=await createBimIndexGeneration(roofModel.id,roofContext);
    const roofEntities=[{localId:8000,ifcClass:'IfcRoof',geometryStatus:'absent' as const},{localId:8001,ifcClass:'IfcSlab',geometryStatus:'present' as const}];
    await bulkUpsertBimElements(roofModel.id,roofEntities.map(e=>({...e,name:'Roof',properties:[
      {setName:'Custom',name:'Free parameter',value:e.localId===8000?'A':'B'},
      {setName:'Custom',name:'Replicated',value:17.45},
      {setName:'Location',name:'ID Partida',value:e.localId===8000?'P1':'P2'},
      {setName:'Ubicacion',name:'Nivel',value:'Roof level'},
      ...(e.localId===8001?[{setName:'Custom',name:'Child only',value:'child'}]:[])
    ]})),{generationId:roofGeneration});
    await replaceAuthoringElementIndex(resolveAuthoringElements({context:roofContext,
      entities:roofEntities.map(e=>({...e,authoringElementId:'2161482',tag:'2161482',sourceContainer:'test'})),
      relations:[{relationLocalId:9000,relationType:'IfcRelAggregates',parentLocalId:8000,childLocalIds:[8001]}]}));
    await publishBimIndexGeneration({generationId:roofGeneration,context:roofContext,elementCount:2,propertyCount:9});
    const rootInput={projectCode,modelKeys:[roofContext.modelKey],columns:[...columns,
      {...columns[0],id:'repeat',propertyName:'Replicated'},{...columns[0],id:'child',propertyName:'Child only'},
      {...columns[0],id:'missing',propertyName:'Absent'}]};
    const roof=await getBimSchedule(rootInput);assert.equal(roof.total,1);
    assert.equal(roof.rows[0].logicalIfcClass,'IfcRoof');assert.deepEqual(roof.rows[0].graphicalLocalIds,[8001]);
    assert.equal(roof.rows[0].cells.value.status,'multiple');assert.equal(roof.rows[0].cells.repeat.value,'17.45');
    assert.equal(roof.rows[0].cells.child.value,'child');assert.equal(roof.rows[0].cells.missing.status,'missing');
    assert.equal(roof.rows[0].level,'Roof level');
    assert.equal((await getBimSchedule({...rootInput,filters:{withoutPartida:true}})).total,0,'conflicting classification is not missing classification');
    assert.equal((await getBimSchedule({...rootInput,filters:{partida:'P1'}})).total,0,'never pick root classification arbitrarily');
    await pool.query(`insert into cde_bim_property_values(bim_element_id,property_id,value_text)
      select v.bim_element_id,v.property_id,v.value_text from cde_bim_property_values v
      join cde_bim_elements e on e.id=v.bim_element_id join cde_bim_properties p on p.id=v.property_id
      where e.generation_id=$1 and e.local_id=8001 and p.name='Free parameter'`,[roofGeneration]);
    assert.equal((await getBimSchedule(rootInput)).rows[0].cells.value.status,'ambiguous');
  } finally {
    await pool.query('delete from cde_bim_models where project_code=$1',[projectCode]);
    await pool.query('delete from cde_bim_index_scopes where project_code=$1',[projectCode]);
    await pool.query('delete from cde_bim_authoring_contexts where project_code=$1',[projectCode]);
    await pool.end();
  }
});
