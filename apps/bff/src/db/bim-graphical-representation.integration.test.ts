import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import graphicalRoutes from '../routes/bim-graphical-representation.routes';
import { getDatabasePool } from './client';
import { upsertBimModel, bulkUpsertBimElements, getBimPropertyCatalog, getBimPropertySummary, queryBimPropertyLocalIds } from './bim-index-store';
import { createBimIndexGeneration, publishBimIndexGeneration } from './bim-index-generations';
import { replaceAuthoringElementIndex } from './bim-authoring-store';
import { resolveAuthoringElements } from '../services/bim-authoring-resolver';
import { prepareBimIfcInput } from '../services/bim-revision-identity';
import { getGraphicalRepresentation } from './bim-graphical-representation';

test('persisted fallback relations resolve batch only in the published revision', {skip: !process.env.DATABASE_URL}, async (t) => {
  const projectCode=`GRAPH-${randomUUID().toUpperCase()}`;
  const pool=getDatabasePool();
  const context=prepareBimIfcInput({projectCode,documentPath:'/test/model.ifc',ifcBuffer:new Uint8Array([1])}).context;
  try {
    const model=await upsertBimModel({projectCode,documentPath:context.modelKey,documentName:'model.ifc',modelKey:'frag:/test/model.ifc',status:'processing'});
    const generationId=await createBimIndexGeneration(model.id,context);
    const resolved=resolveAuthoringElements({context,entities:[
      {localId:125,ifcClass:'IfcWall',geometryStatus:'absent'},
      {localId:145,ifcClass:'IfcBuildingElementPart',geometryStatus:'present'}
    ],relations:[{relationLocalId:147,relationType:'IfcRelAggregates',parentLocalId:125,childLocalIds:[145]}]});
    await replaceAuthoringElementIndex(resolved);
    await bulkUpsertBimElements(model.id,[125,145].map(localId=>({localId,properties:[
      {setName:'Test',name:'Kind',value:'wall'}, {setName:'Test',name:'Other',value:'other'}
    ]})),{generationId,finalize:false});
    assert.equal(await getGraphicalRepresentation(context,[125]),null);
    await publishBimIndexGeneration({generationId,context,elementCount:2,propertyCount:4});
    const before=await pool.query('select * from cde_bim_authoring_elements where context_id in (select id from cde_bim_authoring_contexts where project_code=$1) order by element_key',[projectCode]);
    const data=await getGraphicalRepresentation(context,[125,145,999]);
    assert.deepEqual(data!.results.map(r=>r.graphicalLocalIds),[[145],[145],[]]);
    assert.equal(data!.generationId,generationId);
    const another=prepareBimIfcInput({projectCode,documentPath:context.modelKey,ifcBuffer:new Uint8Array([2])}).context;
    assert.equal(await getGraphicalRepresentation(another,[125]),null);
    assert.equal(await getGraphicalRepresentation({...context,projectCode:'OTHER'},[125]),null);
    const after=await pool.query('select * from cde_bim_authoring_elements where context_id in (select id from cde_bim_authoring_contexts where project_code=$1) order by element_key',[projectCode]);
    assert.deepEqual(after.rows,before.rows);
    const app=express(); app.use(express.json()); app.use('/graphics',graphicalRoutes);
    const server=app.listen(0,'127.0.0.1');
    await new Promise<void>(resolve=>server.once('listening',resolve));
    try {
      const post=(body:unknown)=>fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/graphics`,{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)
      });
      const ok=await post({...context,localIds:[125,145]});
      assert.equal(ok.status,200);
      assert.deepEqual((await ok.json()).data.results[0].graphicalLocalIds,[145]);
      assert.equal((await post({...another,localIds:[125]})).status,409);
      assert.equal((await post({...context,modelKey:'frag:/test/model.ifc',localIds:[125]})).status,400);
      assert.equal((await post({...context,localIds:Array(2049).fill(125)})).status,400);
      assert.equal((await post({...context,localIds:[-1]})).status,400);
    } finally { await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve())); }
    const scope={projectCode,modelKeys:[context.modelKey]};
    for(const [phase,propertyName] of [['first_observed','Kind'],['warm_same','Kind'],['warm_change','Other'],['return_previous','Kind']]) {
      const timings:Record<string,number>={};
      const measure=async(name:string,read:()=>Promise<unknown>)=>{const start=performance.now();await read();timings[name]=+(performance.now()-start).toFixed(3);};
      await measure('catalog',()=>getBimPropertyCatalog(scope));
      await measure('summary',()=>getBimPropertySummary({...scope,propertySetName:'Test',propertyName}));
      await measure('query',()=>queryBimPropertyLocalIds({...scope,property:{setName:'Test',propertyName}}));
      await measure('graphics',()=>getGraphicalRepresentation(context,[125,145]));
      t.diagnostic(JSON.stringify({fixtureEntities:2,phase,timings}));
    }
  } finally {
    await pool.query('delete from cde_bim_models where project_code=$1',[projectCode]);
    await pool.query('delete from cde_bim_index_scopes where project_code=$1',[projectCode]);
    await pool.query('delete from cde_bim_authoring_contexts where project_code=$1',[projectCode]);
    await pool.end();
  }
});
