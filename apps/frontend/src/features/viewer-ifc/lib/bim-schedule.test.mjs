import assert from 'node:assert/strict';
import test from 'node:test';
import {scheduleCsv,scheduleValues,scheduleCellText} from './bim-schedule.ts';
const columns=[{id:'x',label:'Custom.Parameter',source:'stored_parameter',setName:'Custom',propertyName:'Parameter'}];
test('CSV and visible values share configured columns, conflicts and no-partida logical identities',()=>{
  const row={identityKey:'aggregate:1',modelName:'M',logicalIfcClass:'IfcRoof',name:'Roof',elementType:null,level:'L',partida:null,cells:{x:{status:'multiple',value:null}}};
  assert.deepEqual(scheduleValues(row,columns),['M','IfcRoof','Roof','—','L','Múltiple']);
  const csv=scheduleCsv([row],columns);assert.equal(csv.split('\r\n').length,2);assert.ok(csv.includes('Custom.Parameter'));assert.ok(csv.includes('Múltiple'));
  assert.equal(scheduleCellText({status:'ambiguous'}),'Ambiguo');assert.equal(scheduleCellText(),'—');
  assert.ok(scheduleCsv([{...row,name:'=IMPORTDATA("bad")'}],columns).includes("'=IMPORTDATA"));
});
