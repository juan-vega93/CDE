import type { ViewerBimContext } from './viewer-bim-context';

/** Structural representation only; never expands authoring identity or spatial trees. */
export function createParameterGraphicsResolver(models: readonly {
  modelId?: string;
  bimContext?: ViewerBimContext;
  runtimeModel: { getItemsIdsWithGeometry?: () => Promise<number[]> | number[] };
}[], load?: (context: ViewerBimContext, ids: number[]) => Promise<Map<number, number[]>>) {
  const universes = new Map<string, Promise<Set<number>>>();
  const caches = new Map<string, Map<number, Promise<number[]>>>();
  const pending = new Map<string, Map<number, { resolve: (ids: number[]) => void; reject: (error: unknown) => void }>>();
  function delegated(context: ViewerBimContext, ids: number[]) {
    const key = JSON.stringify([context.projectCode, context.modelKey, context.revisionId]);
    const cache = caches.get(key) ?? new Map<number, Promise<number[]>>();
    caches.set(key, cache);
    for (const id of ids) {
      if (cache.has(id)) continue;
      let queue = pending.get(key);
      if (!queue) {
        queue = new Map(); pending.set(key, queue);
        // Bucket requests from one render share bounded HTTP batches, not one request per entity.
        queueMicrotask(() => {
          const entries = [...pending.get(key)!]; pending.delete(key);
          void (async () => {
            for (let offset = 0; offset < entries.length; offset += 2048) {
              const batch = entries.slice(offset, offset + 2048);
              try {
                const result = await load!(context, batch.map(([id]) => id));
                if (batch.some(([id]) => !result.has(id))) throw new Error('Incomplete graphical batch');
                for (const [id, callbacks] of batch) callbacks.resolve(result.get(id)!);
              } catch (error) {
                for (const [id, callbacks] of batch) { cache.delete(id); callbacks.reject(error); }
              }
            }
          })();
        });
      }
      cache.set(id, new Promise<number[]>((resolve, reject) => queue!.set(id, { resolve, reject })));
    }
    return Promise.all(ids.map(id => cache.get(id)!));
  }
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
        const context = candidates[0].bimContext;
        const missing = [...ids].filter(id => !graphical.has(id));
        if (context && load && missing.length) {
          const delegates = await delegated(context, missing);
          for (const group of delegates) for (const id of group) if (graphical.has(id)) targets.add(id);
        }
        if (targets.size) result[modelId] = targets;
      } catch (error) {
        universes.delete(modelId);
        throw error;
      }
    }
    return result;
  };
}
