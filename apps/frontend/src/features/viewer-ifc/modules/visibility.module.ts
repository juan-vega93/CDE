import * as OBC from "@thatopen/components";
import { createVisibilityPolicy, type VisibilityMap } from "../lib/visibility-policy";

export function setupVisibility({ components }: { components: OBC.Components }) {
  const hider = components.get(OBC.Hider);
  const fragments = components.get(OBC.FragmentsManager);
  const policy = createVisibilityPolicy({
    readHidden: () => hider.getVisibilityMap(false),
    setVisible: async (items, visible) => {
      for (const [modelId, ids] of Object.entries(items)) {
        await fragments.list.get(modelId)?.setVisible([...ids], visible);
      }
    },
    refresh: async () => { await fragments.core.update(true); }
  });

  async function excluded(items: VisibilityMap, universe?: VisibilityMap) {
    const hidden: VisibilityMap = {};
    for (const [modelId, model] of fragments.list) {
      const ids = universe?.[modelId] ?? await model.getLocalIds();
      hidden[modelId] = new Set([...ids].filter((id) => !items[modelId]?.has(id)));
    }
    return hidden;
  }

  return {
    ...policy,
    setModelVisible: (modelId: string, visible: boolean) => {
      const key = `model:${modelId}`;
      return visible ? policy.clearLayer(key) : policy.resolveLayer(key, async () => ({
        [modelId]: new Set(await fragments.list.get(modelId)?.getLocalIds() ?? [])
      }));
    },
    isolate: (items: VisibilityMap) =>
      policy.resolveLayer("focus", () => excluded(items)),
    showOnly: (items: VisibilityMap, universe: VisibilityMap) =>
      policy.resolveLayer("focus", () => excluded(items, universe)),
    applyHiddenMap: (hidden: Record<string, number[]>) =>
      policy.setLayer("focus", Object.fromEntries(
        Object.entries(hidden).map(([model, ids]) => [model, new Set(ids)])
      ))
  };
}
