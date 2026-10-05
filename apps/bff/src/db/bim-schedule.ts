import { getBimReadDatabase, withBimPublishedRead } from './bim-index-generations';

export type ScheduleColumn = {id:string;label:string;source:'stored_parameter';setName:string;propertyName:string};
// Future QTO columns must additionally declare quantity type and root/child role;
// the stored-property endpoint deliberately refuses implicit QTO consolidation.
export type ScheduleInput = {projectCode:string;modelKeys?:string[];columns:ScheduleColumn[];
  filters?:{modelKey?:string;logicalIfcClass?:string;level?:string;sector?:string;elementType?:string;partida?:string;withoutPartida?:boolean;search?:string};
  offset?:number;limit?:number};
export type ScheduleCell = {status:'resolved'|'multiple'|'ambiguous'|'missing';value:string|null;observations:number};

const norm=(sql:string)=>`lower(regexp_replace(regexp_replace(${sql}, '[[:space:]]*\\([0-9]+\\)[[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))`;
const value=`coalesce(v.value_text,v.value_number::text,v.value_bool::text,v.value_json::text)`;
const base=`with scope as materialized (
  select g.id generation_id,g.revision_id,scope.project_code,scope.canonical_model_key model_key,models.document_name
  from cde_bim_visible_models models
  join cde_bim_index_generations g on g.id=cde_bim_published_generation(models.project_code,models.document_path)
  join cde_bim_index_scopes scope on scope.id=g.scope_id
  where models.project_code=$1 and models.status='ready'
    and ($2::text[] is null or exists(select 1 from unnest($2::text[]) k where
      lower(k)=lower(scope.canonical_model_key) or lower(k)=lower(models.model_key) or lower(k)=lower('ifc:'||scope.canonical_model_key) or lower(k)=lower('frag:'||scope.canonical_model_key)))
), metadata as materialized (
  select am.authoring_element_id,
    case when count(distinct ${value}) filter(where prop.name in ('Nivel','Nivel del elemento'))=1 then min(${value}) filter(where prop.name in ('Nivel','Nivel del elemento')) end property_level,
    case when count(distinct ${value}) filter(where prop.name='Sector')=1 then min(${value}) filter(where prop.name='Sector') end sector,
    count(distinct ${value}) filter(where prop.name ilike 'ID Partida%') partida_count,
    case when count(distinct ${value}) filter(where prop.name ilike 'ID Partida%')=1 then min(${value}) filter(where prop.name ilike 'ID Partida%') end partida
  from cde_bim_properties prop join cde_bim_property_values v on v.property_id=prop.id
  join cde_bim_elements e on e.id=v.bim_element_id
  join scope s on s.generation_id=e.generation_id
  join cde_bim_authoring_contexts c on c.project_code=s.project_code and c.model_key=s.model_key and c.revision_id=s.revision_id
  join cde_bim_authoring_members am on am.context_id=c.id and am.local_id=e.local_id
  where prop.name in ('Sector','Nivel','Nivel del elemento') or prop.name ilike 'ID Partida%'
  group by am.authoring_element_id
), metadata_map as materialized (
  select coalesce(jsonb_object_agg(authoring_element_id,to_jsonb(metadata)-'authoring_element_id'),'{}'::jsonb) data from metadata
), roots as not materialized (
  select a.id,a.element_key,a.root_local_id,a.resolution_method,a.authoring_element_id,c.project_code,c.model_key,c.revision_id,
    scope.generation_id,e.local_id,e.name,e.ifc_class,e.type_name,coalesce(e.level_name,p.data->a.id::text->>'property_level') level_name,scope.document_name,
    p.data->a.id::text->>'sector' sector,p.data->a.id::text->>'partida' partida,coalesce((p.data->a.id::text->>'partida_count')::int,0) partida_count
  from scope
  join cde_bim_authoring_contexts c on c.project_code=scope.project_code and c.model_key=scope.model_key and c.revision_id=scope.revision_id
  join cde_bim_authoring_elements a on a.context_id=c.id
  join cde_bim_elements e on e.generation_id=scope.generation_id and e.local_id=coalesce(a.root_local_id,
    (a.composition_evidence->'exportSplit'->>'representativeLocalId')::int,
    (select min(m.local_id) from cde_bim_authoring_members m where m.authoring_element_id=a.id having count(*)=1))
  cross join metadata_map p
), filtered as (
  select * from roots where
    ($3::jsonb->>'modelKey' is null or model_key=$3::jsonb->>'modelKey') and
    ($3::jsonb->>'logicalIfcClass' is null or ifc_class=$3::jsonb->>'logicalIfcClass') and
    ($3::jsonb->>'level' is null or level_name=$3::jsonb->>'level') and
    ($3::jsonb->>'sector' is null or sector=$3::jsonb->>'sector') and
    ($3::jsonb->>'elementType' is null or type_name=$3::jsonb->>'elementType') and
    ($3::jsonb->>'partida' is null or partida=$3::jsonb->>'partida') and
    (coalesce(($3::jsonb->>'withoutPartida')::boolean,false)=false or (partida_count<=1 and coalesce(btrim(partida),'') in ('','-','--','Sin partida'))) and
    ($3::jsonb->>'search' is null or concat_ws(' ',name,ifc_class,type_name,level_name,authoring_element_id,partida,sector) ilike '%'||($3::jsonb->>'search')||'%')
)`;

/** COUNT and a stable SQL page in one publication snapshot. Only page observations reach JS. */
export async function getBimSchedule(input:ScheduleInput) {
  if(input.columns.length>24 || input.columns.some(c=>c.source!=='stored_parameter'||!c.id||!c.setName||!c.propertyName||/^Qto_/i.test(c.setName)) ||
    new Set(input.columns.map(c=>c.id)).size!==input.columns.length) throw new Error('Invalid stored schedule columns');
  const filters=Object.fromEntries(Object.entries(input.filters??{}).filter(([,v])=>v!==''&&v!==undefined));
  const offset=Math.max(0,Math.floor(input.offset??0)),limit=Math.max(1,Math.min(500,Math.floor(input.limit??100)));
  return withBimPublishedRead(async()=>{
    const db=getBimReadDatabase(),params=[input.projectCode,input.modelKeys?.length?input.modelKeys:null,JSON.stringify(filters)];
    const count=await db.query<{total:string;publication:string}>(`${base} select count(*)::text total,
      (select string_agg(generation_id::text,',' order by generation_id::text) from scope) publication from filtered`,params);
    const result=await db.query<{
      id:string;element_key:string;local_id:number;root_local_id:number|null;project_code:string;model_key:string;revision_id:string;
      name:string|null;ifc_class:string|null;type_name:string|null;level_name:string|null;document_name:string;authoring_element_id:string|null;sector:string|null;partida:string|null;
      member_ids:number[];graphical_ids:number[];cells:Record<string,ScheduleCell>;
    }>(`${base}, page as materialized (
      select * from filtered order by model_key collate "C",element_key collate "C",id limit $4 offset $5
    ), members as materialized (
      select page.id,page.generation_id,m.local_id,m.geometry_status,e.id entity_id
      from page join cde_bim_authoring_members m on m.authoring_element_id=page.id
      join cde_bim_elements e on e.generation_id=page.generation_id and e.local_id=m.local_id
    ), observations as (
      select m.id,col.id column_id,m.local_id,${value} val,v.id observation_id
      from members m cross join jsonb_to_recordset($6::jsonb) col(id text,"setName" text,"propertyName" text)
      join cde_bim_property_values v on v.bim_element_id=m.entity_id
      join cde_bim_properties prop on prop.id=v.property_id and ${norm('prop.name')}=${norm('col."propertyName"')}
      join cde_bim_property_sets ps on ps.id=prop.property_set_id and ${norm('ps.name')}=${norm('col."setName"')}
    ), cell_values as (
      select id,column_id,jsonb_build_object('status',case
        when count(*)<>count(distinct local_id) then 'ambiguous'
        when count(distinct val)>1 then 'multiple'
        when count(val)=0 then 'missing' else 'resolved' end,
        'value',case when count(*)=count(distinct local_id) and count(distinct val)=1 then min(val) end,
        'observations',count(*)) cell
      from observations group by id,column_id
    ) select page.*,m.member_ids,m.graphical_ids,coalesce(c.cells,'{}'::jsonb) cells
      from page join lateral(select array_agg(local_id order by local_id) member_ids,
        coalesce(array_agg(local_id order by local_id) filter(where geometry_status='present'),'{}') graphical_ids
        from members where members.id=page.id) m on true
      left join lateral(select jsonb_object_agg(column_id,cell) cells from cell_values where cell_values.id=page.id) c on true
      order by page.model_key collate "C",page.element_key collate "C",page.id`,[...params,limit,offset,JSON.stringify(input.columns)]);
    return {total:Number(count.rows[0].total),publication:count.rows[0].publication,offset,limit,rows:result.rows.map(r=>({
      key:JSON.stringify([r.model_key,r.revision_id,r.element_key]),identityKey:r.element_key,
      context:{projectCode:r.project_code,modelKey:r.model_key,revisionId:r.revision_id},
      representativeLocalId:r.local_id,memberLocalIds:r.member_ids,graphicalLocalIds:r.graphical_ids,
      modelName:r.document_name,name:r.name,logicalIfcClass:r.ifc_class,elementType:r.type_name,level:r.level_name,
      authoringElementId:r.authoring_element_id,sector:r.sector,partida:r.partida,
      cells:Object.fromEntries(input.columns.map(c=>[c.id,r.cells[c.id]??{status:'missing',value:null,observations:0}]))
    }))};
  });
}
