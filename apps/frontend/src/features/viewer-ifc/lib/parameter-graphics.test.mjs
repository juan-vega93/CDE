import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const source = fs.readFileSync(new URL("./parameter-graphics.ts", import.meta.url), "utf8");
const exports = {};
vm.runInNewContext(ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {exports, Set, Map});
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
