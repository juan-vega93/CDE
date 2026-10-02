import type { CostSelection, CostSelectionSource } from "./bim-cost-selection";

export const STORED_REPLICA_POLICY = "stored-authoring-replicas@1" as const;
export type CostObservation = { localId: number; value: number | null; candidates: number };
export type ReplicaSource = CostSelectionSource & { resolution_method: string; root_local_id: number | null };
export type LogicalCostRow = {
  key: string; context: CostSelection["groups"][number]["context"];
  identityKey: string; representativeLocalId: number | null;
  memberLocalIds: number[]; graphicalLocalIds: number[];
  quantity: number | null; status: "resolved" | "ambiguous"; reason: string | null;
  replicaCount: number;
};

/** Explicitly declared stored parameters only. Never applicable to IFC quantities or mesh volumes.
 * Equality is exact, scoped to a corroborated AE in one revision, never DISTINCT(value).
 * Full membership is required: split classifications, missing values and duplicate properties fail closed.
 */
export function createStoredReplicaConsolidator(sources: ReplicaSource[]) {
  const lookup = new Map<string, ReplicaSource[]>();
  for (const source of sources) for (const id of source.member_ids) {
    const key = JSON.stringify([source.model_key, id]);
    const matches = lookup.get(key) ?? []; matches.push(source); lookup.set(key, matches);
  }
  return (observations: Record<string, CostObservation[]>, unit: string, source: "stored_parameter" | "ifc_quantity" | "viewer_geometry"): LogicalCostRow[] => {
    if (source !== "stored_parameter") throw new Error("Stored replica policy cannot consume IFC quantities or viewer geometry");
    const groups = new Map<ReplicaSource, CostObservation[]>();
    for (const [model, entries] of Object.entries(observations)) for (const entry of entries) {
      const matches = lookup.get(JSON.stringify([model, entry.localId])) ?? [];
      if (matches.length !== 1) throw new Error("Authoring membership missing or ambiguous");
      const group = groups.get(matches[0]) ?? []; group.push(entry); groups.set(matches[0], group);
    }
    return [...groups].map(([source, entries]) => {
      const context = { projectCode: source.project_code, modelKey: source.canonical_model_key, revisionId: source.revision_id };
      const ids = new Set(entries.map(e => e.localId));
      let reason: string | null = null;
      if (!["standalone", "corroborated_aggregate"].includes(source.resolution_method)) reason = "uncorroborated_composition";
      else if (entries.length !== source.member_ids.length || ids.size !== entries.length || source.member_ids.some(id => !ids.has(id))) reason = "incomplete_or_split_classification";
      else if (!unit.trim() || ["-", "sin valor", "null", "undefined"].includes(unit.trim().toLowerCase())) reason = "missing_unit";
      else if (entries.some(e => e.candidates !== 1 || e.value === null || !Number.isFinite(e.value))) reason = "missing_or_multiple_observations";
      else if (entries.some(e => e.value !== entries[0].value)) reason = "conflicting_values";
      const representative = source.root_local_id ?? (source.member_ids.length === 1 ? source.member_ids[0] : null);
      if (!reason && representative === null) reason = "missing_root";
      return { key: JSON.stringify([context, source.element_key]), context, identityKey: source.element_key,
        representativeLocalId: representative, memberLocalIds: source.member_ids, graphicalLocalIds: source.graphical_ids,
        quantity: reason ? null : entries[0].value, status: reason ? "ambiguous" : "resolved", reason,
        replicaCount: reason ? 0 : entries.length - 1 };
    });
  };
}
