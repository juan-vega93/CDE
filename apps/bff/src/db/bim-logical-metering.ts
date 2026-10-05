import { STORED_REPLICA_POLICY_V2 } from './bim-cost-replicas-v2';
import { getBimCost5DAggregation, type BimCost5DAggregationInput } from './bim-index-store';
import { getBimReadDatabase, withBimPublishedRead } from './bim-index-generations';
import { STORED_REPLICA_POLICY } from './bim-cost-replicas';

/** Consolidate complete memberships FIRST, filter/page logical rows afterwards. Same policy as Partidas. */
export async function getLogicalMeteringRows(input: BimCost5DAggregationInput & {
  partida?: string; sector?: string; logicalIfcClass?: string; search?: string; offset?: number; exportAll?: boolean;
}) {
  if ((input.quantityPolicy !== STORED_REPLICA_POLICY && input.quantityPolicy !== STORED_REPLICA_POLICY_V2) || input.quantitySource !== 'stored_parameter') throw new Error('Logical metering requires a versioned stored-authoring-replicas policy');
  return withBimPublishedRead(async () => {
    const aggregation = await getBimCost5DAggregation(input, true);
    const rows = aggregation.rows.flatMap(group => (group.logicalRows ?? []).map(detail => ({...detail,
      quantityPolicy:group.quantityPolicy,itemId:group.itemId,itemName:group.itemName,itemUnit:group.itemUnit,quantityProvenance:group.quantityProvenance})));
    const targets = [...new Map(rows.map(row => [row.key,{key:row.key,model_key:row.context.modelKey,revision_id:row.context.revisionId,local_id:row.representativeLocalId,authoring_key:row.identityKey}])).values()];
    const metadata = await getBimReadDatabase().query<{key:string;logical_ifc_class:string|null;global_id:string|null;sector:string|null;element_type:string|null;authoring_id:string|null}>(`
      select r.key,e.ifc_class logical_ifc_class,e.global_id,a.authoring_element_id authoring_id,
        p.sector,coalesce(p.element_type,e.name) element_type
      from jsonb_to_recordset($2::jsonb) r(key text,model_key text,revision_id text,local_id int,authoring_key text)
      join cde_bim_index_generations g on g.id=cde_bim_published_generation($1,r.model_key) and g.revision_id=r.revision_id
      join cde_bim_elements e on e.generation_id=g.id and e.local_id=r.local_id
      join cde_bim_authoring_contexts c on c.project_code=$1 and c.model_key=r.model_key and c.revision_id=r.revision_id
      join cde_bim_authoring_elements a on a.context_id=c.id and a.element_key=r.authoring_key
      left join lateral (
        select case when count(distinct v.value_text) filter(where prop.name='Sector')=1
          then min(v.value_text) filter(where prop.name='Sector') end sector,
          case when count(distinct v.value_text) filter(where prop.name in ('Tipo','ObjectType','Type'))=1
          then min(v.value_text) filter(where prop.name in ('Tipo','ObjectType','Type')) end element_type
        from cde_bim_property_values v join cde_bim_properties prop on prop.id=v.property_id
        where v.bim_element_id=e.id and prop.name in ('Sector','Tipo','ObjectType','Type')
      ) p on true`, [input.projectCode,JSON.stringify(targets)]);
    const byKey = new Map(metadata.rows.map(row=>[row.key,row]));
    const enriched = rows.map(row=>{const info=byKey.get(row.key); return {...row,
      logicalIfcClass:info?.logical_ifc_class ?? null,rootGlobalId:info?.global_id ?? null,
      sector:info?.sector ?? null,elementType:info?.element_type ?? null,authoringElementId:info?.authoring_id ?? null};})
      .sort((a,b)=>JSON.stringify([a.itemId,a.itemName,a.itemUnit,a.key]).localeCompare(JSON.stringify([b.itemId,b.itemName,b.itemUnit,b.key])));
    const options = {
      partidas:[...new Set(enriched.map(r=>r.itemId))].sort(),sectors:[...new Set(enriched.flatMap(r=>r.sector?[r.sector]:[]))].sort(),
      classes:[...new Set(enriched.flatMap(r=>r.logicalIfcClass?[r.logicalIfcClass]:[]))].sort()
    };
    const filtered=enriched.filter(row=>(!input.partida || row.itemId===input.partida) && (!input.sector || row.sector===input.sector) &&
      (!input.logicalIfcClass || row.logicalIfcClass===input.logicalIfcClass) && (!input.search ||
        [row.itemId,row.itemName,row.sector,row.authoringElementId,row.elementType,row.logicalIfcClass,row.identityKey].join(' ').toLowerCase().includes(input.search.toLowerCase())));
    const offset=Math.max(0,Math.floor(input.offset ?? 0)),limit=Math.max(1,Math.min(500,Math.floor(input.limit ?? 100)));
    const errors=aggregation.rows.filter(group=>group.consolidationError && (!input.partida || group.itemId===input.partida))
      .map(group=>({itemId:group.itemId,error:group.consolidationError}));
    return {rows:input.exportAll?filtered:filtered.slice(offset,offset+limit),total:filtered.length,offset,limit,options,errors,
      quantity:errors.length || filtered.some(r=>r.quantity===null) || new Set(filtered.map(r=>r.itemUnit)).size>1
        ? null : filtered.reduce((n,r)=>n+r.quantity!,0)};
  });
}
