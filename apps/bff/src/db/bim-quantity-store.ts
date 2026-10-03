import { getDatabasePool } from './client';
import { getBimReadDatabase } from './bim-index-generations';
import { createQuantityObservation, type QuantityObservation, type QuantityOrigin } from '../services/bim-quantity-provenance';
import { isBimRevisionId, type BimProcessingContext } from '../services/bim-revision-identity';
import { toCanonicalBimModelKey } from '../services/bim-model-identity';

function scope(context: BimProcessingContext) {
  if (!context.projectCode.trim() || !isBimRevisionId(context.revisionId) || toCanonicalBimModelKey(context.modelKey) !== context.modelKey)
    throw new Error('INVALID_QUANTITY_CONTEXT');
  return [context.projectCode, context.modelKey, context.revisionId];
}

/** One transaction, bounded serialization batches; publication uses the same locked generation. */
export async function replaceGenerationQuantityObservations(generationId: string, context: BimProcessingContext,
  observations: readonly QuantityObservation[]) {
  const values = scope(context);
  const client = await getDatabasePool().connect();
  try {
    await client.query('begin');
    const generation = await client.query(`select g.status from cde_bim_index_generations g
      join cde_bim_index_scopes s on s.id=g.scope_id where g.id=$1 and s.project_code=$2
      and s.canonical_model_key=$3 and g.revision_id=$4 for update of g`, [generationId, ...values]);
    if (generation.rows[0]?.status !== 'building') throw new Error('QUANTITY_GENERATION_NOT_BUILDING');
    await client.query('delete from cde_bim_quantity_observations where generation_id=$1', [generationId]);
    for (let offset = 0; offset < observations.length; offset += 2000) {
      const batch = observations.slice(offset, offset + 2000).map(observation => {
        if (scope(observation.context).some((v, i) => v !== values[i])) throw new Error('QUANTITY_CONTEXT_MISMATCH');
        const o = observation.origin;
        if (o.source === 'viewer_geometry') throw new Error('BACKEND_VIEWER_GEOMETRY_UNSUPPORTED');
        // JSON cannot represent these numbers; reject rather than silently replacing them by null.
        if (typeof observation.rawValue === 'number' && !Number.isFinite(observation.rawValue)) throw new Error('NON_JSON_QUANTITY_VALUE');
        const canonical = createQuantityObservation(observation);
        if (canonical.observationKey !== observation.observationKey || canonical.numericValue !== observation.numericValue || observation.source !== o.source)
          throw new Error('INVALID_QUANTITY_OBSERVATION');
        return { local_id: observation.localId, occurrence_index: observation.occurrenceIndex, source: o.source,
          set_name: o.source === 'ifc_quantity' ? o.quantitySet : o.propertySet,
          property_name: o.source === 'ifc_quantity' ? o.quantityName : o.propertyName,
          quantity_ifc_type: o.source === 'ifc_quantity' ? o.quantityType : null,
          native_set_id: o.source === 'ifc_quantity' ? o.quantitySetLocalId : o.propertySetLocalId,
          native_value_id: o.source === 'ifc_quantity' ? o.quantityLocalId : o.propertyLocalId,
          value_field: o.source === 'stored_parameter' ? o.valueField : null,
          raw_value: observation.rawValue, numeric_value: observation.numericValue, unit: observation.unit,
          authoring_key: observation.authoring?.identityKey, entity_role: observation.authoring?.role };
      });
      await client.query(`insert into cde_bim_quantity_observations
        (generation_id,local_id,occurrence_index,source,set_name,property_name,quantity_ifc_type,
          native_set_id,native_value_id,value_field,raw_value,numeric_value,unit,authoring_key,entity_role)
        select $1::uuid,local_id,occurrence_index,source,set_name,property_name,quantity_ifc_type,
          native_set_id,native_value_id,value_field,coalesce(raw_value,'null'::jsonb),numeric_value,unit,authoring_key,entity_role
        from jsonb_to_recordset($2::jsonb) as x(local_id int,occurrence_index int,
          source text,set_name text,property_name text,quantity_ifc_type text,native_set_id int,native_value_id int,
          value_field text,raw_value jsonb,numeric_value double precision,unit jsonb,authoring_key text,entity_role text)`,
      [generationId, JSON.stringify(batch)]);
    }
    await client.query(`update cde_bim_index_generations set metadata=metadata ||
      jsonb_build_object('quantityObservationCount',$2::int) where id=$1`, [generationId, observations.length]);
    await client.query('commit');
  } catch (error) { await client.query('rollback'); throw error; }
  finally { client.release(); }
}

export type QuantitySelector =
  | { source: 'stored_parameter'; setName: string; name: string; entityRole?: 'root' | 'child' | 'standalone' }
  | { source: 'ifc_quantity'; setName: string; name: string;
      quantityType: Extract<QuantityOrigin, { source: 'ifc_quantity' }>['quantityType']; entityRole?: 'root' | 'child' | 'standalone' };

type EvidenceRow = {
  local_id: number; occurrence_index: number; source: 'stored_parameter' | 'ifc_quantity';
  set_name: string; property_name: string; quantity_ifc_type: Extract<QuantityOrigin, {source:'ifc_quantity'}>['quantityType'];
  native_set_id: number | null; native_value_id: number | null; value_field: 'NominalValue' | null;
  raw_value: QuantityObservation['rawValue']; numeric_value: number | null; unit: QuantityObservation['unit'];
  authoring_key: string; entity_role: 'root' | 'child' | 'standalone';
};

/** Single SQL snapshot for all requested AEs. Optional generation pins, never exposes unpublished data. */
export async function queryAuthoringQuantitySummaries(input: {
  context: BimProcessingContext; generationId?: string;
  elements: readonly { identityKey: string; primaryLocalId?: number }[]; selector: QuantitySelector;
  /** Bounded audit samples per role; summary statistics always cover every observation. */
  auditLimitPerRole?: number;
}) {
  const p = input.selector;
  const auditLimit = input.auditLimitPerRole ?? 256;
  if (!Number.isSafeInteger(auditLimit) || auditLimit < 1 || auditLimit > 2000) throw new Error('INVALID_QUANTITY_AUDIT_LIMIT');
  const result = await getBimReadDatabase().query<{
    identity_key: string; root_local_id: number | null; root_ifc_class: string | null; root_global_id: string | null;
    primary_local_id: number | null; primary_ifc_class: string | null; primary_global_id: string | null;
    member_count: number; observations: EvidenceRow[]; generation_id: string;
    observation_count: number; distinct_value_count: number; child_count: number;
    root_count: number; standalone_count: number; root_value: number | null; standalone_value: number | null;
    minimum: number | null; maximum: number | null;
  }>(`with published as (
    select g.* from cde_bim_index_generations g where g.id=cde_bim_published_generation($1,$2)
      and g.revision_id=$3 and ($4::uuid is null or g.id=$4)
  ), requested as (select * from jsonb_to_recordset($5::jsonb) as x(identity_key text, primary_local_id int))
  select r.identity_key,g.id as generation_id,a.root_local_id,root.ifc_class as root_ifc_class,root.global_id as root_global_id,
    picked.local_id as primary_local_id,clicked.ifc_class as primary_ifc_class,clicked.global_id as primary_global_id,
    (select count(*)::int from cde_bim_authoring_members m where m.authoring_element_id=a.id) as member_count,
    coalesce(q.observations,'[]'::jsonb) as observations,
    q.observation_count,q.distinct_value_count,q.child_count,q.root_count,q.standalone_count,
    q.root_value,q.standalone_value,q.minimum,q.maximum
  from published g cross join requested r
  join cde_bim_authoring_contexts c on c.project_code=$1 and c.model_key=$2 and c.revision_id=$3
  join cde_bim_authoring_elements a on a.context_id=c.id and a.element_key=r.identity_key
  left join cde_bim_elements root on root.generation_id=g.id and root.local_id=a.root_local_id
  left join cde_bim_authoring_members picked on picked.authoring_element_id=a.id and picked.local_id=r.primary_local_id
  left join cde_bim_elements clicked on clicked.generation_id=g.id and clicked.local_id=picked.local_id
  left join lateral (select
    jsonb_agg(to_jsonb(o)-'audit_rank' order by o.local_id,o.occurrence_index) filter(where audit_rank<=$11) as observations,
    count(*)::int as observation_count,count(distinct raw_value)::int as distinct_value_count,
    count(*) filter(where entity_role='child')::int as child_count,
    count(*) filter(where entity_role='root')::int as root_count,
    count(*) filter(where entity_role='standalone')::int as standalone_count,
    case when count(distinct numeric_value) filter(where entity_role='root')=1
      and count(*) filter(where entity_role='root' and numeric_value is null)=0
      then min(numeric_value) filter(where entity_role='root') end as root_value,
    case when count(distinct numeric_value) filter(where entity_role='standalone')=1
      and count(*) filter(where entity_role='standalone' and numeric_value is null)=0
      then min(numeric_value) filter(where entity_role='standalone') end as standalone_value,
    min(numeric_value) as minimum,max(numeric_value) as maximum
    from (select o.*,row_number() over(partition by entity_role order by local_id,occurrence_index) audit_rank
      from cde_bim_quantity_observations o where o.generation_id=g.id and o.authoring_key=a.element_key
      and o.source=$6 and o.set_name=$7 and o.property_name=$8
      and o.quantity_ifc_type is not distinct from $9::text and ($10::text is null or o.entity_role=$10)) o) q on true
  order by r.identity_key`, [...scope(input.context), input.generationId ?? null,
    JSON.stringify(input.elements.map(e => ({ identity_key: e.identityKey, primary_local_id: e.primaryLocalId }))),
    p.source, p.setName, p.name, p.source === 'ifc_quantity' ? p.quantityType : null, p.entityRole ?? null, auditLimit]);
  return result.rows.map(row => {
    const observations = row.observations.map(o => createQuantityObservation({
      context: input.context, localId: o.local_id, occurrenceIndex: o.occurrence_index, rawValue: o.raw_value, unit: o.unit,
      authoring: { identityKey: o.authoring_key, role: o.entity_role },
      origin: o.source === 'ifc_quantity' ? { source: o.source, quantitySet: o.set_name, quantityName: o.property_name,
        quantityType: o.quantity_ifc_type, quantitySetLocalId: o.native_set_id ?? undefined, quantityLocalId: o.native_value_id ?? undefined }
        : { source: o.source, propertySet: o.set_name, propertyName: o.property_name,
          propertySetLocalId: o.native_set_id ?? undefined, propertyLocalId: o.native_value_id ?? undefined, valueField: o.value_field ?? undefined }
    }));
    const rootQuantities = observations.filter(o => o.authoring?.role === 'root');
    const memberQuantities = observations.filter(o => o.authoring?.role === 'child');
    const standaloneQuantities = observations.filter(o => o.authoring?.role === 'standalone');
    return { identityKey: row.identity_key, generationId: row.generation_id,
      rootLocalId: row.root_local_id, rootIfcClass: row.root_ifc_class, rootGlobalId: row.root_global_id,
      primaryLocalId: row.primary_local_id, primaryIfcClass: row.primary_ifc_class, primaryGlobalId: row.primary_global_id,
      memberCount: row.member_count, observationCount: row.observation_count, distinctValueCount: row.distinct_value_count,
      rootValue: row.root_value ?? undefined, standaloneValue: row.standalone_value ?? undefined,
      min: row.minimum ?? undefined, max: row.maximum ?? undefined,
      roleCounts: {root:row.root_count,child:row.child_count,standalone:row.standalone_count},
      auditTruncated: observations.length < row.observation_count,
      status: !row.observation_count ? 'missing' : row.child_count === row.observation_count ? 'children_only'
        : row.distinct_value_count > 1 ? 'variation' : row.observation_count === 1 ? 'single' : 'replicated',
      rootQuantities, memberQuantities, standaloneQuantities };
  });
}
