-- Additive evidence, owned by the existing publication generation, not by AE UUIDs.
create table if not exists cde_bim_quantity_observations (
  generation_id uuid not null references cde_bim_index_generations(id) on delete cascade,
  local_id integer not null check (local_id > 0),
  occurrence_index integer not null check (occurrence_index >= 0),
  source text not null check (source in ('stored_parameter','ifc_quantity')),
  set_name text not null,
  property_name text not null,
  quantity_ifc_type text,
  native_set_id integer,
  native_value_id integer,
  value_field text,
  raw_value jsonb not null check (jsonb_typeof(raw_value) in ('null','string','number','boolean')),
  numeric_value double precision,
  unit jsonb not null check (unit->>'kind' in ('unknown','explicit')),
  authoring_key text,
  entity_role text check (entity_role in ('root','child','standalone')),
  -- occurrence is the extractor's unique position within an entity.
  primary key (generation_id,local_id,occurrence_index),
  check ((source='stored_parameter' and quantity_ifc_type is null) or
    (source='ifc_quantity' and quantity_ifc_type is not null and quantity_ifc_type in ('IfcQuantityVolume','IfcQuantityArea','IfcQuantityLength',
      'IfcQuantityCount','IfcQuantityWeight','IfcQuantityTime','IfcQuantityNumber'))),
  check ((authoring_key is null) = (entity_role is null))
);
create index if not exists cde_bim_quantity_authoring_lookup on cde_bim_quantity_observations
  (generation_id,authoring_key,source,set_name,property_name,quantity_ifc_type);
