import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";
import { attachLogicalAuthoringSelection } from "../lib/logical-authoring-selection";
import { resolveAuthoringSelection } from "../lib/resolve-authoring-selection";
import type { ViewerBimContext } from "../lib/viewer-bim-context";

type SetupSelectionParams = {
  components: OBC.Components;
  world: OBC.World;
};

export function setupSelection({ components, world }: SetupSelectionParams) {
  components.get(OBC.Raycasters).get(world);

  const highlighter = components.get(OBF.Highlighter);
  const fragments = components.get(OBC.FragmentsManager);
  let getBimContext: (runtimeModelId: string) => ViewerBimContext | undefined = () => undefined;

  async function refreshFragments() {
    await fragments.core.update(true);
  }

  async function getSelectedContainmentData(): Promise<Record<string, unknown>[]> {
    const modelIdMap = getPropertiesModelIdMap();
    const results: Record<string, unknown>[] = [];

    for (const [modelId, localIds] of Object.entries(modelIdMap)) {
      const model = fragments.list.get(modelId);
      if (!model) continue;

      const ids = [...localIds];
      if (ids.length === 0) continue;

      const itemsData = await model.getItemsData(ids, {
        attributesDefault: false,
        relations: {
          ContainedInStructure: {
            attributes: true,
            relations: true
          }
        }
      });

      for (const item of itemsData) {
        const normalizedItem = item as unknown as Record<string, unknown>;
        results.push(normalizedItem);
      }
    }

    return results;
  }

  async function getSelectedAssociationsData(): Promise<Record<string, unknown>[]> {
    const modelIdMap = getPropertiesModelIdMap();
    const results: Record<string, unknown>[] = [];

    for (const [modelId, localIds] of Object.entries(modelIdMap)) {
      const model = fragments.list.get(modelId);
      if (!model) continue;

      const ids = [...localIds];
      if (ids.length === 0) continue;

      const itemsData = await model.getItemsData(ids, {
        attributesDefault: false,
        relations: {
          HasAssociations: {
            attributes: true,
            relations: true
          }
        }
      });

      for (const item of itemsData) {
        const normalizedItem = item as unknown as Record<string, unknown>;
        results.push(normalizedItem);
      }
    }

    return results;
  }

  highlighter.setup({
    world,
    selectMaterialDefinition: {
      color: new THREE.Color("#e30613"),
      opacity: 1,
      transparent: false,
      renderedFaces: 0
    }
  });

  const logicalSelection = attachLogicalAuthoringSelection({
    highlighter,
    resolve: resolveAuthoringSelection,
    pick: async () => {
      // The public declaration also covers plain Three intersections; only a
      // Fragments hit has the runtime identity used by Highlighter.highlight.
      const hit = await components.get(OBC.Raycasters).get(world).castRay() as
        (THREE.Intersection & { localId?: number; fragments?: { modelId: string } }) | null;
      return typeof hit?.localId !== "number" || !hit.fragments?.modelId
        ? undefined : { runtimeModelId: hit.fragments.modelId, localId: hit.localId };
    },
    getContext: (id) => fragments.list.has(id) ? getBimContext(id) : undefined,
    reportError: (error) => console.warn("[viewer-ifc] Authoring selection resolution failed:", error)
  });
  const canvas = world.renderer?.three.domElement;
  canvas?.addEventListener("mouseup", logicalSelection.onMouseUp, true);

  function getPropertiesModelIdMap(): OBC.ModelIdMap {
    return logicalSelection.getPrimaryModelIdMap() ?? getSelectionModelIdMap();
  }

  highlighter.events.select.onHighlight.add(() => {
    void refreshFragments();
  });

  highlighter.events.select.onClear.add(() => {
    void refreshFragments();
  });

  function getSelectionModelIdMap(): OBC.ModelIdMap {
    const result: OBC.ModelIdMap = {};
    const selection = highlighter.selection.select;

    for (const [modelId, ids] of Object.entries(selection)) {
      result[modelId] = new Set(ids);
    }

    return result;
  }

  function hasSelection(): boolean {
    return Object.keys(highlighter.selection.select).length > 0;
  }

  async function clearSelection() {
    await highlighter.clear("select");
    await refreshFragments();
  }

  async function getSelectedItemsData(): Promise<Record<string, unknown>[]> {
    const modelIdMap = getPropertiesModelIdMap();
    const results: Record<string, unknown>[] = [];

    for (const [modelId, localIds] of Object.entries(modelIdMap)) {
      const model = fragments.list.get(modelId);
      if (!model) continue;

      const ids = [...localIds];
      if (ids.length === 0) continue;

      const itemsData = await model.getItemsData(ids, {
        attributesDefault: true,
        relations: {
          IsDefinedBy: {
            attributes: true,
            relations: true
          },
          IsTypedBy: {
            attributes: true,
            relations: true
          }
        }
      });

      for (const item of itemsData) {
        const normalizedItem = item as unknown as Record<string, unknown>;

        results.push({
          ...normalizedItem,
          __modelId: modelId,
          __modelName:
            (model as unknown as { name?: string; uuid?: string }).name ?? modelId
        });
      }
    }

    return results;
  }

  return {
    highlighter,
    getSelectionModelIdMap,
    getPropertiesModelIdMap,
    getLogicalSelection: logicalSelection.getLogicalSelection,
    getLogicalIdentities: logicalSelection.getLogicalIdentities,
    selectLogical: logicalSelection.selectLogical,
    setBimContextResolver(resolver: typeof getBimContext) {
      getBimContext = resolver;
    },
    dispose() {
      canvas?.removeEventListener("mouseup", logicalSelection.onMouseUp, true);
      logicalSelection.dispose();
    },
    getSelectedItemsData,
    getSelectedContainmentData,
    getSelectedAssociationsData,
    hasSelection,
    clearSelection
  };
}
