import type { BimProcessingContext } from "../services/bim-revision-identity";

export type CostSelectionSource = {
  model_key: string;
  project_code: string;
  canonical_model_key: BimProcessingContext["modelKey"];
  revision_id: BimProcessingContext["revisionId"];
  element_key: string;
  member_ids: number[];
  graphical_ids: number[];
};
export type CostSelection = {
  version: 1;
  unresolvedEntityCount: number;
  groups: { context: BimProcessingContext; authoringElements: {
    identityKey: string; memberCount: number; graphicalLocalIds: number[];
  }[] }[];
};

/** Build once per response, not one DB lookup per fragment. Aliases remain response lookup keys only. */
export function createCostSelectionResolver(sources: CostSelectionSource[]) {
  const lookup = new Map<string, CostSelectionSource[]>();
  for (const source of sources) for (const id of source.member_ids) {
    const key = JSON.stringify([source.model_key, id]);
    const entries = lookup.get(key) ?? [];
    entries.push(source); lookup.set(key, entries);
  }
  return (membership: Record<string, number[]>): CostSelection => {
    const groups = new Map<string, CostSelection["groups"][number]>();
    const seen = new Set<CostSelectionSource>();
    let unresolvedEntityCount = 0;
    for (const [modelKey, ids] of Object.entries(membership)) for (const id of new Set(ids)) {
      const candidates = lookup.get(JSON.stringify([modelKey, id])) ?? [];
      if (candidates.length !== 1) { unresolvedEntityCount++; continue; }
      const source = candidates[0];
      if (seen.has(source)) continue;
      seen.add(source);
      const context: BimProcessingContext = { projectCode: source.project_code,
        modelKey: source.canonical_model_key, revisionId: source.revision_id };
      const key = JSON.stringify(context);
      const group = groups.get(key) ?? { context, authoringElements: [] };
      group.authoringElements.push({ identityKey: source.element_key,
        memberCount: source.member_ids.length, graphicalLocalIds: source.graphical_ids });
      groups.set(key, group);
    }
    return { version: 1, groups: [...groups.values()], unresolvedEntityCount };
  };
}
