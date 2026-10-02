import { AsyncLocalStorage } from "node:async_hooks";
import type { PoolClient } from "pg";
import { getDatabasePool } from "./client";
import { toCanonicalBimModelKey, type CanonicalBimModelKey } from "../services/bim-model-identity";
import { isBimRevisionId, type BimProcessingContext } from "../services/bim-revision-identity";
import type { UpsertBimModelInput } from "./bim-index-store";

const readTransaction = new AsyncLocalStorage<PoolClient>();
export function getBimReadDatabase() { return readTransaction.getStore() ?? getDatabasePool(); }

/** Pin every statement in a consumer response to one publication snapshot. */
export async function withBimPublishedRead<T>(read: () => Promise<T>): Promise<T> {
  if (readTransaction.getStore()) return read();
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin isolation level repeatable read read only");
    const result = await readTransaction.run(client, read);
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

/** All publication, registration and legacy writes take this model-scoped row lock. */
export async function lockBimIndexScope(client: PoolClient, projectCode: string, documentPath: string) {
  const key = toCanonicalBimModelKey(documentPath);
  await client.query(`insert into cde_bim_index_scopes(project_code,canonical_model_key)
    values($1,$2) on conflict do nothing`, [projectCode, key]);
  return (await client.query<{ id: string }>(`select id from cde_bim_index_scopes
    where project_code=$1 collate "C" and canonical_model_key=$2 collate "C" for update`, [projectCode, key])).rows[0].id;
}

export async function resolvePublishedBimIndexGeneration(projectCode: string, modelKey: CanonicalBimModelKey) {
  const result = await getBimReadDatabase().query<{ id: string; revision_id: string; sequence: string }>(`
    select g.id,g.revision_id,g.sequence from cde_bim_index_generations g
    where g.id=cde_bim_published_generation($1,$2)`, [projectCode, modelKey]);
  return result.rows[0] ?? null;
}

export async function createBimIndexGeneration(
  modelId: string, context: BimProcessingContext, metadata: Record<string, unknown> = {},
  modelSnapshot?: Pick<UpsertBimModelInput, "documentId" | "documentName" | "sourceVersion" | "modelKey">
) {
  if (!isBimRevisionId(context.revisionId) || toCanonicalBimModelKey(context.modelKey) !== context.modelKey) throw new Error("INVALID_GENERATION_CONTEXT");
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const scopeId = await lockBimIndexScope(client, context.projectCode, context.modelKey);
    const model = await client.query(`select id from cde_bim_models where id=$1
      and project_code=$2 collate "C" and cde_bim_document_key(document_path)=$3 collate "C"`, [modelId, context.projectCode, context.modelKey]);
    if (!model.rowCount) throw new Error("GENERATION_MODEL_CONTEXT_MISMATCH");
    const result = await client.query<{ id: string }>(`insert into cde_bim_index_generations(scope_id,bim_model_id,revision_id,metadata)
      values($1,$2,$3,$4::jsonb) returning id`, [scopeId, modelId, context.revisionId, JSON.stringify({ ...metadata, modelSnapshot })]);
    await client.query("commit");
    return result.rows[0].id;
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function failBimIndexGeneration(generationId: string, message: string) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const scope = (await client.query<{ project_code: string; canonical_model_key: string }>(`select s.* from cde_bim_index_scopes s
      join cde_bim_index_generations g on g.scope_id=s.id where g.id=$1`, [generationId])).rows[0];
    if (scope) await lockBimIndexScope(client, scope.project_code, scope.canonical_model_key);
    const failed = await client.query<{ bim_model_id: string }>(`update cde_bim_index_generations set status='failed',error_message=$2
      where id=$1 and status='building' returning bim_model_id`, [generationId, message]);
    if (failed.rows[0]) await client.query(`update cde_bim_models set status='failed',error_message=$2,updated_at=now()
      where id=$1 and status='processing'
      and cde_bim_published_generation(project_code,document_path) is null
      and not exists(select 1 from cde_bim_elements where bim_model_id=$1 and generation_id is null)`, [failed.rows[0].bim_model_id, message]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

export async function publishBimIndexGeneration(input: {
  generationId: string; context: BimProcessingContext; elementCount: number; propertyCount: number;
}) {
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const scopeId = await lockBimIndexScope(client, input.context.projectCode, input.context.modelKey);
    const generation = (await client.query<{ id: string; status: string; bim_model_id: string; sequence: string; metadata: Record<string, unknown> }>(`
      select * from cde_bim_index_generations where id=$1 and scope_id=$2 and revision_id=$3 for update`,
      [input.generationId, scopeId, input.context.revisionId])).rows[0];
    if (!generation) throw new Error("GENERATION_CONTEXT_MISMATCH");
    if (generation.status === "published") { await client.query("commit"); return; }
    if (generation.status !== "building") throw new Error("GENERATION_NOT_BUILDING");
    const newer = await client.query(`select id from cde_bim_index_generations where scope_id=$1 and status='published' and sequence>$2`, [scopeId, generation.sequence]);
    if (newer.rowCount) throw new Error("STALE_GENERATION");
    const jobs = await client.query<{ status: string }>("select status from cde_bim_index_jobs where generation_id=$1 for update", [generation.id]);
    if (jobs.rows.some((job) => job.status !== "processing")) throw new Error("GENERATION_JOB_NOT_ACTIVE");
    const counts = (await client.query<{ elements: number; properties: number }>(`select
      (select count(*)::int from cde_bim_elements where generation_id=$1) as elements,
      (select count(*)::int from cde_bim_property_values v join cde_bim_elements e on e.id=v.bim_element_id where e.generation_id=$1) as properties`, [generation.id])).rows[0];
    if (counts.elements !== input.elementCount || counts.properties !== input.propertyCount) throw new Error("GENERATION_COUNTS_MISMATCH");
    // The exact revision must have completed Authoring, including the empty IFC case.
    const authoring = await client.query(`select id from cde_bim_authoring_contexts
      where project_code=$1 collate "C" and model_key=$2 collate "C" and revision_id=$3 for share`,
      [input.context.projectCode, input.context.modelKey, input.context.revisionId]);
    if (!authoring.rowCount) throw new Error("GENERATION_AUTHORING_NOT_READY");
    const mismatch = await client.query(`select e.local_id from cde_bim_elements e
      where e.generation_id=$1 and (e.bim_model_id<>$3 or not exists(select 1 from cde_bim_authoring_members a where a.context_id=$2 and a.local_id=e.local_id))
      union all select a.local_id from cde_bim_authoring_members a where a.context_id=$2
      and not exists(select 1 from cde_bim_elements e where e.generation_id=$1 and e.local_id=a.local_id) limit 1`, [generation.id, authoring.rows[0].id, generation.bim_model_id]);
    if (mismatch.rowCount) throw new Error("GENERATION_AUTHORING_MEMBERS_MISMATCH");
    await client.query(`update cde_bim_index_generations set status='superseded' where scope_id=$1 and status='published'`, [scopeId]);
    await client.query(`update cde_bim_index_generations set status='published',published_at=now(),element_count=$2,property_count=$3 where id=$1`, [generation.id, counts.elements, counts.properties]);
    await client.query(`update cde_bim_models set status='ready',element_count=$2,property_count=$3,indexed_at=now(),error_message=null,
      document_name=coalesce($4::jsonb->'modelSnapshot'->>'documentName',document_name),
      document_id=case when $4::jsonb ? 'modelSnapshot' then $4::jsonb->'modelSnapshot'->>'documentId' else document_id end,
      source_version=case when $4::jsonb ? 'modelSnapshot' then $4::jsonb->'modelSnapshot'->>'sourceVersion' else source_version end,
      model_key=coalesce($4::jsonb->'modelSnapshot'->>'modelKey',model_key),
      metadata=metadata || ($4::jsonb - 'modelSnapshot') || jsonb_build_object('bimRevisionId',$5::text,'propertyIndexGenerationId',$6::text),
      updated_at=now() where id=$1`, [generation.bim_model_id, counts.elements, counts.properties, JSON.stringify(generation.metadata), input.context.revisionId, generation.id]);
    await client.query("commit");
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}
