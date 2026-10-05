import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import express from 'express';
import type {AddressInfo} from 'node:net';
import authoringRoutes from '../routes/bim-authoring.routes';
import {getDatabasePool} from './client';
import {getBimCost5DAggregation} from './bim-index-store';
import {getBimSchedule} from './bim-schedule';
import {resolveAuthoringElementByLocalId} from './bim-authoring-store';
import {toCanonicalBimModelKey} from '../services/bim-model-identity';
import type {BimRevisionId} from '../services/bim-revision-identity';
// Read-only assertions against the real IFC indexed into an isolated PostgreSQL.
// Enable only after indexBimPropertiesFromBuffer has completed for these exact bytes.
const enabled=process.env.BIM_OCI_3K_CONTEXT_READY==='1';
const context={projectCode:'AR3173',modelKey:toCanonicalBimModelKey('/AR3173/100021-JYS01-000-ZZZ-MBM-OCI-E3-000100.ifc'),revisionId:'sha256:6f991deefc1b895555992219490f877930db38fe968efac6e64a350787c01cdd' as BimRevisionId};
const columns=[{id:'m',label:'Metrado',source:'stored_parameter' as const,setName:'Datos_Partida',propertyName:'Metrado'}];
after(async()=>{if(enabled)await getDatabasePool().end();});
test('real OCI / temporary PostgreSQL: corrected authoring index, 5D and Schedule agree', {skip:!enabled},async()=>{
  const pool=getDatabasePool();
  const counts=await pool.query(`select count(distinct a.id)::int ae,count(*)::int members,count(*) filter(where a.resolution_method='corroborated_export_split')::int split_members
    from cde_bim_authoring_contexts c join cde_bim_authoring_elements a on a.context_id=c.id join cde_bim_authoring_members m on m.authoring_element_id=a.id
    where c.project_code=$1 and c.model_key=$2 and c.revision_id=$3`,[context.projectCode,context.modelKey,context.revisionId]);
  assert.deepEqual(counts.rows[0],{ae:10920,members:11362,split_members:40});
  const a=await resolveAuthoringElementByLocalId(context,173301),b=await resolveAuthoringElementByLocalId(context,173302);
  assert.deepEqual(a,b);assert.equal(a!.identityKey,'export-split:173301');assert.equal(a!.rootLocalId,undefined);assert.equal(a!.representativeLocalId,173301);assert.deepEqual(a!.graphicalLocalIds,[173301,173302]);
  const data=await getBimCost5DAggregation({projectCode:context.projectCode,modelKeys:[context.modelKey],
    itemId:{setName:'Datos de actividad',propertyName:'ID Partida N°01'},itemName:{setName:'Datos de actividad',propertyName:'Nombre Partida N°01'},
    itemUnit:{setName:'Datos_Partida',propertyName:'Unidad Medida N°01'},quantity:{setName:'Datos_Partida',propertyName:'Metrado'},
    quantityPolicy:'stored-authoring-replicas@1',quantitySource:'stored_parameter',limit:500},true);
  for(const [partida,total,raw,ae] of [['0.2.1.8',1255.662,65,64],['0.2.1.3',1842.105,115,7]] as const){
    const cost=data.rows.find(r=>r.itemId===partida)!;assert.equal(Number(cost.quantity!.toFixed(3)),total);assert.equal(cost.rawEntityCount,raw);assert.equal(cost.elementCount,ae);
    const schedule=await getBimSchedule({projectCode:context.projectCode,modelKeys:[context.modelKey],columns,filters:{partida},limit:500});
    assert.equal(schedule.total,ae);assert.equal(Number(schedule.rows.reduce((n,r)=>n+Number(r.cells.m.value),0).toFixed(3)),total);
    console.log(JSON.stringify({partida,raw,ae,quantity:cost.quantity,scheduleSum:schedule.rows.reduce((n,r)=>n+Number(r.cells.m.value),0)}));
  }
  const ambiguous=data.rows.find(r=>r.itemId==='0.2.1.7')!;assert.equal(ambiguous.quantity,null,'pre-existing ambiguous identities must not silently become a valid total');assert.equal(ambiguous.elementCount,386);
  const split=await getBimSchedule({projectCode:context.projectCode,modelKeys:[context.modelKey],columns,filters:{search:'1020025'}});
  assert.equal(split.total,1);assert.equal(split.rows[0].identityKey,a!.identityKey);assert.deepEqual(split.rows[0].graphicalLocalIds,[173301,173302]);assert.equal(Number(split.rows[0].cells.m.value),116.076);
  assert.ok((await getBimSchedule({projectCode:context.projectCode,modelKeys:[context.modelKey],columns,filters:{withoutPartida:true}})).total>0);
});

test('real OCI rootless composition survives resolve/tree API transport', {skip:!enabled}, async()=>{
  const app=express();app.use('/authoring',authoringRoutes);
  const server=app.listen(0,'127.0.0.1');
  await new Promise<void>(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}/authoring`;
  const query=new URLSearchParams(context);
  try {
    const resolved=await fetch(`${base}/resolve?${query}&localId=173302`);
    assert.equal(resolved.status,200);const {data}=await resolved.json();
    assert.equal(data.authoringElement.identityKey,'export-split:173301');
    assert.equal(data.authoringElement.rootLocalId,undefined);
    assert.equal(data.authoringElement.representativeLocalId,173301);
    assert.deepEqual(data.members,[{localId:173301,geometryStatus:'present'},{localId:173302,geometryStatus:'present'}]);
    const response=await fetch(`${base}/tree?${query}`);assert.equal(response.status,200);
    const tree=await response.json();const nodes=tree.data.filter((e:{identityKey:string})=>e.identityKey==='export-split:173301');
    assert.equal(nodes.length,1);assert.equal(nodes[0].rootLocalId,null);assert.equal(nodes[0].representativeLocalId,173301);
    assert.deepEqual(nodes[0].memberLocalIds,[173301,173302]);
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
