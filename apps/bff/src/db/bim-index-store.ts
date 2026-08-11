import type { PoolClient } from "pg";
import { getDatabasePool, isDatabaseEnabled } from "./client";

export type BimModelStatus = "pending" | "processing" | "ready" | "failed" | "stale";
export type BimPropertyValueType = "text" | "number" | "boolean" | "date" | "json";
export type BimIndexJobStatus = "pending" | "processing" | "ready" | "failed" | "cancelled";

export type UpsertBimIndexJobInput = {
  projectCode: string;
  documentPath: string;
  sourceHash?: string;
  status: BimIndexJobStatus;
  errorMessage?: string;
  stats?: Record<string, unknown>;
};

type BimIndexJobRow = {
  id: string;
  project_code: string;
  document_path: string;
  source_hash: string | null;
  status: BimIndexJobStatus;
  started_at: Date | null;
  finished_at: Date | null;
  error_message: string | null;
  stats: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

function toIndexJob(row: BimIndexJobRow) {
  return {
    id: row.id,
    projectCode: row.project_code,
    documentPath: row.document_path,
    sourceHash: row.source_hash,
    status: row.status,
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    errorMessage: row.error_message,
    stats: asObject(row.stats),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export type UpsertBimModelInput = {
  projectCode: string;
  documentId?: string;
  documentPath: string;
  documentName: string;
  sourceVersion?: string;
  sourceHash?: string;
  modelKey: string;
  runtimeModelId?: string;
  status?: BimModelStatus;
  elementCount?: number;
  propertyCount?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
};

export type UpsertBimModelDerivativeInput = {
  bimModelId: string;
  derivativeType: string;
  storagePath: string;
  sourceHash?: string;
  fileSizeBytes?: number;
  status?: BimModelStatus;
  metadata?: Record<string, unknown>;
};
export type BimElementPropertyInput = {
  setName: string;
  name: string;
  value?: string | number | boolean | null | Record<string, unknown> | unknown[];
  valueType?: BimPropertyValueType;
  unit?: string;
};

export type BimElementInput = {
  localId: number;
  globalId?: string;
  ifcClass?: string;
  name?: string;
  typeName?: string;
  levelName?: string;
  spatialPath?: string[];
  elementIdentity?: string;
  hasGeometry?: boolean;
  metadata?: Record<string, unknown>;
  properties?: BimElementPropertyInput[];
};

export type BimPropertyIndex = {
  sets: string[];
  propertiesBySet: Record<string, string[]>;
  valuesBySetAndProperty: Record<string, Record<string, string[]>>;
  localIdsBySetPropertyValue: Record<string, Record<string, Record<string, Record<string, number[]>>>>;
  localIdsByModelKey: Record<string, number[]>;
  elementIdentityByKey: Record<string, string>;
  levelLocalIdsByModelKey: Record<string, Record<string, number[]>>;
};

export type BimPropertyCatalog = {
  sets: string[];
  propertiesBySet: Record<string, string[]>;
  valuesBySetAndProperty: Record<string, Record<string, Array<{ value: string; count: number }>>>;
  elementCount: number;
  propertyCount: number;
  valueCount: number;
};


export type BimPropertySummaryInput = {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  propertySetName: string;
  propertyName: string;
  className?: string;
  levelName?: string;
  text?: string;
  maxBuckets?: number;
  maxIdsPerBucket?: number;
};

export type BimPropertySummaryBucket = {
  value: string;
  count: number;
  localIdsByModelKey: Record<string, number[]>;
  truncated: boolean;
};

export type BimPropertySummaryResult = {
  projectCode: string;
  totalElements: number;
  missingValueCount: number;
  bucketCount: number;
  buckets: BimPropertySummaryBucket[];
};
export type BimPropertyRef = {
  setName: string;
  propertyName: string;
};

export type BimCost5DAggregationInput = {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  itemId: BimPropertyRef;
  itemName?: BimPropertyRef;
  itemUnit?: BimPropertyRef;
  quantity?: BimPropertyRef;
  limit?: number;
};
export type BimPropertyLocalIdsQueryInput = {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  property: BimPropertyRef;
  propertyValue?: string;
  maxIdsPerModel?: number;
};

export type BimCost5DAggregationRow = {
  itemId: string;
  itemName: string;
  itemUnit: string;
  quantity: number;
  elementCount: number;
  modelCount: number;
  modelKeys: string[];
};

export type BimCost5DAggregation = {
  projectCode: string;
  rows: BimCost5DAggregationRow[];
  totals: {
    quantity: number;
    elementCount: number;
    rowCount: number;
  };
};

export type BimCost5DMeteringColumnInput = {
  id: string;
  label?: string;
  ref: BimPropertyRef;
};

export type BimCost5DMeteringRowsInput = {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  columns: BimCost5DMeteringColumnInput[];
  search?: string;
  limit?: number;
  offset?: number;
};

export type BimCost5DMeteringRow = {
  key: string;
  modelId: string;
  modelKey: string;
  modelName: string;
  className: string;
  elementName: string;
  localId: number;
  values: string[];
};

export type BimCost5DMeteringRowsResult = {
  projectCode: string;
  total: number;
  limit: number;
  offset: number;
  rows: BimCost5DMeteringRow[];
};
type BimModelRow = {
  id: string;
  project_code: string;
  document_id: string | null;
  document_path: string;
  document_name: string;
  source_version: string | null;
  source_hash: string | null;
  model_key: string;
  runtime_model_id: string | null;
  status: BimModelStatus;
  element_count: number;
  property_count: number;
  indexed_at: Date | null;
  error_message: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export function ensureBimDatabaseEnabled() {
  if (!isDatabaseEnabled()) {
    const error = new Error("DATABASE_URL no esta configurado para el indice BIM");
    error.name = "DatabaseDisabledError";
    throw error;
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toModel(row: BimModelRow) {
  return {
    id: row.id,
    projectCode: row.project_code,
    documentId: row.document_id,
    documentPath: row.document_path,
    documentName: row.document_name,
    sourceVersion: row.source_version,
    sourceHash: row.source_hash,
    modelKey: row.model_key,
    runtimeModelId: row.runtime_model_id,
    status: row.status,
    elementCount: row.element_count,
    propertyCount: row.property_count,
    indexedAt: row.indexed_at?.toISOString() ?? null,
    errorMessage: row.error_message,
    metadata: asObject(row.metadata),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function inferValueType(value: BimElementPropertyInput["value"]): BimPropertyValueType {
  if (typeof value === "number" && Number.isFinite(value)) return "number";
  if (typeof value === "boolean") return "boolean";
  if (value && typeof value === "object") return "json";
  return "text";
}

function valueColumns(property: BimElementPropertyInput) {
  const valueType = property.valueType ?? inferValueType(property.value);
  const value = property.value;

  return {
    valueType,
    valueText:
      value === null || value === undefined || typeof value === "object"
        ? null
        : String(value),
    valueNumber:
      typeof value === "number" && Number.isFinite(value) ? value : null,
    valueBool: typeof value === "boolean" ? value : null,
    valueJson:
      value && typeof value === "object" ? JSON.stringify(value) : null
  };
}

async function upsertPropertySet(client: PoolClient, modelId: string, name: string) {
  const result = await client.query<{ id: string }>(
    `
      insert into cde_bim_property_sets (bim_model_id, name)
      values ($1, $2)
      on conflict (bim_model_id, name) do update set name = excluded.name
      returning id
    `,
    [modelId, name]
  );
  return result.rows[0].id;
}

async function upsertProperty(
  client: PoolClient,
  propertySetId: string,
  name: string,
  valueType: BimPropertyValueType
) {
  const result = await client.query<{ id: string }>(
    `
      insert into cde_bim_properties (property_set_id, name, value_type)
      values ($1, $2, $3)
      on conflict (property_set_id, name)
      do update set value_type = excluded.value_type
      returning id
    `,
    [propertySetId, name, valueType]
  );
  return result.rows[0].id;
}

export async function upsertBimModel(input: UpsertBimModelInput) {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<BimModelRow>(
    `
      insert into cde_bim_models (
        project_code,
        document_id,
        document_path,
        document_name,
        source_version,
        source_hash,
        model_key,
        runtime_model_id,
        status,
        element_count,
        property_count,
        indexed_at,
        error_message,
        metadata,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, case when $9 = 'ready' then now() else null end, $12, $13::jsonb, now())
      on conflict (project_code, document_path, coalesce(source_hash, ''))
      do update set
        document_id = excluded.document_id,
        document_name = excluded.document_name,
        source_version = excluded.source_version,
        model_key = excluded.model_key,
        runtime_model_id = excluded.runtime_model_id,
        status = excluded.status,
        element_count = excluded.element_count,
        property_count = excluded.property_count,
        indexed_at = case when excluded.status = 'ready' then now() else cde_bim_models.indexed_at end,
        error_message = excluded.error_message,
        metadata = excluded.metadata,
        updated_at = now()
      returning *
    `,
    [
      input.projectCode,
      normalizeText(input.documentId),
      input.documentPath,
      input.documentName,
      normalizeText(input.sourceVersion),
      normalizeText(input.sourceHash),
      input.modelKey,
      normalizeText(input.runtimeModelId),
      input.status ?? "pending",
      input.elementCount ?? 0,
      input.propertyCount ?? 0,
      normalizeText(input.errorMessage),
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return toModel(result.rows[0]);
}

export async function listBimModels(projectCode: string) {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<BimModelRow>(
    `
      select *
      from cde_bim_models
      where project_code = $1
      order by document_name asc, updated_at desc
    `,
    [projectCode]
  );
  return result.rows.map(toModel);
}

export async function upsertBimModelDerivative(input: UpsertBimModelDerivativeInput) {
  ensureBimDatabaseEnabled();

  const pool = getDatabasePool();
  const result = await pool.query(
    `
      insert into cde_bim_model_derivatives (
        bim_model_id,
        derivative_type,
        storage_path,
        source_hash,
        file_size_bytes,
        status,
        metadata
      )
      values ($1, $2, $3, $4, $5, $6, $7::jsonb)
      on conflict (bim_model_id, derivative_type, storage_path)
      do update set
        source_hash = excluded.source_hash,
        file_size_bytes = coalesce(excluded.file_size_bytes, cde_bim_model_derivatives.file_size_bytes),
        status = excluded.status,
        metadata = coalesce(cde_bim_model_derivatives.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now()
      returning id,
        bim_model_id as "bimModelId",
        derivative_type as "derivativeType",
        storage_path as "storagePath",
        source_hash as "sourceHash",
        file_size_bytes as "fileSizeBytes",
        status,
        metadata,
        created_at as "createdAt",
        updated_at as "updatedAt"
    `,
    [
      input.bimModelId,
      normalizeText(input.derivativeType) || "frag",
      normalizeText(input.storagePath),
      normalizeText(input.sourceHash),
      input.fileSizeBytes ?? null,
      input.status ?? "pending",
      JSON.stringify(input.metadata ?? {})
    ]
  );

  return result.rows[0];
}
export async function getBimModelByDocument(input: {
  projectCode: string;
  documentPath: string;
  sourceHash?: string;
}) {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<BimModelRow>(
    `
      select *
      from cde_bim_models
      where project_code = $1
        and document_path = $2
        and ($3::text is null or coalesce(source_hash, '') = $3)
      order by updated_at desc
      limit 1
    `,
    [input.projectCode, input.documentPath, normalizeText(input.sourceHash)]
  );
  return result.rows[0] ? toModel(result.rows[0]) : null;
}

export async function bulkUpsertBimElements(modelId: string, elements: BimElementInput[]) {
  ensureBimDatabaseEnabled();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    let propertyValueCount = 0;
    const propertySetIdByName = new Map<string, string>();
    const propertyIdBySetAndName = new Map<string, string>();

    async function getPropertySetId(setName: string) {
      const cached = propertySetIdByName.get(setName);
      if (cached) return cached;

      const id = await upsertPropertySet(client, modelId, setName);
      propertySetIdByName.set(setName, id);
      return id;
    }

    async function getPropertyId(
      propertySetId: string,
      propertyName: string,
      valueType: BimPropertyValueType
    ) {
      const cacheKey = `${propertySetId}:${propertyName}`;
      const cached = propertyIdBySetAndName.get(cacheKey);
      if (cached) return cached;

      const id = await upsertProperty(client, propertySetId, propertyName, valueType);
      propertyIdBySetAndName.set(cacheKey, id);
      return id;
    }

    for (const element of elements) {
      const elementResult = await client.query<{ id: string }>(
        `
          insert into cde_bim_elements (
            bim_model_id,
            local_id,
            global_id,
            ifc_class,
            name,
            type_name,
            level_name,
            spatial_path,
            element_identity,
            has_geometry,
            metadata,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11::jsonb, now())
          on conflict (bim_model_id, local_id)
          do update set
            global_id = excluded.global_id,
            ifc_class = excluded.ifc_class,
            name = excluded.name,
            type_name = excluded.type_name,
            level_name = excluded.level_name,
            spatial_path = excluded.spatial_path,
            element_identity = excluded.element_identity,
            has_geometry = excluded.has_geometry,
            metadata = excluded.metadata,
            updated_at = now()
          returning id
        `,
        [
          modelId,
          element.localId,
          normalizeText(element.globalId),
          normalizeText(element.ifcClass),
          normalizeText(element.name),
          normalizeText(element.typeName),
          normalizeText(element.levelName),
          element.spatialPath ?? [],
          normalizeText(element.elementIdentity),
          element.hasGeometry ?? true,
          JSON.stringify(element.metadata ?? {})
        ]
      );

      const elementId = elementResult.rows[0].id;
      await client.query("delete from cde_bim_property_values where bim_element_id = $1", [
        elementId
      ]);

      for (const property of element.properties ?? []) {
        const setName = normalizeText(property.setName);
        const propertyName = normalizeText(property.name);
        if (!setName || !propertyName) continue;

        const columns = valueColumns(property);
        const propertySetId = await getPropertySetId(setName);
        const propertyId = await getPropertyId(
          propertySetId,
          propertyName,
          columns.valueType
        );

        await client.query(
          `
            insert into cde_bim_property_values (
              bim_element_id,
              property_id,
              value_text,
              value_number,
              value_bool,
              value_json,
              unit
            )
            values ($1, $2, $3, $4, $5, $6::jsonb, $7)
          `,
          [
            elementId,
            propertyId,
            columns.valueText,
            columns.valueNumber,
            columns.valueBool,
            columns.valueJson,
            normalizeText(property.unit)
          ]
        );
        propertyValueCount += 1;
      }
    }

    await client.query(
      `
        update cde_bim_models
        set
          status = 'ready',
          element_count = (select count(*) from cde_bim_elements where bim_model_id = $1),
          property_count = (
            select count(*)
            from cde_bim_property_values pv
            join cde_bim_elements elements on elements.id = pv.bim_element_id
            where elements.bim_model_id = $1
          ),
          indexed_at = now(),
          error_message = null,
          updated_at = now()
        where id = $1
      `,
      [modelId]
    );

    await client.query("commit");
    return {
      modelId,
      elements: elements.length,
      propertyValues: propertyValueCount
    };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export async function upsertBimIndexJob(input: UpsertBimIndexJobInput) {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<BimIndexJobRow>(
    `
      insert into cde_bim_index_jobs (
        project_code,
        document_path,
        source_hash,
        status,
        started_at,
        finished_at,
        error_message,
        stats,
        updated_at
      )
      values (
        $1,
        $2,
        $3,
        $4,
        case when $4 = 'processing' then now() else null end,
        case when $4 in ('ready', 'failed', 'cancelled') then now() else null end,
        $5,
        $6::jsonb,
        now()
      )
      on conflict (project_code, document_path, coalesce(source_hash, ''))
      do update set
        status = excluded.status,
        started_at = case
          when excluded.status = 'processing' then coalesce(cde_bim_index_jobs.started_at, now())
          else cde_bim_index_jobs.started_at
        end,
        finished_at = case
          when excluded.status in ('ready', 'failed', 'cancelled') then now()
          else null
        end,
        error_message = excluded.error_message,
        stats = excluded.stats,
        updated_at = now()
      returning *
    `,
    [
      input.projectCode,
      input.documentPath,
      normalizeText(input.sourceHash),
      input.status,
      normalizeText(input.errorMessage),
      JSON.stringify(input.stats ?? {})
    ]
  );
  return toIndexJob(result.rows[0]);
}

export async function listBimIndexJobs(input: {
  projectCode: string;
  status?: BimIndexJobStatus;
  limit?: number;
}) {
  ensureBimDatabaseEnabled();
  const limit = Math.max(1, Math.min(input.limit ?? 50, 200));
  const result = await getDatabasePool().query<BimIndexJobRow>(
    `
      select *
      from cde_bim_index_jobs
      where project_code = $1
        and ($2::text is null or status = $2)
      order by updated_at desc
      limit $3
    `,
    [input.projectCode, input.status ?? null, limit]
  );
  return result.rows.map(toIndexJob);
}

export async function getBimIndexOverview(projectCode: string) {
  ensureBimDatabaseEnabled();
  const [models, jobs, snapshots] = await Promise.all([
    getDatabasePool().query<{
      total: string;
      ready: string;
      pending: string;
      processing: string;
      failed: string;
      stale: string;
      elements: string;
      properties: string;
      last_indexed_at: Date | null;
    }>(
      `
        select
          count(*)::text as total,
          count(*) filter (where status = 'ready')::text as ready,
          count(*) filter (where status = 'pending')::text as pending,
          count(*) filter (where status = 'processing')::text as processing,
          count(*) filter (where status = 'failed')::text as failed,
          count(*) filter (where status = 'stale')::text as stale,
          coalesce(sum(element_count), 0)::text as elements,
          coalesce(sum(property_count), 0)::text as properties,
          max(indexed_at) as last_indexed_at
        from cde_bim_models
        where project_code = $1
      `,
      [projectCode]
    ),
    getDatabasePool().query<{
      total: string;
      pending: string;
      processing: string;
      ready: string;
      failed: string;
      cancelled: string;
      last_updated_at: Date | null;
    }>(
      `
        select
          count(*)::text as total,
          count(*) filter (where status = 'pending')::text as pending,
          count(*) filter (where status = 'processing')::text as processing,
          count(*) filter (where status = 'ready')::text as ready,
          count(*) filter (where status = 'failed')::text as failed,
          count(*) filter (where status = 'cancelled')::text as cancelled,
          max(updated_at) as last_updated_at
        from cde_bim_index_jobs
        where project_code = $1
      `,
      [projectCode]
    ),
    getDatabasePool().query<{
      total: string;
      last_updated_at: Date | null;
    }>(
      `
        select count(*)::text as total, max(updated_at) as last_updated_at
        from cde_bim_property_index_snapshots
        where project_code = $1
      `,
      [projectCode]
    )
  ]);

  const modelRow = models.rows[0];
  const jobRow = jobs.rows[0];
  const snapshotRow = snapshots.rows[0];
  return {
    projectCode,
    models: {
      total: Number(modelRow.total),
      ready: Number(modelRow.ready),
      pending: Number(modelRow.pending),
      processing: Number(modelRow.processing),
      failed: Number(modelRow.failed),
      stale: Number(modelRow.stale),
      elements: Number(modelRow.elements),
      properties: Number(modelRow.properties),
      lastIndexedAt: modelRow.last_indexed_at?.toISOString() ?? null
    },
    jobs: {
      total: Number(jobRow.total),
      pending: Number(jobRow.pending),
      processing: Number(jobRow.processing),
      ready: Number(jobRow.ready),
      failed: Number(jobRow.failed),
      cancelled: Number(jobRow.cancelled),
      lastUpdatedAt: jobRow.last_updated_at?.toISOString() ?? null
    },
    snapshots: {
      total: Number(snapshotRow.total),
      lastUpdatedAt: snapshotRow.last_updated_at?.toISOString() ?? null
    }
  };
}
export async function getBimPropertyCatalog(input: {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  maxValuesPerProperty?: number;
}): Promise<BimPropertyCatalog> {
  ensureBimDatabaseEnabled();
  const maxValues = Math.max(10, Math.min(input.maxValuesPerProperty ?? 100, 500));
  const pool = getDatabasePool();
  const params = [
    input.projectCode,
    input.modelIds?.length ? input.modelIds : null,
    input.modelKeys?.length ? input.modelKeys : null,
    maxValues
  ];

  const [statsResult, valuesResult] = await Promise.all([
    pool.query<{ element_count: string; property_count: string; value_count: string }>(
      `
        select
          count(distinct elements.id)::text as element_count,
          count(distinct properties.id)::text as property_count,
          count(pv.id)::text as value_count
        from cde_bim_property_values pv
        join cde_bim_properties properties on properties.id = pv.property_id
        join cde_bim_property_sets sets on sets.id = properties.property_set_id
        join cde_bim_elements elements on elements.id = pv.bim_element_id
        join cde_bim_models models on models.id = elements.bim_model_id
        where models.project_code = $1
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ($3::text[] is null or models.model_key = any($3::text[]))
      `,
      params.slice(0, 3)
    ),
    pool.query<{ set_name: string; property_name: string; value_key: string | null; count: string }>(
      `
        with grouped as (
          select
            sets.name as set_name,
            properties.name as property_name,
            coalesce(
              pv.value_text,
              pv.value_number::text,
              pv.value_bool::text,
              pv.value_json::text
            ) as value_key,
            count(*)::bigint as value_count
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          join cde_bim_elements elements on elements.id = pv.bim_element_id
          join cde_bim_models models on models.id = elements.bim_model_id
          where models.project_code = $1
            and ($2::uuid[] is null or models.id = any($2::uuid[]))
            and ($3::text[] is null or models.model_key = any($3::text[]))
          group by sets.name, properties.name, value_key
        ), ranked as (
          select
            set_name,
            property_name,
            value_key,
            value_count,
            row_number() over (
              partition by set_name, property_name
              order by value_count desc, value_key asc nulls last
            ) as row_number
          from grouped
        )
        select
          set_name,
          property_name,
          value_key,
          value_count::text as count
        from ranked
        where row_number <= $4
        order by set_name asc, property_name asc, value_count desc, value_key asc nulls last
      `,
      params
    )
  ]);

  const propertiesBySet = new Map<string, Set<string>>();
  const valuesBySetAndProperty = new Map<string, Map<string, Array<{ value: string; count: number }>>>();

  for (const row of valuesResult.rows) {
    if (!propertiesBySet.has(row.set_name)) propertiesBySet.set(row.set_name, new Set());
    propertiesBySet.get(row.set_name)!.add(row.property_name);

    if (!valuesBySetAndProperty.has(row.set_name)) {
      valuesBySetAndProperty.set(row.set_name, new Map());
    }
    const propertyValues = valuesBySetAndProperty.get(row.set_name)!;
    const values = propertyValues.get(row.property_name) ?? [];
    values.push({ value: row.value_key ?? '', count: Number(row.count) });
    propertyValues.set(row.property_name, values);
  }

  const sortedSets = [...propertiesBySet.keys()].sort((a, b) => a.localeCompare(b));
  const sortedPropertiesBySet: Record<string, string[]> = {};
  const valuesObject: BimPropertyCatalog['valuesBySetAndProperty'] = {};

  for (const setName of sortedSets) {
    sortedPropertiesBySet[setName] = [...(propertiesBySet.get(setName) ?? new Set<string>())].sort((a, b) =>
      a.localeCompare(b)
    );
    valuesObject[setName] = {};
    const propertyValues = valuesBySetAndProperty.get(setName) ?? new Map();
    for (const propertyName of sortedPropertiesBySet[setName]) {
      valuesObject[setName][propertyName] = propertyValues.get(propertyName) ?? [];
    }
  }

  const stats = statsResult.rows[0];
  return {
    sets: sortedSets,
    propertiesBySet: sortedPropertiesBySet,
    valuesBySetAndProperty: valuesObject,
    elementCount: Number(stats?.element_count ?? 0),
    propertyCount: Number(stats?.property_count ?? 0),
    valueCount: Number(stats?.value_count ?? 0)
  };
}

function normalizePropertyRef(ref: BimPropertyRef | undefined): BimPropertyRef | null {
  const setName = normalizeText(ref?.setName);
  const propertyName = normalizeText(ref?.propertyName);
  return setName && propertyName ? { setName, propertyName } : null;
}

export async function getBimCost5DAggregation(
  input: BimCost5DAggregationInput
): Promise<BimCost5DAggregation> {
  ensureBimDatabaseEnabled();

  const itemId = normalizePropertyRef(input.itemId);
  if (!itemId) {
    throw new Error("itemId setName/propertyName son obligatorios");
  }

  const itemName = normalizePropertyRef(input.itemName);
  const itemUnit = normalizePropertyRef(input.itemUnit);
  const quantity = normalizePropertyRef(input.quantity);
  const limit = Math.max(1, Math.min(input.limit ?? 500, 5000));
  const params = [
    input.projectCode,
    input.modelIds?.length ? input.modelIds : null,
    input.modelKeys?.length ? input.modelKeys : null,
    itemId.setName,
    itemId.propertyName,
    itemName?.setName ?? null,
    itemName?.propertyName ?? null,
    itemUnit?.setName ?? null,
    itemUnit?.propertyName ?? null,
    quantity?.setName ?? null,
    quantity?.propertyName ?? null,
    limit
  ];

  const result = await getDatabasePool().query<{
    item_id: string | null;
    item_name: string | null;
    item_unit: string | null;
    quantity: string;
    element_count: string;
    model_count: string;
    model_keys: string[];
  }>(
    `
      with base as (
        select
          models.model_key,
          elements.id as element_id
        from cde_bim_elements elements
        join cde_bim_models models on models.id = elements.bim_model_id
        where models.project_code = $1
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ($3::text[] is null or models.model_key = any($3::text[]))
      ), enriched as (
        select
          base.model_key,
          base.element_id,
          item_id_value.value_key as item_id,
          item_name_value.value_key as item_name,
          item_unit_value.value_key as item_unit,
          case
            when quantity_value.value_number is not null then quantity_value.value_number::double precision
            when quantity_value.value_key ~ '^-?[0-9]+([\.,][0-9]+)?$' then replace(quantity_value.value_key, ',', '.')::double precision
            else null
          end as quantity_value
        from base
        join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and sets.name = $4
            and properties.name = $5
          limit 1
        ) item_id_value on true
        left join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and $6::text is not null
            and sets.name = $6
            and properties.name = $7
          limit 1
        ) item_name_value on true
        left join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and $8::text is not null
            and sets.name = $8
            and properties.name = $9
          limit 1
        ) item_unit_value on true
        left join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key,
            pv.value_number
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and $10::text is not null
            and sets.name = $10
            and properties.name = $11
          limit 1
        ) quantity_value on true
      )
      select
        coalesce(nullif(item_id, ''), 'Sin partida') as item_id,
        coalesce(nullif(item_name, ''), '-') as item_name,
        coalesce(nullif(item_unit, ''), '-') as item_unit,
        case
          when $10::text is null or $11::text is null then count(*)::double precision
          else coalesce(sum(quantity_value), 0)
        end::text as quantity,
        count(*)::text as element_count,
        count(distinct model_key)::text as model_count,
        array_agg(distinct model_key order by model_key) as model_keys
      from enriched
      group by
        coalesce(nullif(item_id, ''), 'Sin partida'),
        coalesce(nullif(item_name, ''), '-'),
        coalesce(nullif(item_unit, ''), '-')
      order by
        case
          when $10::text is null or $11::text is null then count(*)::double precision
          else coalesce(sum(quantity_value), 0)
        end desc,
        item_id asc
      limit $12
    `,
    params
  );

  const rows = result.rows.map((row) => ({
    itemId: row.item_id ?? "Sin partida",
    itemName: row.item_name ?? "-",
    itemUnit: row.item_unit ?? "-",
    quantity: Number(row.quantity),
    elementCount: Number(row.element_count),
    modelCount: Number(row.model_count),
    modelKeys: row.model_keys ?? []
  }));

  return {
    projectCode: input.projectCode,
    rows,
    totals: {
      quantity: rows.reduce((sum, row) => sum + row.quantity, 0),
      elementCount: rows.reduce((sum, row) => sum + row.elementCount, 0),
      rowCount: rows.length
    }
  };
}

export async function getBimCost5DMeteringRows(
  input: BimCost5DMeteringRowsInput
): Promise<BimCost5DMeteringRowsResult> {
  ensureBimDatabaseEnabled();

  const columns = input.columns
    .map((column, index) => {
      const ref = normalizePropertyRef(column.ref);
      if (!ref) return null;
      return {
        id: normalizeText(column.id) || `col-${index}`,
        label: normalizeText(column.label) || `${ref.setName}.${ref.propertyName}`,
        ref
      };
    })
    .filter((column): column is { id: string; label: string; ref: BimPropertyRef } =>
      Boolean(column)
    )
    .slice(0, 12);

  const limit = Math.max(1, Math.min(input.limit ?? 150, 500));
  const offset = Math.max(0, input.offset ?? 0);
  const search = normalizeText(input.search);
  const searchPattern = search ? `%${search}%` : null;
  const commonParams = [
    input.projectCode,
    input.modelIds?.length ? input.modelIds : null,
    input.modelKeys?.length ? input.modelKeys : null,
    searchPattern
  ];
  const whereSql = `
        models.project_code = $1
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ($3::text[] is null or models.model_key = any($3::text[]))
          and (
            $4::text is null
            or elements.element_name ilike $4
            or elements.element_type ilike $4
            or models.document_name ilike $4
            or exists (
              select 1
              from cde_bim_property_values pv_search
              where pv_search.bim_element_id = elements.id
                and coalesce(
                  pv_search.value_text,
                  pv_search.value_number::text,
                  pv_search.value_bool::text,
                  pv_search.value_json::text
                ) ilike $4
            )
          )
  `;

  const countResult = await getDatabasePool().query<{ total: string }>(
    `
      select count(*)::text as total
      from cde_bim_elements elements
      join cde_bim_models models on models.id = elements.bim_model_id
      where ${whereSql}
    `,
    commonParams
  );

  const total = Number(countResult.rows[0]?.total ?? 0);
  if (columns.length === 0) {
    return { projectCode: input.projectCode, total, limit, offset, rows: [] };
  }

  const columnPayload = columns.map((column) => ({
    id: column.id,
    setName: column.ref.setName,
    propertyName: column.ref.propertyName
  }));

  const result = await getDatabasePool().query<{
    model_id: string;
    model_key: string;
    document_name: string;
    local_id: number;
    class_name: string;
    element_name: string;
    values: string[] | string;
  }>(
    `
      with requested_columns as (
        select
          row_number() over () as ordinal,
          column_data->>'id' as column_id,
          column_data->>'setName' as set_name,
          column_data->>'propertyName' as property_name
        from jsonb_array_elements($7::jsonb) as columns(column_data)
      ), page as (
        select
          elements.id,
          elements.local_id,
          coalesce(elements.element_type, '-') as class_name,
          coalesce(elements.element_name, concat('Elemento ', elements.local_id::text)) as element_name,
          models.id as model_id,
          models.model_key,
          models.document_name
        from cde_bim_elements elements
        join cde_bim_models models on models.id = elements.bim_model_id
        where ${whereSql}
        order by
          models.document_name asc,
          elements.element_type asc nulls last,
          elements.element_name asc nulls last,
          elements.local_id asc
        limit $5 offset $6
      ), property_values as (
        select
          page.id as element_id,
          requested_columns.ordinal,
          coalesce(property_value.value_key, '-') as value_key
        from page
        cross join requested_columns
        left join lateral (
          select coalesce(
            values.value_text,
            values.value_number::text,
            values.value_bool::text,
            values.value_json::text
          ) as value_key
          from cde_bim_property_values values
          join cde_bim_properties properties on properties.id = values.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where values.bim_element_id = page.id
            and sets.name = requested_columns.set_name
            and properties.name = requested_columns.property_name
          limit 1
        ) property_value on true
      )
      select
        page.model_id::text as model_id,
        page.model_key,
        page.document_name,
        page.local_id,
        page.class_name,
        page.element_name,
        coalesce(jsonb_agg(property_values.value_key order by property_values.ordinal), '[]'::jsonb) as values
      from page
      left join property_values on property_values.element_id = page.id
      group by
        page.id,
        page.model_id,
        page.model_key,
        page.document_name,
        page.local_id,
        page.class_name,
        page.element_name
      order by
        page.document_name asc,
        page.class_name asc,
        page.element_name asc,
        page.local_id asc
    `,
    [...commonParams, limit, offset, JSON.stringify(columnPayload)]
  );

  return {
    projectCode: input.projectCode,
    total,
    limit,
    offset,
    rows: result.rows.map((row) => {
      const rawValues = Array.isArray(row.values) ? row.values : JSON.parse(row.values || "[]");
      return {
        key: `${row.model_key}:${row.local_id}`,
        modelId: row.model_id,
        modelKey: row.model_key,
        modelName: row.document_name,
        className: row.class_name,
        elementName: row.element_name,
        localId: Number(row.local_id),
        values: rawValues.map((value: unknown) => normalizeText(String(value ?? "")) || "-")
      };
    })
  };
}
export async function getBimPropertyIndex(input: {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  maxValuesPerProperty?: number;
}): Promise<BimPropertyIndex> {
  ensureBimDatabaseEnabled();
  const maxValues = Math.max(25, Math.min(input.maxValuesPerProperty ?? 450, 1000));
  const maxLocalIdsPerBucket = 12000;
  const maxLocalIdsPerModel = 100000;
  const result = await getDatabasePool().query<{
    model_key: string;
    local_id: number;
    element_identity: string | null;
    level_name: string | null;
    set_name: string;
    property_name: string;
    value_key: string | null;
  }>(
    `
      select
        models.model_key,
        elements.local_id,
        elements.element_identity,
        elements.level_name,
        sets.name as set_name,
        properties.name as property_name,
        coalesce(
          pv.value_text,
          pv.value_number::text,
          pv.value_bool::text,
          pv.value_json::text
        ) as value_key
      from cde_bim_property_values pv
      join cde_bim_properties properties on properties.id = pv.property_id
      join cde_bim_property_sets sets on sets.id = properties.property_set_id
      join cde_bim_elements elements on elements.id = pv.bim_element_id
      join cde_bim_models models on models.id = elements.bim_model_id
      where models.project_code = $1
        and ($2::uuid[] is null or models.id = any($2::uuid[]))
        and ($3::text[] is null or models.model_key = any($3::text[]))
    `,
    [
      input.projectCode,
      input.modelIds?.length ? input.modelIds : null,
      input.modelKeys?.length ? input.modelKeys : null
    ]
  );

  const propertiesBySet = new Map<string, Set<string>>();
  const valuesBySetAndProperty = new Map<string, Map<string, Set<string>>>();
  const localIdsBySetPropertyValue: BimPropertyIndex["localIdsBySetPropertyValue"] = {};
  const localIdsByModelKeySets = new Map<string, Set<number>>();
  const elementIdentityByKey: Record<string, string> = {};
  const levelLocalIdsByModelKeySets = new Map<string, Map<string, Set<number>>>();

  for (const row of result.rows) {
    if (!propertiesBySet.has(row.set_name)) propertiesBySet.set(row.set_name, new Set());
    propertiesBySet.get(row.set_name)!.add(row.property_name);

    const modelLocalIds = localIdsByModelKeySets.get(row.model_key) ?? new Set<number>();
    if (modelLocalIds.size < maxLocalIdsPerModel) {
      modelLocalIds.add(row.local_id);
    }
    localIdsByModelKeySets.set(row.model_key, modelLocalIds);

    if (row.element_identity) {
      elementIdentityByKey[`${row.model_key}:${row.local_id}`] = row.element_identity;
    }

    if (row.level_name) {
      const levels =
        levelLocalIdsByModelKeySets.get(row.model_key) ?? new Map<string, Set<number>>();
      const ids = levels.get(row.level_name) ?? new Set<number>();
      ids.add(row.local_id);
      levels.set(row.level_name, ids);
      levelLocalIdsByModelKeySets.set(row.model_key, levels);
    }

    if (!valuesBySetAndProperty.has(row.set_name)) {
      valuesBySetAndProperty.set(row.set_name, new Map());
    }
    const propertyValues = valuesBySetAndProperty.get(row.set_name)!;
    if (!propertyValues.has(row.property_name)) {
      propertyValues.set(row.property_name, new Set());
    }
    const valueSet = propertyValues.get(row.property_name)!;
    if (row.value_key !== null && valueSet.size < maxValues) {
      valueSet.add(row.value_key);
    }

    if (row.value_key !== null) {
      const setBuckets =
        localIdsBySetPropertyValue[row.set_name] ??
        (localIdsBySetPropertyValue[row.set_name] = {});
      const propertyBuckets =
        setBuckets[row.property_name] ?? (setBuckets[row.property_name] = {});
      const valueBuckets =
        propertyBuckets[row.value_key] ?? (propertyBuckets[row.value_key] = {});
      const ids = valueBuckets[row.model_key] ?? [];
      if (ids.length < maxLocalIdsPerBucket) {
        ids.push(row.local_id);
      }
      valueBuckets[row.model_key] = ids;
    }
  }

  const valuesObject: BimPropertyIndex["valuesBySetAndProperty"] = {};
  for (const [setName, propertyValues] of valuesBySetAndProperty) {
    valuesObject[setName] = {};
    for (const [propertyName, values] of propertyValues) {
      valuesObject[setName][propertyName] = [...values].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    }
  }

  const localIdsByModelKey: Record<string, number[]> = {};
  for (const [modelKey, ids] of localIdsByModelKeySets) {
    localIdsByModelKey[modelKey] = [...ids];
  }

  const levelLocalIdsByModelKey: Record<string, Record<string, number[]>> = {};
  for (const [modelKey, levels] of levelLocalIdsByModelKeySets) {
    levelLocalIdsByModelKey[modelKey] = {};
    for (const [levelName, ids] of levels) {
      levelLocalIdsByModelKey[modelKey][levelName] = [...ids];
    }
  }

  const sortedSets = [...propertiesBySet.keys()].sort((a, b) => a.localeCompare(b));
  const sortedPropertiesBySet = Object.fromEntries(
    sortedSets.map((name) => [
      name,
      [...(propertiesBySet.get(name) ?? new Set<string>())].sort((a, b) => a.localeCompare(b))
    ])
  );

  return {
    sets: sortedSets,
    propertiesBySet: sortedPropertiesBySet,
    valuesBySetAndProperty: valuesObject,
    localIdsBySetPropertyValue,
    localIdsByModelKey,
    elementIdentityByKey,
    levelLocalIdsByModelKey
  };
}

export async function getBimPropertySummary(
  input: BimPropertySummaryInput
): Promise<BimPropertySummaryResult> {
  ensureBimDatabaseEnabled();

  const projectCode = input.projectCode.trim().toUpperCase();
  const propertySetName = normalizeText(input.propertySetName);
  const propertyName = normalizeText(input.propertyName);
  if (!projectCode || !propertySetName || !propertyName) {
    throw new Error("projectCode, propertySetName y propertyName son obligatorios");
  }

  const modelIds = input.modelIds?.map((value) => value.trim()).filter(Boolean) ?? [];
  const modelKeys = input.modelKeys?.map((value) => value.trim()).filter(Boolean) ?? [];
  const className = normalizeText(input.className) ?? "";
  const classNameWithoutIfc = className.replace(/^ifc/i, "");
  const levelName = normalizeText(input.levelName) ?? "";
  const text = (normalizeText(input.text) ?? "").toLowerCase();
  const maxBuckets = Math.max(1, Math.min(input.maxBuckets ?? 120, 300));
  const maxIdsPerBucket = Math.max(1, Math.min(input.maxIdsPerBucket ?? 12000, 50000));

  const result = await getDatabasePool().query<{
    value_key: string;
    total_count: string;
    model_key: string | null;
    local_ids: number[] | null;
    model_truncated: boolean | null;
    total_elements: string;
    missing_value_count: string;
    bucket_count: string;
  }>(
    `
      with selected_models as (
        select id, model_key
        from cde_bim_models
        where project_code = $1
          and ($2::uuid[] is null or id = any($2::uuid[]))
          and ($3::text[] is null or model_key = any($3::text[]))
      ),
      candidate_elements as (
        select
          elements.id,
          elements.local_id,
          elements.ifc_class,
          elements.name,
          elements.type_name,
          elements.level_name,
          elements.element_identity,
          models.model_key
        from cde_bim_elements elements
        join selected_models models on models.id = elements.bim_model_id
        where (
            $6::text = ''
            or lower(elements.ifc_class) = lower($6)
            or lower(regexp_replace(elements.ifc_class, '^IFC', '', 'i')) = lower($7)
          )
          and ($8::text = '' or elements.level_name = $8)
          and (
            $9::text = ''
            or lower(coalesce(elements.name, '')) like '%' || $9 || '%'
            or lower(coalesce(elements.type_name, '')) like '%' || $9 || '%'
            or lower(coalesce(elements.element_identity, '')) like '%' || $9 || '%'
            or exists (
              select 1
              from cde_bim_property_values pvx
              where pvx.bim_element_id = elements.id
                and lower(coalesce(
                  pvx.value_text,
                  pvx.value_number::text,
                  pvx.value_bool::text,
                  pvx.value_json::text,
                  ''
                )) like '%' || $9 || '%'
            )
          )
      ),
      element_values as (
        select
          candidate_elements.model_key,
          candidate_elements.local_id,
          coalesce(nullif(trim(coalesce(
            matched_value.value_text,
            matched_value.value_number::text,
            matched_value.value_bool::text,
            matched_value.value_json::text,
            ''
          )), ''), '') as value_key
        from candidate_elements
        left join lateral (
          select pv.value_text, pv.value_number, pv.value_bool, pv.value_json
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = candidate_elements.id
            and properties.normalized_name = lower(regexp_replace(trim($5), '\\s+', ' ', 'g'))
            and sets.normalized_name = lower(regexp_replace(trim($4), '\\s+', ' ', 'g'))
          order by pv.id
          limit 1
        ) matched_value on true
      ),
      bucket_counts as (
        select value_key, count(*)::int as total_count
        from element_values
        group by value_key
      ),
      limited_values as (
        select value_key, total_count
        from bucket_counts
        order by total_count desc, value_key asc
        limit $10
      ),
      ranked_ids as (
        select
          element_values.value_key,
          element_values.model_key,
          element_values.local_id,
          row_number() over (
            partition by element_values.value_key, element_values.model_key
            order by element_values.local_id
          ) as rn
        from element_values
        join limited_values on limited_values.value_key = element_values.value_key
      ),
      ids_by_model as (
        select
          value_key,
          model_key,
          array_agg(local_id order by local_id) filter (where rn <= $11) as local_ids,
          count(*) > $11 as model_truncated
        from ranked_ids
        group by value_key, model_key
      )
      select
        limited_values.value_key,
        limited_values.total_count::text,
        ids_by_model.model_key,
        coalesce(ids_by_model.local_ids, '{}'::int[]) as local_ids,
        coalesce(ids_by_model.model_truncated, false) as model_truncated,
        (select count(*)::int from candidate_elements)::text as total_elements,
        coalesce((select total_count from bucket_counts where value_key = ''), 0)::text as missing_value_count,
        (select count(*)::int from bucket_counts)::text as bucket_count
      from limited_values
      left join ids_by_model on ids_by_model.value_key = limited_values.value_key
      order by limited_values.total_count desc, limited_values.value_key asc, ids_by_model.model_key asc
    `,
    [
      projectCode,
      modelIds.length ? modelIds : null,
      modelKeys.length ? modelKeys : null,
      propertySetName,
      propertyName,
      className,
      classNameWithoutIfc,
      levelName,
      text,
      maxBuckets,
      maxIdsPerBucket
    ]
  );

  const bucketMap = new Map<string, BimPropertySummaryBucket>();
  let totalElements = 0;
  let missingValueCount = 0;
  let bucketCount = 0;

  for (const row of result.rows) {
    totalElements = Number(row.total_elements) || totalElements;
    missingValueCount = Number(row.missing_value_count) || missingValueCount;
    bucketCount = Number(row.bucket_count) || bucketCount;

    const value = row.value_key || "";
    const bucket = bucketMap.get(value) ?? {
      value,
      count: Number(row.total_count) || 0,
      localIdsByModelKey: {},
      truncated: false
    };

    if (row.model_key) {
      bucket.localIdsByModelKey[row.model_key] = (row.local_ids ?? []).map(Number).filter(Number.isFinite);
    }
    bucket.truncated = bucket.truncated || Boolean(row.model_truncated);
    bucketMap.set(value, bucket);
  }

  return {
    projectCode,
    totalElements,
    missingValueCount,
    bucketCount,
    buckets: Array.from(bucketMap.values())
  };
}
export async function queryBimPropertyLocalIds(
  input: BimPropertyLocalIdsQueryInput
): Promise<Record<string, number[]>> {
  ensureBimDatabaseEnabled();

  const maxIdsPerModel = Math.max(1, Math.min(input.maxIdsPerModel ?? 100000, 250000));
  const propertyValue = normalizeText(input.propertyValue);

  const result = await getDatabasePool().query<{
    model_key: string;
    local_ids: number[];
  }>(
    `
      with matches as (
        select
          models.model_key,
          elements.local_id,
          row_number() over (
            partition by models.model_key
            order by elements.local_id
          ) as rn
        from cde_bim_property_values pv
        join cde_bim_properties properties on properties.id = pv.property_id
        join cde_bim_property_sets sets on sets.id = properties.property_set_id
        join cde_bim_elements elements on elements.id = pv.bim_element_id
        join cde_bim_models models on models.id = elements.bim_model_id
        where models.project_code = $1
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ($3::text[] is null or models.model_key = any($3::text[]))
          and lower(trim(sets.name)) = lower(trim($4))
          and lower(trim(properties.name)) = lower(trim($5))
          and (
            $6::text is null
            or lower(coalesce(
              pv.value_text,
              pv.value_number::text,
              pv.value_bool::text,
              pv.value_json::text,
              ''
            )) = lower($6)
          )
      )
      select
        model_key,
        array_agg(local_id order by local_id) as local_ids
      from matches
      where rn <= $7
      group by model_key
    `,
    [
      input.projectCode,
      input.modelIds?.length ? input.modelIds : null,
      input.modelKeys?.length ? input.modelKeys : null,
      input.property.setName,
      input.property.propertyName,
      propertyValue,
      maxIdsPerModel
    ]
  );

  return Object.fromEntries(
    result.rows.map((row) => [row.model_key, row.local_ids.map(Number)])
  );
}
export async function getBimPropertyIndexSnapshot(input: {
  projectCode: string;
  signature: string;
}): Promise<BimPropertyIndex | null> {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<{ index_payload: BimPropertyIndex }>(
    `
      select index_payload
      from cde_bim_property_index_snapshots
      where project_code = $1 and signature = $2
      limit 1
    `,
    [input.projectCode, input.signature]
  );

  return result.rows[0]?.index_payload ?? null;
}

export async function upsertBimPropertyIndexSnapshot(input: {
  projectCode: string;
  signature: string;
  modelKeys: string[];
  elementCount: number;
  index: BimPropertyIndex;
}) {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<{ id: string; updated_at: Date }>(
    `
      insert into cde_bim_property_index_snapshots (
        project_code,
        signature,
        model_keys,
        element_count,
        index_payload,
        updated_at
      )
      values ($1, $2, $3::text[], $4, $5::jsonb, now())
      on conflict (project_code, signature)
      do update set
        model_keys = excluded.model_keys,
        element_count = excluded.element_count,
        index_payload = excluded.index_payload,
        updated_at = now()
      returning id, updated_at
    `,
    [
      input.projectCode,
      input.signature,
      input.modelKeys,
      input.elementCount,
      JSON.stringify(input.index)
    ]
  );

  return {
    id: result.rows[0].id,
    updatedAt: result.rows[0].updated_at.toISOString()
  };
}
