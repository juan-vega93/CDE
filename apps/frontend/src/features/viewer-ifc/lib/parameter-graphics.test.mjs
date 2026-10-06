import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./parameter-graphics.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {exports, Set, Map, queueMicrotask});
const {createParameterGraphicsResolver} = exports;
const plain = (map) => Object.fromEntries(Object.entries(map).map(([key, ids]) => [key, [...ids]]));

test("Sin valor: color and visibility share the exact graphical intersection, including hidden IDs", async () => {
  let reads = 0;
  const resolve = createParameterGraphicsResolver([{modelId:"A",runtimeModel:{getItemsIdsWithGeometry:async()=>{reads++;return [2,3,4];}}}]);
  const membership = {A:new Set([1,2,3])};
  const color = await resolve(membership), visibility = await resolve(membership);
  assert.deepEqual(plain(color), {A:[2,3]});
  assert.deepEqual(plain(visibility), plain(color));
  assert.equal(reads,1);
  assert.deepEqual([...membership.A],[1,2,3]);
  // Same targets on off/on: no visibility-dependent filtering or showAll.
  assert.deepEqual(plain(await resolve(membership)),plain(color));
});
test("federation isolates identical local IDs and ignores unloaded/ambiguous model IDs", async () => {
  const resolve = createParameterGraphicsResolver([
    {modelId:"A",runtimeModel:{getItemsIdsWithGeometry:()=>[1]}},
    {modelId:"B",runtimeModel:{getItemsIdsWithGeometry:()=>[2]}},
    {modelId:"duplicate",runtimeModel:{}},{modelId:"duplicate",runtimeModel:{}}
  ]);
  assert.deepEqual(plain(await resolve({A:new Set([1,2]),B:new Set([1,2]),other:new Set([1]),duplicate:new Set([1])})),{A:[1],B:[2]});
});
test("unknown geometry availability fails closed; failed lookup can retry", async () => {
  let calls=0;
  const resolve=createParameterGraphicsResolver([{modelId:"A",runtimeModel:{getItemsIdsWithGeometry:async()=>{if(++calls===1)throw Error("offline");return [1];}}},{modelId:"B",runtimeModel:{}}]);
  await assert.rejects(resolve({A:new Set([1])}));
  assert.deepEqual(plain(await resolve({A:new Set([1]),B:new Set([1])})),{A:[1]});
});
test("Parameters wiring includes Sin valor and shares mapping without tree expansion", () => {
  const canvas=fs.readFileSync(new URL("../components/ifc-viewer-canvas.tsx",import.meta.url),"utf8");
  assert.match(canvas,/const colorableBuckets = displayBuckets;/);
  for(const name of ["handleApplyParameterColors", "handleToggleParameterBucketVisibility", "handleSelectParameterBucket"]) {
    const body=canvas.split(`async function ${name}`)[1].split("\n  async function ")[0];
    assert.match(body,/resolveParameterGraphics\(bucket.modelIdMap\)/);
    assert.doesNotMatch(body,/showAll|expandModelIdMapForRendering/);
  }
});

const context = (modelKey='/A.ifc', revisionId='sha256:'+ 'a'.repeat(64)) => ({projectCode:'P',modelKey,revisionId});
test('EST structural targets: batched and cached; color/hide same set; semantic input untouched', async () => {
  const calls=[];
  const resolve=createParameterGraphicsResolver([{modelId:'A',bimContext:context(),runtimeModel:{getItemsIdsWithGeometry:()=>[145,710,83541]}}],
    async (ctx,ids)=>{calls.push({ctx,ids});return new Map(ids.map(id=>[id,id===125?[145]:id===697?[710]:[]]));});
  const membership={A:new Set([125,697,83541])};
  const color=await resolve(membership),hide=await resolve(membership);
  assert.deepEqual(plain(color),{A:[83541,145,710]});
  assert.deepEqual(plain(color),plain(hide));
  assert.equal(calls.length,1);assert.deepEqual(Array.from(calls[0].ids),[125,697]);
  assert.deepEqual([...membership.A],[125,697,83541]);
});
test('concurrent buckets coalesce; models and revisions isolate identical localIds', async () => {
  const calls=[];
  const resolve=createParameterGraphicsResolver([
    {modelId:'A',bimContext:context(),runtimeModel:{getItemsIdsWithGeometry:()=>[145,710]}},
    {modelId:'B',bimContext:context('/B.ifc'),runtimeModel:{getItemsIdsWithGeometry:()=>[999]}},
    {modelId:'C',bimContext:context('/A.ifc','sha256:'+'b'.repeat(64)),runtimeModel:{getItemsIdsWithGeometry:()=>[888]}}
  ],async(ctx,ids)=>{calls.push({ctx,ids});return new Map(ids.map(id=>[id,ctx.modelKey==='/B.ifc'?[999]:ctx.revisionId.endsWith('b')?[888]:id===125?[145]:[710]]));});
  const result=await Promise.all([resolve({A:new Set([125])}),resolve({A:new Set([697])}),resolve({B:new Set([125])}),resolve({C:new Set([125])})]);
  assert.deepEqual(result.map(plain),[{A:[145]},{A:[710]},{B:[999]},{C:[888]}]);
  assert.equal(calls.length,3);
  assert.deepEqual(Array.from(calls.find(c=>c.ctx.modelKey==='/A.ifc'&&c.ctx.revisionId.endsWith('a')).ids),[125,697]);
});
test('bounded requests for a large bucket; unavailable runtime targets excluded', async()=>{
  const calls=[];
  const resolve=createParameterGraphicsResolver([{modelId:'A',bimContext:context(),runtimeModel:{getItemsIdsWithGeometry:()=>[9999]}}],
    async(ctx,ids)=>{calls.push(ids.length);return new Map(ids.map(id=>[id,[9999,10000]]));});
  assert.deepEqual(plain(await resolve({A:new Set(Array.from({length:4500},(_,i)=>i+1))})),{A:[9999]});
  assert.deepEqual(calls,[2048,2048,404]);
});
test('failed delegate request can retry; unknown context never infers an alias',async()=>{
  let calls=0;
  const resolve=createParameterGraphicsResolver([{modelId:'A',bimContext:context(),runtimeModel:{getItemsIdsWithGeometry:()=>[145]}}],
    async()=>{if(++calls===1)throw Error('offline');return new Map([[125,[145]]]);});
  await assert.rejects(resolve({A:new Set([125])}));
  assert.deepEqual(plain(await resolve({A:new Set([125])})),{A:[145]});
});
test('visual integration preserves summary counts, shares resolver and avoids color-only target subtraction',()=>{
  const canvas=fs.readFileSync(new URL('../components/ifc-viewer-canvas.tsx',import.meta.url),'utf8');
  const color=canvas.split('async function handleApplyParameterColors')[1].split('async function handleSelectParameterBucket')[0];
  assert.doesNotMatch(color,/takeExclusiveModelIdMap/);
  assert.match(canvas,/resolveGraphics=\{resolveParameterGraphics\}/);
  assert.match(canvas,/totalElements: summary.totalElements/);
  assert.match(canvas,/missingValueCount: summary.missingValueCount/);
  assert.match(canvas,/const modelIdMap = await resolveParameterGraphics\(semanticMap\)/);
});
