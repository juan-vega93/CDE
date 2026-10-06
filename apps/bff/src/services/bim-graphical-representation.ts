import type { BimProcessingContext } from './bim-revision-identity';

export type GraphicalRelation = { relationLocalId: number; relationType: string; parentLocalId: number; childLocalIds: readonly number[] };
export type GraphicalFact = { localId: number; geometryStatus: 'present' | 'absent' | 'unknown' };
export type GraphicalResolution = {
  semanticLocalId: number;
  resolution: 'direct' | 'structural_delegate' | 'unresolved';
  graphicalLocalIds: number[];
  evidence: { relations: GraphicalRelation[]; reason?: 'cycle' | 'no_confirmed_geometry' };
};

/** Representation only: deliberately independent of authoring corroboration and quantities. */
export function resolveGraphicalRepresentation(context: BimProcessingContext, ids: readonly number[],
  facts: readonly GraphicalFact[], relations: readonly GraphicalRelation[]) {
  const byId = new Map(facts.map(f => [f.localId, f.geometryStatus]));
  const edges = new Map<number, GraphicalRelation[]>();
  const unique = new Map<string, GraphicalRelation>();
  for (const r of relations) {
    if (r.relationType !== 'IfcRelAggregates' || !Number.isSafeInteger(r.relationLocalId) || r.relationLocalId <= 0) continue;
    const children = [...new Set(r.childLocalIds)].filter(id => Number.isSafeInteger(id) && id > 0).sort((a,b) => a-b);
    const edge = { ...r, childLocalIds: children };
    unique.set(JSON.stringify(edge), edge);
  }
  for (const r of unique.values()) edges.set(r.parentLocalId, [...(edges.get(r.parentLocalId) ?? []), r]);
  const results: GraphicalResolution[] = [...new Set(ids)].sort((a,b) => a-b).map(semanticLocalId => {
    if (byId.get(semanticLocalId) === 'present') return { semanticLocalId, resolution: 'direct', graphicalLocalIds: [semanticLocalId], evidence: { relations: [] } };
    const targets = new Set<number>(), evidence = new Map<number, GraphicalRelation>();
    const active = new Set<number>(), done = new Set<number>();
    const stack = [{ id: semanticLocalId, exit: false }];
    let cycle = false;
    while (stack.length) {
      const { id, exit } = stack.pop()!;
      if (exit) { active.delete(id); done.add(id); continue; }
      if (active.has(id)) { cycle = true; continue; }
      if (done.has(id) || !byId.has(id)) continue;
      if (byId.get(id) === 'present') { targets.add(id); done.add(id); continue; }
      active.add(id); stack.push({ id, exit: true });
      for (const r of edges.get(id) ?? []) {
        evidence.set(r.relationLocalId, r);
        for (const child of r.childLocalIds) stack.push({ id: child, exit: false });
      }
    }
    const graphicalLocalIds = cycle ? [] : [...targets].sort((a,b) => a-b);
    return { semanticLocalId, resolution: graphicalLocalIds.length ? 'structural_delegate' : 'unresolved', graphicalLocalIds,
      evidence: { relations: [...evidence.values()].sort((a,b) => a.relationLocalId-b.relationLocalId),
        ...(!graphicalLocalIds.length ? { reason: cycle ? 'cycle' as const : 'no_confirmed_geometry' as const } : {}) } };
  });
  return { context, results };
}
