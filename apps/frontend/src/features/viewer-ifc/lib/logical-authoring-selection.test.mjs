import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import * as THREE from "three";

function load(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, { exports, require: (id) => {
    assert.ok(id in dependencies, `Unexpected dependency ${id}`);
    return dependencies[id];
  }, console, AbortController, URLSearchParams, Set, ...globals });
  return exports;
}
const adapter = load("./logical-authoring-selection.ts");
const contextA = { projectCode: "AR3173", modelKey: "/AR3173/A.ifc", revisionId: `sha256:${"a".repeat(64)}` };
const contextB = { ...contextA, modelKey: "/AR3173/B.ifc", revisionId: `sha256:${"b".repeat(64)}` };
const member = (localId, geometryStatus = "present") => ({ localId, geometryStatus });
const response = (context = contextA, members = [member(1, "absent"), member(2), member(3)]) => ({
  context, authoringElement: { identityKey: "ae:1", rootLocalId: 1, resolutionMethod: "corroborated_aggregate", identityConfidence: "high", resolutionStatus: "resolved" }, members
});
const plainMap = (map) => Object.fromEntries(Object.entries(map).map(([id, ids]) => [id, [...ids].sort((a,b) => a-b)]));
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function settle() { for (let n = 0; n < 8; n++) await tick(); }
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function harness(resolve = async (context) => response(context)) {
  const calls = [], errors = [], highlights = [], propertyReads = [], listeners = new Map();
  const hidden = new Set([3]);
  let visibilityWrites = 0;
  const forbidden = () => { visibilityWrites++; throw new Error("Visibility mutation"); };
  const canvas = {
    addEventListener(name, handler, capture) { const list = listeners.get(name) ?? []; list.push({handler,capture}); listeners.set(name,list); },
    removeEventListener(name, handler) { listeners.set(name, (listeners.get(name) ?? []).filter((item) => item.handler !== handler)); }
  };
  const runtimeModels = new Map(["A", "B"].map((id) => [id, {
    getItemsData: async (ids) => { propertyReads.push({ id, ids: Array.from(ids) }); return ids.map((localId) => ({ localId })); },
    setVisible: forbidden, resetVisible: forbidden, toggleVisible: forbidden
  }]));
  let afterHighlight = async () => {};
  const fragments = {
    list: runtimeModels, core: { update: async () => {} },
    resetHighlight: async () => {},
    highlight: async (_style, map) => { highlights.push(plainMap(map)); await afterHighlight(); },
    showAll: forbidden, show: forbidden, hide: forbidden, isolate: forbidden
  };
  let raycast;
  let castRay = async () => raycast;
  const components = {
    add() {},
    get(type) {
      if (type.uuid === OBF.Highlighter.uuid) return highlighter;
      if (type.uuid === OBC.FragmentsManager.uuid) return fragments;
      if (type.uuid === OBC.Raycasters.uuid) return { get: () => ({ castRay: () => castRay() }) };
      throw new Error(`Unexpected component ${type.uuid}`);
    }
  };
  const highlighter = new OBF.Highlighter(components);
  const selectionModule = load("../modules/selection.module.ts", {
    three: THREE, "@thatopen/components": OBC, "@thatopen/components-front": OBF,
    "../lib/logical-authoring-selection": adapter,
    "../lib/resolve-authoring-selection": { resolveAuthoringSelection: (...args) => { calls.push(args); return resolve(...args); } }
  }, { console: { ...console, warn: (...args) => errors.push(args) } });
  const selection = selectionModule.setupSelection({ components, world: { renderer: { three: { domElement: canvas } } } });
  const contexts = new Map([["A",contextA], ["B",contextB]]);
  selection.setBimContextResolver((id) => contexts.get(id));
  async function click(runtimeModelId, localId, modifiers = {}) {
    raycast = localId === null ? null : { localId, fragments: { modelId: runtimeModelId } };
    const event = { target: canvas, button: 0, clientX: 0, clientY: 0, ctrlKey: false, shiftKey: false, metaKey: false, ...modifiers };
    for (const {handler} of listeners.get("mousedown") ?? []) await handler(event);
    const handlers = [...listeners.get("mouseup")].sort((a,b) => Number(Boolean(b.capture))-Number(Boolean(a.capture)));
    for (const {handler} of handlers) await handler(event);
  }
  return { selection, highlighter, fragments, click, calls, errors, highlights, hidden, propertyReads, contexts, runtimeModels,
    visibilityWrites: () => visibilityWrites,
    setAfterHighlight: (value) => { afterHighlight = value; },
    setCastRay: (value) => { castRay = value; },
    map: () => plainMap(selection.getSelectionModelIdMap()),
    primary: () => plainMap(selection.getPropertiesModelIdMap()) };
}

for (const clicked of [1, 2]) {
  test(`real Highlighter: ${clicked === 1 ? "root" : "child"} resolves same graphical members; clicked stays primary`, async () => {
    const h = harness(); await h.click("A", clicked); await settle();
    assert.deepEqual(h.map(), { A: [2,3] });
    assert.deepEqual(h.primary(), { A: [clicked] });
    await h.selection.getSelectedItemsData();
    await h.selection.getSelectedContainmentData();
    await h.selection.getSelectedAssociationsData();
    assert.deepEqual(h.propertyReads, Array.from({length:3}, () => ({id:"A",ids:[clicked]})));
    assert.equal(h.calls.length, 1, "programmatic expansion must not recurse");
    assert.equal(h.highlights.length, 1, "one atomic logical commit after resolution");
  });
}
test("standalone remains one graphical element", async () => {
  const h = harness(async (context) => ({...response(context,[member(1698042)]),authoringElement:{identityKey:"single",resolutionMethod:"standalone"}}));
  await h.click("A",1698042); await settle(); assert.deepEqual(h.map(),{A:[1698042]}); assert.equal(h.calls.length,1);
});
test("retain all semantic members; only seven present members highlighted; no visibility changes", async () => {
  const members = [member(1,"absent"),...Array.from({length:7},(_,i)=>member(i+2)),member(9,"unknown")];
  const h = harness(async (context) => response(context,members));
  await h.click("A",2); await settle();
  assert.deepEqual(h.map(),{A:[2,3,4,5,6,7,8]});
  assert.deepEqual(h.selection.getLogicalSelection().members,members);
  assert.equal(h.visibilityWrites(),0); assert.deepEqual([...h.hidden],[3]);
});
for (const kind of ["FRAG legacy","IFC direct","URL-only"]) {
  test(`${kind} without verified context: zero requests and legacy pick`, async () => {
    const h=harness(); h.contexts.clear(); await h.click("A",2); await settle();
    assert.equal(h.calls.length,0); assert.deepEqual(h.map(),{A:[2]}); assert.equal(h.errors.length,0);
  });
}
test("404 keeps legacy primary without error",async()=>{
  const h=harness(async()=>null); await h.click("A",2); await settle();
  assert.deepEqual(h.map(),{A:[2]}); assert.deepEqual(h.primary(),{A:[2]}); assert.equal(h.errors.length,0);
});
for (const reason of ["HTTP 400","HTTP 403","HTTP 500","network"]) {
  test(`${reason} preserves legacy primary and logs`,async()=>{
    const h=harness(async()=>{throw new Error(reason);}); await h.click("A",2); await settle();
    assert.deepEqual(h.map(),{A:[2]}); assert.deepEqual(h.primary(),{A:[2]}); assert.equal(h.errors.length,1);
  });
}
test("response A after B cannot replace B, even if transport ignores abort",async()=>{
  const first=deferred(),second=deferred(); const h=harness((ctx)=>ctx===contextA?first.promise:second.promise);
  await h.click("A",2); await h.click("B",2);
  assert.equal(h.calls[0][2].aborted,true);
  second.resolve(response(contextB,[member(2),member(20)])); await settle();
  first.resolve(response()); await settle();
  assert.deepEqual(h.map(),{B:[2,20]}); assert.deepEqual(h.primary(),{B:[2]});
  assert.equal(h.calls[0][0],contextA); assert.equal(h.calls[1][0],contextB);
});
for (const clear of ["method","empty pick"]) {
  test(`${clear} invalidates pending response and never restores selection`,async()=>{
    const pending=deferred(); const h=harness(()=>pending.promise); await h.click("A",2);
    if(clear==="method") await h.selection.clearSelection(); else await h.click("A",null);
    pending.resolve(response()); await settle(); assert.deepEqual(h.map(),{}); assert.deepEqual(h.primary(),{});
  });
}
test("clear during an in-flight expansion wins after asynchronous render completes",async()=>{
  const request=deferred(),render=deferred(); const h=harness(()=>request.promise); await h.click("A",2);
  h.setAfterHighlight(()=>render.promise); request.resolve(response()); await tick();
  const clearing=h.selection.clearSelection(); render.resolve(); await clearing; await settle();
  assert.deepEqual(h.map(),{});
});
test("new pick during an in-flight expansion wins",async()=>{
  const request=deferred(),render=deferred(); const h=harness((ctx)=>ctx===contextA?request.promise:Promise.resolve(response(contextB,[member(2),member(40)])));
  await h.click("A",2); h.setAfterHighlight(()=>render.promise); request.resolve(response()); await tick();
  const next=h.click("B",2); render.resolve(); await next; await settle(); assert.deepEqual(h.map(),{B:[2,40]});
});
test("programmatic tool selection never resolves and invalidates pending pick",async()=>{
  const request=deferred(); const h=harness(()=>request.promise); await h.click("A",2);
  await h.highlighter.highlightByID("select",{B:new Set([100])},true,false);
  request.resolve(response()); await settle(); assert.deepEqual(h.map(),{B:[100]}); assert.equal(h.calls.length,1);
});
for (const modifier of ["ctrlKey","shiftKey","metaKey"]) {
  test(`${modifier} pick retains legacy behavior without Authoring request`,async()=>{
    const h=harness(); await h.click("A",2,{[modifier]:true}); await settle();
    assert.deepEqual(h.map(),{A:[2]}); assert.equal(h.calls.length,0);
  });
}
test("model unload blocks pending expansion",async()=>{
  const request=deferred(); const h=harness(()=>request.promise); await h.click("A",2);
  h.runtimeModels.delete("A"); request.resolve(response()); await settle(); assert.deepEqual(h.map(),{});
});
test("changed runtime revision blocks pending expansion",async()=>{
  const request=deferred(); const h=harness(()=>request.promise); await h.click("A",2);
  h.contexts.set("A",contextB); request.resolve(response()); await settle(); assert.deepEqual(h.map(),{});
});
test("Ctrl after a logical pick preserves legacy multiselection without another resolve",async()=>{
  const h=harness(); await h.click("A",2); await settle();
  await h.click("A",4,{ctrlKey:true}); await settle();
  assert.equal(h.calls.length,1); assert.deepEqual(h.map(),{A:[2,3,4]});
  assert.deepEqual(h.primary(),{A:[2,3,4]}); assert.equal(h.selection.getLogicalSelection(),undefined);
});
test("rapid additive programmatic selections are not dropped while rendering",async()=>{
  const render=deferred(); const h=harness(); h.setAfterHighlight(()=>render.promise);
  const first=h.highlighter.highlightByID("select",{A:new Set([2])},false,false);
  const second=h.highlighter.highlightByID("select",{A:new Set([4])},false,false);
  render.resolve(); await Promise.all([first,second]); await settle();
  assert.deepEqual(h.map(),{A:[2,4]}); assert.equal(h.calls.length,0);
});
test("dispose aborts request and restores original Highlighter methods",async()=>{
  const request=deferred(); const h=harness(()=>request.promise); await h.click("A",2);
  h.selection.dispose(); assert.equal(h.calls[0][2].aborted,true);
  assert.equal(h.highlighter.highlightByID,OBF.Highlighter.prototype.highlightByID);
  request.resolve(response()); await settle(); assert.deepEqual(h.map(),{});
});
test("slow old raycast cannot overwrite a newer pick or start another request",async()=>{
  const slow=deferred(); const h=harness(); let count=0;
  h.setCastRay(()=>++count===1?slow.promise:Promise.resolve({localId:2,fragments:{modelId:"B"}}));
  const first=h.click("A",2); await tick(); await h.click("B",2); await settle();
  slow.resolve({localId:2,fragments:{modelId:"A"}}); await first; await settle();
  assert.equal(h.calls.length,1); assert.equal(h.calls[0][0],contextB); assert.deepEqual(h.map(),{B:[2,3]});
});
test("clear during raycast prevents a late pick from returning",async()=>{
  const slow=deferred(); const h=harness(); h.setCastRay(()=>slow.promise);
  const picking=h.click("A",2); await tick(); await h.selection.clearSelection();
  slow.resolve({localId:2,fragments:{modelId:"A"}}); await picking; await settle();
  assert.equal(h.calls.length,0); assert.deepEqual(h.map(),{});
});
test("isPicking alone is not authorization to expand programmatic selections",async()=>{
  const h=harness(); await h.highlighter.highlightByID("select",{A:new Set([2])},true,false,null,true); await settle();
  assert.equal(h.calls.length,0); assert.deepEqual(h.map(),{A:[2]});
});

test("API client transmits exact context once with abort and no authentication retry",async()=>{
  const calls=[]; const api=load("./resolve-authoring-selection.ts",{"@/services/bff-client":{bffFetch:async(...args)=>{calls.push(args);return Response.json({success:true,data:response()});}}});
  const signal=new AbortController().signal; const data=await api.resolveAuthoringSelection(contextA,2,signal);
  const url=new URL(calls[0][0],"https://test.invalid");
  assert.deepEqual(Object.fromEntries(url.searchParams),{...contextA,localId:"2"});
  assert.equal(calls.length,1); assert.equal(calls[0][1].signal,signal); assert.equal(calls[0][1].retryUnauthorized,false);
  assert.deepEqual(data,response());
});
for(const status of [400,403,404,500]){
  test(`API client HTTP ${status}`,async()=>{
    const api=load("./resolve-authoring-selection.ts",{"@/services/bff-client":{bffFetch:async()=>new Response(null,{status})}});
    const run=()=>api.resolveAuthoringSelection(contextA,2,new AbortController().signal);
    if(status===404) assert.equal(await run(),null); else await assert.rejects(run,new RegExp(String(status)));
  });
}
test("API client rejects response from another revision",async()=>{
  const api=load("./resolve-authoring-selection.ts",{"@/services/bff-client":{bffFetch:async()=>Response.json({success:true,data:response(contextB)})}});
  await assert.rejects(()=>api.resolveAuthoringSelection(contextA,2,new AbortController().signal),/Invalid/);
});
for(const retryUnauthorized of [false,true]){
  test(`BFF transport retryUnauthorized=${retryUnauthorized}`,async()=>{
    let requests=0;
    const client=load("../../../services/bff-client.ts",{"next-auth/react":{getSession:async()=>({accessToken:"test"})}}, {
      process:{env:{NEXT_PUBLIC_BFF_URL:"https://test.invalid"}},Headers,FormData,performance,
      fetch:async()=>{requests++;return new Response(null,{status:401});}
    });
    await client.bffFetch("/api/bim-index/authoring/resolve",{retryUnauthorized});
    assert.equal(requests,retryUnauthorized?2:1);
  });
}


test("real OCI 1177591: every present child selects ONE logical element / 72 graphical members", async () => {
  const evidence = JSON.parse(fs.readFileSync(new URL("../../../../../bff/src/services/fixtures/bim-oci-3f-evidence.json", import.meta.url), "utf8"));
  const members = evidence.members.filter(m => m.authoringKey === "aggregate:209862");
  const graphical = members.filter(m => m.geometryStatus === "present").map(m => m.localId).sort((a,b)=>a-b);
  assert.equal(members.length,73); assert.equal(graphical.length,72);
  const h = harness(async context => ({context, authoringElement: {identityKey:"aggregate:209862"}, members}));
  for (const picked of graphical) {
    await h.click("A",picked); await settle();
    assert.deepEqual(h.map(),{A:graphical});
    assert.equal(h.selection.getLogicalIdentities().length,1);
    assert.equal(h.selection.getLogicalIdentities()[0].identityKey,"aggregate:209862");
    // Hide, isolate and focus consume this complete map; primary remains properties-only.
    assert.deepEqual(h.primary(),{A:[picked]}); assert.equal(h.visibilityWrites(),0);
  }
  h.selection.dispose();
});
test("programmatic logical selection preserves identities during highlight and clears on legacy selection", async () => {
  const h=harness(); let during;
  h.setAfterHighlight(async()=>{during=h.selection.getLogicalIdentities().length;});
  await h.selection.selectLogical({A:new Set([2,3])},[{context:contextA,identityKey:"ae1"},{context:contextA,identityKey:"ae1"}]);
  assert.equal(during,1);assert.equal(h.selection.getLogicalIdentities().length,1);
  await h.highlighter.highlightByID("select",{A:new Set([2])},true,false);
  assert.equal(h.selection.getLogicalIdentities().length,0);
  await h.selection.clearSelection();assert.equal(h.selection.getLogicalIdentities().length,0);
});


test("actual hide/isolate/focus handlers consume the complete logical selection, never the primary child", async () => {
  const h=harness();await h.click("A",2);await settle();
  const calls=[];
  const canvas=fs.readFileSync(new URL("../components/ifc-viewer-canvas.tsx",import.meta.url),"utf8");
  for(const name of ["handleToggleSelection","handleIsolateSelection","handleFocusSelection"]) {
    const body=canvas.split("  async function "+name+"(")[1].split("\n  async function ")[0];
    const ctx={exports:{},console,modulesRef:{current:{selection:h.selection,visibility:{
      toggle:async map=>calls.push(["hide",plainMap(map)]),isolate:async map=>calls.push(["isolate",plainMap(map)]),showAll:()=>assert.fail("showAll")
    }}},viewerRef:{current:{components:{}}},setStatus:()=>{},requestViewerRefresh:()=>{},
      fitSelectionInView:async(_v,_c,map)=>calls.push(["fit",plainMap(map)])};
    vm.runInNewContext(ts.transpileModule("export async function run("+body,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
    await ctx.exports.run();
  }
  assert.deepEqual(calls.map(c=>c[0]),["hide","isolate","fit","fit"]);
  assert.ok(calls.every(c=>JSON.stringify(c[1])===JSON.stringify({A:[2,3]})));
});

// Execute the actual canvas event handlers with the real Highlighter. Dataset setters are
// intentionally absent: selection events may mutate only selection/inspector presentation.
function attachCanvasState(h) {
  const source=fs.readFileSync(new URL('../components/ifc-viewer-canvas.tsx',import.meta.url),'utf8');
  const ast=ts.createSourceFile('canvas.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const dataset={smartView:['S'],partidas:['P'],metrados:['M'],charts:['C'],catalog:['K']};
  const state={selected:false,models:[{key:'A'}],...dataset};
  const globals={modules:{selection:h.selection},selectionDataTimeoutRef:{current:null},window:{clearTimeout(){}},
    setTreeLogicalSelection(){},setSelectedTreeLocalIds(){},setSelectedModelIds(){},setHasSelection:value=>{state.selected=value;},setStatus(){},setSelectedItemsData(){},
    setPropertiesRequested(){},setPropertiesLoading(){},setContainmentData(){},setAssociationsData(){},setContainmentLoading(){},setAssociationsLoading(){},
    setModels(){throw new Error('Selection must not mutate dataset model identity');},Set,Object};
  function visit(node) {
    if(ts.isCallExpression(node)) for(const event of ['onHighlight','onClear']) {
      if(node.expression.getText(ast)===`modules.selection.highlighter.events.select.${event}.add`) {
        const code=ts.transpileModule(`exports.callback=${node.arguments[0].getText(ast)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
        const exports={};vm.runInNewContext(code,{...globals,exports});h.highlighter.events.select[event].add(exports.callback);
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  return {state,assertStable(){for(const key of Object.keys(dataset)) assert.equal(state[key],dataset[key],key);}};
}
test('pending A → B snapshots preserve SmartView, Partidas, Metrados, charts and catalog; clear affects only selection',async()=>{
  const next=deferred();let count=0;
  const h=harness(async context=>++count===1?response(context):next.promise);
  const ui=attachCanvasState(h);
  await h.click('A',2);await settle();assert.equal(ui.state.selected,true);ui.assertStable();
  const before=h.map();await h.click('B',2);ui.assertStable();assert.deepEqual(h.map(),before);
  next.resolve(response(contextB,[member(2),member(30)]));await settle();ui.assertStable();assert.deepEqual(h.map(),{B:[2,30]});
  await h.selection.clearSelection();assert.equal(ui.state.selected,false);ui.assertStable();
});
test('404 fallback and rapid out-of-order requests never clear datasets or committed selection while pending',async()=>{
  const slow=deferred();const h=harness(context=>context===contextA?slow.promise:Promise.resolve(null));const ui=attachCanvasState(h);
  await h.click('A',2);ui.assertStable();await h.click('B',20);await settle();assert.deepEqual(h.map(),{B:[20]});ui.assertStable();
  slow.resolve(response());await settle();assert.deepEqual(h.map(),{B:[20]});ui.assertStable();
});

test('real Highlighter commit applies selection context for OCI 7 logical / 112 graphical and clear preserves hidden',async()=>{
  const evidence=JSON.parse(fs.readFileSync(new URL('../../../../../bff/src/services/fixtures/bim-oci-3f-evidence.json',import.meta.url),'utf8'));
  const graphical=evidence.members.filter(m=>m.geometryStatus==='present').map(m=>m.localId);
  const keys=[...new Set(evidence.members.map(m=>m.authoringKey))];
  assert.equal(graphical.length,112);assert.equal(keys.length,7);
  const h=harness(),dimmed=new Map([['A',new Set()],['B',new Set()]]);
  const models=new Map([['A',[...graphical,999998,999999]],['B',[21,22]]].map(([id,ids])=>[id,{
    getItemsIdsWithGeometry:async()=>ids,
    setOpacity:async batch=>batch.forEach(n=>dimmed.get(id).add(n)),
    resetOpacity:async batch=>batch.forEach(n=>dimmed.get(id).delete(n))
  }]));
  const {createSelectionContext}=load('./selection-context.ts');
  const context=createSelectionContext({models:()=>models,hidden:async()=>({A:[999999],B:[22]}),refresh:async()=>{}});
  h.selection.setCommitListener(presentation=>context.setSelection(presentation==='context'?h.selection.getSelectionModelIdMap():{}));
  await h.selection.selectLogical({A:new Set(graphical)},keys.map(identityKey=>({context:contextA,identityKey})), 'context');
  assert.equal(h.selection.getLogicalIdentities().length,7);
  assert.deepEqual([...dimmed.get('A')],[999998]);assert.deepEqual([...dimmed.get('B')],[21]);
  await h.selection.clearSelection();assert.equal(dimmed.get('A').size,0);assert.equal(dimmed.get('B').size,0);
  assert.equal(h.visibilityWrites(),0);context.dispose();h.selection.dispose();
});

function attachPresentation(h) {
  const dim={A:new Set(),B:new Set()},hidden={A:[3],B:[12]},writes=[];
  const {createSelectionContext}=load('./selection-context.ts');
  const context=createSelectionContext({models:()=>Object.entries({A:[1,2,3,4,5],B:[2,3,10,11,12]}).map(([id,ids])=>[id,{
    getItemsIdsWithGeometry:async()=>ids,
    setOpacity:async batch=>{writes.push(['dim',id,[...batch]]);batch.forEach(n=>dim[id].add(n));},
    resetOpacity:async batch=>{assert.ok(Array.isArray(batch));writes.push(['reset',id,[...batch]]);batch.forEach(n=>dim[id].delete(n));}
  }]),hidden:async()=>hidden,refresh:async()=>{}},2);
  // Execute the production module wiring, not a second implementation of origin routing.
  const source=fs.readFileSync(new URL('../modules/index.ts',import.meta.url),'utf8');
  const ast=ts.createSourceFile('index.ts',source,ts.ScriptTarget.Latest,true);let found=false;
  function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(ast)==='selection.setCommitListener'){
    vm.runInNewContext(ts.transpileModule(node.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{selection:h.selection,context});found=true;
  }ts.forEachChild(node,visit);}visit(ast);assert.ok(found);
  return {dim,hidden,writes,context};
}

test('viewport logical pick and manual/SmartView highlights never request automatic ghost',async()=>{
  const h=harness(),p=attachPresentation(h);await h.click('A',2);await settle();
  assert.deepEqual(h.map(),{A:[2,3]});assert.equal(h.selection.getLogicalIdentities().length,1);assert.equal(p.writes.length,0);
  await h.highlighter.highlightByID('select',{B:new Set([10])},true,false);
  await h.click('A',4,{ctrlKey:true});await settle();assert.equal(p.writes.length,0);
  assert.equal(h.visibilityWrites(),0);h.selection.dispose();p.context.dispose();
});

test('metering → viewport → metering requests context explicitly and preserves hidden/federated universe',async()=>{
  const h=harness(),p=attachPresentation(h);
  await h.selection.selectMember('A',2,'context');assert.ok(p.dim.A.has(4));assert.ok(p.dim.B.has(10));assert.ok(!p.dim.A.has(3));assert.ok(!p.dim.B.has(12));
  await h.click('B',2);await settle();assert.deepEqual(h.map(),{B:[2,3]});assert.equal(p.dim.A.size+p.dim.B.size,0);
  await h.selection.selectMember('A',2,'context');assert.ok(p.dim.B.has(10));
  await h.selection.clearSelection();assert.equal(p.dim.A.size+p.dim.B.size,0);assert.deepEqual(p.hidden,{A:[3],B:[12]});assert.equal(h.visibilityWrites(),0);
});

test('5D A → B updates only opacity delta: shared background never resets between chunks',async()=>{
  const h=harness(async(context,id)=>response(context,[member(1,'absent'),member(id)])),p=attachPresentation(h);
  await h.selection.selectMember('A',2,'context');p.writes.length=0;
  await h.selection.selectMember('A',4,'context');
  assert.ok(p.writes.some(([op,id,ids])=>op==='reset'&&id==='A'&&ids.includes(4)));
  assert.ok(p.writes.some(([op,id,ids])=>op==='dim'&&id==='A'&&ids.includes(2)));
  assert.ok(p.writes.every(([op,id,ids])=>op!=='reset'||(id==='A'&&ids.every(n=>n===4))));
  assert.ok(p.dim.A.has(5));assert.ok(p.dim.B.has(10));assert.equal(h.visibilityWrites(),0);
});

test('stale metering resolution cannot re-enable context after newer viewport intent',async()=>{
  const pending=deferred(),h=harness(context=>context===contextA?pending.promise:Promise.resolve(response(context))),p=attachPresentation(h);
  const old=h.selection.selectMember('A',2,'context');await h.click('B',2);await settle();
  pending.resolve(response());await old;await settle();assert.deepEqual(h.map(),{B:[2,3]});assert.equal(p.writes.length,0);
});

test('highlight-only and clear preserve explicit context and isolate restriction',async()=>{
  const h=harness(),p=attachPresentation(h);p.hidden.A.push(5);
  await p.context.setContext({A:new Set([2])});const before=[...p.dim.A];
  await h.selection.selectMember('B',2,'context');await h.click('A',2);await settle();
  assert.deepEqual([...p.dim.A].sort(),before.sort());assert.ok(!p.dim.A.has(5));
  await h.selection.clearSelection();assert.deepEqual([...p.dim.A].sort(),before.sort());assert.equal(h.visibilityWrites(),0);
});


test('real Highlighter material resets: A → B → C → A → same row, SmartView and member inspection',async()=>{
  const h=harness(async(context,id)=>response(context,[member(1,'absent'),member(id)])),p=attachPresentation(h);
  const {createSelectionMaterialBridge}=load('./selection-materials.ts');
  const bridge=createSelectionMaterialBridge({selections:()=>h.highlighter.selection,reset:async map=>{
    assert.ok(map,'global material reset forbidden');for(const [id,ids] of Object.entries(map))for(const n of ids)p.dim[id].delete(n);
  }});
  let changed;
  h.fragments.resetHighlight=async()=>{changed=await bridge.reset();};
  const update=h.highlighter.updateColors.bind(h.highlighter);
  h.highlighter.updateColors=()=>p.context.rebuildMaterials(async()=>{await update();return changed;},h.selection.isCommittingPresentation);
  for(const id of [2,4,5,2,2]) {
    p.writes.length=0;
    await h.selection.selectMember('A',id,'context');
    assert.ok(p.writes.every(([op,model,ids])=>op!=='dim'||model!=='A'||!ids.includes(id)), 'new selected material must never be overwritten by previous context');
    assert.deepEqual([...p.dim.A].sort(),[1,2,4,5].filter(n=>n!==id));
    assert.deepEqual([...p.dim.B].sort(),[2,3,10,11].sort());
  }
  await h.highlighter.updateColors();assert.deepEqual([...p.dim.A].sort(),[1,4,5]);
  await h.selection.inspectMember('A',4);assert.deepEqual(h.map(),{A:[4]});assert.equal(h.selection.getLogicalSelection(),undefined);
  assert.deepEqual(h.primary(),{A:[4]});assert.equal(p.dim.A.size+p.dim.B.size,0);
  await h.selection.selectMember('A',2,'context');assert.ok(p.dim.B.has(10));
  await h.selection.clearSelection();assert.equal(p.dim.A.size+p.dim.B.size,0);assert.equal(h.visibilityWrites(),0);
});

for(const clicked of [173301,173302])test(`real export split pick ${clicked} resolves both graphics without fabricating a root`,async()=>{
  const h=harness(async context=>({...response(context,[member(173301),member(173302)]),authoringElement:{identityKey:'export-split:173301',representativeLocalId:173301,resolutionMethod:'corroborated_export_split',resolutionStatus:'resolved',identityConfidence:'high'}}));
  await h.click('A',clicked);await settle();assert.deepEqual(h.map(),{A:[173301,173302]});
  assert.deepEqual(h.primary(),{A:[clicked]});assert.equal(h.selection.getLogicalSelection().authoringElement.rootLocalId,undefined);
  assert.equal(h.visibilityWrites(),0);
});
