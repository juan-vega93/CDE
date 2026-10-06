import { getBimReadDatabase, withBimPublishedRead } from './bim-index-generations';
import { resolveGraphicalRepresentation, type GraphicalRelation } from '../services/bim-graphical-representation';
import type { BimProcessingContext } from '../services/bim-revision-identity';

/** Three bounded reads, independent of bucket size; no new persistence or writes. */
export function getGraphicalRepresentation(context: BimProcessingContext, localIds: number[]) {
  return withBimPublishedRead(async () => {
    const db = getBimReadDatabase();
    const scope = (await db.query<{ id: string; generation_id: string }>(`
      select c.id,g.id generation_id from cde_bim_authoring_contexts c
      join cde_bim_index_generations g on g.id=cde_bim_published_generation(c.project_code,c.model_key)
        and g.revision_id=c.revision_id
      where c.project_code=$1 and c.model_key=$2 and c.revision_id=$3`,
    [context.projectCode, context.modelKey, context.revisionId])).rows[0];
    if (!scope) return null;
    const facts = (await db.query<{ localId: number; geometryStatus: 'present' | 'absent' | 'unknown' }>(`
      select m.local_id "localId",m.geometry_status "geometryStatus"
      from cde_bim_authoring_members m join cde_bim_elements e
        on e.generation_id=$2 and e.local_id=m.local_id
      where m.context_id=$1`, [scope.id, scope.generation_id])).rows;
    const relations = (await db.query<{ relation: GraphicalRelation }>(`
      select distinct r.value relation from cde_bim_authoring_elements a
      cross join lateral jsonb_array_elements(a.composition_evidence->'relations') r(value)
      where a.context_id=$1 and r.value->>'relationType'='IfcRelAggregates'`, [scope.id])).rows.map(r => r.relation);
    return { ...resolveGraphicalRepresentation(context, localIds, facts, relations), generationId: scope.generation_id };
  });
}
