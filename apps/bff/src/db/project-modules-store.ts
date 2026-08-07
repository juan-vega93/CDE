import { getDatabasePool } from "./client";
import { ensureBimDatabaseEnabled } from "./bim-index-store";

export type ProjectModuleRecord = {
  projectCode: string;
  moduleKey: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updatedAt: string;
};

export type PmaSourceRecord = {
  id: string;
  projectCode: string;
  name: string;
  sourceDocumentPath?: string;
  sourceHash?: string;
  status: string;
  importedBy?: string;
  importedAt?: string;
  config: Record<string, unknown>;
  updatedAt: string;
};

type ProjectModuleRow = {
  project_code: string;
  module_key: string;
  enabled: boolean;
  config: Record<string, unknown>;
  updated_at: Date;
};

type PmaSourceRow = {
  id: string;
  project_code: string;
  name: string;
  source_document_path: string | null;
  source_hash: string | null;
  status: string;
  imported_by: string | null;
  imported_at: Date | null;
  config: Record<string, unknown>;
  updated_at: Date;
};

function normalizeProjectCode(projectCode: string) {
  return projectCode.trim().toUpperCase();
}

function mapProjectModule(row: ProjectModuleRow): ProjectModuleRecord {
  return {
    projectCode: row.project_code,
    moduleKey: row.module_key,
    enabled: row.enabled,
    config: row.config ?? {},
    updatedAt: row.updated_at.toISOString()
  };
}

function mapPmaSource(row: PmaSourceRow): PmaSourceRecord {
  return {
    id: row.id,
    projectCode: row.project_code,
    name: row.name,
    sourceDocumentPath: row.source_document_path ?? undefined,
    sourceHash: row.source_hash ?? undefined,
    status: row.status,
    importedBy: row.imported_by ?? undefined,
    importedAt: row.imported_at?.toISOString(),
    config: row.config ?? {},
    updatedAt: row.updated_at.toISOString()
  };
}

export async function listProjectModules(projectCode: string): Promise<ProjectModuleRecord[]> {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<ProjectModuleRow>(
    `
      select project_code, module_key, enabled, config, updated_at
      from cde_project_modules
      where project_code = $1
      order by module_key asc
    `,
    [normalizeProjectCode(projectCode)]
  );

  return result.rows.map(mapProjectModule);
}

export async function upsertProjectModule(input: {
  projectCode: string;
  moduleKey: string;
  enabled: boolean;
  config?: Record<string, unknown>;
}): Promise<ProjectModuleRecord> {
  ensureBimDatabaseEnabled();
  const projectCode = normalizeProjectCode(input.projectCode);
  const moduleKey = input.moduleKey.trim().toLowerCase();

  const result = await getDatabasePool().query<ProjectModuleRow>(
    `
      insert into cde_project_modules (project_code, module_key, enabled, config, updated_at)
      values ($1, $2, $3, $4::jsonb, now())
      on conflict (project_code, module_key)
      do update set enabled = excluded.enabled, config = excluded.config, updated_at = now()
      returning project_code, module_key, enabled, config, updated_at
    `,
    [projectCode, moduleKey, input.enabled, JSON.stringify(input.config ?? {})]
  );

  return mapProjectModule(result.rows[0]);
}

export async function listPmaSources(projectCode: string): Promise<PmaSourceRecord[]> {
  ensureBimDatabaseEnabled();
  const result = await getDatabasePool().query<PmaSourceRow>(
    `
      select id, project_code, name, source_document_path, source_hash, status,
        imported_by, imported_at, config, updated_at
      from cde_pma_sources
      where project_code = $1
      order by updated_at desc
    `,
    [normalizeProjectCode(projectCode)]
  );

  return result.rows.map(mapPmaSource);
}

export async function upsertPmaSource(input: {
  id?: string;
  projectCode: string;
  name: string;
  sourceDocumentPath?: string;
  sourceHash?: string;
  status?: string;
  importedBy?: string;
  config?: Record<string, unknown>;
}): Promise<PmaSourceRecord> {
  ensureBimDatabaseEnabled();
  const projectCode = normalizeProjectCode(input.projectCode);
  const status = input.status?.trim() || "draft";

  const result = await getDatabasePool().query<PmaSourceRow>(
    `
      insert into cde_pma_sources (
        id, project_code, name, source_document_path, source_hash, status,
        imported_by, imported_at, config, updated_at
      ) values (
        coalesce($1::uuid, gen_random_uuid()), $2, $3, $4, $5, $6,
        $7, case when $6 = 'imported' then now() else null end, $8::jsonb, now()
      )
      on conflict (id)
      do update set
        name = excluded.name,
        source_document_path = excluded.source_document_path,
        source_hash = excluded.source_hash,
        status = excluded.status,
        imported_by = excluded.imported_by,
        imported_at = coalesce(excluded.imported_at, cde_pma_sources.imported_at),
        config = excluded.config,
        updated_at = now()
      returning id, project_code, name, source_document_path, source_hash, status,
        imported_by, imported_at, config, updated_at
    `,
    [
      input.id ?? null,
      projectCode,
      input.name.trim(),
      input.sourceDocumentPath?.trim() || null,
      input.sourceHash?.trim() || null,
      status,
      input.importedBy?.trim() || null,
      JSON.stringify(input.config ?? {})
    ]
  );

  return mapPmaSource(result.rows[0]);
}
