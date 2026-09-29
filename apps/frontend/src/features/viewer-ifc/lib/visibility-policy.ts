export type VisibilityMap = Record<string, Set<number>>;
export type VisibilityDriver = {
  readHidden: () => Promise<Record<string, number[]>>;
  setVisible: (items: VisibilityMap, visible: boolean) => Promise<void>;
  refresh: () => Promise<void>;
};
const clone = (map: VisibilityMap): VisibilityMap =>
  Object.fromEntries(Object.entries(map).map(([model, ids]) => [model, new Set(ids)]));
export const parameterVisibilityKey = (set: string, property: string, value: string) =>
  `parameter:${JSON.stringify([set, property, value])}`;

/** Viewer-lifetime policy: visible sets intersect, hidden sets unite.
 * Serialized writes converge to the latest intention, independently of render cancellation.
 */
export function createVisibilityPolicy(driver: VisibilityDriver, chunkSize = 450) {
  const layers = new Map<string, VisibilityMap>();
  const intentions = new Map<string, object>();
  const listeners = new Set<() => void>();
  let snapshot: ReadonlySet<string> = new Set();
  let revision = 0;
  let appliedRevision = -1;
  let disposed = false;
  let running: Promise<void> | undefined;

  function changed() {
    revision += 1;
    snapshot = new Set(intentions.keys());
    for (const listener of listeners) listener();
  }
  function desiredHidden() {
    const result: VisibilityMap = {};
    for (const layer of layers.values()) {
      for (const [model, ids] of Object.entries(layer)) {
        const target = result[model] ??= new Set();
        for (const id of ids) target.add(id);
      }
    }
    return result;
  }
  async function drain() {
    // Reread actual state after errors or external model lifecycle changes.
    const actual: VisibilityMap = Object.fromEntries(
      Object.entries(await driver.readHidden()).map(([model, ids]) => [model, new Set(ids)])
    );
    while (true) {
      if (disposed) return;
      const version = revision;
      const target = desiredHidden();
      let stale = false;
      for (const visible of [false, true]) {
        const from = visible ? actual : target;
        const other = visible ? target : actual;
        for (const [model, ids] of Object.entries(from)) {
          const delta = [...ids].filter((id) => !other[model]?.has(id));
          for (let offset = 0; offset < delta.length; offset += chunkSize) {
            if (disposed) return;
            if (revision !== version) { stale = true; break; }
            const batch = delta.slice(offset, offset + chunkSize);
            await driver.setVisible({ [model]: new Set(batch) }, visible);
            const applied = actual[model] ??= new Set();
            for (const id of batch) {
              if (visible) applied.delete(id);
              else applied.add(id);
            }
          }
          if (stale) break;
        }
        if (stale) break;
      }
      if (stale || revision !== version) continue;
      await driver.refresh();
      if (revision === version) { appliedRevision = version; return; }
    }
  }
  function reconcile(): Promise<void> {
    if (disposed) return Promise.resolve();
    if (!running) running = drain().finally(() => { running = undefined; });
    // An intention can arrive between drain's last check and its finally microtask.
    return running.then(() => appliedRevision === revision ? undefined : reconcile());
  }
  function setLayer(key: string, items: VisibilityMap) {
    if (disposed) return Promise.resolve();
    intentions.set(key, {});
    layers.set(key, clone(items));
    changed();
    return reconcile();
  }
  async function resolveLayer(key: string, resolve: () => Promise<VisibilityMap>) {
    if (disposed) return;
    const intention = {};
    intentions.set(key, intention);
    changed();
    try {
      const items = await resolve();
      if (intentions.get(key) !== intention) return;
      layers.set(key, clone(items));
      changed();
      await reconcile();
    } catch (error) {
      if (intentions.get(key) === intention) {
        intentions.delete(key);
        layers.delete(key);
        changed();
        await reconcile();
      }
      throw error;
    }
  }
  function clearLayers(prefix: string) {
    for (const key of intentions.keys()) {
      if (!key.startsWith(prefix)) continue;
      intentions.delete(key);
      layers.delete(key);
    }
    changed();
    return reconcile();
  }
  function clearLayer(key: string) {
    intentions.delete(key);
    layers.delete(key);
    changed();
    return reconcile();
  }
  function setManual(items: VisibilityMap, visible: boolean) {
    const next = clone(layers.get("manual") ?? {});
    for (const [model, ids] of Object.entries(items)) {
      const target = next[model] ??= new Set();
      for (const id of ids) {
        if (visible) target.delete(id);
        else target.add(id);
      }
    }
    return setLayer("manual", next);
  }
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
    dispose: () => {
      disposed = true;
      intentions.clear();
      layers.clear();
      listeners.clear();
    },
    reconcile, setLayer, resolveLayer, clearLayers, clearLayer,
    hide: (items: VisibilityMap) => setManual(items, false),
    show: (items: VisibilityMap) => setManual(items, true),
    toggle: (items: VisibilityMap) => {
      const hidden = desiredHidden();
      const next = clone(layers.get("manual") ?? {});
      for (const [model, ids] of Object.entries(items)) {
        const target = next[model] ??= new Set();
        for (const id of ids) {
          if (hidden[model]?.has(id)) target.delete(id);
          else target.add(id);
        }
      }
      return setLayer("manual", next);
    },
    toggleBucket: (key: string, resolve: () => Promise<VisibilityMap>) =>
      intentions.has(key) ? clearLayer(key) : resolveLayer(key, resolve),
    clearParameters: () => clearLayers("parameter:"),
    clearFocus: () => clearLayers("focus"),
    showAll: () => clearLayers(""),
    getHiddenMap: async () => {
      await reconcile();
      return driver.readHidden();
    }
  };
}
export type VisibilityPolicy = ReturnType<typeof createVisibilityPolicy>;
