import * as OBC from "@thatopen/components";

type SetupVisibilityParams = {
  components: OBC.Components;
};

export function setupVisibility({ components }: SetupVisibilityParams) {
  const hider = components.get(OBC.Hider);
  const fragments = components.get(OBC.FragmentsManager);

  console.log("[viewer-ifc] Visibility module ready");

  async function refreshFragments() {
    await fragments.core.update(true);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await fragments.core.update(true);
  }

  async function hide(modelIdMap: OBC.ModelIdMap) {
    await hider.set(false, modelIdMap);
    await refreshFragments();
  }

  async function show(modelIdMap: OBC.ModelIdMap) {
    await hider.set(true, modelIdMap);
    await refreshFragments();
  }

  async function showAll() {
    await hider.set(true);
    await refreshFragments();
  }

  async function isolate(modelIdMap: OBC.ModelIdMap) {
    await hider.isolate(modelIdMap);
    await refreshFragments();
  }

  async function toggle(modelIdMap: OBC.ModelIdMap) {
    const hiddenMap = await hider.getVisibilityMap(false);

    const toHide: OBC.ModelIdMap = {};
    const toShow: OBC.ModelIdMap = {};

    for (const [modelId, ids] of Object.entries(modelIdMap)) {
      const hiddenIds = new Set(hiddenMap[modelId] ?? []);

      const hideSet = new Set<number>();
      const showSet = new Set<number>();

      for (const id of ids) {
        if (hiddenIds.has(id)) {
          showSet.add(id); // estaba oculto → mostrar
        } else {
          hideSet.add(id); // estaba visible → ocultar
        }
      }

      if (hideSet.size > 0) {
        toHide[modelId] = hideSet;
      }

      if (showSet.size > 0) {
        toShow[modelId] = showSet;
      }
    }

    if (Object.keys(toHide).length > 0) {
      await hider.set(false, toHide);
    }

    if (Object.keys(toShow).length > 0) {
      await hider.set(true, toShow);
    }

    await refreshFragments();
  }

  async function getHiddenMap(): Promise<Record<string, number[]>> {
    return hider.getVisibilityMap(false);
  }

  async function applyHiddenMap(hidden: Record<string, number[]>) {
    await hider.set(true);

    const modelIdMap: OBC.ModelIdMap = {};

    for (const [modelId, ids] of Object.entries(hidden)) {
      modelIdMap[modelId] = new Set(ids);
    }

    if (Object.keys(modelIdMap).length > 0) {
      await hider.set(false, modelIdMap);
    }

    await refreshFragments();
  }

  return {
    hide,
    show,
    showAll,
    isolate,
    getHiddenMap,
    applyHiddenMap,
    toggle
  };
}