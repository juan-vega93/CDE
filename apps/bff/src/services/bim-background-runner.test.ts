import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { BimBackgroundRunner } from "./bim-background-runner";
import { createApp } from "../index";

async function fixture(source: string) {
  const directory = await mkdtemp(path.join(tmpdir(), "bim-worker-test-"));
  const entry = path.join(directory, "worker.cjs");
  await writeFile(entry, `const {parentPort,workerData}=require('node:worker_threads');\n${source}`);
  return { entry, dispose: () => rm(directory, { recursive: true, force: true }) };
}

test("HTTP responds while the background worker is executing synchronous CPU work", async () => {
  const f = await fixture(`parentPort.postMessage({type:'started'});
    const flag=new Int32Array(workerData); const deadline=Date.now()+10000;
    while(Atomics.load(flag,0)===0 && Date.now()<deadline) { Math.sqrt(Math.random()); }
    parentPort.postMessage({type:'result',value:Atomics.load(flag,0)});`);
  const config = {
    KEYCLOAK_ISSUER: "http://localhost/realms/test",
    KEYCLOAK_JWKS_URI: "http://localhost/realms/test/certs",
    KEYCLOAK_AUDIENCE: "bim-worker-test",
    CORS_ALLOWED_ORIGINS: "http://localhost:3000"
  };
  const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]));
  Object.assign(process.env, config);
  const server = createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const flag = new Int32Array(new SharedArrayBuffer(4));
  let started!: () => void;
  const start = new Promise<void>((resolve) => { started = resolve; });
  const task = new BimBackgroundRunner().run<number>(f.entry, flag.buffer, () => started());
  try {
    await start;
    for (let i = 0; i < 3; i++) {
      const response = await fetch(`http://127.0.0.1:${address.port}/health`, { signal: AbortSignal.timeout(2000) });
      assert.equal(response.status, 200);
      assert.equal((await response.json()).service, "bff");
    }
    Atomics.store(flag, 0, 1);
    assert.equal(await task, 1, "HTTP finished before the CPU worker timed out");
  } finally {
    Atomics.store(flag, 0, 1);
    await task.catch(() => undefined);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await f.dispose();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("conversion/index tasks share one slot, queue is bounded, failure releases the slot", async () => {
  const f = await fixture(`if(workerData.fail) throw new Error('test crash');
    const flags=new Int32Array(workerData.flags);
    const prior=Atomics.add(flags,0,1);
    const until=Date.now()+150; while(Date.now()<until) {}
    Atomics.sub(flags,0,1);
    parentPort.postMessage({type:'result',value:prior});`);
  try {
    const runner = new BimBackgroundRunner(3);
    const flags = new SharedArrayBuffer(4);
    const failed = assert.rejects(runner.run(f.entry, { fail: true }), /test crash/);
    const one = runner.run(f.entry, { flags });
    const two = runner.run(f.entry, { flags });
    await assert.rejects(runner.run(f.entry, { flags }), /queue is full/);
    await failed;
    assert.deepEqual(await Promise.all([one, two]), [0, 0]);
    assert.equal(await runner.run(f.entry, { flags }), 0);
  } finally { await f.dispose(); }
});

test("exit without a result rejects rather than leaving a pending request", async () => {
  const f = await fixture("process.exit(0);");
  try { await assert.rejects(new BimBackgroundRunner().run(f.entry, {}), /without a result/); }
  finally { await f.dispose(); }
});
