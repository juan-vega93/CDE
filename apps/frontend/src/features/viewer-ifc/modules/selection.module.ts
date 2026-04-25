import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as OBF from "@thatopen/components-front";

type SetupSelectionParams = {
  components: OBC.Components;
  world: OBC.World;
};

export function setupSelection({ components, world }: SetupSelectionParams) {
  components.get(OBC.Raycasters).get(world);

  const highlighter = components.get(OBF.Highlighter);
  const fragments = components.get(OBC.FragmentsManager);

  async function refreshFragments() {
    await fragments.core.update(true);
  }

  async function getSelectedContainmentData(): Promise<Record<string, unknown>[]> {
    const modelIdMap = getSelectionModelIdMap();
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
    const modelIdMap = getSelectionModelIdMap();
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
      color: new THREE.Color("#bcf124"),
      opacity: 1,
      transparent: false,
      renderedFaces: 0
    }
  });

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
    highlighter.clear("select");
    await refreshFragments();
  }

  async function getSelectedItemsData(): Promise<Record<string, unknown>[]> {
    const modelIdMap = getSelectionModelIdMap();
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
          },
          ContainedInStructure: {
            attributes: false,
            relations: false
          },
          HasAssociations: {
            attributes: false,
            relations: false
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
    getSelectedItemsData,
    getSelectedContainmentData,
    getSelectedAssociationsData,
    hasSelection,
    clearSelection
  };
}