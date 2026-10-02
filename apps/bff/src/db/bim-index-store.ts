import { createStoredReplicaConsolidator, STORED_REPLICA_POLICY, type ReplicaSource, type CostObservation, type LogicalCostRow } from "./bim-cost-replicas";
import { createCostSelectionResolver } from "./bim-cost-selection";
import type { PoolClient } from "pg";
import { getDatabasePool, isDatabaseEnabled } from "./client";
import { getBimReadDatabase, lockBimIndexScope, withBimPublishedRead } from "./bim-index-generations";

export type BimModelStatus = "pending" | "processing" | "ready" | "failed" | "stale";
export type BimPropertyValueType = "text" | "number" | "boolean" | "date" | "json";
export type BimIndexJobStatus = "pending" | "processing" | "ready" | "failed" | "cancelled";

export const BIM_INDEX_INTERRUPTED_MESSAGE =
  "Indexación BIM interrumpida porque el proceso BFF anterior dejó de ejecutarse.";

/**
 * cde_bim_models deliberately has no `cancelled` state: a cancelled index is
 * not usable by DB-first consumers, so its model is represented as failed with
 * an explicit cancellation/interruption message rather than as `ready`.
 */
export function getBimModelTerminalStatus(jobStatus: BimIndexJobStatus): BimModelStatus | undefined {
  if (jobStatus === "ready") return "ready";
  if (jobStatus === "failed" || jobStatus === "cancelled") return "failed";
  return undefined;
}

export type UpsertBimIndexJobInput = {
  generationId?: string;
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
  preserveExisting?: boolean;
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

export type BimElementProperties = {
  model: ReturnType<typeof toModel>;
  localId: number;
  globalId: string | null;
  ifcClass: string | null;
  name: string | null;
  tag: string | null;
  propertySets: Array<{
    name: string;
    properties: Array<{
      name: string;
      value: string | number | boolean | Record<string, unknown> | unknown[] | null;
      valueType: BimPropertyValueType;
      unit: string | null;
    }>;
  }>;
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
  quantitySource?: "stored_parameter" | "ifc_quantity" | "viewer_geometry";
  quantityPolicy?: typeof STORED_REPLICA_POLICY;
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
  ifcClass?: string;
  levelName?: string;
  maxIdsPerModel?: number;
};

export type BimAuditOperator =
  | "exists"
  | "missing"
  | "equals"
  | "not_equals"
  | "contains"
  | "empty"
  | "not_empty";

export type BimPropertyAuditQueryInput = {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  property: BimPropertyRef;
  operator: BimAuditOperator;
  value?: string;
  ifcClass?: string;
  levelName?: string;
  maxResults?: number;
};

export type BimPropertyAuditQueryRecord = {
  modelKey: string;
  localId: number;
  globalId: string | null;
  ifcClass: string | null;
  name: string | null;
  levelName: string | null;
  values: string[];
  matches: boolean;
};

export type BimCost5DAggregationRow = {
  rawEntityCount?: number;
  rawQuantity?: number;
  logicalRows?: LogicalCostRow[];
  quantityPolicy?: typeof STORED_REPLICA_POLICY;
  quantityProvenance?: { source: "stored_parameter"; declaration: "mapping"; sourceProperty: BimPropertyRef; unitProperty: BimPropertyRef };
  consolidationError?: string;
  selection?: import("./bim-cost-selection").CostSelection;
  itemId: string;
  itemName: string;
  itemUnit: string;
  quantity: number | null;
  elementCount: number;
  modelCount: number;
  modelKeys: string[];
  localIdsByModelKey: Record<string, number[]>;
};

export type BimCost5DAggregation = {
  projectCode: string;
  rows: BimCost5DAggregationRow[];
  totals: {
    quantity: number | null;
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

function normalizeBimPropertyLabel(value: string): string {
  return value.trim().replace(/[\s]*\([0-9]+\)[\s]*$/, "");
}

function isRealBimPropertyValue(value: string | null | undefined): boolean {
  const trimmed = value?.trim();
  if (!trimmed) return false;
  return !["-", "sin valor", "null", "undefined"].includes(trimmed.toLowerCase());
}

const BIM_MODEL_KEY_FILTER_SQL = `(
  $3::text[] is null
  or models.model_key = any($3::text[])
  or exists (
    select 1
    from unnest($3::text[]) as requested_model_keys(model_key)
    where lower(requested_model_keys.model_key) = lower(models.model_key)
      or lower(requested_model_keys.model_key) = lower('frag:' || models.document_path)
      or lower(requested_model_keys.model_key) = lower('ifc:' || models.document_path)
      or lower(requested_model_keys.model_key) = lower(models.document_path)
  )
)`;

const BIM_MODEL_KEY_ALIAS_SQL = `coalesce((
  select requested_model_keys.model_key
  from unnest($3::text[]) as requested_model_keys(model_key)
  where lower(requested_model_keys.model_key) = lower(models.model_key)
    or lower(requested_model_keys.model_key) = lower('frag:' || models.document_path)
    or lower(requested_model_keys.model_key) = lower('ifc:' || models.document_path)
    or lower(requested_model_keys.model_key) = lower(models.document_path)
  limit 1
), models.model_key)`;

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

async function upsertPropertySet(client: PoolClient, modelId: string, name: string, generationId?: string) {
  const result = await client.query<{ id: string }>(
    `
      insert into cde_bim_property_sets (bim_model_id, name, generation_id)
      values ($1, $2, $3)
      on conflict ${generationId ? "(generation_id, name) where generation_id is not null" : "(bim_model_id, name) where generation_id is null"} do update set name = excluded.name
      returning id
    `,
    [modelId, name, generationId ?? null]
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
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const scopeId = await lockBimIndexScope(client, input.projectCode, input.documentPath);
    const canonical = await client.query("select id from cde_bim_index_generations where scope_id=$1 limit 1", [scopeId]);
    if (input.preserveExisting || canonical.rowCount) {
      const existing = await client.query<BimModelRow>(`select * from cde_bim_models where project_code=$1 and document_path=$2 and coalesce(source_hash,'')=coalesce($3,'')`, [input.projectCode, input.documentPath, normalizeText(input.sourceHash)]);
      if (existing.rows[0]) { await client.query("commit"); return toModel(existing.rows[0]); }
    }
    const result = await client.query<BimModelRow>(
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

    await client.query("commit");
    return toModel(result.rows[0]);
  } catch (error) { await client.query("rollback"); throw error; }
  finally { client.release(); }
}

async function read_listBimModels(projectCode: string) {
  ensureBimDatabaseEnabled();
  const result = await getBimReadDatabase().query<BimModelRow>(
    `
      select *
      from cde_bim_visible_models
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
      from cde_bim_visible_models
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

function getCompatibleBimModelKeys(value: string): string[] {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return [];

  const documentPath = normalized.replace(/^(?:ifc|frag):/, "");
  if (!documentPath.startsWith("/")) return [normalized];

  return Array.from(
    new Set([normalized, documentPath, `ifc:${documentPath}`, `frag:${documentPath}`])
  );
}

async function read_getBimElementProperties(input: {
  projectCode: string;
  modelKey: string;
  localId: number;
}): Promise<BimElementProperties | null> {
  ensureBimDatabaseEnabled();
  const modelKeys = getCompatibleBimModelKeys(input.modelKey);
  if (!input.projectCode.trim() || modelKeys.length === 0 || !Number.isInteger(input.localId)) {
    return null;
  }

  const modelResult = await getBimReadDatabase().query<BimModelRow>(
    `
      select models.*
      from cde_bim_visible_models models
      where models.project_code = $1
        and (
          lower(models.model_key) = any($2::text[])
          or lower(models.document_path) = any($2::text[])
          or lower('ifc:' || models.document_path) = any($2::text[])
          or lower('frag:' || models.document_path) = any($2::text[])
        )
      order by case when models.status = 'ready' then 0 else 1 end, models.updated_at desc
      limit 1
    `,
    [input.projectCode.trim(), modelKeys]
  );
  const model = modelResult.rows[0];
  if (!model) return null;

  const elementResult = await getBimReadDatabase().query<{
    id: string;
    local_id: number;
    global_id: string | null;
    ifc_class: string | null;
    name: string | null;
    metadata: Record<string, unknown>;
  }>(
    `
      select id, local_id, global_id, ifc_class, name, metadata
      from cde_bim_visible_elements
      where bim_model_id = $1 and local_id = $2
      limit 1
    `,
    [model.id, input.localId]
  );
  const element = elementResult.rows[0];
  if (!element) return null;

  const propertyResult = await getBimReadDatabase().query<{
    set_name: string;
    property_name: string;
    value_type: BimPropertyValueType;
    value_text: string | null;
    value_number: number | null;
    value_bool: boolean | null;
    value_json: Record<string, unknown> | unknown[] | null;
    unit: string | null;
  }>(
    `
      select
        sets.name as set_name,
        properties.name as property_name,
        properties.value_type,
        values.value_text,
        values.value_number,
        values.value_bool,
        values.value_json,
        values.unit
      from cde_bim_property_values values
      join cde_bim_properties properties on properties.id = values.property_id
      join cde_bim_property_sets sets on sets.id = properties.property_set_id
      where values.bim_element_id = $1
      order by sets.name asc, properties.name asc
    `,
    [element.id]
  );

  const propertySets = new Map<string, BimElementProperties["propertySets"][number]>();
  for (const property of propertyResult.rows) {
    const set = propertySets.get(property.set_name) ?? {
      name: property.set_name,
      properties: []
    };
    if (!propertySets.has(property.set_name)) propertySets.set(property.set_name, set);

    set.properties.push({
      name: property.property_name,
      value:
        property.value_json ??
        property.value_bool ??
        property.value_number ??
        property.value_text,
      valueType: property.value_type,
      unit: property.unit
    });
  }

  const metadata = asObject(element.metadata);
  const tag = metadata.tag ?? metadata.Tag;
  return {
    model: toModel(model),
    localId: element.local_id,
    globalId: element.global_id,
    ifcClass: element.ifc_class,
    name: element.name,
    tag: typeof tag === "string" ? tag : null,
    propertySets: [...propertySets.values()]
  };
}

export async function bulkUpsertBimElements(
  modelId: string,
  elements: BimElementInput[],
  options: { finalize?: boolean; generationId?: string } = {}
) {
  ensureBimDatabaseEnabled();
  const pool = getDatabasePool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    const model = (await client.query<{ project_code: string; document_path: string }>("select project_code,document_path from cde_bim_models where id=$1", [modelId])).rows[0];
    if (!model) throw new Error("BIM_MODEL_NOT_FOUND");
    if (options.generationId) {
      const generation = await client.query(`select id from cde_bim_index_generations where id=$1 and bim_model_id=$2 and status='building' for update`, [options.generationId, modelId]);
      if (!generation.rowCount) throw new Error("GENERATION_NOT_BUILDING");
      if (options.finalize) throw new Error("EXPLICIT_GENERATION_PUBLICATION_REQUIRED");
    } else {
      const scopeId = await lockBimIndexScope(client, model.project_code, model.document_path);
      const canonical = await client.query("select id from cde_bim_index_generations where scope_id=$1 limit 1", [scopeId]);
      if (canonical.rowCount) throw new Error("GENERATION_CONTEXT_REQUIRED");
    }
    let propertyValueCount = 0;
    const propertySetIdByName = new Map<string, string>();
    const propertyIdBySetAndName = new Map<string, string>();

    async function getPropertySetId(setName: string) {
      const cached = propertySetIdByName.get(setName);
      if (cached) return cached;

      const id = await upsertPropertySet(client, modelId, setName, options.generationId);
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
            generation_id,
            updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8::text[], $9, $10, $11::jsonb, $12, now())
          on conflict ${options.generationId ? "(generation_id, local_id) where generation_id is not null" : "(bim_model_id, local_id) where generation_id is null"}
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
          JSON.stringify(element.metadata ?? {}),
          options.generationId ?? null
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

    if (!options.generationId) await client.query(
      `
        update cde_bim_models
        set
          status = case when $2::boolean then 'ready' else 'processing' end,
          element_count = (select count(*) from cde_bim_elements where bim_model_id = $1),
          property_count = (
            select count(*)
            from cde_bim_property_values pv
            join cde_bim_elements elements on elements.id = pv.bim_element_id
            where elements.bim_model_id = $1
          ),
          indexed_at = case when $2::boolean then now() else indexed_at end,
          error_message = case when $2::boolean then null else error_message end,
          updated_at = now()
        where id = $1
      `,
      [modelId, options.finalize === true]
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
  const pool = await getDatabasePool().connect();
  try {
    await pool.query("begin");
    const scopeId = await lockBimIndexScope(pool, input.projectCode, input.documentPath);
    const result = await pool.query<BimIndexJobRow>(
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
        generation_id,
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
        $7,
        now()
      )
      on conflict (project_code, document_path, coalesce(source_hash, ''))
      do update set
        status = excluded.status, generation_id = coalesce(excluded.generation_id,cde_bim_index_jobs.generation_id),
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
      where (excluded.generation_id is null and cde_bim_index_jobs.generation_id is null)
        or (excluded.generation_id is not null and (cde_bim_index_jobs.generation_id is null or
          (select sequence from cde_bim_index_generations where id=excluded.generation_id) >=
          (select sequence from cde_bim_index_generations where id=cde_bim_index_jobs.generation_id)))
        or (excluded.generation_id is null and excluded.status='cancelled' and cde_bim_index_jobs.status='processing')
      returning *
    `,
      [
        input.projectCode,
        input.documentPath,
        normalizeText(input.sourceHash),
        input.status,
        normalizeText(input.errorMessage),
        JSON.stringify(input.stats ?? {}),
        input.generationId ?? null
      ]
    );
    if (!result.rows[0]) {
      const existing = await pool.query<BimIndexJobRow>("select * from cde_bim_index_jobs where project_code=$1 and document_path=$2 and coalesce(source_hash,'')=coalesce($3,'')", [input.projectCode, input.documentPath, normalizeText(input.sourceHash)]);
      await pool.query("commit");
      return toIndexJob(existing.rows[0]);
    }
    const job = toIndexJob(result.rows[0]);

    // A cancelled/failed job must never leave its matching model in the
    // ambiguous `processing` state. We intentionally do not infer `ready` from
    // a job alone: only the indexer can declare a fully persisted model ready.
    if (input.status === "failed" || input.status === "cancelled") {
      await pool.query(
        `
        update cde_bim_models
        set
          status = 'failed',
          error_message = coalesce($1, error_message, 'Indexación BIM no completada.'),
          updated_at = now()
        where project_code = $2
          and document_path = $3
          and coalesce(source_hash, '') = coalesce($4, '')
          and status in ('processing', 'ready')
          and not exists(select 1 from cde_bim_index_generations where scope_id=$5)
      `,
        [
          normalizeText(input.errorMessage) ??
          (input.status === "cancelled" ? "Indexación BIM cancelada." : "Indexación BIM fallida."),
          input.projectCode,
          input.documentPath,
          normalizeText(input.sourceHash),
          scopeId
        ]
      );
    }

    await pool.query("commit");
    return job;
  } catch (error) { await pool.query("rollback"); throw error; }
  finally { pool.release(); }
}

export async function getBimIndexJob(input: {
  projectCode: string;
  documentPath: string;
  sourceHash?: string;
}) {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<BimIndexJobRow>(
    `
      select *
      from cde_bim_index_jobs
      where project_code = $1
        and document_path = $2
        and coalesce(source_hash, '') = coalesce($3, '')
      limit 1
    `,
    [input.projectCode, input.documentPath, normalizeText(input.sourceHash)]
  );
  return result.rows[0] ? toIndexJob(result.rows[0]) : null;
}

/**
 * Resolves server-side jobs that cannot still be owned by this BFF process.
 * The heartbeat is `updated_at`, refreshed after each persisted batch. A
 * grace period prevents a concurrent, recently active BFF from being treated
 * as interrupted. Partial rows are intentionally retained for diagnostics.
 */
export async function recoverInterruptedBimIndexJobs(
  options: { staleAfterMs?: number; projectCode?: string } = {}
) {
  if (!isDatabaseEnabled()) return { interruptedJobs: 0, reconciledModels: 0 };

  const staleAfterMs = Math.max(60_000, Math.min(options.staleAfterMs ?? 5 * 60_000, 24 * 60 * 60_000));
  const client = await getDatabasePool().connect();
  try {
    await client.query("begin");
    const interrupted = await client.query<BimIndexJobRow>(
      `
        update cde_bim_index_jobs
        set
          status = 'failed',
          finished_at = now(),
          error_message = $1,
          updated_at = now()
        where status = 'processing'
          and updated_at < now() - ($2::bigint * interval '1 millisecond')
          and ($3::text is null or project_code = $3)
        returning *
      `,
      [BIM_INDEX_INTERRUPTED_MESSAGE, staleAfterMs, normalizeText(options.projectCode)]
    );

    const reconciled = await client.query<{ id: string }>(
      `
        update cde_bim_models as model
        set
          status = 'failed',
          error_message = coalesce(job.error_message, $1),
          updated_at = now()
        from cde_bim_index_jobs as job
        where model.project_code = job.project_code
          and model.document_path = job.document_path
          and coalesce(model.source_hash, '') = coalesce(job.source_hash, '')
          and model.status in ('processing', 'ready')
          and not exists(select 1 from cde_bim_index_generations g join cde_bim_index_scopes s on s.id=g.scope_id where s.project_code=model.project_code collate "C" and s.canonical_model_key=cde_bim_document_key(model.document_path) collate "C")
          and job.status in ('failed', 'cancelled')
          and ($2::text is null or job.project_code = $2)
        returning model.id
      `,
      [BIM_INDEX_INTERRUPTED_MESSAGE, normalizeText(options.projectCode)]
    );
    await client.query("commit");
    return { interruptedJobs: interrupted.rowCount ?? 0, reconciledModels: reconciled.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
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

async function read_getBimIndexOverview(projectCode: string) {
  ensureBimDatabaseEnabled();
  const [models, jobs, snapshots] = await Promise.all([
    getBimReadDatabase().query<{
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
        from cde_bim_visible_models
        where project_code = $1
      `,
      [projectCode]
    ),
    getBimReadDatabase().query<{
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
    getBimReadDatabase().query<{
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
async function read_getBimPropertyCatalog(input: {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  maxValuesPerProperty?: number;
}): Promise<BimPropertyCatalog> {
  ensureBimDatabaseEnabled();
  const maxValues = Math.max(10, Math.min(input.maxValuesPerProperty ?? 100, 500));
  const pool = getBimReadDatabase();
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
        join cde_bim_visible_elements elements on elements.id = pv.bim_element_id
        join cde_bim_visible_models models on models.id = elements.bim_model_id
        where models.project_code = $1
          and models.status = 'ready'
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ${BIM_MODEL_KEY_FILTER_SQL}
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
          join cde_bim_visible_elements elements on elements.id = pv.bim_element_id
          join cde_bim_visible_models models on models.id = elements.bim_model_id
          where models.project_code = $1
            and models.status = 'ready'
            and ($2::uuid[] is null or models.id = any($2::uuid[]))
            and ${BIM_MODEL_KEY_FILTER_SQL}
            and nullif(trim(coalesce(
              pv.value_text,
              pv.value_number::text,
              pv.value_bool::text,
              pv.value_json::text,
              ''
            )), '') is not null
            and lower(trim(coalesce(
              pv.value_text,
              pv.value_number::text,
              pv.value_bool::text,
              pv.value_json::text,
              ''
            ))) not in ('-', 'sin valor', 'null', 'undefined')
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
    const setName = normalizeBimPropertyLabel(row.set_name);
    const propertyName = normalizeBimPropertyLabel(row.property_name);
    if (!isRealBimPropertyValue(row.value_key)) continue;

    if (!propertiesBySet.has(setName)) propertiesBySet.set(setName, new Set());
    propertiesBySet.get(setName)!.add(propertyName);

    if (!valuesBySetAndProperty.has(setName)) {
      valuesBySetAndProperty.set(setName, new Map());
    }
    const propertyValues = valuesBySetAndProperty.get(setName)!;
    const values = propertyValues.get(propertyName) ?? [];
    const existing = values.find((item) => item.value === row.value_key);
    if (existing) {
      existing.count += Number(row.count);
    } else {
      values.push({ value: row.value_key as string, count: Number(row.count) });
    }
    propertyValues.set(propertyName, values);
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

async function read_getBimCost5DAggregation(
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

  const result = await getBimReadDatabase().query<{
    item_id: string | null;
    item_name: string | null;
    item_unit: string | null;
    observations: Record<string, CostObservation[]>;
    quantity: string;
    element_count: string;
    model_count: string;
    model_keys: string[];
    local_ids_by_model_key: Record<string, number[]> | null;
  }>(
    `
      with base as (
        select
          ${BIM_MODEL_KEY_ALIAS_SQL} as model_key,
          elements.id as element_id,
          elements.local_id
        from cde_bim_visible_elements elements
        join cde_bim_visible_models models on models.id = elements.bim_model_id
        where models.project_code = $1
          and models.status = 'ready'
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ${BIM_MODEL_KEY_FILTER_SQL}
      ), enriched as (
        select
          base.model_key,
          base.element_id,
          base.local_id,
          item_id_value.value_key as item_id,
          item_name_value.value_key as item_name,
          item_unit_value.value_key as item_unit,
          (coalesce(quantity_value.candidates,0) * coalesce(item_unit_value.candidates,0) * item_id_value.candidates * coalesce(item_name_value.candidates,1)) as candidates,
          case
            when quantity_value.value_number is not null then quantity_value.value_number::double precision
            when quantity_value.value_key ~ '^-?[0-9]+([\.,][0-9]+)?$' then replace(quantity_value.value_key, ',', '.')::double precision
            else null
          end as quantity_value
        from base
        join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key, count(*) over ()::int as candidates
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($4), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
            and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($5), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
                    order by
            case
              when nullif(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, '')), '') is not null
                and lower(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, ''))) not in ('-', 'sin valor', 'null', 'undefined')
              then 0
              else 1
            end,
            pv.id
          limit 1
        ) item_id_value on true
        left join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key, count(*) over ()::int as candidates
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and $6::text is not null
            and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($6), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
            and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($7), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
                    order by
            case
              when nullif(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, '')), '') is not null
                and lower(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, ''))) not in ('-', 'sin valor', 'null', 'undefined')
              then 0
              else 1
            end,
            pv.id
          limit 1
        ) item_name_value on true
        left join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key, count(*) over ()::int as candidates
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and $8::text is not null
            and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($8), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
            and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($9), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
                    order by
            case
              when nullif(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, '')), '') is not null
                and lower(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, ''))) not in ('-', 'sin valor', 'null', 'undefined')
              then 0
              else 1
            end,
            pv.id
          limit 1
        ) item_unit_value on true
        left join lateral (
          select
            coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text) as value_key,
            pv.value_number, count(*) over ()::int as candidates
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = base.element_id
            and $10::text is not null
            and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($10), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
            and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($11), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
                    order by
            case
              when nullif(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, '')), '') is not null
                and lower(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, ''))) not in ('-', 'sin valor', 'null', 'undefined')
              then 0
              else 1
            end,
            pv.id
          limit 1
        ) quantity_value on true
      )
      , grouped_models as (
        select
          coalesce(nullif(item_id, ''), 'Sin partida') as item_id,
          coalesce(nullif(item_name, ''), '-') as item_name,
          coalesce(nullif(item_unit, ''), '-') as item_unit,
          model_key,
          array_agg(local_id order by local_id) as local_ids,
          jsonb_agg(jsonb_build_object('localId',local_id,'value',quantity_value,'candidates',candidates)) as observations,
          count(*)::int as element_count,
          coalesce(sum(quantity_value), 0) as quantity
        from enriched
        group by
          coalesce(nullif(item_id, ''), 'Sin partida'),
          coalesce(nullif(item_name, ''), '-'),
          coalesce(nullif(item_unit, ''), '-'),
          model_key
      ), grouped_rows as (
        select
          item_id,
          item_name,
          item_unit,
          case
            when $10::text is null or $11::text is null
              then sum(element_count)::double precision
            else sum(quantity)
          end::text as quantity,
          sum(element_count)::text as element_count,
          count(*)::text as model_count,
          array_agg(model_key order by model_key) as model_keys,
          jsonb_object_agg(model_key, observations) as observations,
          jsonb_object_agg(model_key, to_jsonb(local_ids) order by model_key) as local_ids_by_model_key
        from grouped_models
        group by item_id, item_name, item_unit
      )
      select *
      from grouped_rows
      order by
        quantity::double precision desc,
        item_id asc
      limit $12
    `,
    params
  );

  const rows: BimCost5DAggregationRow[] = result.rows.map((row) => ({
    itemId: row.item_id ?? "Sin partida",
    itemName: row.item_name ?? "-",
    itemUnit: row.item_unit ?? "-",
    quantity: Number(row.quantity),
    elementCount: Number(row.element_count),
    modelCount: Number(row.model_count),
    modelKeys: row.model_keys ?? [],
    localIdsByModelKey: Object.fromEntries(
      Object.entries(row.local_ids_by_model_key ?? {}).map(([modelKey, localIds]) => [
        modelKey,
        Array.isArray(localIds) ? localIds.map(Number).filter(Number.isFinite) : []
      ])
    )
  }));

  // Same repeatable-read snapshot as the quantity query. No inferred revision for legacy rows.
  const sources = await getBimReadDatabase().query<ReplicaSource>(`
    select ${BIM_MODEL_KEY_ALIAS_SQL} as model_key, scope.project_code, scope.canonical_model_key,
      g.revision_id, a.element_key, a.resolution_method, a.root_local_id, array_agg(am.local_id order by am.local_id) as member_ids,
      coalesce(array_agg(am.local_id order by am.local_id) filter (where am.geometry_status='present'), '{}') as graphical_ids
    from cde_bim_visible_models models
    join cde_bim_index_generations g on g.id=cde_bim_published_generation(models.project_code,models.document_path)
    join cde_bim_index_scopes scope on scope.id=g.scope_id
    join cde_bim_authoring_contexts c on c.project_code=scope.project_code and c.model_key=scope.canonical_model_key and c.revision_id=g.revision_id
    join cde_bim_authoring_elements a on a.context_id=c.id
    join cde_bim_authoring_members am on am.authoring_element_id=a.id
    where models.project_code=$1 and ($2::uuid[] is null or models.id=any($2::uuid[])) and ${BIM_MODEL_KEY_FILTER_SQL}
    group by models.id, models.model_key, models.document_path, scope.project_code,scope.canonical_model_key,g.revision_id,a.id
    order by a.element_key`, params.slice(0,3));
  const resolveSelection = createCostSelectionResolver(sources.rows);
  const consolidate = createStoredReplicaConsolidator(sources.rows);
  for (const [index, row] of rows.entries()) {
    row.selection = resolveSelection(row.localIdsByModelKey);
    if (input.quantityPolicy === STORED_REPLICA_POLICY) {
      row.quantityPolicy = input.quantityPolicy;
      row.rawEntityCount = row.elementCount; row.rawQuantity = row.quantity ?? 0;
      row.elementCount = row.selection.groups.reduce((sum, group) => sum + group.authoringElements.length, 0);
      try {
        if (!quantity || !itemUnit || input.quantitySource !== "stored_parameter") throw new Error("Stored source declaration, quantity and unit mapping are required");
        row.quantityProvenance = { source: "stored_parameter", declaration: "mapping", sourceProperty: quantity, unitProperty: itemUnit };
        row.logicalRows = consolidate(result.rows[index].observations, row.itemUnit, input.quantitySource);
        row.quantity = row.logicalRows.some(r => r.quantity === null) ? null : row.logicalRows.reduce((sum, r) => sum + r.quantity!, 0);
      } catch (error) {
        row.quantity = null; row.consolidationError = error instanceof Error ? error.message : "Unresolved quantity";
      }
    }
  }
  return {
    projectCode: input.projectCode,
    rows,
    totals: {
      quantity: rows.some(row => row.quantity === null) || (input.quantityPolicy === STORED_REPLICA_POLICY && new Set(rows.map(row => row.itemUnit)).size > 1) ? null : rows.reduce((sum, row) => sum + row.quantity!, 0),
      elementCount: rows.reduce((sum, row) => sum + row.elementCount, 0),
      rowCount: rows.length
    }
  };
}

async function read_getBimCost5DMeteringRows(
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
          and ${BIM_MODEL_KEY_FILTER_SQL}
          and (
            $4::text is null
            or elements.name ilike $4
            or elements.type_name ilike $4
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

  const countResult = await getBimReadDatabase().query<{ total: string }>(
    `
      select count(*)::text as total
      from cde_bim_visible_elements elements
      join cde_bim_visible_models models on models.id = elements.bim_model_id
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

  const result = await getBimReadDatabase().query<{
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
          coalesce(elements.type_name, elements.ifc_class, '-') as class_name,
          coalesce(elements.name, concat('Elemento ', elements.local_id::text)) as element_name,
          models.id as model_id,
          ${BIM_MODEL_KEY_ALIAS_SQL} as model_key,
          models.document_name
        from cde_bim_visible_elements elements
        join cde_bim_visible_models models on models.id = elements.bim_model_id
        where ${whereSql}
        order by
          models.document_name asc,
          elements.type_name asc nulls last,
          elements.name asc nulls last,
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
            and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim(requested_columns.set_name), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
            and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim(requested_columns.property_name), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
                    order by
            case
              when nullif(trim(coalesce(values.value_text, values.value_number::text, values.value_bool::text, values.value_json::text, '')), '') is not null
                and lower(trim(coalesce(values.value_text, values.value_number::text, values.value_bool::text, values.value_json::text, ''))) not in ('-', 'sin valor', 'null', 'undefined')
              then 0
              else 1
            end,
            values.id
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
async function read_getBimPropertyIndex(input: {
  projectCode: string;
  modelIds?: string[];
  modelKeys?: string[];
  maxValuesPerProperty?: number;
}): Promise<BimPropertyIndex> {
  ensureBimDatabaseEnabled();
  const maxValues = Math.max(25, Math.min(input.maxValuesPerProperty ?? 450, 1000));
  const maxLocalIdsPerBucket = 12000;
  const maxLocalIdsPerModel = 100000;
  const result = await getBimReadDatabase().query<{
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
        ${BIM_MODEL_KEY_ALIAS_SQL} as model_key,
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
      join cde_bim_visible_elements elements on elements.id = pv.bim_element_id
      join cde_bim_visible_models models on models.id = elements.bim_model_id
      where models.project_code = $1
        and ($2::uuid[] is null or models.id = any($2::uuid[]))
        and ${BIM_MODEL_KEY_FILTER_SQL}
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
    const setName = normalizeBimPropertyLabel(row.set_name);
    const propertyName = normalizeBimPropertyLabel(row.property_name);
    const hasRealValue = isRealBimPropertyValue(row.value_key);

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

    if (!hasRealValue) continue;

    if (!propertiesBySet.has(setName)) propertiesBySet.set(setName, new Set());
    propertiesBySet.get(setName)!.add(propertyName);

    if (!valuesBySetAndProperty.has(setName)) {
      valuesBySetAndProperty.set(setName, new Map());
    }
    const propertyValues = valuesBySetAndProperty.get(setName)!;
    if (!propertyValues.has(propertyName)) {
      propertyValues.set(propertyName, new Set());
    }
    const valueSet = propertyValues.get(propertyName)!;
    if (valueSet.size < maxValues) {
      valueSet.add(row.value_key as string);
    }

    const valueKey = row.value_key as string;
    const setBuckets =
      localIdsBySetPropertyValue[setName] ??
      (localIdsBySetPropertyValue[setName] = {});
    const propertyBuckets =
      setBuckets[propertyName] ?? (setBuckets[propertyName] = {});
    const valueBuckets =
      propertyBuckets[valueKey] ?? (propertyBuckets[valueKey] = {});
    const ids = valueBuckets[row.model_key] ?? [];
    if (ids.length < maxLocalIdsPerBucket) {
      ids.push(row.local_id);
    }
    valueBuckets[row.model_key] = ids;
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

async function read_getBimPropertySummary(
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

  const result = await getBimReadDatabase().query<{
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
        select id, ${BIM_MODEL_KEY_ALIAS_SQL} as model_key
        from cde_bim_visible_models models
        where project_code = $1
          and models.status = 'ready'
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ${BIM_MODEL_KEY_FILTER_SQL}
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
        from cde_bim_visible_elements elements
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
            and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($5), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
            and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($4), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
          order by
            case
              when nullif(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, '')), '') is not null
                and lower(trim(coalesce(pv.value_text, pv.value_number::text, pv.value_bool::text, pv.value_json::text, ''))) not in ('-', 'sin valor', 'null', 'undefined')
              then 0
              else 1
            end,
            pv.id
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
async function read_queryBimPropertyLocalIds(
  input: BimPropertyLocalIdsQueryInput
): Promise<Record<string, number[]>> {
  ensureBimDatabaseEnabled();

  const maxIdsPerModel = Math.max(1, Math.min(input.maxIdsPerModel ?? 100000, 250000));
  const propertyValue = normalizeText(input.propertyValue);
  const ifcClass = normalizeText(input.ifcClass);
  const levelName = normalizeText(input.levelName);

  const result = await getBimReadDatabase().query<{
    model_key: string;
    local_ids: number[];
  }>(
    `
      with matches as (
        select
          ${BIM_MODEL_KEY_ALIAS_SQL} as model_key,
          elements.local_id,
          row_number() over (
            partition by models.model_key
            order by elements.local_id
          ) as rn
        from cde_bim_property_values pv
        join cde_bim_properties properties on properties.id = pv.property_id
        join cde_bim_property_sets sets on sets.id = properties.property_set_id
        join cde_bim_visible_elements elements on elements.id = pv.bim_element_id
        join cde_bim_visible_models models on models.id = elements.bim_model_id
        where models.project_code = $1
          and models.status = 'ready'
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ${BIM_MODEL_KEY_FILTER_SQL}
          and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($4), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
          and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($5), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
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
          and (
            $7::text is null
            or upper(elements.ifc_class) = upper($7)
            or (upper($7) not like 'IFC%' and upper(elements.ifc_class) = upper('IFC' || $7))
          )
          and ($8::text is null or lower(coalesce(elements.level_name, '')) = lower($8))
      )
      select
        model_key,
        array_agg(local_id order by local_id) as local_ids
      from matches
      where rn <= $9
      group by model_key
    `,
    [
      input.projectCode,
      input.modelIds?.length ? input.modelIds : null,
      input.modelKeys?.length ? input.modelKeys : null,
      input.property.setName,
      input.property.propertyName,
      propertyValue,
      ifcClass,
      levelName,
      maxIdsPerModel
    ]
  );

  return Object.fromEntries(
    result.rows.map((row) => [row.model_key, row.local_ids.map(Number)])
  );
}

/**
 * Evaluates the property operators used by the BIM audit against the canonical
 * PostgreSQL index. A row is returned for every element matching the model,
 * class and level filters; `matches` is the audit outcome for that element.
 */
async function read_queryBimPropertyAuditRecords(
  input: BimPropertyAuditQueryInput
): Promise<BimPropertyAuditQueryRecord[]> {
  ensureBimDatabaseEnabled();

  const maxResults = Math.max(1, Math.min(input.maxResults ?? 250000, 250000));
  const ifcClass = normalizeText(input.ifcClass);
  const ifcClassWithoutIfc = ifcClass?.replace(/^ifc/i, "") ?? null;
  const levelName = normalizeText(input.levelName);
  const expectedValue = input.value?.trim() ?? "";

  const result = await getBimReadDatabase().query<{
    model_key: string;
    local_id: number;
    global_id: string | null;
    ifc_class: string | null;
    name: string | null;
    level_name: string | null;
    property_values: string[] | null;
    matches: boolean;
  }>(
    `
      with selected_models as (
        select id, ${BIM_MODEL_KEY_ALIAS_SQL} as model_key
        from cde_bim_visible_models models
        where models.project_code = $1
          and models.status = 'ready'
          and ($2::uuid[] is null or models.id = any($2::uuid[]))
          and ${BIM_MODEL_KEY_FILTER_SQL}
      ), candidate_elements as (
        select
          selected_models.model_key,
          elements.id,
          elements.local_id,
          elements.global_id,
          elements.ifc_class,
          elements.name,
          elements.level_name
        from cde_bim_visible_elements elements
        join selected_models on selected_models.id = elements.bim_model_id
        where (
            $6::text is null
            or upper(elements.ifc_class) = upper($6)
            or upper(elements.ifc_class) = upper('IFC' || $7)
          )
          and ($8::text is null or coalesce(elements.level_name, '') = $8)
      ), element_values as (
        select
          candidate_elements.*,
          coalesce(property_matches.values, '{}'::text[]) as property_values
        from candidate_elements
        left join lateral (
          select array_agg(
            coalesce(
              pv.value_text,
              pv.value_number::text,
              pv.value_bool::text,
              pv.value_json::text,
              '-'
            )
            order by pv.id
          ) as values
          from cde_bim_property_values pv
          join cde_bim_properties properties on properties.id = pv.property_id
          join cde_bim_property_sets sets on sets.id = properties.property_set_id
          where pv.bim_element_id = candidate_elements.id
            and lower(regexp_replace(regexp_replace(sets.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($4), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
            and lower(regexp_replace(regexp_replace(properties.name, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g')) = lower(regexp_replace(regexp_replace(trim($5), '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))
        ) property_matches on true
      )
      select
        model_key,
        local_id,
        global_id,
        ifc_class,
        name,
        level_name,
        property_values,
        case $9::text
          when 'exists' then cardinality(property_values) > 0
          when 'missing' then cardinality(property_values) = 0
          when 'equals' then exists (
            select 1
            from unnest(property_values) as property_value(value)
            where lower(trim(property_value.value)) = lower(trim($10))
          )
          when 'not_equals' then cardinality(property_values) > 0 and not exists (
            select 1
            from unnest(property_values) as property_value(value)
            where lower(trim(property_value.value)) = lower(trim($10))
          )
          when 'contains' then exists (
            select 1
            from unnest(property_values) as property_value(value)
            where position(lower(trim($10)) in lower(trim(property_value.value))) > 0
          )
          when 'empty' then not exists (
            select 1
            from unnest(property_values) as property_value(value)
            where lower(trim(property_value.value)) not in ('', '-', '--', 'n/a')
          )
          when 'not_empty' then exists (
            select 1
            from unnest(property_values) as property_value(value)
            where lower(trim(property_value.value)) not in ('', '-', '--', 'n/a')
          )
          else false
        end as matches
      from element_values
      order by model_key, local_id
      limit $11
    `,
    [
      input.projectCode,
      input.modelIds?.length ? input.modelIds : null,
      input.modelKeys?.length ? input.modelKeys : null,
      input.property.setName,
      input.property.propertyName,
      ifcClass,
      ifcClassWithoutIfc,
      levelName,
      input.operator,
      expectedValue,
      maxResults
    ]
  );

  return result.rows.map((row) => ({
    modelKey: row.model_key,
    localId: Number(row.local_id),
    globalId: row.global_id,
    ifcClass: row.ifc_class,
    name: row.name,
    levelName: row.level_name,
    values: (row.property_values ?? []).map(String),
    matches: Boolean(row.matches)
  }));
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
        and not exists (
          select 1 from cde_bim_index_generations g join cde_bim_index_scopes s on s.id=g.scope_id
          where s.project_code=$1 collate "C" and g.status='published'
        )
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

export async function listBimModels(...args: Parameters<typeof read_listBimModels>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_listBimModels(...args));
}

export async function getBimElementProperties(...args: Parameters<typeof read_getBimElementProperties>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_getBimElementProperties(...args));
}

export async function getBimIndexOverview(...args: Parameters<typeof read_getBimIndexOverview>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_getBimIndexOverview(...args));
}

export async function getBimPropertyCatalog(...args: Parameters<typeof read_getBimPropertyCatalog>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_getBimPropertyCatalog(...args));
}

export async function getBimCost5DAggregation(...args: Parameters<typeof read_getBimCost5DAggregation>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_getBimCost5DAggregation(...args));
}

export async function getBimCost5DMeteringRows(...args: Parameters<typeof read_getBimCost5DMeteringRows>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_getBimCost5DMeteringRows(...args));
}

export async function getBimPropertyIndex(...args: Parameters<typeof read_getBimPropertyIndex>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_getBimPropertyIndex(...args));
}

export async function getBimPropertySummary(...args: Parameters<typeof read_getBimPropertySummary>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_getBimPropertySummary(...args));
}

export async function queryBimPropertyLocalIds(...args: Parameters<typeof read_queryBimPropertyLocalIds>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_queryBimPropertyLocalIds(...args));
}

export async function queryBimPropertyAuditRecords(...args: Parameters<typeof read_queryBimPropertyAuditRecords>) {
  ensureBimDatabaseEnabled();
  return withBimPublishedRead(() => read_queryBimPropertyAuditRecords(...args));
}
