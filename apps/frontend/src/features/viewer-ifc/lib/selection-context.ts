import type { ModelIdMap } from '@thatopen/components';

type Model = {
  getItemsIdsWithGeometry(): Promise<number[]>;
  setOpacity(ids: number[], value: number): Promise<void>;
  resetOpacity(ids: number[]): Promise<void>;
};
/** Presentation only. Serialized deltas converge after an in-flight opacity operation. */
export function createSelectionContext(driver: {
  models(): Iterable<[string, Model]>;
  hidden(): Promise<Record<string, number[]>>;
  refresh(): Promise<void>;
}, chunkSize = 450) {
  let selection: ModelIdMap = {}, context: ModelIdMap = {};
  let revision = 0, appliedRevision = -1, disposed = false;
  let running: Promise<void> | undefined;
  const applied = new Map<string, Set<number>>();
  const clone = (map: ModelIdMap) => Object.fromEntries(Object.entries(map).map(([id, ids]) => [id, new Set(ids)]));
  async function drain() {
    while (!disposed) {
      const version = revision;
      const activeSelection = Object.values(selection).some(ids => ids.size);
      const activeContext = Object.values(context).some(ids => ids.size);
      const hidden = await driver.hidden();
      for (const [id, model] of driver.models()) {
        const invisible = new Set(hidden[id] ?? []);
        const universe = activeSelection || activeContext ? await model.getItemsIdsWithGeometry() : [];
        const target = new Set(universe.filter(localId => !invisible.has(localId) && !selection[id]?.has(localId) &&
          (activeSelection || (activeContext && !context[id]?.has(localId)))));
        const actual = applied.get(id) ?? new Set<number>(); applied.set(id, actual);
        for (const ghosted of [false, true]) {
          const delta = [...(ghosted ? target : actual)].filter(localId => !(ghosted ? actual : target).has(localId));
          for (let i = 0; i < delta.length; i += chunkSize) {
            if (disposed || revision !== version) break;
            const batch = delta.slice(i, i + chunkSize);
            if (ghosted) await model.setOpacity(batch, 0.16); else await model.resetOpacity(batch);
            for (const localId of batch) { if (ghosted) actual.add(localId); else actual.delete(localId); }
          }
        }
        if (disposed || revision !== version) break;
      }
      if (disposed) return;
      if (revision !== version) continue;
      await driver.refresh();
      if (revision === version) { appliedRevision = version; return; }
    }
  }
  function reconcile(): Promise<void> {
    revision++;
    if (!running) running = drain().finally(() => { running = undefined; });
    return running.then(() => !disposed && appliedRevision !== revision ? reconcile() : undefined);
  }
  return {
    setSelection(map: ModelIdMap) { selection = clone(map); return reconcile(); },
    setContext(map: ModelIdMap) { context = clone(map); return reconcile(); },
    clearContext() { context = {}; return reconcile(); },
    clearAll() { selection = {}; context = {}; return reconcile(); },
    reconcile,
    dispose() { disposed = true; revision++; applied.clear(); }
  };
}
