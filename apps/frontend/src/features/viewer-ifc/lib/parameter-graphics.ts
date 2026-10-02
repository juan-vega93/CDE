/** Exact runtime membership: never expand a property bucket through spatial children. */
export function createParameterGraphicsResolver(models: readonly {
  modelId?: string;
  runtimeModel: { getItemsIdsWithGeometry?: () => Promise<number[]> | number[] };
}[]) {
  const universes = new Map<string, Promise<Set<number>>>();
  return async (membership: Record<string, Set<number>>): Promise<Record<string, Set<number>>> => {
    const result: Record<string, Set<number>> = {};
    for (const [modelId, ids] of Object.entries(membership)) {
      const candidates = models.filter((model) => model.modelId === modelId);
      if (candidates.length !== 1 || !candidates[0].runtimeModel.getItemsIdsWithGeometry) continue;
      let universe = universes.get(modelId);
      if (!universe) {
        universe = Promise.resolve(candidates[0].runtimeModel.getItemsIdsWithGeometry()).then((values) => new Set(values));
        universes.set(modelId, universe);
      }
      try {
        const graphical = await universe;
        const targets = new Set([...ids].filter((id) => graphical.has(id)));
        if (targets.size) result[modelId] = targets;
      } catch (error) {
        universes.delete(modelId);
        throw error;
      }
    }
    return result;
  };
}
