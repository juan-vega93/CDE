import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import express from "express";
import routes from "../routes/bim-index.routes";
import { getDatabasePool } from "./client";
import * as store from "./bim-index-store";
import { createBimIndexGeneration, failBimIndexGeneration, lockBimIndexScope, publishBimIndexGeneration, resolvePublishedBimIndexGeneration, withBimPublishedRead } from "./bim-index-generations";
import { replaceAuthoringElementIndex } from "./bim-authoring-store";
import { resolveAuthoringElements } from "../services/bim-authoring-resolver";
import { toCanonicalBimModelKey } from "../services/bim-model-identity";
import { isBimRevisionId, type BimProcessingContext } from "../services/bim-revision-identity";

test("atomic generations on real PostgreSQL", { skip: !process.env.DATABASE_URL, timeout: 60000 }, async (t) => {
  const pool = getDatabasePool();
  const projectCode = `TEST-GENERATION-${randomUUID().toUpperCase()}`;
  const documentPath = "/TEST/Model.ifc";
  const modelKey = "frag:/test/model.ifc";
  const input = { projectCode, documentPath, documentName: "Model.ifc", modelKey };
  const ref = { setName: "Datos_Partida", propertyName: "Metrado" };
  let revision = 0;
  const context = (path = documentPath): BimProcessingContext => {
    // Synthetic DB identities, not an IFC parser/hash test.
    const revisionId = `sha256:${(++revision).toString(16).padStart(64, "0")}`;
    assert.ok(isBimRevisionId(revisionId));
    return { projectCode, modelKey: toCanonicalBimModelKey(path), revisionId };
  };
  const payload = (ids: number[], value: number | string) => ids.map(localId => ({
localId, globalId: localId === 118 || localId === 126 ? "X" : `G${localId}`, ifcClass: "IfcSlab", properties: [
      { setName: ref.setName, name: ref.propertyName, value }, { setName: ref.setName, name: "Partida", value: "0.2.1.3" }
    ]
}));
  const authoring = async (ctx: BimProcessingContext, ids: number[]) => replaceAuthoringElementIndex(resolveAuthoringElements({
context: ctx, relations: [],
    entities: ids.map(localId => ({ localId, ifcClass: "IfcSlab", geometryStatus: "present" as const }))
}));
  const model = await store.upsertBimModel({ ...input, sourceHash: "legacy-A", status: "processing" });
  const build = async (ids: number[], value: number | string, modelId = model.id, ctx = context()) => {
    const id = await createBimIndexGeneration(modelId, ctx);
    for (const element of payload(ids, value)) await store.bulkUpsertBimElements(modelId, [element], { generationId: id });
    await authoring(ctx, ids);
    return { generationId: id, context: ctx, elementCount: ids.length, propertyCount: ids.length * 2 };
  };
  const visibleSnapshot = async () => (await pool.query(`select e.local_id,e.global_id,p.name,v.value_text,v.value_number,p.value_type
    from cde_bim_visible_elements e join cde_bim_models m on m.id=e.bim_model_id
    join cde_bim_property_values v on v.bim_element_id=e.id join cde_bim_properties p on p.id=v.property_id
    where m.project_code=$1 order by e.local_id,p.name`, [projectCode])).rows;
  const checkReaders = async (ids: number[], value: number) => {
    const query = { projectCode, modelKeys: [modelKey] };
    const sorted = (values: number[]) => values.sort((a, b) => a - b);
    const catalog = await store.getBimPropertyCatalog(query);
    assert.deepEqual(catalog.valuesBySetAndProperty.Datos_Partida.Metrado, [{ value: String(value), count: ids.length }]);
    assert.deepEqual(sorted(Object.values(await store.queryBimPropertyLocalIds({ ...query, property: ref })).flat()), ids);
    const qa = await store.queryBimPropertyAuditRecords({ ...query, property: ref, operator: "equals", value: String(value) });
    assert.deepEqual(sorted(qa.map(r => r.localId)), ids); assert.ok(qa.every(r => r.matches));
    const cost = await store.getBimCost5DAggregation({ ...query, itemId: { setName: ref.setName, propertyName: "Partida" }, quantity: ref });
    assert.equal(cost.rows[0].quantity, value * ids.length);
    assert.deepEqual(sorted(Object.values(cost.rows[0].localIdsByModelKey).flat()), ids);
    assert.equal(cost.rows[0].selection?.unresolvedEntityCount, 0);
    assert.deepEqual(sorted(cost.rows[0].selection!.groups.flatMap(g => g.authoringElements.flatMap(a => a.graphicalLocalIds))), ids);
    assert.ok(cost.rows[0].selection!.groups.every(g => g.context.projectCode === projectCode && g.context.modelKey === documentPath));
    const metering = await store.getBimCost5DMeteringRows({ ...query, columns: [{ id: "q", label: "q", ref }], limit: 100, offset: 0 });
    assert.deepEqual(sorted(metering.rows.map(r => r.localId)), ids);
    assert.ok(metering.rows.every(r => r.values[0] === String(value)));
    const index = await store.getBimPropertyIndex(query);
    assert.deepEqual(sorted(Object.values(index.localIdsByModelKey).flat()), ids);
    const summary = await store.getBimPropertySummary({ ...query, propertySetName: ref.setName, propertyName: ref.propertyName });
    assert.equal(summary.bucketCount, 1);
    for (const localId of ids) {
      const properties = await store.getBimElementProperties({ projectCode, modelKey, localId });
      assert.equal(properties?.propertySets.find(s => s.name === ref.setName)?.properties.find(p => p.name === ref.propertyName)?.value, value);
    }
  };
  try {
    await t.test("additive migration preserves a pre-schema legacy index and is idempotent", async () => {
      const client = await pool.connect();
      const schema = `generation_migration_${randomUUID().replace(/-/g, "")}`;
      try {
        await client.query(`create schema ${schema}; set search_path to ${schema}, public`);
        await client.query(await readFile(path.join(__dirname, "bim-schema.sql"), "utf8"));
        await client.query(`insert into cde_bim_models(project_code,document_path,document_name,model_key,status)
          values('LEGACY','/Legacy.ifc','Legacy.ifc','ifc:/legacy.ifc','ready');
          insert into cde_bim_elements(bim_model_id,local_id,global_id) select id,118,'X' from cde_bim_models`);
        const before = (await client.query("select id,bim_model_id,local_id,global_id from cde_bim_elements")).rows;
        const migration = await readFile(path.join(__dirname, "bim-index-generations.sql"), "utf8");
        await client.query(migration); await client.query(migration);
        assert.deepEqual((await client.query("select id,bim_model_id,local_id,global_id from cde_bim_visible_elements")).rows, before);
        assert.equal((await client.query("select count(*)::int n from cde_bim_index_generations")).rows[0].n, 0);
      } finally { await client.query(`set search_path to public; drop schema ${schema} cascade`); client.release(); }
    });
    await store.bulkUpsertBimElements(model.id, payload([118], 5), { finalize: true });
    const otherLegacy = await store.upsertBimModel({ ...input, sourceHash: "legacy-B", status: "processing" });
    await store.bulkUpsertBimElements(otherLegacy.id, payload([126], 6), { finalize: true });
    await t.test("legacy fallback preserves contradictory ready rows without inferring a revision", async () => {
      assert.equal(await resolvePublishedBimIndexGeneration(projectCode, toCanonicalBimModelKey(documentPath)), null);
      assert.deepEqual(Object.values(await store.queryBimPropertyLocalIds({ projectCode, property: ref })).flat(), [118, 126]);
      assert.equal((await store.getBimElementProperties({ projectCode, modelKey, localId: 126 }))?.globalId, "X");
      const index = await store.getBimPropertyIndex({projectCode});
      await store.upsertBimPropertyIndexSnapshot({projectCode,signature:"legacy",modelKeys:[modelKey],elementCount:2,index});
      assert.deepEqual(await store.getBimPropertyIndexSnapshot({projectCode,signature:"legacy"}),index);
    });
    const legacy = await visibleSnapshot();
    const a = await build([1, 2, 3], 10);
    await t.test("building A leaves opaque legacy untouched", async () => { assert.deepEqual(await visibleSnapshot(), legacy); });
    await t.test("publish A replaces every legacy reader", async () => { await publishBimIndexGeneration(a); await checkReaders([1, 2, 3], 10); });
    const snapshotA = await visibleSnapshot();
    const b = await build([2, 3, 4], 20);
    await t.test("building B does not change A, definitions or model counts", async () => {
      assert.deepEqual(await visibleSnapshot(), snapshotA); await checkReaders([1, 2, 3], 10);
      const metadata = await store.upsertBimModel({ ...input, sourceHash: "legacy-A", status: "failed", elementCount: 999 });
      assert.equal(metadata.elementCount, 3); assert.equal(metadata.status, "ready");
    });
    await t.test("publish B gives all eight readers only B; counts and values agree", async () => {
      await publishBimIndexGeneration(b); await checkReaders([2, 3, 4], 20);
      assert.equal(await store.getBimElementProperties({ projectCode, modelKey, localId: 1 }), null);
      const counts = (await pool.query(`select g.element_count,g.property_count,m.element_count as model_elements,m.property_count as model_properties
        from cde_bim_index_generations g join cde_bim_models m on m.id=g.bim_model_id where g.id=$1`, [b.generationId])).rows[0];
      assert.deepEqual(counts, { element_count: 3, property_count: 6, model_elements: 3, model_properties: 6 });
    });
    await t.test("same generation publish retry is idempotent and published batches are rejected", async () => {
      await publishBimIndexGeneration(b);
      await assert.rejects(store.bulkUpsertBimElements(model.id, payload([99], 99), { generationId: b.generationId }), /GENERATION_NOT_BUILDING/);
      await checkReaders([2, 3, 4], 20);
    });
    await t.test("mid-build failure with changed property type preserves published rows exactly", async () => {
      const before = await visibleSnapshot(); const failed = await build([2, 3], "different-type");
      await assert.rejects(store.bulkUpsertBimElements(model.id, [{ localId: 2.5 }], { generationId: failed.generationId }));
      await failBimIndexGeneration(failed.generationId, "controlled batch failure");
      assert.deepEqual(await visibleSnapshot(), before); await checkReaders([2, 3, 4], 20);
    });
    await t.test("missing Authoring and incorrect counts prevent publication", async () => {
      const ctx = context(); const id = await createBimIndexGeneration(model.id, ctx);
      await store.bulkUpsertBimElements(model.id, payload([9], 90), { generationId: id });
      const next = { generationId: id, context: ctx, elementCount: 1, propertyCount: 2 };
      await assert.rejects(publishBimIndexGeneration(next), /AUTHORING_NOT_READY/);
      await authoring(ctx, [9]);
      await assert.rejects(publishBimIndexGeneration({ ...next, elementCount: 2 }), /COUNTS_MISMATCH/);
      await failBimIndexGeneration(id, "controlled completion failure"); await checkReaders([2, 3, 4], 20);
    });
    await t.test("publication transaction failure rolls back superseding A", async () => {
      const failed = await build([9], 90);
      await pool.query(`create function test_generation_publish_failure() returns trigger language plpgsql as $$ begin
        if new.id='${failed.generationId}' and new.status='published' then raise exception 'controlled publication failure'; end if; return new; end $$;
        create trigger test_generation_publish_failure before update on cde_bim_index_generations for each row execute function test_generation_publish_failure()`);
      try { await assert.rejects(publishBimIndexGeneration(failed), /controlled publication failure/); await checkReaders([2, 3, 4], 20); }
      finally { await pool.query("drop trigger test_generation_publish_failure on cde_bim_index_generations; drop function test_generation_publish_failure()"); }
    });
    await t.test("changed localId for same GlobalId is never combined", async () => {
      const old = await build([118], 10); await publishBimIndexGeneration(old);
      const next = await build([126], 20); await checkReaders([118], 10);
      await publishBimIndexGeneration(next); await checkReaders([126], 20);
      assert.equal(await store.getBimElementProperties({ projectCode, modelKey, localId: 118 }), null);
    });
    await t.test("stale B cannot replace C; independent connections enforce model lock", async () => {
      const old = await build([1], 30); const newer = await build([2], 40);
      const job = { ...input, sourceHash: "legacy-A" };
      await store.upsertBimIndexJob({ ...job, generationId: old.generationId, status: "processing" });
      await store.upsertBimIndexJob({ ...job, generationId: newer.generationId, status: "processing" });
      const held = await pool.connect();
      try {
        await held.query("begin"); await lockBimIndexScope(held, projectCode, documentPath);
        // Publication uses a different connection and must wait for this transaction.
        const publishing = publishBimIndexGeneration(newer);
        let blocked = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const waiting = await pool.query(`select pid from pg_stat_activity where datname=current_database()
            and wait_event_type='Lock' and query like '%cde_bim_index_scopes%'`);
          if (waiting.rowCount) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        assert.ok(blocked, "a second PostgreSQL connection must be waiting on the scope lock");
        await held.query("commit"); await publishing;
        await store.upsertBimIndexJob({ ...job, generationId: newer.generationId, status: "ready" });
        await assert.rejects(publishBimIndexGeneration(old), /STALE_GENERATION/);
        await failBimIndexGeneration(old.generationId, "STALE_GENERATION");
        await store.upsertBimIndexJob({ ...job, generationId: old.generationId, status: "failed" });
        assert.equal((await store.getBimIndexJob(job))?.status, "ready");
        await checkReaders([2], 40);
      } finally { await held.query("rollback"); held.release(); }
    });
    await t.test("different exact-case model scope is not blocked by another model lock", async () => {
      const path = "/TEST/model.ifc";
      const other = await store.upsertBimModel({ ...input, documentPath: path, modelKey: path });
      const next = await build([88], 88, other.id, context(path));
      const held = await pool.connect();
      try {
        await held.query("begin"); await lockBimIndexScope(held, projectCode, documentPath);
        await publishBimIndexGeneration(next); // cannot finish if publication takes a global lock
        assert.equal((await resolvePublishedBimIndexGeneration(projectCode, toCanonicalBimModelKey(path)))?.id, next.generationId);
      } finally { await held.query("rollback"); held.release(); await pool.query("delete from cde_bim_models where id=$1", [other.id]); }
    });
    await t.test("reader transaction keeps its snapshot across a concurrent publish", async () => {
      const next = await build([3], 50);
      await withBimPublishedRead(async () => {
        assert.equal((await store.getBimPropertyCatalog({ projectCode })).valuesBySetAndProperty.Datos_Partida.Metrado[0].value, "40");
        await publishBimIndexGeneration(next);
        await checkReaders([2], 40);
      });
      await checkReaders([3], 50);
    });
    await t.test("legacy bulk HTTP cannot write after a canonical context exists", async () => {
      const app = express(); app.use(express.json()); app.use(routes);
      const server = app.listen(0, "127.0.0.1");
      try {
        await new Promise<void>(r => server.once("listening", r));
        const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}/models/${otherLegacy.id}/elements/bulk`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ elements: payload([99], 99), finalize: true })
});
        assert.equal(response.status, 409); assert.equal((await response.json()).message, "GENERATION_CONTEXT_REQUIRED");
        await checkReaders([3], 50);
      } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
    });
    await t.test("superseded generation cascade cannot delete published values", async () => {
      await pool.query("delete from cde_bim_index_generations where id=$1 and status='superseded'", [a.generationId]);
      assert.equal((await pool.query("select count(*)::int n from cde_bim_elements where generation_id=$1", [a.generationId])).rows[0].n, 0);
      await checkReaders([3], 50);
    });
    await t.test("legacy timestamps and snapshot payloads cannot override canonical publication", async () => {
      await pool.query("update cde_bim_models set updated_at=now()+interval '1 day' where id=$1",[otherLegacy.id]);
      assert.equal((await store.getBimModelByDocument({projectCode,documentPath}))?.id,model.id);
      assert.equal(await store.getBimModelByDocument({projectCode,documentPath,sourceHash:"legacy-B"}),null);
      assert.equal(await store.getBimPropertyIndexSnapshot({projectCode,signature:"legacy"}),null);
      await checkReaders([3],50);
    });
  } finally {
    await pool.query("delete from cde_bim_index_jobs where project_code=$1", [projectCode]);
    await pool.query("delete from cde_bim_property_index_snapshots where project_code=$1",[projectCode]);
    await pool.query("delete from cde_bim_models where project_code=$1", [projectCode]);
    await pool.query("delete from cde_bim_index_scopes where project_code=$1", [projectCode]);
    await pool.query("delete from cde_bim_authoring_contexts where project_code=$1", [projectCode]);
    await pool.end();
  }
});
