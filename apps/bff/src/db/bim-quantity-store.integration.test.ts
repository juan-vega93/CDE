import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getDatabasePool } from './client';
import { upsertBimModel, bulkUpsertBimElements } from './bim-index-store';
import { createBimIndexGeneration, publishBimIndexGeneration, failBimIndexGeneration } from './bim-index-generations';
import { replaceGenerationQuantityObservations, queryAuthoringQuantitySummaries, type QuantitySelector } from './bim-quantity-store';
import { replaceAuthoringElementIndex } from './bim-authoring-store';
import { resolveAuthoringElements } from '../services/bim-authoring-resolver';
import { createQuantityObservation, type QuantityObservation } from '../services/bim-quantity-provenance';
import { toCanonicalBimModelKey } from '../services/bim-model-identity';
import type { BimProcessingContext, BimRevisionId } from '../services/bim-revision-identity';

test('quantity provenance real PostgreSQL', {skip:!process.env.DATABASE_URL,timeout:120000}, async t => {
  const pool=getDatabasePool(), projectCode=`TEST-QUANTITY-${randomUUID()}`;
  const context:BimProcessingContext={projectCode,modelKey:toCanonicalBimModelKey('/Quantity.ifc'),revisionId:`sha256:${'a'.repeat(64)}` as BimRevisionId};
  const entities=[
    {localId:389468,ifcClass:'IfcRoof',globalId:'0EEVeb_X11ARAc6bXxkglh',geometryStatus:'absent' as const,tag:'2161482',authoringElementId:'2161482',sourceContainer:'OCI'},
    {localId:389463,ifcClass:'IfcSlab',globalId:'0EEVeb_X11ARAc6bfxkglh',geometryStatus:'present' as const,tag:'2161482',authoringElementId:'2161482',sourceContainer:'OCI'},
    {localId:301309,ifcClass:'IfcSlab',geometryStatus:'present' as const,tag:'1698042',authoringElementId:'1698042',sourceContainer:'OCI'}
  ];
  const resolution=resolveAuthoringElements({context,entities,relations:[{relationLocalId:389469,relationType:'IfcRelAggregates',parentLocalId:389468,childLocalIds:[389463]}]});
  const model=await upsertBimModel({projectCode,documentPath:context.modelKey,documentName:'Quantity.ifc',modelKey:'test-alias',status:'processing'});
  function q(localId:number,occurrenceIndex:number,name:string,value:number,quantityId:number):QuantityObservation {
    return createQuantityObservation({context,localId,occurrenceIndex,rawValue:value,
      authoring:{identityKey:localId===301309?'entity:301309':'aggregate:389468',role:localId===301309?'standalone':localId===389468?'root':'child'},
      origin:{source:'ifc_quantity',quantitySet:localId===389468?'Qto_RoofBaseQuantities':'Qto_SlabBaseQuantities',quantityName:name,
        quantityType:'IfcQuantityArea',quantitySetLocalId:localId===389468?389546:389554,quantityLocalId:quantityId}});
  }
  const observations=[q(389468,0,'NetArea',17.449077689484753,389544),q(389468,1,'ProjectedArea',17.449077689484675,389545),
    q(389463,0,'NetArea',1.6210723625493098,389464),q(389463,1,'GrossArea',17.449077689484753,389466),
    q(389468,2,'GrossArea',17.449077689484753,389543),q(301309,0,'NetArea',2068.15908406442,1)];
  const selector:QuantitySelector={source:'ifc_quantity',setName:'Qto_RoofBaseQuantities',name:'NetArea',quantityType:'IfcQuantityArea'};
  const query=(generationId?:string,s:QuantitySelector=selector) => queryAuthoringQuantitySummaries({context,generationId,selector:s,elements:[{identityKey:'aggregate:389468',primaryLocalId:389463},{identityKey:'entity:301309',primaryLocalId:301309}]});
  const build=async () => {
    const generationId=await createBimIndexGeneration(model.id,context,{quantityProvenanceRequired:true});
    await bulkUpsertBimElements(model.id,entities.map(e=>({...e,properties:[]})),{generationId});
    await replaceAuthoringElementIndex(resolution);
    return {generationId,context,elementCount:3,propertyCount:0};
  };
  try {
    await t.test('additive schema can be reapplied without deleting evidence', async()=>{
      await pool.query(await readFile(path.join(__dirname,'bim-quantity-observations.sql'),'utf8'));
    });
    const a=await build();
    await t.test('publication requires completed provenance; building invisible',async()=>{
      await assert.rejects(publishBimIndexGeneration(a),/QUANTITIES_NOT_READY/);
      await replaceGenerationQuantityObservations(a.generationId,context,observations);
      assert.deepEqual(await query(),[]);
    });
    await publishBimIndexGeneration(a);
    await t.test('batch query preserves Roof root vs Slab clicked class, IDs, types, units and quantities',async()=>{
      const spy=t.mock.method(pool,'query');
      const rows=await query(); assert.equal(spy.mock.callCount(),1); spy.mock.restore();
      assert.equal(rows.length,2); const roof=rows[0];
      assert.equal(roof.rootLocalId,389468); assert.equal(roof.rootIfcClass,'IfcRoof');
      assert.equal(roof.rootGlobalId,'0EEVeb_X11ARAc6bXxkglh');
      assert.equal(roof.primaryLocalId,389463); assert.equal(roof.primaryIfcClass,'IfcSlab');
      assert.equal(roof.primaryGlobalId,'0EEVeb_X11ARAc6bfxkglh'); assert.equal(roof.memberCount,2);
      assert.deepEqual(roof.rootQuantities,[observations[0]]); assert.deepEqual(roof.memberQuantities,[]);
      assert.equal(roof.status,'single'); assert.equal(rows[1].status,'missing');
      const child=(await query(undefined,{...selector,setName:'Qto_SlabBaseQuantities'}))[0];
      assert.deepEqual(child.memberQuantities,[observations[2]]); assert.equal(child.status,'children_only');
      assert.equal((await query(undefined,{...selector,name:'ProjectedArea'}))[0].rootValue,17.449077689484675);
      assert.equal((await query(undefined,{...selector,setName:'Qto_SlabBaseQuantities',name:'ProjectedArea'}))[0].status,'missing');
      assert.equal((await query(undefined,{...selector,setName:'Qto_SlabBaseQuantities'}))[1].standaloneValue,2068.15908406442);
      await assert.rejects(replaceGenerationQuantityObservations(a.generationId,context,[]),/NOT_BUILDING/);
    });
    const b=await build();
    await t.test('failed B cannot affect A; context mismatch rolls back',async()=>{
      await assert.rejects(replaceGenerationQuantityObservations(b.generationId,context,[createQuantityObservation({...observations[0],context:{...context,projectCode:'OTHER'}})]),/CONTEXT_MISMATCH/);
      await replaceGenerationQuantityObservations(b.generationId,context,[q(389468,0,'NetArea',99,389544)]);
      assert.equal((await query())[0].rootValue,17.449077689484753); assert.deepEqual(await query(b.generationId),[]);
      await failBimIndexGeneration(b.generationId,'test failure'); assert.deepEqual(await query(b.generationId),[]);
    });
    const c=await build();
    await t.test('all source/native/occurrence/raw/unit evidence survives; retry replaces idempotently',async()=>{
      const stored=createQuantityObservation({context,localId:389468,occurrenceIndex:3,rawValue:'17.449',
        origin:{source:'stored_parameter',propertySet:'Datos_Partida',propertyName:'Metrado',propertyLocalId:99,propertySetLocalId:98,valueField:'NominalValue'},
        authoring:{identityKey:'aggregate:389468',role:'root'},unit:{kind:'explicit',raw:'m2',evidence:{propertySet:'Datos_Partida',propertyName:'Unit'}}});
      const rawNull=createQuantityObservation({...stored,occurrenceIndex:4,rawValue:null});
      const values=[...observations,stored,rawNull];
      await replaceGenerationQuantityObservations(c.generationId,context,values);
      await replaceGenerationQuantityObservations(c.generationId,context,values);
      await publishBimIndexGeneration(c);
      const result=(await query(undefined,{source:'stored_parameter',setName:'Datos_Partida',name:'Metrado'}))[0];
      assert.deepEqual(result.rootQuantities,[stored,rawNull]); assert.equal(result.distinctValueCount,2); assert.equal(result.status,'variation');
      assert.deepEqual(await query(a.generationId),[]); assert.equal((await query())[0].generationId,c.generationId);
    });
    await t.test('all seven IFC types, identical replicas and independent occurrences survive',async()=>{
      const d=await build();
      const types=['IfcQuantityVolume','IfcQuantityArea','IfcQuantityLength','IfcQuantityCount','IfcQuantityWeight','IfcQuantityTime','IfcQuantityNumber'] as const;
      const values=types.map((quantityType,i)=>createQuantityObservation({...observations[0],occurrenceIndex:i,
        origin:{source:'ifc_quantity',quantitySet:'NativeTypes',quantityName:quantityType,quantityType,quantityLocalId:100+i,quantitySetLocalId:90},
        unit:{kind:'explicit',raw:'test-unit',evidence:{ifcUnitLocalId:19}}}));
      values.push(createQuantityObservation({...values[0],occurrenceIndex:7}));
      await replaceGenerationQuantityObservations(d.generationId,context,values);
      // A bad second replacement rolls back deletion and all prior batches.
      await assert.rejects(replaceGenerationQuantityObservations(d.generationId,context,[...values,values[0]]));
      await assert.rejects(replaceGenerationQuantityObservations(d.generationId,context,[createQuantityObservation({...values[0],rawValue:NaN})]),/NON_JSON_QUANTITY_VALUE/);
      await assert.rejects(replaceGenerationQuantityObservations(d.generationId,context,[createQuantityObservation({...values[0],origin:{source:'viewer_geometry',metric:'area',calculation:'test'}})]),/VIEWER_GEOMETRY_UNSUPPORTED/);
      await publishBimIndexGeneration(d);
      for (const quantityType of types) {
        const row=(await query(undefined,{source:'ifc_quantity',setName:'NativeTypes',name:quantityType,quantityType}))[0];
        assert.equal(row.observationCount,quantityType==='IfcQuantityVolume'?2:1);
        assert.deepEqual(row.rootQuantities,values.filter(o=>o.origin.source==='ifc_quantity' && o.origin.quantityType===quantityType));
        assert.equal(row.status,quantityType==='IfcQuantityVolume'?'replicated':'single');
      }
      assert.deepEqual(await queryAuthoringQuantitySummaries({context:{...context,revisionId:`sha256:${'b'.repeat(64)}` as BimRevisionId},elements:[{identityKey:'aggregate:389468'}],selector}),[]);
      const invalidPrimary=await queryAuthoringQuantitySummaries({context,elements:[{identityKey:'aggregate:389468',primaryLocalId:301309}],selector});
      assert.equal(invalidPrimary[0].primaryLocalId,null);
    });
    await t.test('191481 observations use 96 bounded batch inserts with measured time/memory',async()=>{
      const large=await build(); const memoryBefore=process.memoryUsage().rss;
      const values=Array.from({length:191481},(_,i)=>createQuantityObservation({...observations[0],occurrenceIndex:i}));
      const afterFixture=process.memoryUsage().rss;
      const client=await pool.connect(); client.release();
      const spy=t.mock.method(client,'query'); const started=performance.now();
      await replaceGenerationQuantityObservations(large.generationId,context,values);
      const elapsedMs=performance.now()-started;
      const inserts=spy.mock.calls.filter(call=>String(call.arguments[0]).startsWith('insert into cde_bim_quantity_observations')).length;
      spy.mock.restore(); assert.equal(inserts,96);
      const count=(await pool.query('select count(*)::int n from cde_bim_quantity_observations where generation_id=$1',[large.generationId])).rows[0].n;
      assert.equal(count,191481);
      const afterWrite=process.memoryUsage().rss;
      await publishBimIndexGeneration(large);
      const queryStart=performance.now();
      const rows=await query(); assert.equal(rows[0].observationCount,191481); assert.equal(rows[0].status,'replicated');
      assert.equal(rows[0].auditTruncated,true); assert.equal(rows[0].rootQuantities.length,256);
      assert.equal(rows[0].roleCounts.root,191481);
      t.diagnostic(JSON.stringify({observations:count,batchInserts:inserts,elapsedMs,queryMs:performance.now()-queryStart,
        fixtureRssDeltaBytes:afterFixture-memoryBefore,writeRssDeltaBytes:afterWrite-afterFixture,rssBytes:process.memoryUsage().rss}));
    });
  } finally {
    await pool.query('delete from cde_bim_models where project_code=$1',[projectCode]);
    await pool.query('delete from cde_bim_authoring_contexts where project_code=$1',[projectCode]);
    await pool.end();
  }
});
