import assert from 'node:assert/strict';
import {after,test} from 'node:test';
import {getDatabasePool} from './client';
import {getBimCost5DAggregation} from './bim-index-store';
import {getLogicalMeteringRows} from './bim-logical-metering';
const enabled=process.env.BIM_OCI_3K2_CONTEXT_READY==='1';
after(async()=>{if(enabled)await getDatabasePool().end();});
// Read-only regression. No test setup/indexing/mutations against the canonical model.
test('OCI published observations: @2 resolves sole owners, retains real missing data and @1 behavior',{skip:!enabled},async()=>{
  const input={projectCode:'AR3173',modelKeys:['/AR3173/100021-JYS01-000-ZZZ-MBM-OCI-E3-000100.ifc'],
    itemId:{setName:'Datos de actividad',propertyName:'ID Partida N°01'},itemName:{setName:'Datos de actividad',propertyName:'Nombre Partida N°01'},
    itemUnit:{setName:'Datos_Partida',propertyName:'Unidad Medida N°01'},quantity:{setName:'Datos_Partida',propertyName:'Metrado'},
    quantitySource:'stored_parameter' as const,limit:500};
  const pool=getDatabasePool();
  const generation=async()=>(await pool.query('select cde_bim_published_generation($1,$2) id',[input.projectCode,input.modelKeys[0]])).rows[0].id;
  const before=await generation();
  const v1=await getBimCost5DAggregation({...input,quantityPolicy:'stored-authoring-replicas@1'},true);
  const v2=await getBimCost5DAggregation({...input,quantityPolicy:'stored-authoring-replicas@2'},true);
  assert.equal(v1.rows.length,31);assert.equal(v2.rows.length,31);
  assert.equal(v1.rows.filter(r=>r.quantity!==null).length,12);
  assert.equal(v2.rows.filter(r=>r.quantity!==null).length,18);
  for(const [id,total] of [['0.2.1.3',1842.105],['0.2.1.8',1255.662],['0.2.1.7',7621.600],['0.2.1.11',14640.381]] as const){
    const r=v2.rows.find(r=>r.itemId===id)!;assert.equal(Number(r.quantity!.toFixed(3)),total);
    if(id==='0.2.1.7'||id==='0.2.1.11')assert.equal(v1.rows.find(r=>r.itemId===id)!.quantity,null);
    else assert.equal(r.quantity,v1.rows.find(r=>r.itemId===id)!.quantity);
  }
  const concrete=v2.rows.find(r=>r.itemId==='0.2.1.5')!;assert.equal(concrete.quantity,null);
  assert.deepEqual(concrete.logicalRows!.filter(r=>r.quantity===null).map(r=>r.identityKey).sort(),['entity:182637','entity:184782']);
  const split=v2.rows.find(r=>r.itemId==='0.2.1.8')!.logicalRows!.find(r=>r.identityKey==='export-split:173301')!;
  assert.equal(split.quantity,116.076);assert.deepEqual(split.graphicalLocalIds,[173301,173302]);
  const sample=v2.rows.find(r=>r.itemId==='0.2.1.7')!.logicalRows!.find(r=>r.identityKey==='entity:165332')!;
  assert.equal(sample.quantity,43.583);
  for(const [id,total] of [['0.2.1.14',152],['0.2.1.15',39],['0.2.1.16',25]] as const)
    assert.equal(v2.rows.find(r=>r.itemId===id)!.quantity,total,'nested ports must not invalidate the sole product quantity');
  for(const id of ['0.2.1.4','0.2.1.19','9.2.4.2','9.2.4.3'])
    assert.equal(v2.rows.find(r=>r.itemId===id)!.quantity,null,'absent Metrado is not substituted by QTO');
  assert.deepEqual(v2.rows.filter(r=>r.itemId==='0.2.1.13').map(r=>r.itemUnit).sort(),['m2','ml']);
  const remaining=v2.rows.flatMap(r=>r.logicalRows??[]).filter(r=>r.quantity===null);
  assert.equal(remaining.length,1709);assert.ok(remaining.every(r=>r.reason!=='uncorroborated_composition'));
  const meter=await getLogicalMeteringRows({...input,quantityPolicy:'stored-authoring-replicas@2',partida:'0.2.1.7'});
  assert.equal(meter.total,386);assert.equal(Number(meter.quantity!.toFixed(3)),7621.600);
  assert.equal(await generation(),before,'policy evaluation must not publish or reindex');
});
