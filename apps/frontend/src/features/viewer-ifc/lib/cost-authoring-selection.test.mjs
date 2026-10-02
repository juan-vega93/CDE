import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const exports={};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./cost-authoring-selection.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports,Set});
const context={projectCode:"P",modelKey:"/P/M.ifc",revisionId:`sha256:${"a".repeat(64)}`};
const group=(ctx=context)=>({context:ctx,authoringElements:[{identityKey:"ae1",memberCount:4,graphicalLocalIds:[2,3]},
  {identityKey:"ae2",memberCount:1,graphicalLocalIds:[5]}]});
const selection=(groups=[group()])=>({version:1,unresolvedEntityCount:0,groups});
const model=(id="runtime",ctx=context,ids=[2,3,5])=>({modelId:id,bimContext:ctx,runtimeModel:{getItemsIdsWithGeometry:async()=>ids}});
const plain=(map)=>Object.fromEntries(Object.entries(map).map(([key,ids])=>[key,[...ids]]));
test("all graphical memberships of multiple AEs; identical IDs in another runtime excluded",async()=>{
  const result=await exports.resolveCostAuthoringSelection(selection(),[model(),model("other",{...context,modelKey:"/P/Other.ifc"})]);
  assert.deepEqual(plain(result),{runtime:[2,3,5]});assert.ok(!result.runtime.has(1)&&!result.runtime.has(4));
});
test("federated exact contexts remain separate",async()=>{
  const ctx={...context,modelKey:"/P/Other.ifc"};
  assert.deepEqual(plain(await exports.resolveCostAuthoringSelection(selection([group(),group(ctx)]),[model(),model("other",ctx)])),{runtime:[2,3,5],other:[2,3,5]});
});
test("wrong revision/case, missing context, duplicate runtimes, missing geometry fail closed",async()=>{
  for(const models of [[model("r",{...context,revisionId:`sha256:${"b".repeat(64)}`})],
    [model("r",{...context,modelKey:"/p/m.ifc"})],[{...model(),bimContext:undefined}],
    [model(),model("duplicate")],[model("r",context,[2,3])]]){
    await assert.rejects(exports.resolveCostAuthoringSelection(selection(),models));
  }
});
test("unresolved membership is not a partial-success selection",async()=>{
  await assert.rejects(exports.resolveCostAuthoringSelection({...selection(),unresolvedEntityCount:1},[model()]));
});
test("actual canonical 5D handler highlights complete map without visibility/ghost/tree writes",async()=>{
  const canvas=fs.readFileSync(new URL("../components/ifc-viewer-canvas.tsx",import.meta.url),"utf8");
  const body=canvas.split("  async function handleSelectCost5DRow(")[1].split("\n  async function ")[0];
  const calls=[];const forbidden=()=>assert.fail("visibility mutation");
  const ctx={exports:{},modulesRef:{current:{visibility:{showAll:forbidden},selection:{selectLogical:async(...args)=>calls.push(args),highlighter:{highlightByID:forbidden}}}},
    viewerRef:{current:{components:{}}},models:[model()],resolveCostAuthoringSelection:exports.resolveCostAuthoringSelection,
    beginRenderOperation:()=>1,isRenderOperationCurrent:()=>true,countModelIdMapElements:m=>Object.values(m).reduce((n,s)=>n+s.size,0),
    fitSelectionInView:async()=>{},setHasSelection:()=>{},setStatus:()=>{},requestViewerRefresh:()=>{},
    handleSelectModelIdMap:forbidden,applySelectionFocusMode:forbidden,expandModelIdMapForRendering:forbidden};
  vm.runInNewContext(ts.transpileModule(`export async function run(${body}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
  await ctx.exports.run({selection:selection(),itemId:"any"});
  assert.equal(calls.length,1);assert.deepEqual(plain(calls[0][0]),{runtime:[2,3,5]});
  assert.deepEqual(Array.from(calls[0][1], x=>x.identityKey),["ae1","ae2"]);
});
