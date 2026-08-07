-- Canonical CDE metadata schema.
-- PostgreSQL is the target store; PostGIS can be enabled later in the same DB.

create extension if not exists pgcrypto;

create table if not exists cde_documents (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  document_path text not null,
  document_name text not null,
  repository_kind text not null default 'nextcloud',
  repository_file_id text,
  repository_etag text,
  content_type text,
  size_bytes bigint,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_code, document_path)
);

create index if not exists cde_documents_project_path_idx
  on cde_documents (project_code, document_path);

create table if not exists cde_document_annotations (
  id uuid primary key,
  project_code text not null,
  document_path text not null,
  document_version_id text,
  page_number integer not null check (page_number > 0),
  kind text not null check (kind in ('comment', 'issue_marker', 'revision_cloud', 'rectangle', 'highlight', 'arrow', 'measurement')),
  text text,
  color text not null default '#e30613',
  geometry jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  status text not null default 'open',
  author text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

alter table cde_document_annotations
  add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  alter table cde_document_annotations
    drop constraint if exists cde_document_annotations_kind_check;

  alter table cde_document_annotations
    add constraint cde_document_annotations_kind_check
    check (kind in ('comment', 'issue_marker', 'revision_cloud', 'rectangle', 'highlight', 'arrow', 'measurement'));
end $$;

create index if not exists cde_document_annotations_document_idx
  on cde_document_annotations (project_code, document_path, document_version_id, page_number)
  where deleted_at is null;
