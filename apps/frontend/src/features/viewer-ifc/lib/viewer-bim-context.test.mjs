import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Exercise production source resolution and loader with transport/WebGL boundaries stubbed.
function loadModule(file, dependencies) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, console, URL, URLSearchParams, DOMException, Uint8Array, Object });
  return exports;
}
const context = { projectCode: "AR3173", modelKey: "/AR3173/Modelo.ifc", revisionId: `sha256:${"a".repeat(64)}` };
const frag = { kind: "frag", modelUrl: "http://bff/api/documents/content?path=test.frag&expectedFragSha256=digest", bimContext: context };
const plain = (value) => JSON.parse(JSON.stringify(value));
function loaderHarness(status = 200, header) {
  let next = 0;
  const loaded = [], urls = [];
  const makeModel = () => ({ modelId: `runtime-${++next}`, useCamera() {}, object: { traverse() {} } });
  const fragments = { core: { load: async () => { const model = makeModel(); loaded.push(model); return model; }, update: async () => {} } };
  const ifcBuffers = [];
  const ifcLoader = { setup: async () => {}, load: async (bytes) => { ifcBuffers.push([...bytes]); return makeModel(); } };
  const contextModule = loadModule("./viewer-bim-context.ts", {});
  const loadedModule = loadModule("./load-ifc-model.ts", {
    three: {}, "@thatopen/components": { IfcLoader: "IfcLoader" },
    "@/features/viewer-ifc/lib/fragments": { initializeFragments: () => ({ fragments, workerUrl: "worker" }) },
    "@/services/bff-client": { getBffPathFromUrl: (url) => new URL(url).origin === "http://bff" ? new URL(url).pathname + new URL(url).search : null,
      bffAssetFetch: async (url) => { urls.push(url); return new Response(new Uint8Array([1,2,3]), { status, headers: header ? { "x-bim-context": header } : {} }); } },
    "./viewer-bim-context": contextModule
  });
  return { loaded, urls, ifcBuffers, load: (source) => loadedModule.loadViewerModel({ source,
    components: { get: () => ifcLoader }, world: { camera: { three: {} }, scene: { three: { add() {} } } } }) };
}

test("ViewerSource parsing and memory cache retain exact backend context and guarded URL", async () => {
  let requests = 0;
  const loadedModule = loadModule("./resolve-viewer-source.ts", {
    "@/services/bff-client": { bffFetch: async () => { requests++; return Response.json({ success: true, data: frag }); }, getBffUrl: (url) => `http://bff${url}` }
  });
  const options = { documentPath: context.modelKey, documentName: "Modelo.ifc" };
  const first = await loadedModule.resolveViewerSource(options);
  const cached = await loadedModule.resolveViewerSource(options);
  assert.deepEqual(plain(first.bimContext), context);
  assert.deepEqual(plain(cached.bimContext), context);
  assert.equal(cached.modelUrl, frag.modelUrl);
  assert.equal(requests, 1);
});
test("successful FRAG loader associates exact context with each independent runtime instance", async () => {
  const harness = loaderHarness();
  const first = await harness.load(frag);
  const otherContext = { ...context, modelKey: "/AR3173/Other.ifc", revisionId: `sha256:${"b".repeat(64)}` };
  const second = await harness.load({ ...frag, bimContext: otherContext });
  assert.notEqual(first.model.modelId, second.model.modelId);
  assert.deepEqual(plain(first.bimContext), context);
  assert.deepEqual(plain(second.bimContext), otherContext);
  assert.equal(Object.isFrozen(first.bimContext), true);
  assert.equal(harness.urls[0], frag.modelUrl);
});
test("reload changes runtime identity while retaining canonical content identity", async () => {
  const harness = loaderHarness();
  const first = await harness.load(frag), reloaded = await harness.load(frag);
  assert.notEqual(first.model.modelId, reloaded.model.modelId);
  assert.deepEqual(plain(first.bimContext), plain(reloaded.bimContext));
});
test("legacy FRAG and direct IFC load without inventing context", async () => {
  const harness = loaderHarness();
  const legacy = await harness.load({ kind: "frag", modelUrl: "http://bff/legacy.frag" });
  const direct = await harness.load({ kind: "ifc", modelUrl: "http://bff/current.ifc" });
  assert.equal(legacy.bimContext, undefined);
  assert.equal(direct.bimContext, undefined);
  assert.ok(legacy.model.modelId && direct.model.modelId);
});
test("409 guarded download never registers geometry or stale context", async () => {
  const harness = loaderHarness(409);
  await assert.rejects(harness.load(frag), /409/);
  assert.equal(harness.loaded.length, 0);
});
test("both initial and incremental canvas registration retain loader context per model", () => {
  const canvas = fs.readFileSync(new URL("../components/ifc-viewer-canvas.tsx", import.meta.url), "utf8");
  assert.match(canvas, /loadedEntries\.push\(\{[\s\S]*?source: currentSource,\s*bimContext: result\.bimContext,/);
  assert.match(canvas, /const entry: FederatedModelEntry = \{[\s\S]*?source,\s*bimContext: result\.bimContext,/);
});

test("IFC direct registers the context of the exact response bytes passed to IfcLoader", async () => {
  const h=loaderHarness(200,encodeURIComponent(JSON.stringify(context)));
  const result=await h.load({kind:"ifc",modelUrl:"http://bff/api/documents/content?path=model.ifc",documentPath:context.modelKey});
  assert.deepEqual(plain(result.bimContext),context);assert.deepEqual(h.ifcBuffers,[[1,2,3]]);
  assert.ok(Object.isFrozen(result.bimContext));
});
test("mismatched exact response context fails before IFC load",async()=>{
  const h=loaderHarness(200,encodeURIComponent(JSON.stringify(context)));
  await assert.rejects(h.load({kind:"ifc",modelUrl:"http://bff/api/documents/content?path=other.ifc",documentPath:"/AR3173/Other.ifc"}));
  assert.equal(h.ifcBuffers.length,0);
  const malformed=loaderHarness(200,encodeURIComponent(JSON.stringify({...context,revisionId:context.revisionId+"\n"})));
  await assert.rejects(malformed.load({kind:"ifc",modelUrl:"http://bff/api/documents/content?path=model.ifc",documentPath:context.modelKey}));
  assert.equal(malformed.ifcBuffers.length,0);
});
test("external URL cannot claim BIM context through a supplied header",async()=>{
  const h=loaderHarness(200,encodeURIComponent(JSON.stringify(context)));
  const result=await h.load({kind:"ifc",modelUrl:"http://external/model.ifc"});assert.equal(result.bimContext,undefined);
});
