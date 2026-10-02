import type { ViewerBimContext } from "./viewer-bim-context";

export type CostAuthoringSelection = {
  version: 1;
  unresolvedEntityCount: number;
  groups: { context: ViewerBimContext; authoringElements: {
    identityKey: string; memberCount: number; graphicalLocalIds: number[];
  }[] }[];
};
type RuntimeModel = { modelId?: string; bimContext?: ViewerBimContext;
  runtimeModel: { getItemsIdsWithGeometry?: () => Promise<number[]> | number[] } };
const sameContext = (a: ViewerBimContext | undefined, b: ViewerBimContext) => Boolean(a &&
  a.projectCode === b.projectCode && a.modelKey === b.modelKey && a.revisionId === b.revisionId);

export function getCostSelectionModelMap(selection: CostAuthoringSelection, models: readonly RuntimeModel[]) {
  const map: Record<string, Set<number>> = {};
  for (const group of selection.groups) {
    const matches = models.filter(m => m.modelId && sameContext(m.bimContext, group.context));
    if (matches.length !== 1) continue;
    const ids = map[matches[0].modelId!] ?? new Set<number>();
    for (const element of group.authoringElements) for (const id of element.graphicalLocalIds) ids.add(id);
    if (ids.size) map[matches[0].modelId!] = ids;
  }
  return map;
}

/** No path normalization, legacy aliases, tree expansion or visibility operations. Fail closed on partial matches. */
export async function resolveCostAuthoringSelection(selection: CostAuthoringSelection, models: readonly RuntimeModel[]) {
  if (selection.version !== 1 || selection.unresolvedEntityCount !== 0 || !selection.groups.length) {
    throw new Error("La partida no dispone de membresía Authoring completa en una generación canónica.");
  }
  const map: Record<string, Set<number>> = {};
  for (const group of selection.groups) {
    const matches = models.filter(m => m.modelId && sameContext(m.bimContext, group.context));
    if (matches.length !== 1) throw new Error("Carga exactamente la revisión IFC de la partida; contexto ausente, distinto o duplicado.");
    const model = matches[0];
    if (!model.runtimeModel.getItemsIdsWithGeometry) throw new Error("No se puede verificar la geometría del modelo cargado.");
    const available = new Set(await model.runtimeModel.getItemsIdsWithGeometry());
    const targets = map[model.modelId!] ?? new Set<number>();
    for (const element of group.authoringElements) for (const id of element.graphicalLocalIds) {
      if (!Number.isSafeInteger(id) || id <= 0 || !available.has(id)) {
        throw new Error("La geometría cargada no contiene todos los miembros gráficos de la partida.");
      }
      targets.add(id);
    }
    if (targets.size) map[model.modelId!] = targets;
  }
  return map;
}
