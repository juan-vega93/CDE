import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

function harness(load, maxAttempts=3) {
  const timers=new Map();let id=0,completed=0,exhausted=0;
  const updates=[],exports={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./bim-index-polling.ts",import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,setTimeout:(fn,ms)=>{timers.set(++id,{fn,ms});return id;},clearTimeout:(key)=>timers.delete(key)});
  const stop=exports.pollBimIndex({initial:progress(1),load,update:(v)=>updates.push(v),completed:()=>completed++,exhausted:()=>exhausted++,maxAttempts});
  return {stop,updates,get completed(){return completed;},get exhausted(){return exhausted;},get pending(){return timers.size;},async tick(deadline=false){const [key,{fn}]=[...timers.entries()].sort((a,b)=>deadline?b[1].ms-a[1].ms:a[1].ms-b[1].ms)[0];timers.delete(key);await fn();}};
}
const progress=(processing)=>({jobs:{processing,pending:0,ready:processing?0:1,failed:0,cancelled:0}});
test("processing → ready reloads catalog once and stops",async()=>{
  let calls=0;const h=harness(async()=>progress(++calls<2?1:0));
  await h.tick();assert.equal(h.completed,0);await h.tick();assert.equal(h.completed,1);assert.equal(h.pending,0);assert.equal(h.updates.length,2);
});
test("stuck job and network failure have bounded retries",async()=>{
  for(const load of [async()=>progress(1),async()=>null,async()=>{throw Error("offline");}]) {
    const h=harness(load);for(let n=0;n<3;n++)await h.tick();assert.equal(h.exhausted,1);assert.equal(h.completed,0);assert.equal(h.pending,0);
  }
});
test("unmount aborts request and suppresses late overview/catalog writes",async()=>{
  let finish,signal;const h=harness((s)=>{signal=s;return new Promise((resolve)=>{finish=resolve;});});
  const pending=h.tick();h.stop();finish(progress(0));await pending;
  assert.equal(signal.aborted,true);assert.equal(h.completed,0);assert.equal(h.updates.length,0);assert.equal(h.pending,0);
});
test("unmount cancels scheduled polling",()=>{const h=harness(async()=>progress(0));h.stop();assert.equal(h.pending,0);});
test("deadline aborts a hung request and ignores its late result",async()=>{
  let finish,signal;const h=harness((s)=>{signal=s;return new Promise(resolve=>{finish=resolve;});});
  const request=h.tick();await h.tick(true);assert.equal(signal.aborted,true);assert.equal(h.exhausted,1);
  finish(progress(0));await request;assert.equal(h.completed,0);assert.equal(h.updates.length,0);assert.equal(h.pending,0);
});
