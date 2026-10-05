import { createStoredReplicaConsolidator, type CostObservation, type LogicalCostRow, type ReplicaSource } from './bim-cost-replicas';
import type { AuthoringCompositionEvidence } from '../services/bim-authoring-resolver';

export const STORED_REPLICA_POLICY_V2 = 'stored-authoring-replicas@2' as const;
export type EvidenceSource = ReplicaSource & { composition_evidence?: AuthoringCompositionEvidence };
export type StoredOwnerObservation = {
  model_key: string; local_id: number; occurrence_index: number;
  kind: 'quantity' | 'unit'; numeric_value: number | null; raw_value: unknown;
};
const key = (model: string, id: number) => JSON.stringify([model, id]);
const identityIssues = new Set(['missing_authoring_id', 'conflicting_authoring_id', 'missing_tag',
  'conflicting_tag', 'tag_authoring_id_mismatch', 'missing_source_container', 'conflicting_source_container',
  'unsupported_relation_type']);

/** @2 adds ONLY an exclusive stored observation owner in a complete native component.
 * Authoring confidence/membership remain unchanged. Other owners (even equal values),
 * duplicate observations, unknown structure and absent provenance fail closed.
 * Evidence must cover the whole published component, not just the current partida.
 */
export function createStoredReplicaConsolidatorV2(sources: EvidenceSource[], evidence: StoredOwnerObservation[]) {
  const original = createStoredReplicaConsolidator(sources);
  const members = new Set(sources.flatMap(s => s.member_ids.map(id => key(s.model_key, id))));
  const byEntity = new Map<string, StoredOwnerObservation[]>();
  for (const o of evidence) {
    const k = key(o.model_key, o.local_id), list = byEntity.get(k) ?? [];
    list.push(o); byEntity.set(k, list);
  }
  const components = new Map<string, StoredOwnerObservation[]>();
  const reasons = new Map<string,string>();
  const proofs = new Map<string, { quantity: StoredOwnerObservation; unit: StoredOwnerObservation; ids: number[] }>();
  for (const s of sources) {
    const sourceKey = JSON.stringify([s.model_key,s.element_key]);
    const e = s.composition_evidence;
    if (s.resolution_method !== 'singleton_fallback' || s.member_ids.length !== 1 || !e ||
        e.missingLocalIds.length || !e.relations.length || e.issues.some(i => !identityIssues.has(i)) ||
        e.relations.some(r => !['IfcRelAggregates','IfcRelNests'].includes(r.relationType))) continue;
    const ids = [...new Set(e.affectedLocalIds)].sort((a,b)=>a-b);
    const related = new Set(e.relations.flatMap(r => [r.parentLocalId,...r.childLocalIds]));
    if (!ids.includes(s.member_ids[0]) || ids.length !== related.size ||
        ids.some(id => !related.has(id) || !members.has(key(s.model_key,id)))) continue;
    const componentKey = JSON.stringify([s.model_key,ids]);
    let quantities = components.get(componentKey);
    if (!quantities) {
      quantities = ids.flatMap(id => (byEntity.get(key(s.model_key,id)) ?? []).filter(o => o.kind==='quantity'));
      components.set(componentKey, quantities);
    }
    if (quantities.length !== 1 || quantities[0].local_id !== s.member_ids[0] ||
        quantities[0].numeric_value === null || !Number.isFinite(quantities[0].numeric_value)) {
      reasons.set(sourceKey, quantities.length===0 ? 'missing_stored_quantity' :
        !quantities.some(q=>q.local_id===s.member_ids[0]) ? 'missing_stored_quantity_on_entity' :
        quantities.length>1 ? 'multiple_component_observations' : 'invalid_stored_quantity');
      continue;
    }
    const units = (byEntity.get(key(s.model_key,s.member_ids[0])) ?? []).filter(o => o.kind==='unit');
    if (units.length !== 1 || typeof units[0].raw_value !== 'string' ||
        !units[0].raw_value.trim() || ['-','--','sin valor','null','undefined'].includes(units[0].raw_value.trim().toLowerCase())) {
      reasons.set(sourceKey,'missing_or_multiple_units'); continue;
    }
    proofs.set(sourceKey, {quantity:quantities[0],unit:units[0],ids});
  }
  const sourcesByRow = new Map(sources.map(s => [JSON.stringify([{projectCode:s.project_code,
    modelKey:s.canonical_model_key,revisionId:s.revision_id},s.element_key]),s]));
  return (observations: Record<string, CostObservation[]>, unit: string, source: 'stored_parameter' | 'ifc_quantity' | 'viewer_geometry') => {
    const rows: (LogicalCostRow & { evaluationBasis?: string; quantityEvidence?: {localId:number;occurrenceIndex:number;componentLocalIds:number[]} })[] = original(observations,unit,source);
    const entries = new Map(Object.entries(observations).flatMap(([model,values])=>values.map(o=>[key(model,o.localId),o] as const)));
    const counts = new Map<string,number>();
    for (const [model, values] of Object.entries(observations)) for (const o of values) {
      const k=key(model,o.localId); counts.set(k,(counts.get(k)??0)+1);
    }
    for (const row of rows) {
      if (row.reason !== 'uncorroborated_composition') continue;
      // Response aliases and canonical context are distinct; locate by complete revision identity.
      const s = sourcesByRow.get(row.key);
      if (!s) continue;
      const proof = proofs.get(JSON.stringify([s.model_key,row.identityKey]));
      row.reason = reasons.get(JSON.stringify([s.model_key,row.identityKey])) ?? row.reason;
      const o = entries.get(key(s.model_key,row.memberLocalIds[0]));
      if (!proof || !o || o.candidates !== 1 || o.value !== proof.quantity.numeric_value ||
          proof.unit.raw_value !== unit || counts.get(key(s.model_key,o.localId))!==1) continue;
      row.quantity = o.value; row.status = 'resolved'; row.reason = null;
      row.evaluationBasis = 'exclusive_entity_observation';
      row.quantityEvidence = {localId:o.localId,occurrenceIndex:proof.quantity.occurrence_index,componentLocalIds:proof.ids};
    }
    return rows;
  };
}
