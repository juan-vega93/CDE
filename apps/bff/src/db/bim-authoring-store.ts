import { getDatabasePool } from "./client";
import { toCanonicalBimModelKey } from "../services/bim-model-identity";
import { isBimRevisionId, type BimProcessingContext } from "../services/bim-revision-identity";
import type { AuthoringElementResolution, AuthoringModelContext, AuthoringResolution } from "../services/bim-authoring-resolver";

function contextValues(context: AuthoringModelContext): string[] {
  if (!context.projectCode.trim() || toCanonicalBimModelKey(context.modelKey) !== context.modelKey ||
    !isBimRevisionId(context.revisionId)) {
    throw new Error("A strict canonical BIM revision context is required");
  }
  return [context.projectCode, context.modelKey, context.revisionId];
}

/** Stores resolver output, never infers authorship. Replacement is one exact scope. */
export async function replaceAuthoringElementIndex(resolution: AuthoringResolution): Promise<void> {
  const scope = contextValues(resolution.context);
  // Serialize caller-owned evidence before awaiting; no mixed output if the caller mutates it.
  const elements = resolution.elements.map((element) => {
    const graphical = new Set(element.graphicalLocalIds);
    const unknown = new Set(element.geometryUnknownLocalIds);
    const members = new Set(element.memberLocalIds);
    if (!members.size || (element.rootLocalId !== undefined && !members.has(element.rootLocalId)) ||
      [...graphical, ...unknown].some((id) => !members.has(id)) ||
      [...graphical].some((id) => unknown.has(id))) throw new Error("Inconsistent resolver membership");
    return {
      values: [element.identityKey, element.rootLocalId ?? null, element.resolutionMethod,
        element.identityConfidence, element.resolutionStatus, element.authoringElementId ?? null,
        element.sourceContainer ?? null, JSON.stringify(element.compositionEvidence)],
      ids: [...element.memberLocalIds],
      geometry: element.memberLocalIds.map((id) => graphical.has(id) ? "present" : unknown.has(id) ? "unknown" : "absent")
    };
  });
  const version = resolution.resolverVersion;
  const diagnostics = JSON.stringify(resolution.diagnostics);
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    // ON CONFLICT UPDATE acquires the context row lock until commit, including first creation.
    const result = await client.query<{ id: string }>(`
      insert into cde_bim_authoring_contexts (project_code, model_key, revision_id, resolver_version, diagnostics)
      values ($1, $2, $3, $4, $5::jsonb)
      on conflict (project_code, model_key, revision_id) do update set
        resolver_version = excluded.resolver_version, diagnostics = excluded.diagnostics, updated_at = now()
      returning id`, [...scope, version, diagnostics]);
    const contextId = result.rows[0].id;
    await client.query("delete from cde_bim_authoring_elements where context_id = $1", [contextId]);
    for (const element of elements) {
      const inserted = await client.query<{ id: string }>(`
        insert into cde_bim_authoring_elements (context_id, element_key, root_local_id, resolution_method,
          identity_confidence, resolution_status, authoring_element_id, source_container, composition_evidence)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) returning id`, [contextId, ...element.values]);
      await client.query(`insert into cde_bim_authoring_members
        (context_id, authoring_element_id, local_id, geometry_status)
        select $1::uuid, $2::uuid, local_id, geometry_status from unnest($3::int[], $4::text[]) as m(local_id, geometry_status)`,
      [contextId, inserted.rows[0].id, element.ids, element.geometry]);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

type ElementRow = {
  element_key: string; root_local_id: number | null;
  resolution_method: AuthoringElementResolution["resolutionMethod"];
  identity_confidence: AuthoringElementResolution["identityConfidence"];
  resolution_status: AuthoringElementResolution["resolutionStatus"];
  authoring_element_id: string | null; source_container: string | null;
  composition_evidence: AuthoringElementResolution["compositionEvidence"];
  member_ids: number[]; graphical_ids: number[]; unknown_ids: number[];
};

export async function resolveAuthoringElementByLocalId(
  context: BimProcessingContext, localId: number
): Promise<AuthoringElementResolution | null> {
  if (!Number.isSafeInteger(localId) || localId <= 0) throw new Error("Invalid IFC localId");
  // One statement/snapshot: a concurrent replacement cannot mix two generations of the index.
  const result = await getDatabasePool().query<ElementRow>(`
    select a.*, array_agg(m.local_id order by m.local_id) as member_ids,
      coalesce(array_agg(m.local_id order by m.local_id) filter (where m.geometry_status = 'present'), '{}') as graphical_ids,
      coalesce(array_agg(m.local_id order by m.local_id) filter (where m.geometry_status = 'unknown'), '{}') as unknown_ids
    from cde_bim_authoring_contexts c
    join cde_bim_authoring_members picked on picked.context_id = c.id and picked.local_id = $4
    join cde_bim_authoring_elements a on a.id = picked.authoring_element_id
    join cde_bim_authoring_members m on m.authoring_element_id = a.id
    where c.project_code = $1 and c.model_key = $2 and c.revision_id = $3
    group by a.id`, [...contextValues(context), localId]);
  const row = result.rows[0];
  if (!row) return null;
  return {
    identityKey: row.element_key,
    ...(row.root_local_id === null ? {} : { rootLocalId: row.root_local_id }),
    memberLocalIds: row.member_ids, graphicalLocalIds: row.graphical_ids,
    geometryUnknownLocalIds: row.unknown_ids,
    authoringElementId: row.authoring_element_id ?? undefined,
    sourceContainer: row.source_container ?? undefined,
    resolutionMethod: row.resolution_method, identityConfidence: row.identity_confidence,
    resolutionStatus: row.resolution_status, compositionEvidence: row.composition_evidence
  };
}

export async function getAuthoringElementMembers(context: BimProcessingContext, authoringElementKey: string): Promise<number[]> {
  const result = await getDatabasePool().query<{ local_id: number }>(`
    select m.local_id from cde_bim_authoring_contexts c
    join cde_bim_authoring_elements a on a.context_id = c.id and a.element_key = $4
    join cde_bim_authoring_members m on m.authoring_element_id = a.id
    where c.project_code = $1 and c.model_key = $2 and c.revision_id = $3
    order by m.local_id`, [...contextValues(context), authoringElementKey]);
  return result.rows.map((row) => row.local_id);
}
