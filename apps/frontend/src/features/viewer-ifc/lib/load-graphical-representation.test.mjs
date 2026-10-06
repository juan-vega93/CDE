import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
const source=fs.readFileSync(new URL('./load-graphical-representation.ts',import.meta.url),'utf8');
const context={projectCode:'P',modelKey:'/P/m.ifc',revisionId:'sha256:'+'a'.repeat(64)};
function loader(fetch) {
  const exports={};
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:()=>({bffFetch:fetch}),Set,Map});
  return exports.loadGraphicalRepresentation;
}
const payload=(results,ctx=context)=>({ok:true,json:async()=>({success:true,data:{context:ctx,results}})});
test('batch transport retains canonical context and delegates',async()=>{
  const load=loader(async(url,request)=>{
    assert.equal(url,'/api/bim-index/graphical-representation');
    assert.deepEqual(JSON.parse(request.body),{...context,localIds:[125,83541]});
    return payload([{semanticLocalId:125,resolution:'structural_delegate',graphicalLocalIds:[145]},
      {semanticLocalId:83541,resolution:'direct',graphicalLocalIds:[83541]}]);
  });
  assert.deepEqual(Object.fromEntries(await load(context,[125,83541])),{125:[145],83541:[83541]});
});
test('wrong revision, incomplete response and inconsistent direct/unresolved results rejected',async()=>{
  for(const response of [
    payload([], {...context,revisionId:'sha256:'+'b'.repeat(64)}),payload([]),
    payload([{semanticLocalId:125,resolution:'direct',graphicalLocalIds:[145]}]),
    payload([{semanticLocalId:125,resolution:'unresolved',graphicalLocalIds:[145]}]),
    {ok:false,status:409}
  ]) await assert.rejects(loader(async()=>response)(context,[125]));
});
