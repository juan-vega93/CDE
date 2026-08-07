-- Initial metadata schema for BIM/document issues.
-- Binary assets stay in Nextcloud; PostgreSQL stores canonical metadata.

create table if not exists cde_issues (
  id uuid primary key,
  project_code text not null,
  title text not null,
  description text,
  source_kind text not null check (source_kind in ('model', 'document')),
  source_system text not null default 'legacy',
  source_id text,
  issue_type text not null default 'coordination',
  status text not null default 'open',
  priority text not null default 'medium',
  discipline text,
  author text,
  assigned_to text,
  due_date date,
  document_path text,
  document_name text,
  document_version_id text,
  page_number integer,
  snapshot_url text,
  viewpoint_id uuid,
  native_viewpoint_guid uuid,
  location jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  element_count integer not null default 0,
  openproject_project_ref text,
  openproject_work_package_id text,
  openproject_sync_status text not null default 'not_synced',
  openproject_last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cde_issues
  add column if not exists source_system text not null default 'legacy';

alter table cde_issues
  add column if not exists source_id text;

update cde_issues
set source_id = id::text
where source_id is null;

alter table cde_issues
  alter column source_id set not null;

alter table cde_issues
  add column if not exists document_path text,
  add column if not exists document_name text,
  add column if not exists document_version_id text,
  add column if not exists page_number integer,
  add column if not exists location jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists element_count integer not null default 0;

create index if not exists cde_issues_project_status_idx
  on cde_issues (project_code, status)
  where deleted_at is null;

create index if not exists cde_issues_project_source_idx
  on cde_issues (project_code, source_system, source_id)
  where deleted_at is null;

create index if not exists cde_issues_openproject_wp_idx
  on cde_issues (openproject_work_package_id)
  where openproject_work_package_id is not null;

create table if not exists cde_issue_models (
  issue_id uuid not null references cde_issues(id) on delete cascade,
  model_name text not null,
  document_path text,
  document_name text,
  primary key (issue_id, model_name)
);

create table if not exists cde_issue_selections (
  issue_id uuid not null references cde_issues(id) on delete cascade,
  model_id text not null,
  express_id bigint not null,
  primary key (issue_id, model_id, express_id)
);

create table if not exists cde_issue_comments (
  id uuid primary key,
  issue_id uuid not null references cde_issues(id) on delete cascade,
  author text,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists cde_issue_attachments (
  id uuid primary key,
  issue_id uuid not null references cde_issues(id) on delete cascade,
  name text not null,
  mime_type text,
  size_bytes bigint,
  storage_url text not null,
  created_at timestamptz not null default now()
);

create table if not exists cde_bcf_topics (
  id text not null,
  project_code text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (project_code, id)
);

do $$
begin
  alter table cde_bcf_topics
    drop constraint if exists cde_bcf_topics_pkey;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'cde_bcf_topics_project_id_pkey'
  ) then
    alter table cde_bcf_topics
      add constraint cde_bcf_topics_project_id_pkey primary key (project_code, id);
  end if;
end $$;

create index if not exists cde_bcf_topics_project_idx
  on cde_bcf_topics (project_code, updated_at desc)
  where deleted_at is null;

create table if not exists cde_bim_derivatives (
  id text primary key,
  project_code text not null,
  source_path text not null,
  source_name text not null,
  file_id text,
  version_id text not null default 'current',
  version_key text,
  frag_path text not null,
  status text not null default 'pending'
    check (status in ('pending', 'generated', 'failed')),
  error text,
  generated_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists cde_bim_derivatives_source_idx
  on cde_bim_derivatives (project_code, source_path, version_id, version_key);

create index if not exists cde_bim_derivatives_file_idx
  on cde_bim_derivatives (project_code, file_id, version_id, version_key)
  where file_id is not null;
