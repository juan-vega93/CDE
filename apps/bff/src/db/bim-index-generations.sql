-- Legacy rows remain opaque (generation_id IS NULL); no backfill or revision inference.
begin;
create table if not exists cde_bim_index_scopes (
  id uuid primary key default gen_random_uuid(),
  project_code text collate "C" not null,
  canonical_model_key text collate "C" not null,
  unique(project_code, canonical_model_key)
);
create table if not exists cde_bim_index_generations (
  id uuid primary key default gen_random_uuid(),
  scope_id uuid not null references cde_bim_index_scopes(id),
  bim_model_id uuid not null references cde_bim_models(id) on delete cascade,
  revision_id text collate "C" not null check (revision_id ~ '^sha256:[0-9a-f]{64}$'),
  sequence bigint generated always as identity unique,
  status text not null default 'building' check(status in ('building','published','failed','superseded')),
  element_count integer not null default 0 check(element_count >= 0),
  property_count integer not null default 0 check(property_count >= 0),
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  published_at timestamptz
);
create unique index if not exists cde_bim_index_generations_published_uidx
  on cde_bim_index_generations(scope_id) where status='published';
create index if not exists cde_bim_index_generations_scope_idx on cde_bim_index_generations(scope_id, sequence);
alter table cde_bim_elements add column if not exists generation_id uuid references cde_bim_index_generations(id) on delete cascade;
alter table cde_bim_property_sets add column if not exists generation_id uuid references cde_bim_index_generations(id) on delete cascade;
alter table cde_bim_index_jobs add column if not exists generation_id uuid references cde_bim_index_generations(id) on delete set null;
alter table cde_bim_elements drop constraint if exists cde_bim_elements_bim_model_id_local_id_key;
alter table cde_bim_property_sets drop constraint if exists cde_bim_property_sets_bim_model_id_name_key;
create unique index if not exists cde_bim_elements_legacy_uidx on cde_bim_elements(bim_model_id,local_id) where generation_id is null;
create unique index if not exists cde_bim_elements_generation_uidx on cde_bim_elements(generation_id,local_id) where generation_id is not null;
create unique index if not exists cde_bim_property_sets_legacy_uidx on cde_bim_property_sets(bim_model_id,name) where generation_id is null;
create unique index if not exists cde_bim_property_sets_generation_uidx on cde_bim_property_sets(generation_id,name) where generation_id is not null;

-- Documentary slash convention only. No case folding, alias or revision inference.
create or replace function cde_bim_document_key(document_path text) returns text
language sql immutable strict parallel safe as $$
  select regexp_replace(case when left(btrim(document_path),1)='/' then btrim(document_path)
    else '/' || btrim(document_path) end, '/$', '')
$$;
create or replace function cde_bim_published_generation(project text, document_path text) returns uuid
language sql stable parallel safe as $$
  select g.id from cde_bim_index_scopes s join cde_bim_index_generations g on g.scope_id=s.id
  where s.project_code=project collate "C" and s.canonical_model_key=cde_bim_document_key(document_path) collate "C"
    and g.status='published'
$$;
create or replace view cde_bim_visible_elements as
select e.* from cde_bim_elements e join cde_bim_models m on m.id=e.bim_model_id
where e.generation_id is not distinct from cde_bim_published_generation(m.project_code,m.document_path);
create or replace view cde_bim_visible_models as
select m.* from cde_bim_models m
where cde_bim_published_generation(m.project_code,m.document_path) is null
  or exists(select 1 from cde_bim_index_generations g
    where g.id=cde_bim_published_generation(m.project_code,m.document_path) and g.bim_model_id=m.id);

-- Values inherit generation through their element; definitions must share that scope.
create or replace function cde_bim_check_value_generation() returns trigger language plpgsql as $$
begin
  if not exists(select 1 from cde_bim_elements e
    join cde_bim_properties p on p.id=new.property_id
    join cde_bim_property_sets s on s.id=p.property_set_id
    where e.id=new.bim_element_id and e.bim_model_id=s.bim_model_id
      and e.generation_id is not distinct from s.generation_id) then
    raise exception 'BIM_PROPERTY_GENERATION_MISMATCH';
  end if;
  return new;
end $$;
drop trigger if exists cde_bim_value_generation on cde_bim_property_values;
create trigger cde_bim_value_generation before insert or update on cde_bim_property_values
for each row execute function cde_bim_check_value_generation();
commit;
