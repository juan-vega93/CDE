import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
function load(file,deps={}) {
  const exports={};const source=fs.readFileSync(new URL(file,import.meta.url),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require:id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return jsx;assert.ok(id in deps,id);return deps[id];},console});return exports;
}
const cost=load('./logical-cost-rows.ts');
const table=load('../components/logical-metering-panel.tsx',{'@/services/bff-client':{},'../lib/logical-cost-rows':cost});
const inspector=load('../components/ifc-selected-properties-panel.tsx');
test('real OCI logical metering data: seven rendered rows, CSV and row action share the same identities/quantities',()=>{
  const fixture=JSON.parse(fs.readFileSync(new URL('../../../../../bff/src/services/fixtures/bim-oci-3f-evidence.json',import.meta.url),'utf8'));
  const rows=fixture.authoringElements.map(a=>{const members=fixture.members.filter(m=>m.authoringKey===a.element_key),root=members.find(m=>m.localId===a.root_local_id)??members[0];
    return {key:a.element_key,identityKey:a.element_key,context:fixture.context,representativeLocalId:root.localId,memberLocalIds:members.map(m=>m.localId),graphicalLocalIds:members.filter(m=>m.geometryStatus==='present').map(m=>m.localId),
      itemId:'0.2.1.3',itemName:'Pavimento',itemUnit:'m3',quantity:root.metradoNumeric,status:'resolved',reason:null,replicaCount:members.length-1,logicalIfcClass:root.ifcClass,sector:root.sector,authoringElementId:root.sourceElementId};});
  assert.equal(rows.length,7);assert.equal(Number(rows.reduce((n,r)=>n+r.quantity,0).toFixed(3)),1842.105);assert.equal(rows.reduce((n,r)=>n+r.graphicalLocalIds.length,0),112);
  let selected;const element=table.LogicalMeteringTable({rows,onSelect:r=>{selected=r;}});
  const body=element.props.children.props.children[1];const a5=body.props.children.find(r=>r.key.includes('aggregate:209862'));
  a5.props.children[0].props.children.props.onClick();assert.equal(selected.quantity,156.616);assert.equal(selected.graphicalLocalIds.length,72);
  const html=renderToStaticMarkup(element);assert.equal((html.match(/<tr/g)||[]).length,8);assert.ok(html.includes('IFC Class lógica'));
  const csv=cost.logicalCostCsv(rows.map(row=>({...row,logicalRows:[row]})));assert.equal(csv.split('\r\n').length,8);assert.ok(csv.includes('"Sector"'));assert.ok(csv.includes('"1842.105"')===false,'CSV has per-AE observations, not a repeated total');
});
test('actual Inspector renders logical Roof first and preserves clicked Slab identity and properties',()=>{
  const items=[{_category:'IfcRoof',_localId:389468,_guid:'0EEVeb_X11ARAc6bXxkglh',__inspectorRole:'root',__authoringKey:'aggregate:389468',__authoringId:'2161482'},
    {_category:'IfcSlab',_localId:389463,_guid:'0EEVeb_X11ARAc6bfxkglh',__inspectorRole:'child'}];
  const html=renderToStaticMarkup(React.createElement(inspector.IfcSelectedPropertiesPanel,{items,containmentData:[],associationsData:[],containmentLoading:false,associationsLoading:false,onLoadContainment(){},onLoadAssociations(){}}));
  assert.ok(html.includes('Elemento lógico'));assert.ok(html.includes('Miembro clicado'));assert.ok(html.indexOf('IfcRoof')<html.indexOf('IfcSlab'));assert.ok(html.includes(items[0]._guid));assert.ok(html.includes(items[1]._guid));
});
