import type { ModelIdMap } from '@thatopen/components';

type Model = {
  getItemsIdsWithGeometry(): Promise<number[]>;
  setOpacity(ids: number[], value: number): Promise<void>;
  resetOpacity(ids: number[]): Promise<void>;
};
/** Presentation only. The desired opacity is authoritative; material owners can reset overrides. */
export function createSelectionContext(driver: {
  models(): Iterable<[string, Model]>;
  hidden(): Promise<Record<string, number[]>>;
  refresh(): Promise<void>;
}, chunkSize = 450) {
  let selection: ModelIdMap = {}, context: ModelIdMap = {};
  let revision = 0, appliedRevision = -1, disposed = false;
  let running: Promise<void> | undefined;
  let materialWriters = 0;
  let materialQueue: Promise<void> = Promise.resolve();
  const applied = new Map<string, Set<number>>();
  const clone = (map: ModelIdMap) => Object.fromEntries(Object.entries(map).map(([id, ids]) => [id, new Set(ids)]));
  async function drain() {
    while (!disposed && materialWriters === 0) {
      const version = revision;
      const models = new Map(driver.models());
      for (const id of applied.keys()) if (!models.has(id)) applied.delete(id);
      const activeSelection = Object.entries(selection).some(([id, ids]) => models.has(id) && ids.size);
      const activeContext = Object.entries(context).some(([id, ids]) => models.has(id) && ids.size);
      const hidden = await driver.hidden();
      for (const [id, model] of models) {
        const invisible = new Set(hidden[id] ?? []);
        const universe = activeSelection || activeContext ? await model.getItemsIdsWithGeometry() : [];
        const target = new Set(universe.filter(localId => !invisible.has(localId) && !selection[id]?.has(localId) &&
          (activeSelection || (activeContext && !context[id]?.has(localId)))));
        const actual = applied.get(id) ?? new Set<number>(); applied.set(id, actual);
        for (const ghosted of [false, true]) {
          // Material rebuilds explicitly invalidate their affected IDs below.
          // Unaffected overrides remain owned; reapplying them allocates a new
          // non-deduplicated Fragments material for every mesh on every selection.
          const delta = ghosted ? [...target].filter(localId=>!actual.has(localId)) : [...actual].filter(localId => !target.has(localId));
          for (let i = 0; i < delta.length; i += chunkSize) {
            if (disposed || revision !== version) break;
            if (!new Map(driver.models()).has(id)) { applied.delete(id); break; }
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
    if(materialWriters) return Promise.resolve();
    if (!running) running = drain().finally(() => { running = undefined; });
    return running.then(() => !disposed && !materialWriters && appliedRevision !== revision ? reconcile() : undefined);
  }
  return {
    setSelection(map: ModelIdMap) { selection = clone(map); return reconcile(); },
    setContext(map: ModelIdMap) { context = clone(map); return reconcile(); },
    clearContext() { context = {}; return reconcile(); },
    clearAll() { selection = {}; context = {}; return reconcile(); },
    reconcile,
    async rebuildMaterials(write:()=>Promise<ModelIdMap | void>, deferPresentation:()=>boolean) {
      materialWriters++; revision++;
      const operation=materialQueue.then(async()=>{
        await running;
        if(disposed)return;
        const changed=await write();
        if(!changed)applied.clear();
        else for(const [id,ids] of Object.entries(changed))for(const localId of ids)applied.get(id)?.delete(localId);
      });
      materialQueue=operation.catch(()=>{});
      try {
        await operation;
      } finally {
        materialWriters--;
      }
      if(!deferPresentation()) await reconcile();
    },
    dispose() { disposed = true; revision++; applied.clear(); }
  };
}
