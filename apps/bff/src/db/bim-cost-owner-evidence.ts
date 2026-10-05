import { getBimReadDatabase } from './bim-index-generations';
import type { EvidenceSource, StoredOwnerObservation } from './bim-cost-replicas-v2';

const normalized = (sql: string) => `lower(regexp_replace(regexp_replace(${sql}, '[[:space:]]*[(][0-9]+[)][[:space:]]*$', ''), '[[:space:]_.-]+', '', 'g'))`;

/** Published snapshot only. Do not scope this query to the partida: a different
 * classification on another native member must still invalidate exclusivity. */
export async function readStoredOwnerEvidence(sources: EvidenceSource[], quantity: {setName:string;propertyName:string}, unit: {setName:string;propertyName:string}) {
  const contexts = [...new Map(sources.map(s => [JSON.stringify([s.model_key,s.revision_id]), {
    model_key:s.model_key,project_code:s.project_code,canonical_model_key:s.canonical_model_key,revision_id:s.revision_id
  }])).values()];
  const match = (set: string, name: string) => `${normalized('q.set_name')}=${normalized(set)} and ${normalized('q.property_name')}=${normalized(name)}`;
  const result = await getBimReadDatabase().query<StoredOwnerObservation>(`
    select c.model_key,q.local_id,q.occurrence_index,q.raw_value,q.numeric_value,
      case when ${match('$2','$3')} then 'quantity' else 'unit' end kind
    from jsonb_to_recordset($1::jsonb) c(model_key text,project_code text,canonical_model_key text,revision_id text)
    join cde_bim_index_generations g on g.id=cde_bim_published_generation(c.project_code,c.canonical_model_key) and g.revision_id=c.revision_id
    join cde_bim_quantity_observations q on q.generation_id=g.id and q.source='stored_parameter'
    where (${match('$2','$3')}) or (${match('$4','$5')})`,
  [JSON.stringify(contexts),quantity.setName,quantity.propertyName,unit.setName,unit.propertyName]);
  return result.rows;
}
