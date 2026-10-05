import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('./selection-opacity.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports});
test('opacity adapter uses reusable partial definitions and restores actual style owners',async()=>{
  const calls=[],model={getItemsIdsWithGeometry:async()=>[1,2,3],highlight:async(ids,definition)=>calls.push({ids:[...ids],definition}),resetHighlight:async ids=>calls.push({reset:[...ids]})};
  const red={color:{r:1,g:0,b:0},opacity:1,transparent:false,renderedFaces:0},blue={...red,color:{r:0,g:0,b:1}};
  const highlighter={selection:{manual:{M:new Set([1,2])},select:{M:new Set([2])}},styles:new Map([['manual',blue],['select',red]])};
  const adapter=exports.createSelectionOpacityModel(model,'M',highlighter);
  await adapter.setOpacity([1,3],0.16);assert.deepEqual(calls[0].ids,[1]);assert.equal(calls[0].definition.color,blue.color);assert.equal(calls[0].definition.opacity,0.16);
  assert.deepEqual(calls[1].ids,[3]);assert.equal(calls[1].definition.color,undefined);assert.equal(calls[1].definition.preserveOriginalMaterial,undefined);
  await adapter.resetOpacity([1,2,3]);assert.deepEqual(calls[2].reset,[1,2,3]);assert.deepEqual(calls[3].ids,[1]);assert.equal(calls[3].definition,blue);assert.deepEqual(calls[4].ids,[2]);assert.equal(calls[4].definition,red);
});
test('installed Fragments material allocator deduplicates partial opacity; original per-tile colors survive',()=>{
  // Execute the installed library allocator, not a reimplementation. This is a
  // compatibility test for the dependency behavior this adapter relies upon.
  const source=fs.readFileSync(new URL(import.meta.resolve('@thatopen/fragments')),'utf8');
  const start=source.indexOf('class Jd{'),end=source.indexOf('class eu{',start);
  assert.ok(start>0&&end>start,'review adapter compatibility when Fragments is upgraded');
  let allocations=0;const scope={ot:(o,k,v)=>{o[k]=v;},Gr:{ONE:0},no:{CREATE_MATERIAL:1},capture:data=>{allocations+=data.materialDefinitions.length;},exports:{}};
  vm.runInNewContext(source.slice(start,end)+`;exports.materials=new tu('test',capture);`,scope);
  for(let n=0;n<100;n++)scope.exports.materials.transfer(Array.from({length:10000},()=>({opacity:0.16,transparent:true})));
  assert.equal(allocations,1,'one million mesh writes reuse one material ID');
  const marker='getHighlightProps(t,e,s){',methodStart=source.indexOf(marker),methodEnd=source.indexOf('getFromRequest(',methodStart);
  assert.ok(methodStart>0&&methodEnd>methodStart);
  const object=vm.runInNewContext('({'+source.slice(methodStart,methodEnd)+'})');
  object._definitions=new Map([['M',[{color:'red',opacity:1},{color:'blue',opacity:1},{opacity:0.16,transparent:true}]]]);
  assert.equal(object.getHighlightProps(2,0,'M').color,'red');assert.equal(object.getHighlightProps(2,1,'M').color,'blue');
  assert.equal(object.getHighlightProps(2,1,'M').opacity,0.16);
});
