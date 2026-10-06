import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID, createHash } from "node:crypto";
import { prepareFragInBackground, indexInBackground } from "./bim-background-processing";
import { createAuthoringIfcFixture } from "./fixtures/bim-authoring-ifc.fixture";
import { createQuantityIfcFixture } from "./fixtures/bim-quantity-ifc.fixture";
import { prepareBimIfcInput } from "./bim-revision-identity";
import { getDatabasePool } from "../db/client";
import { bimBackgroundRunner } from "./bim-background-runner";
import { createBimIndexGeneration } from "../db/bim-index-generations";
import { upsertBimIndexJob } from "../db/bim-index-store";

const projectCode = `TEST-WORKER-${randomUUID()}`;
const enabled = Boolean(process.env.DATABASE_URL);
after(async () => {
  if (!enabled) return;
  const pool = getDatabasePool();
  for (const table of ["cde_bim_authoring_contexts", "cde_bim_models", "cde_bim_index_jobs"]) {
    await pool.query(`delete from ${table} where project_code=$1`, [projectCode]);
  }
  await pool.end();
});

test("real worker converts valid IFC with exact revision, retained bytes and FRAG digest", async () => {
  const ifcBuffer = createAuthoringIfcFixture();
  const input = { projectCode, documentPath: "/TEST/Worker.ifc", ifcBuffer };
  const expected = prepareBimIfcInput(input);
  const result = await prepareFragInBackground(input);
  assert.deepEqual(result.prepared.context, expected.context);
  assert.ok(Object.isFrozen(result.prepared.context));
  assert.deepEqual(result.prepared.ifcBytes, expected.ifcBytes);
  assert.ok(result.fragBytes.length > 0);
  assert.equal(result.fragContentSha256, createHash("sha256").update(result.fragBytes).digest("hex"));
  assert.equal(ifcBuffer.byteLength, expected.ifcBytes.byteLength, "caller buffer not detached");
});

test("background index preserves generation publication, authoring and quantities", { skip: !enabled }, async (t) => {
  const input = { projectCode, documentPath: "/TEST/Worker.ifc", documentName: "Worker.ifc", modelKey: "frag:/test/worker.ifc" };
  const ifcBuffer = createQuantityIfcFixture();
  const prepared = prepareBimIfcInput({ ...input, ifcBuffer });
  const direct = await indexInBackground(input, { ifcBuffer });
  const repeated = await indexInBackground(input, { prepared });
  assert.deepEqual(direct.context, prepared.context);
  assert.deepEqual(repeated.context, direct.context);
  assert.equal(repeated.elementCount, 188);
  const pool = getDatabasePool();
  const generations = await pool.query(`select g.status from cde_bim_index_generations g
    join cde_bim_index_scopes s on s.id=g.scope_id where s.project_code=$1`, [projectCode]);
  assert.equal(generations.rows.filter((r) => r.status === "published").length, 1);
  const members = await pool.query(`select count(*)::int n from cde_bim_authoring_members m
    join cde_bim_authoring_contexts c on c.id=m.context_id where c.project_code=$1`, [projectCode]);
  assert.equal(members.rows[0].n, 188);
  const observations = await pool.query(`select q.source,count(*)::int n from cde_bim_quantity_observations q
    join cde_bim_index_generations g on g.id=q.generation_id join cde_bim_index_scopes s on s.id=g.scope_id
    where s.project_code=$1 and g.status='published' group by q.source`, [projectCode]);
  assert.ok(observations.rows.some((r) => r.source === "stored_parameter" && r.n > 0));
  assert.ok(observations.rows.some((r) => r.source === "ifc_quantity" && r.n > 0));
  const published = (await pool.query(`select id from cde_bim_index_generations where bim_model_id=$1 and status='published'`, [direct.modelId])).rows[0].id;
  let crashedGeneration = published;
  const crash = t.mock.method(bimBackgroundRunner, "run", async (_entry: string, _data: unknown, onEvent?: (event: unknown) => void) => {
    onEvent?.({ type: "generation", generationId: crashedGeneration });
    throw new Error("simulated worker crash");
  });
  try {
    await t.test("crash after publication cannot downgrade ready job or published generation", async () => {
      await assert.rejects(indexInBackground(input, { prepared }), /simulated worker crash/);
      const state = (await pool.query(`select g.status, j.status as job_status from cde_bim_index_generations g
        join cde_bim_index_jobs j on j.generation_id=g.id where g.id=$1`, [published])).rows[0];
      assert.deepEqual(state, { status: "published", job_status: "ready" });
    });
    await t.test("crash reconciles only its building generation and preserves previous publication", async () => {
      crashedGeneration = await createBimIndexGeneration(direct.modelId, prepared.context, {});
      await upsertBimIndexJob({ ...input, generationId: crashedGeneration, status: "processing" });
      await assert.rejects(indexInBackground(input, { prepared }), /simulated worker crash/);
      const state = (await pool.query(`select g.status,j.status as job_status from cde_bim_index_generations g
        join cde_bim_index_jobs j on j.generation_id=g.id where g.id=$1`, [crashedGeneration])).rows[0];
      assert.deepEqual(state, { status: "failed", job_status: "failed" });
      assert.equal((await pool.query("select status from cde_bim_index_generations where id=$1", [published])).rows[0].status, "published");
    });
  } finally { crash.mock.restore(); }
});
