create extension if not exists pgcrypto;

create table if not exists cde_bim_models (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  document_id text,
  document_path text not null,
  document_name text not null,
  source_version text,
  source_hash text,
  model_key text not null,
  runtime_model_id text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed', 'stale')),
  element_count integer not null default 0,
  property_count integer not null default 0,
  indexed_at timestamptz,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists cde_bim_models_project_path_hash_uidx
  on cde_bim_models (project_code, document_path, coalesce(source_hash, ''));

create index if not exists cde_bim_models_project_idx
  on cde_bim_models (project_code);

create index if not exists cde_bim_models_status_idx
  on cde_bim_models (status);

create table if not exists cde_bim_model_derivatives (
  id uuid primary key default gen_random_uuid(),
  bim_model_id uuid not null references cde_bim_models(id) on delete cascade,
  derivative_type text not null default 'frag'
    check (derivative_type in ('frag', 'tiles', 'gltf', 'thumbnail', 'index')),
  storage_provider text not null default 'nextcloud',
  storage_path text not null,
  source_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed', 'stale')),
  file_size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bim_model_id, derivative_type, storage_path)
);

create index if not exists cde_bim_model_derivatives_model_idx
  on cde_bim_model_derivatives (bim_model_id);

create index if not exists cde_bim_model_derivatives_status_idx
  on cde_bim_model_derivatives (status);

create table if not exists cde_bim_elements (
  id uuid primary key default gen_random_uuid(),
  bim_model_id uuid not null references cde_bim_models(id) on delete cascade,
  local_id integer not null,
  global_id text,
  ifc_class text,
  name text,
  type_name text,
  level_name text,
  spatial_path text[] not null default '{}'::text[],
  element_identity text,
  has_geometry boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bim_model_id, local_id)
);

create index if not exists cde_bim_elements_model_class_idx
  on cde_bim_elements (bim_model_id, ifc_class);

create index if not exists cde_bim_elements_model_level_idx
  on cde_bim_elements (bim_model_id, level_name);

create index if not exists cde_bim_elements_global_id_idx
  on cde_bim_elements (global_id);

create index if not exists cde_bim_elements_identity_idx
  on cde_bim_elements (element_identity);

create table if not exists cde_bim_property_sets (
  id uuid primary key default gen_random_uuid(),
  bim_model_id uuid not null references cde_bim_models(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(name, '[[:space:]]+', '', 'g'))) stored,
  created_at timestamptz not null default now(),
  unique (bim_model_id, name)
);

create index if not exists cde_bim_property_sets_model_idx
  on cde_bim_property_sets (bim_model_id);

create table if not exists cde_bim_properties (
  id uuid primary key default gen_random_uuid(),
  property_set_id uuid not null references cde_bim_property_sets(id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(regexp_replace(name, '[[:space:]]+', '', 'g'))) stored,
  value_type text not null default 'text'
    check (value_type in ('text', 'number', 'boolean', 'date', 'json')),
  created_at timestamptz not null default now(),
  unique (property_set_id, name)
);

create index if not exists cde_bim_properties_set_idx
  on cde_bim_properties (property_set_id);

create index if not exists cde_bim_properties_name_idx
  on cde_bim_properties (normalized_name);

create table if not exists cde_bim_property_values (
  id bigserial primary key,
  bim_element_id uuid not null references cde_bim_elements(id) on delete cascade,
  property_id uuid not null references cde_bim_properties(id) on delete cascade,
  value_text text,
  value_number double precision,
  value_bool boolean,
  value_json jsonb,
  unit text,
  created_at timestamptz not null default now()
);

create index if not exists cde_bim_property_values_element_idx
  on cde_bim_property_values (bim_element_id);

create index if not exists cde_bim_property_values_property_text_idx
  on cde_bim_property_values (property_id, value_text);

create index if not exists cde_bim_property_values_property_number_idx
  on cde_bim_property_values (property_id, value_number);

create table if not exists cde_bim_index_jobs (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  document_path text not null,
  source_hash text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'failed', 'cancelled')),
  started_at timestamptz,
  finished_at timestamptz,
  error_message text,
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cde_bim_index_jobs_project_status_idx
  on cde_bim_index_jobs (project_code, status);

create table if not exists cde_project_modules (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  module_key text not null,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_code, module_key)
);

create index if not exists cde_project_modules_project_idx
  on cde_project_modules (project_code);


create table if not exists cde_bim_property_index_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  signature text not null,
  model_keys text[] not null default '{}'::text[],
  element_count integer not null default 0,
  index_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_code, signature)
);

create index if not exists cde_bim_property_index_snapshots_project_idx
  on cde_bim_property_index_snapshots (project_code, updated_at desc);
create index if not exists cde_bim_models_project_model_key_idx
  on cde_bim_models (project_code, model_key);

create index if not exists cde_bim_models_project_document_idx
  on cde_bim_models (project_code, document_path);

create index if not exists cde_bim_elements_model_local_idx
  on cde_bim_elements (bim_model_id, local_id);

create index if not exists cde_bim_property_sets_model_name_idx
  on cde_bim_property_sets (bim_model_id, name);

create index if not exists cde_bim_properties_set_name_idx
  on cde_bim_properties (property_set_id, name);

create index if not exists cde_bim_property_values_property_bool_idx
  on cde_bim_property_values (property_id, value_bool)
  where value_bool is not null;
create index if not exists cde_bim_property_index_snapshots_signature_idx
  on cde_bim_property_index_snapshots (signature, updated_at desc);

create index if not exists cde_bim_models_project_status_updated_idx
  on cde_bim_models (project_code, status, updated_at desc);

create index if not exists cde_bim_models_project_runtime_idx
  on cde_bim_models (project_code, runtime_model_id);

create index if not exists cde_bim_elements_model_class_level_idx
  on cde_bim_elements (bim_model_id, ifc_class, level_name);

create index if not exists cde_bim_elements_model_level_class_idx
  on cde_bim_elements (bim_model_id, level_name, ifc_class);

create index if not exists cde_bim_elements_model_type_idx
  on cde_bim_elements (bim_model_id, type_name);

create index if not exists cde_bim_elements_model_identity_idx
  on cde_bim_elements (bim_model_id, element_identity);

create index if not exists cde_bim_property_sets_model_normalized_idx
  on cde_bim_property_sets (bim_model_id, normalized_name);

create index if not exists cde_bim_properties_set_normalized_idx
  on cde_bim_properties (property_set_id, normalized_name);

create index if not exists cde_bim_property_values_element_property_idx
  on cde_bim_property_values (bim_element_id, property_id);

create index if not exists cde_bim_property_values_property_nonempty_text_idx
  on cde_bim_property_values (property_id, value_text)
  where value_text is not null and value_text <> '';

create index if not exists cde_bim_property_values_property_unit_idx
  on cde_bim_property_values (property_id, unit)
  where unit is not null and unit <> '';
create unique index if not exists cde_bim_index_jobs_project_path_hash_uidx
  on cde_bim_index_jobs (project_code, document_path, coalesce(source_hash, ''));

create table if not exists cde_pma_sources (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  name text not null,
  source_document_path text,
  source_hash text,
  status text not null default 'draft'
    check (status in ('draft', 'imported', 'failed', 'archived')),
  imported_by text,
  imported_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cde_pma_sources_project_idx
  on cde_pma_sources (project_code, updated_at desc);

create table if not exists cde_pma_requirements (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references cde_pma_sources(id) on delete cascade,
  project_code text not null,
  pma_code text,
  pma_name text not null,
  zone text,
  building text,
  level_name text,
  normative_area numeric,
  preinvestment_area numeric,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists cde_pma_requirements_project_idx
  on cde_pma_requirements (project_code, pma_name);
create index if not exists cde_pma_requirements_source_idx
  on cde_pma_requirements (source_id);

create table if not exists cde_pma_mappings (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  name text not null default 'default',
  active boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_code, name)
);

create index if not exists cde_pma_mappings_project_idx
  on cde_pma_mappings (project_code, active);
