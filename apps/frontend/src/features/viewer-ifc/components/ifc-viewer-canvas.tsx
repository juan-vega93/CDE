"use client";
import { useSession } from "next-auth/react";
import type { BcfTopic } from "@/features/viewer-ifc/types/bcf-topic";
import { captureViewerSnapshot } from "@/features/viewer-ifc/lib/viewpoint-snapshot";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { createWorld } from "@/features/viewer-ifc/lib/create-world";
import { loadViewerModel } from "@/features/viewer-ifc/lib/load-ifc-model";
import {
  resolveViewerSource,
  type ViewerSource
} from "@/features/viewer-ifc/lib/resolve-viewer-source";
import { setupViewerModules } from "@/features/viewer-ifc/modules";
import { IfcViewerToolbar } from "@/features/viewer-ifc/components/ifc-viewer-toolbar";
import { IfcViewpointsPanel } from "@/features/viewer-ifc/components/ifc-viewpoints-panel";
import { IfcSelectedPropertiesPanel } from "@/features/viewer-ifc/components/ifc-selected-properties-panel";
import { IfcModelSelector } from "@/features/viewer-ifc/components/ifc-model-selector";
import {
  applyViewpoint,
  captureViewpoint,
  fitObjectInView,
  fitSelectionInView
} from "@/features/viewer-ifc/lib/viewpoints";
import {
  getViewpoints as fetchViewpoints,
  saveViewpoints as persistViewpoints
} from "@/services/viewpoints.service";
import type { ViewerViewpoint } from "@/features/viewer-ifc/types/viewpoint";

type IfcViewerCanvasProps = {
  sources: ViewerSource[];
  documentNames?: string[];
  documentPaths?: string[];
};

type ViewerRuntime = ReturnType<typeof createWorld>;
type LoadedViewerModelResult = Awaited<ReturnType<typeof loadViewerModel>>;

type FederatedModelEntry = {
  key: string;
  name: string;
  source: ViewerSource;
  object: THREE.Object3D<THREE.Object3DEventMap>;
  visible: boolean;
  expanded: boolean;
  isolated?: boolean;
  isSelected?: boolean;
  modelId?: string;
};
type RightPanelTab = "properties" | "models" | "viewpoints" | "topics";

function getParentFolderPath(documentPath?: string) {
  if (!documentPath) return "/documents";
  const clean = documentPath.trim();
  const index = clean.lastIndexOf("/");
  if (index <= 0) return "/documents";
  const parent = clean.slice(0, index);
  return `/documents?path=${encodeURIComponent(parent || "/")}`;
}

function cloneModelIdMap(modelIdMap: OBC.ModelIdMap): OBC.ModelIdMap {
  const clone: OBC.ModelIdMap = {};

  for (const [modelId, ids] of Object.entries(modelIdMap)) {
    clone[modelId] = new Set(ids);
  }

  return clone;
}

function getSelectionCacheKey(modelIdMap: OBC.ModelIdMap) {
  return Object.entries(modelIdMap)
    .map(([modelId, ids]) => {
      const sortedIds = Array.from(ids).sort((a, b) => a - b);
      return `${modelId}:${sortedIds.join(",")}`;
    })
    .sort()
    .join("|");
}

function getDisplayNameFromSource(
  source: ViewerSource,
  fallback?: string,
  index?: number
) {
  if (fallback?.trim()) return fallback.trim();
  if (source.documentName?.trim()) return source.documentName.trim();

  const fromUrl = decodeURIComponent(source.modelUrl.split("/").pop() || "")
    .split("?")[0]
    .trim();

  if (fromUrl) return fromUrl;

  return `Modelo ${typeof index === "number" ? index + 1 : ""}`.trim();
}

function getSourceKey(source: ViewerSource) {
  return source.documentPath ?? source.modelUrl;
}

function ModelVisibilityButton({
  visible,
  onClick
}: {
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
      title={visible ? "Ocultar modelo" : "Mostrar modelo"}
      aria-label={visible ? "Ocultar modelo" : "Mostrar modelo"}
    >
      {visible ? "👁" : "🚫"}
    </button>
  );
}

function ExpandButton({
  expanded,
  onClick
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
      title={expanded ? "Colapsar" : "Expandir"}
      aria-label={expanded ? "Colapsar" : "Expandir"}
    >
      {expanded ? "▾" : "▸"}
    </button>
  );
}

function IfcModelsPanel({
  models,
  onToggleModelVisibility,
  onToggleModelExpanded,
  onRemoveModel,
  onFocusModel,
  onIsolateModel
}: {
  models: FederatedModelEntry[];
  onToggleModelVisibility: (key: string) => void;
  onToggleModelExpanded: (key: string) => void;
  onRemoveModel: (key: string) => void;
  onFocusModel: (key: string) => void;
  onIsolateModel: (key: string) => void;
}) {
  return (
    <section className="border-b border-zinc-300 bg-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-300 bg-zinc-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-zinc-800">Modelos</h3>
        <span className="text-xs text-zinc-500">{models.length}</span>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {models.length === 0 ? (
          <div className="px-3 py-3 text-sm text-zinc-500">
            Aún no hay modelos cargados.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {models.map((model) => (
              <div key={model.key} className="bg-white">
                <div
                  className={`flex items-center gap-2 px-3 py-2 ${
                    model.isSelected ? "bg-amber-50" : ""
                  }`}
                >
                  <ExpandButton
                    expanded={model.expanded}
                    onClick={() => onToggleModelExpanded(model.key)}
                  />

                  <ModelVisibilityButton
                    visible={model.visible}
                    onClick={() => onToggleModelVisibility(model.key)}
                  />

                  <button
                    type="button"
                    onClick={() => onFocusModel(model.key)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
                    title="Enfocar modelo"
                    aria-label="Enfocar modelo"
                  >
                    ⊕
                  </button>

                  <button
                    type="button"
                    onClick={() => onIsolateModel(model.key)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
                    title="Aislar modelo"
                    aria-label="Aislar modelo"
                  >
                    ◉
                  </button>

                  <button
                    type="button"
                    onClick={() => onRemoveModel(model.key)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
                    title="Quitar modelo"
                    aria-label="Quitar modelo"
                  >
                    ✕
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-800">
                      {model.name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {model.source.kind.toUpperCase()}
                    </div>
                  </div>
                </div>

                {model.expanded ? (
                  <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="space-y-2 pl-2">
                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">└</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Archivo</div>
                          <div className="break-all text-zinc-500">
                            {model.name}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">└</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Formato</div>
                          <div className="text-zinc-500">
                            {model.source.kind === "frag" ? "FRAG" : "IFC"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">└</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Ruta</div>
                          <div className="break-all text-zinc-500">
                            {model.source.documentPath ?? "-"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">└</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Visibilidad</div>
                          <div className="text-zinc-500">
                            {model.visible ? "Visible" : "Oculto"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function IfcViewerCanvas({
  sources,
  documentNames = [],
  documentPaths = []
}: IfcViewerCanvasProps) {
  const { data: session } = useSession();

  const currentAuthor =
    session?.user?.name ||
    session?.user?.email ||
    "Usuario";   
  const [newComment, setNewComment] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [topics, setTopics] = useState<BcfTopic[]>([]);
  const [isTopicDetailOpen, setIsTopicDetailOpen] = useState(false);
  const rendererRef = useRef<unknown>(null);
  const initialSourcesRef = useRef(sources);
  const initialDocumentNamesRef = useRef(documentNames);
  const loadedSourceKeysRef = useRef<Set<string>>(new Set());

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerFrameRef = useRef<HTMLDivElement | null>(null);
  const modulesRef = useRef<ReturnType<typeof setupViewerModules> | null>(null);
  const viewerRef = useRef<ViewerRuntime | null>(null);
  const modelsGroupRef = useRef<THREE.Group | null>(null);
  const selectionDataTimeoutRef = useRef<number | null>(null);
  const propertiesCacheRef = useRef<Map<string, Record<string, unknown>[]>>(
    new Map()
  );
  const loadedModelResultsRef = useRef<LoadedViewerModelResult[]>([]);
  const lastSectionBoxSelectionRef = useRef<OBC.ModelIdMap | null>(null);
  const lastColoredSelectionRef = useRef<OBC.ModelIdMap | null>(null);

  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("properties");
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [status, setStatus] = useState("Inicializando visor...");
  const [viewpoints, setViewpoints] = useState<ViewerViewpoint[]>([]);
  const [viewpointsLoaded, setViewpointsLoaded] = useState(false);
  const [clipperEnabled, setClipperEnabled] = useState(false);
  const [selectedItemsData, setSelectedItemsData] = useState<
    Record<string, unknown>[]
  >([]);
  const [propertiesRequested, setPropertiesRequested] = useState(false);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectedColor, setSelectedColor] = useState("#ff7a00");
  const [sectionBoxPadding, setSectionBoxPadding] = useState(0.2);
  const [containmentData, setContainmentData] = useState<
    Record<string, unknown>[]
  >([]);
  const [associationsData, setAssociationsData] = useState<
    Record<string, unknown>[]
  >([]);
  const [containmentLoading, setContainmentLoading] = useState(false);
  const [associationsLoading, setAssociationsLoading] = useState(false);
  const [models, setModels] = useState<FederatedModelEntry[]>([]);

  const primaryDocumentPath = documentPaths[0] ?? sources[0]?.documentPath;
  const primaryDocumentName = documentNames[0] ?? sources[0]?.documentName;

  const backHref = useMemo(
    () => getParentFolderPath(primaryDocumentPath),
    [primaryDocumentPath]
  );

  const titleText = useMemo(() => {
    if (documentNames.length === 1 && documentNames[0]?.trim()) {
      return documentNames[0];
    }

    if (models.length === 1) {
      return models[0].name;
    }

    if (models.length > 1) {
      return `${models.length} modelos cargados`;
    }

    if (primaryDocumentName?.trim()) {
      return primaryDocumentName;
    }

    return "Visor federado";
  }, [documentNames, models, primaryDocumentName]);

  useEffect(() => {
    let cancelled = false;

    async function loadRemoteViewpoints() {
      if (!primaryDocumentPath) {
        setViewpoints([]);
        setViewpointsLoaded(true);
        return;
      }

      try {
        const data = await fetchViewpoints(primaryDocumentPath);
        if (!cancelled) {
          setViewpoints(data);
          setViewpointsLoaded(true);
        }
      } catch (error) {
        console.error("[viewer-ifc] Error loading viewpoints:", error);
        if (!cancelled) {
          setViewpoints([]);
          setViewpointsLoaded(true);
        }
      }
    }

    setViewpointsLoaded(false);
    void loadRemoteViewpoints();

    return () => {
      cancelled = true;
    };
  }, [primaryDocumentPath]);

  useEffect(() => {
    if (!primaryDocumentPath || !viewpointsLoaded) return;

    const timeout = window.setTimeout(() => {
      const viewpointsForStorage = viewpoints.map(({ snapshot, ...viewpoint }) => viewpoint);

      void persistViewpoints(primaryDocumentPath, viewpointsForStorage).catch((error) => {
        console.error("[viewer-ifc] Error saving viewpoints:", error);
      });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [viewpoints, primaryDocumentPath, viewpointsLoaded]);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) return;

    let components: OBC.Components | null = null;
    let handleResize: (() => void) | null = null;
    let workerUrls: string[] = [];
    let disposed = false;
    let viewport: HTMLElement | null = null;
    let handleViewportDoubleClick: (() => void) | null = null;

    const currentSelectionTimeoutRef = selectionDataTimeoutRef;
    const currentPropertiesCacheRef = propertiesCacheRef;
    const currentLoadedModelResultsRef = loadedModelResultsRef;
    const currentLoadedSourceKeysRef = loadedSourceKeysRef;
    const currentLastSectionBoxSelectionRef = lastSectionBoxSelectionRef;
    const currentLastColoredSelectionRef = lastColoredSelectionRef;

    const setup = async () => {
      try {
        setStatus("Cargando UI...");

        const BUI = await import("@thatopen/ui");
        if (disposed) return;

        hostElement.innerHTML = "";
        BUI.Manager.init();
        
        viewport = document.createElement("bim-viewport");
        viewport.style.width = "100%";
        viewport.style.height = "100%";
        viewport.style.display = "block";

        hostElement.appendChild(viewport);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        if (disposed) return;

        setStatus("Creando escena...");

        const viewer = createWorld(viewport);
        components = viewer.components;
        viewerRef.current = viewer;

        const world = viewer.world;
        const renderer = viewer.renderer;
        rendererRef.current = renderer;
        const camera = viewer.camera;
        const initialSources = initialSourcesRef.current;
        const initialDocumentNames = initialDocumentNamesRef.current;

        const modelsGroup = new THREE.Group();
        modelsGroup.name = "federated-models-group";
        world.scene.three.add(modelsGroup);
        modelsGroupRef.current = modelsGroup;

        handleResize = () => {
          renderer.resize();
          camera.updateAspect();

          const rendererWithDirty = renderer as typeof renderer & {
            needsUpdate?: boolean;
          };
          rendererWithDirty.needsUpdate = true;
        };

        window.addEventListener("resize", handleResize);

        const modules = setupViewerModules({
          components,
          world
        });

        modulesRef.current = modules;

        modules.selection.highlighter.events.select.onHighlight.add(() => {
          const map = modules.selection.getSelectionModelIdMap();
          const hasAnySelection = Object.keys(map).length > 0;
          const selectedModelIds = new Set(Object.keys(map));

          setModels((prev) =>
            prev.map((model) => ({
              ...model,
              isSelected: model.modelId ? selectedModelIds.has(model.modelId) : false,
              expanded:
                model.modelId && selectedModelIds.has(model.modelId)
                  ? true
                  : model.expanded
            }))
          );

          setHasSelection(hasAnySelection);

          if (selectionDataTimeoutRef.current !== null) {
            window.clearTimeout(selectionDataTimeoutRef.current);
            selectionDataTimeoutRef.current = null;
          }

          if (!hasAnySelection) return;

          setPropertiesRequested(false);
          setPropertiesLoading(false);
          setContainmentData([]);
          setAssociationsData([]);

          const selectedCount = Object.values(map).reduce((total, ids) => {
            return total + ids.size;
          }, 0);

          if (selectedCount > 25) {
            setStatus(`Selección múltiple: ${selectedCount} elementos`);
          }
        });

        modules.selection.highlighter.events.select.onClear.add(() => {
          if (selectionDataTimeoutRef.current !== null) {
            window.clearTimeout(selectionDataTimeoutRef.current);
            selectionDataTimeoutRef.current = null;
          }
          setModels((prev) =>
            prev.map((model) => ({
              ...model,
              isSelected: false
            }))
          );

          setHasSelection(false);
          setSelectedItemsData([]);
          setPropertiesRequested(false);
          setPropertiesLoading(false);
          setContainmentData([]);
          setAssociationsData([]);
          setContainmentLoading(false);
          setAssociationsLoading(false);
        });

        handleViewportDoubleClick = () => {
          modules.clipper.create();
          requestViewerRefresh();
        };

        viewport.addEventListener("dblclick", handleViewportDoubleClick);

        if (!initialSources.length) {
          setStatus("No hay modelos para cargar");
          return;
        }

        setStatus(
          initialSources.length > 1
            ? `Cargando ${initialSources.length} modelos...`
            : initialSources[0]?.kind === "frag"
            ? "Cargando modelo FRAG..."
            : "Cargando modelo IFC..."
        );

        const loadedEntries: FederatedModelEntry[] = [];
        currentLoadedModelResultsRef.current = [];
        currentLoadedSourceKeysRef.current = new Set();
        workerUrls = [];

        for (let index = 0; index < initialSources.length; index += 1) {
          const currentSource = initialSources[index];
          const currentName = getDisplayNameFromSource(
            currentSource,
            initialDocumentNames[index],
            index
          );

          const result = await loadViewerModel({
            components,
            world,
            source: currentSource,
            modelName: currentName
          });

          currentLoadedModelResultsRef.current.push(result);

          if (result.workerUrl) {
            workerUrls.push(result.workerUrl);
          }

          const object = result.model.object as THREE.Object3D<THREE.Object3DEventMap>;
          object.name = currentName;

          if (object.parent && object.parent !== modelsGroup) {
            object.parent.remove(object);
          }

          modelsGroup.add(object);

          loadedEntries.push({
            key: `${currentName}-${index}`,
            name: currentName,
            source: currentSource,
            object,
            visible: true,
            expanded: index === 0,
            isolated: false,
            isSelected: false,
            modelId:
              "modelId" in result.model
                ? String(result.model.modelId)
                : undefined
          });

          currentLoadedSourceKeysRef.current.add(getSourceKey(currentSource));
        }

        setModels(loadedEntries);

        if (loadedEntries.length > 0) {
          await fitObjectInView(viewer, modelsGroup);
        }

        renderer.resize();
        camera.updateAspect();

        const rendererWithDirty = renderer as typeof renderer & {
          needsUpdate?: boolean;
        };
        rendererWithDirty.needsUpdate = true;

        setStatus(
          loadedEntries.length > 1
            ? `${loadedEntries.length} modelos cargados`
            : initialSources[0]?.kind === "frag"
            ? "FRAG cargado"
            : "IFC cargado"
        );
      } catch (error) {
        console.error("Error inicializando IfcViewerCanvas:", error);
        setStatus(
          error instanceof Error
            ? `Error: ${error.message}`
            : "Error desconocido cargando el visor"
        );
      }
    };

    void setup();

    return () => {
      disposed = true;
      modulesRef.current = null;
      viewerRef.current = null;
      rendererRef.current = null;
      modelsGroupRef.current = null;
      currentLoadedModelResultsRef.current = [];
      currentLoadedSourceKeysRef.current = new Set();
      currentPropertiesCacheRef.current.clear();
      currentLastSectionBoxSelectionRef.current = null;
      currentLastColoredSelectionRef.current = null;

      if (currentSelectionTimeoutRef.current !== null) {
        window.clearTimeout(currentSelectionTimeoutRef.current);
        currentSelectionTimeoutRef.current = null;
      }

      setClipperEnabled(false);
      setHasSelection(false);
      setSelectedItemsData([]);
      setPropertiesRequested(false);
      setPropertiesLoading(false);
      setContainmentData([]);
      setAssociationsData([]);
      setContainmentLoading(false);
      setAssociationsLoading(false);
      setModels([]);

      if (handleResize) {
        window.removeEventListener("resize", handleResize);
      }

      if (viewport && handleViewportDoubleClick) {
        viewport.removeEventListener("dblclick", handleViewportDoubleClick);
      }

      hostElement.replaceChildren();

      for (const workerUrl of workerUrls) {
        URL.revokeObjectURL(workerUrl);
      }

      if (components) {
        components.dispose();
      }
    };
  }, []);

  function requestViewerRefresh() {
    const viewer = viewerRef.current;
    if (!viewer) return;

    requestAnimationFrame(() => {
      try {
        const rendererWithDirty = viewer.renderer as typeof viewer.renderer & {
          needsUpdate?: boolean;
        };

        rendererWithDirty.needsUpdate = true;
        viewer.renderer.resize();
        viewer.camera.updateAspect();
      } catch (error) {
        console.error("[viewer-ifc] Error refreshing viewer:", error);
      }
    });
  }

  function handleToggleModelExpanded(key: string) {
    setModels((prev) =>
      prev.map((model) =>
        model.key === key ? { ...model, expanded: !model.expanded } : model
      )
    );
  }

  function handleToggleModelVisibility(key: string) {
    setModels((prev) =>
      prev.map((model) => {
        if (model.key !== key) return model;

        model.object.visible = !model.visible;
        return { ...model, visible: !model.visible };
      })
    );

    requestViewerRefresh();
  }

  async function handleFocusModel(key: string) {
  const viewer = viewerRef.current;
  const target = models.find((model) => model.key === key);

  if (!viewer || !target) return;

  try {
    await fitObjectInView(viewer, target.object);
    setStatus(`Modelo enfocado: ${target.name}`);
    requestViewerRefresh();
  } catch (error) {
    console.error("[viewer-ifc] Error focusing model:", error);
    setStatus("Error enfocando modelo. Revisa la consola.");
  }
}

async function handleIsolateModel(key: string) {
  const target = models.find((model) => model.key === key);
  if (!target) return;

  try {
    setModels((prev) =>
      prev.map((model) => {
        const shouldBeVisible = model.key === key;
        model.object.visible = shouldBeVisible;

        return {
          ...model,
          visible: shouldBeVisible,
          isolated: shouldBeVisible
        };
      })
    );

    setStatus(`Modelo aislado: ${target.name}`);
    requestViewerRefresh();
  } catch (error) {
    console.error("[viewer-ifc] Error isolating model:", error);
    setStatus("Error aislando modelo. Revisa la consola.");
  }
}

  function handleRemoveModel(key: string) {
    const target = models.find((model) => model.key === key);
    if (!target) return;

    try {
      if (target.object.parent) {
        target.object.parent.remove(target.object);
      }

      setModels((prev) => prev.filter((model) => model.key !== key));

      if (target.source) {
        const keyToDelete = getSourceKey(target.source);
        loadedSourceKeysRef.current.delete(keyToDelete);
      }

      setStatus(`Modelo quitado: ${target.name}`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error removing model:", error);
      setStatus("Error quitando modelo. Revisa la consola.");
    }
  }

  function handleOpenModelSelector() {
    setIsModelSelectorOpen(true);
  }

  function handleCloseModelSelector() {
    setIsModelSelectorOpen(false);
  }

  async function handleAddModelsIncrementally(
    selected: Array<{ path: string; name: string }>
  ) {
    const viewer = viewerRef.current;
    const modelsGroup = modelsGroupRef.current;

    if (!viewer || !modelsGroup) return;
    if (!selected.length) {
      setIsModelSelectorOpen(false);
      return;
    }

    setIsModelSelectorOpen(false);

    const resolvedSources = await Promise.all(
      selected.map((item) =>
        resolveViewerSource({
          documentPath: item.path,
          documentName: item.name
        })
      )
    );

    const pending = resolvedSources
      .map((source, index) => ({
        source,
        name:
          selected[index]?.name ||
          getDisplayNameFromSource(source, undefined, index)
      }))
      .filter(({ source }) => {
        const key = getSourceKey(source);
        return !loadedSourceKeysRef.current.has(key);
      });

    if (!pending.length) {
      setStatus("Los modelos seleccionados ya estaban cargados");
      return;
    }

    setStatus(`Agregando ${pending.length} modelo(s)...`);

    const loadedEntries: FederatedModelEntry[] = [];

    for (let index = 0; index < pending.length; index += 1) {
      const { source, name } = pending[index];

      const result = await loadViewerModel({
        components: viewer.components,
        world: viewer.world,
        source,
        modelName: name
      });

      loadedModelResultsRef.current.push(result);

      const object = result.model.object as THREE.Object3D<THREE.Object3DEventMap>;
      object.name = name;

      if (object.parent && object.parent !== modelsGroup) {
        object.parent.remove(object);
      }

      modelsGroup.add(object);

      const entry: FederatedModelEntry = {
        key: `${name}-${Date.now()}-${index}`,
        name,
        source,
        object,
        visible: true,
        expanded: false,
        isolated: false,
        isSelected: false,
        modelId:
          "modelId" in result.model ? String(result.model.modelId) : undefined
      };

      loadedEntries.push(entry);      
      loadedSourceKeysRef.current.add(getSourceKey(source));
    }

    if (loadedEntries.length) {
      setModels((prev) => [...prev, ...loadedEntries]);
      setStatus(`${loadedEntries.length} modelo(s) agregados`);
      requestViewerRefresh();
    }
  }

  async function handleApplyModelSelection(
    selected: Array<{ path: string; name: string }>
  ) {
    await handleAddModelsIncrementally(selected);
  }

  async function handleIsolateSelection() {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;

    if (!modules || !viewer) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    try {
      setStatus("Aislando selección...");
      await modules.visibility.isolate(map);
      await fitSelectionInView(viewer, viewer.components, map);
      setStatus("Selección aislada");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error isolating selection:", error);
      setStatus("Error aislando selección. Revisa la consola.");
    }
  }

  async function handleLoadSelectedProperties() {
    const modules = modulesRef.current;
    if (!modules) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    const cacheKey = getSelectionCacheKey(map);
    const cached = propertiesCacheRef.current.get(cacheKey);

    if (cached) {
      setSelectedItemsData(cached);
      setPropertiesRequested(true);
      setPropertiesLoading(false);
      setStatus("Propiedades cargadas");
      return;
    }

    setPropertiesLoading(true);

    try {
      const data = await modules.selection.getSelectedItemsData();
      const typedData = data as Record<string, unknown>[];

      propertiesCacheRef.current.set(cacheKey, typedData);
      setSelectedItemsData(typedData);
      setPropertiesRequested(true);
      setStatus("Propiedades cargadas");
    } catch (error) {
      console.error("[viewer-ifc] Error loading selected item data:", error);
      setStatus("Error cargando propiedades. Revisa la consola.");
    } finally {
      setPropertiesLoading(false);
    }
  }

  async function handleToggleSelection() {
    const modules = modulesRef.current;
    if (!modules) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    try {
      await modules.visibility.toggle(map);
      setStatus("Visibilidad actualizada");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error toggling selection visibility:", error);
      setStatus("Error cambiando visibilidad. Revisa la consola.");
    }
  }

  async function handleShowAll() {
    const modules = modulesRef.current;
    if (!modules) return;

    try {
      await modules.visibility.showAll();

      setModels((prev) =>
        prev.map((model) => {
          model.object.visible = true;
          return {
            ...model,
            visible: true,
            isolated: false
          };
        })
      );

      setStatus("Todos los elementos visibles");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error showing all:", error);
      setStatus("Error mostrando todos los elementos. Revisa la consola.");
    }
  }

  async function handleFitModel() {
    const viewer = viewerRef.current;
    const modelsGroup = modelsGroupRef.current;

    if (!viewer || !modelsGroup) return;

    await fitObjectInView(viewer, modelsGroup);
  }

  async function handleFocusSelection() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    const modelIdMap = modules.selection.getSelectionModelIdMap();
    if (Object.keys(modelIdMap).length === 0) return;

    await fitSelectionInView(viewer, viewer.components, modelIdMap);
  }

  async function handleResetView() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;
    const modelsGroup = modelsGroupRef.current;

    if (!viewer || !modules || !modelsGroup) return;

    await modules.visibility.showAll();

    if (modules.coloring) {
      await modules.coloring.restoreAllColors();
    }

    if (modules.sectionBox) {
      modules.sectionBox.clear();
    }

    lastSectionBoxSelectionRef.current = null;
    lastColoredSelectionRef.current = null;

    setModels((prev) =>
      prev.map((model) => {
        model.object.visible = true;
        return { ...model, visible: true };
      })
    );

    await fitObjectInView(viewer, modelsGroup);
    setStatus("Vista restablecida");
    requestViewerRefresh();
  }

  async function handleSaveViewpoint() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    const canvas = viewer.renderer?.three?.domElement ?? null;

    const snapshot = canvas
      ? await captureViewerSnapshot(canvas)
      : null;

    const viewpoint = await captureViewpoint(viewer, modules, {
      loadedModels: models.map((model) => ({
        key: model.key,
        name: model.name,
        documentPath: model.source.documentPath,
        documentName: model.source.documentName ?? model.name,
        visible: model.visible,
        isolated: model.isolated ?? false
      })),
      selectedColor,
      sectionBoxPadding,
      snapshot,
        coloredSelection: lastColoredSelectionRef.current
          ? Object.entries(lastColoredSelectionRef.current).map(([modelId, ids]) => ({
              modelId,
              expressIds: Array.from(ids)
            }))
          : [],
    });
    if (!viewpoint) return;

    setViewpoints((prev) => [
      ...prev,
      {
        ...viewpoint,
        name: `Vista ${prev.length + 1}`
      }
    ]);
    
    setStatus("Vista guardada");
  }

  async function handleCreateTopicFromCurrentView() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    const canvas = viewer.renderer?.three?.domElement ?? null;
    const snapshot = canvas
      ? await captureViewerSnapshot(canvas, requestViewerRefresh)
      : null;

    const viewpoint = await captureViewpoint(viewer, modules, {
      loadedModels: models.map((model) => ({
        key: model.key,
        name: model.name,
        documentPath: model.source.documentPath,
        documentName: model.source.documentName ?? model.name,
        visible: model.visible,
        isolated: model.isolated ?? false
      })),
      selectedColor,
      sectionBoxPadding,
      snapshot,
      coloredSelection: lastColoredSelectionRef.current
        ? Object.entries(lastColoredSelectionRef.current).map(
            ([modelId, ids]) => ({
              modelId,
              expressIds: Array.from(ids)
            })
          )
        : []
    });

    if (!viewpoint) return;

    const topic: BcfTopic = {
      id: crypto.randomUUID(),
      title: `Incidencia ${topics.length + 1}`,
      description: "",
      status: "open",
      priority: "medium",
      author: currentAuthor,
      assignedTo: "",
      creationDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
      viewpointId: viewpoint.id,
      snapshot: viewpoint.snapshot ?? null,
      comments: [],      
      attachments: []
    };

    setViewpoints((prev) => [...prev, viewpoint]);
    setTopics((prev) => [...prev, topic]);
    setSelectedTopicId(topic.id);
    setRightPanelTab("topics");
    console.log(topic.snapshot?.slice(0, 30));
    setStatus(`Topic creado: ${topic.title}`);
  }

  function handleDeleteTopic(topicId: string) {
    setTopics((prev) => prev.filter((topic) => topic.id !== topicId));

    if (selectedTopicId === topicId) {
      setSelectedTopicId(null);
      setIsTopicDetailOpen(false);
    }

    setStatus("Incidencia eliminada");
  }

  function handleUpdateTopic(
    topicId: string,
    patch: Partial<
            Pick<
              BcfTopic,
              "title" | "description" | "status" | "priority" | "assignedTo"
            >
          >
  ) {
    setTopics((prev) =>
      prev.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              ...patch,
              modifiedDate: new Date().toISOString()
            }
          : topic
      )
    );
  }
  function handleAddComment(topicId: string, comment: string) {
    if (!comment.trim()) return;

    setTopics((prev) =>
      prev.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              comments: [
                ...topic.comments,
                {
                  id: crypto.randomUUID(),
                  author: currentAuthor,
                  date: new Date().toISOString(),
                  comment
                }
              ],
              modifiedDate: new Date().toISOString()
            }
          : topic
      )
    );
  }
  function handleAddTopicAttachment(topicId: string, file: File) {
    const reader = new FileReader();

    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";

      if (!dataUrl) return;

      setTopics((prev) =>
        prev.map((topic) =>
          topic.id === topicId
            ? {
                ...topic,
                attachments: [
                  ...topic.attachments,
                  {
                    id: crypto.randomUUID(),
                    name: file.name,
                    type: file.type || "application/octet-stream",
                    size: file.size,
                    dataUrl,
                    createdAt: new Date().toISOString()
                  }
                ],
                modifiedDate: new Date().toISOString()
              }
            : topic
        )
      );
    };

    reader.readAsDataURL(file);
  }

  async function handleApplyViewpoint(viewpoint: ViewerViewpoint) {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;
    //  LIMPIAR ESTADOS VISUALES PREVIOS
    // limpiar estados visuales previos antes de aplicar el viewpoint
    await modules.visibility.showAll();
    await modules.selection.clearSelection();

    if (modules.coloring) {
      await modules.coloring.restoreAllColors();
    }
    await applyViewpoint(viewer, modules, viewpoint, {
      applyModelsState: async (modelsState) => {
        setModels((prev) =>
          prev.map((model) => {
            const match = modelsState.find(
              (item) =>
                item.documentPath &&
                model.source.documentPath &&
                item.documentPath === model.source.documentPath
            );

            if (!match) {
              return model;
            }

            model.object.visible = match.visible;

            return {
              ...model,
              visible: match.visible,
              isolated: match.isolated
            };
          })
        );

        requestViewerRefresh();
      }
    });
    // reaplicar color guardado
    if (viewpoint.coloring?.selection && viewpoint.coloring.color && modules.coloring) {
      const coloredSelectionMap: OBC.ModelIdMap = {};

      for (const item of viewpoint.coloring.selection) {
        coloredSelectionMap[item.modelId] = new Set(item.expressIds);
      }

      await modules.coloring.colorSelection(
        coloredSelectionMap,
        viewpoint.coloring.color
      );
    }

    if (viewpoint.display?.selectedColor) {
      setSelectedColor(viewpoint.display.selectedColor);
    }

    if (typeof viewpoint.display?.sectionBoxPadding === "number") {
      setSectionBoxPadding(viewpoint.display.sectionBoxPadding);
    }
    setStatus(`Viewpoint aplicado: ${viewpoint.name}`);
    requestViewerRefresh();
  }

  async function handleLoadContainment() {
    const modules = modulesRef.current;
    if (!modules) return;

    setContainmentLoading(true);

    try {
      const data = await modules.selection.getSelectedContainmentData();
      setContainmentData(data as Record<string, unknown>[]);
      setStatus("Contenedor espacial cargado");
    } catch (error) {
      console.error("[viewer-ifc] Error loading containment data:", error);
      setStatus("Error cargando contenedor espacial. Revisa la consola.");
    } finally {
      setContainmentLoading(false);
    }
  }

  async function handleLoadAssociations() {
    const modules = modulesRef.current;
    if (!modules) return;

    setAssociationsLoading(true);

    try {
      const data = await modules.selection.getSelectedAssociationsData();
      setAssociationsData(data as Record<string, unknown>[]);
      setStatus("Asociaciones cargadas");
    } catch (error) {
      console.error("[viewer-ifc] Error loading associations data:", error);
      setStatus("Error cargando asociaciones. Revisa la consola.");
    } finally {
      setAssociationsLoading(false);
    }
  }

  function handleRenameViewpoint(viewpointId: string, nextName: string) {
    setViewpoints((prev) =>
      prev.map((viewpoint) =>
        viewpoint.id === viewpointId
          ? { ...viewpoint, name: nextName }
          : viewpoint
      )
    );
  }

  function handleDeleteViewpoint(viewpointId: string) {
    setViewpoints((prev) =>
      prev.filter((viewpoint) => viewpoint.id !== viewpointId)
    );
  }

  function handleToggleClipper() {
    const modules = modulesRef.current;
    if (!modules) return;

    const enabled = modules.clipper.toggle();
    setClipperEnabled(enabled);
    setStatus(enabled ? "Modo de corte activo" : "Modo de corte desactivado");
    requestViewerRefresh();
  }

  function handleDeleteClippingPlanes() {
    const modules = modulesRef.current;
    if (!modules) return;

    modules.clipper.deleteAll();
    setStatus("Cortes eliminados");
    requestViewerRefresh();
  }

  async function handleApplySelectionColor() {
    const modules = modulesRef.current;
    if (!modules) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    const colorTarget = cloneModelIdMap(map);

    try {
      const applied = await modules.coloring.colorSelection(
        colorTarget,
        selectedColor
      );

      if (applied) {
        lastColoredSelectionRef.current = colorTarget;
        setStatus(`Color aplicado: ${selectedColor}`);
        requestViewerRefresh();
      }
    } catch (error) {
      console.error("[viewer-ifc] Error applying color:", error);
      setStatus("Error aplicando color. Revisa la consola.");
    }
  }

  function handleSelectedColorChange(value: string) {
    setSelectedColor(value);
  }

  async function handleRestoreSelectionColor() {
    const modules = modulesRef.current;
    if (!modules) return;

    const restoreTarget =
      lastColoredSelectionRef.current &&
      Object.keys(lastColoredSelectionRef.current).length > 0
        ? cloneModelIdMap(lastColoredSelectionRef.current)
        : modules.selection.getSelectionModelIdMap();

    if (Object.keys(restoreTarget).length === 0) return;

    try {
      const restored = await modules.coloring.restoreSelectionColor(
        restoreTarget
      );

      if (restored) {
        lastColoredSelectionRef.current = null;
        setStatus("Color restaurado");
        requestViewerRefresh();
      }
    } catch (error) {
      console.error("[viewer-ifc] Error restoring color:", error);
      setStatus("Error restaurando color. Revisa la consola.");
    }
  }

  async function handleCreateSelectionSectionBox() {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;

    if (!modules || !viewer) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    try {
      const selectionClone = cloneModelIdMap(map);

      const created = await modules.sectionBox.createFromSelection(
        selectionClone,
        {
          paddingFactor: sectionBoxPadding,
          minPadding: 0.5
        }
      );

      if (created) {
        lastSectionBoxSelectionRef.current = selectionClone;
        await fitSelectionInView(viewer, viewer.components, selectionClone);
        setStatus(`Caja de sección creada (${sectionBoxPadding.toFixed(2)})`);
        requestViewerRefresh();
      } else {
        setStatus("No se pudo crear la caja de sección");
      }
    } catch (error) {
      console.error("[viewer-ifc] Error creating section box:", error);
      setStatus("Error creando caja de sección. Revisa la consola.");
    }
  }

  function handleClearSelectionSectionBox() {
    const modules = modulesRef.current;
    if (!modules) return;

    try {
      modules.sectionBox.clear();
      lastSectionBoxSelectionRef.current = null;
      setStatus("Caja de sección eliminada");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error clearing section box:", error);
      setStatus("Error limpiando caja de sección. Revisa la consola.");
    }
  }

  async function handleSectionBoxPaddingChange(value: number) {
    setSectionBoxPadding(value);

    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    const lastSelection = lastSectionBoxSelectionRef.current;

    if (!modules || !viewer || !lastSelection) return;

    try {
      const created = await modules.sectionBox.createFromSelection(
        lastSelection,
        {
          paddingFactor: value,
          minPadding: 0.5
        }
      );

      if (created) {
        await fitSelectionInView(viewer, viewer.components, lastSelection);
        setStatus(`Caja de sección actualizada (${value.toFixed(2)})`);
        requestViewerRefresh();
      }
    } catch (error) {
      console.error("[viewer-ifc] Error updating section box:", error);
      setStatus("Error actualizando caja de sección. Revisa la consola.");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-white">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border border-zinc-300 bg-zinc-50 px-3 py-2">
        <div className="min-w-0 flex flex-1 flex-col">
          <p className="truncate text-sm font-semibold text-zinc-800">
            {titleText}
          </p>
          <p className="text-sm text-zinc-600">{status}</p>
        </div>

        <Link
          href={backHref}
          className="inline-flex h-9 items-center border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Volver
        </Link>
      </div>

      <div className="shrink-0">
        <IfcViewerToolbar
          onIsolateSelection={handleIsolateSelection}
          onToggleSelection={handleToggleSelection}
          onShowAll={handleShowAll}
          onFitModel={handleFitModel}
          onFocusSelection={handleFocusSelection}
          onResetView={handleResetView}
          onSaveViewpoint={handleSaveViewpoint}
          onToggleClipper={handleToggleClipper}
          onDeleteClippingPlanes={handleDeleteClippingPlanes}
          onCreateSelectionSectionBox={handleCreateSelectionSectionBox}
          onClearSelectionSectionBox={handleClearSelectionSectionBox}
          onApplySelectionColor={handleApplySelectionColor}
          onRestoreSelectionColor={handleRestoreSelectionColor}
          onSelectedColorChange={handleSelectedColorChange}
          onSectionBoxPaddingChange={handleSectionBoxPaddingChange}
          clipperEnabled={clipperEnabled}
          hasSelection={hasSelection}
          selectedColor={selectedColor}
          sectionBoxPadding={sectionBoxPadding}
        />
      </div>
      <div className="mb-2 flex shrink-0 gap-2 px-1">
        <button
          type="button"
          onClick={handleCreateTopicFromCurrentView}
          className="h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
        >
          Crear incidencia
        </button>
      </div>

      <div className="flex min-h-0 flex-1 items-stretch gap-1 overflow-hidden px-1 pb-1">
        <div className="min-h-0 min-w-0 flex-1">
          <div ref={viewerFrameRef} className="relative h-full min-h-0 w-full">
            <div
              ref={hostRef}
              className="h-full w-full overflow-hidden bg-gray-950"
              style={{ position: "relative", zIndex: 0 }}
            />
          </div>
        </div>

        <aside
          className="flex h-full min-h-0 shrink-0 flex-col overflow-hidden border border-zinc-300 bg-zinc-100"
          style={{
            width: "420px",
            minWidth: "320px",
            maxWidth: "760px",
            resize: "horizontal"
          }}
        >
          <div className="border-b border-zinc-300 bg-zinc-50">
            <div className="grid grid-cols-4 border-b border-zinc-300 text-xs">
              {[
                ["properties", "Prop."],
                ["models", "Modelos"],
                ["viewpoints", "Vistas"],
                ["topics", "BCF"]
              ].map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setRightPanelTab(key as RightPanelTab)}
                  className={`h-9 border-r border-zinc-300 px-2 ${
                    rightPanelTab === key
                      ? "bg-white font-semibold text-zinc-900"
                      : "bg-zinc-100 text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {rightPanelTab === "models" && (
            <>
              <div className="border-b border-zinc-300 bg-zinc-50 px-3 py-2">
                <button
                  type="button"
                  onClick={handleOpenModelSelector}
                  className="h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
                >
                  Agregar modelos
                </button>
              </div>

              <IfcModelsPanel
                models={models}
                onToggleModelVisibility={handleToggleModelVisibility}
                onToggleModelExpanded={handleToggleModelExpanded}
                onRemoveModel={handleRemoveModel}
                onFocusModel={handleFocusModel}
                onIsolateModel={handleIsolateModel}
              />
            </>
          )}

          {rightPanelTab === "viewpoints" && (
            <IfcViewpointsPanel
              viewpoints={viewpoints}
              onApplyViewpoint={handleApplyViewpoint}
              onRenameViewpoint={handleRenameViewpoint}
              onDeleteViewpoint={handleDeleteViewpoint}
            />
          )}

          {rightPanelTab === "topics" && (
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              onWheel={(event) => event.stopPropagation()}
            > {!isTopicDetailOpen && (
                <div className="border-b border-zinc-300 bg-white">
                <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-100 px-3 py-2">
                  <h3 className="text-sm font-semibold text-zinc-800">Incidencias</h3>
                  <span className="text-xs text-zinc-500">{topics.length}</span>
                </div>

                {topics.length === 0 ? (
                  <div className="px-3 py-3 text-sm text-zinc-500">
                    Aún no hay incidencias.
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto divide-y divide-zinc-200">
                    {topics.map((topic) => (
                      <div
                        key={topic.id}
                        className={`border-b border-zinc-200 bg-white px-3 py-2 ${
                          selectedTopicId === topic.id ? "bg-amber-50" : ""
                        }`}
                      >
                        <button
                          type="button"
                          className="flex w-full flex-col items-start gap-1 text-left hover:bg-zinc-50"
                          onClick={() => {
                            setSelectedTopicId(topic.id);
                            setIsTopicDetailOpen(true);

                            const linkedViewpoint = viewpoints.find(
                              (viewpoint) => viewpoint.id === topic.viewpointId
                            );

                            if (linkedViewpoint) {
                              void handleApplyViewpoint(linkedViewpoint);
                            }
                          }}
                        >
                          <span className="text-sm font-medium text-zinc-800">
                            {topic.title}
                          </span>

                          <span className="text-xs text-zinc-500">
                            {topic.status} · {topic.priority}
                          </span>
                          <span className="text-xs text-zinc-500">
                            Autor: {topic.author || "Sin autor"}
                          </span>
                          <span className="text-xs text-zinc-500">
                            Asignado: {topic.assignedTo || "Sin asignar"}
                          </span>

                          {topic.snapshot ? (
                            <div className="mt-2 w-full overflow-hidden rounded border border-zinc-300 bg-black">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={topic.snapshot}
                                alt={topic.title}
                                className="block w-full"
                                style={{ maxHeight: 180, objectFit: "contain" }}
                              />
                            </div>
                          ) : null}
                        </button>

                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDeleteTopic(topic.id);
                          }}
                          className="mt-2 h-8 border border-red-300 bg-white px-3 text-xs text-red-600 hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              )}
              {isTopicDetailOpen && selectedTopicId ? (
                (() => {
                  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId);

                  if (!selectedTopic) return null;

                  return (
                    <div className="border-t border-zinc-300 bg-zinc-50 px-3 py-3">
                      <button
                          type="button"
                          onClick={() => setIsTopicDetailOpen(false)}
                          className="mb-3 h-8 border border-zinc-300 bg-white px-3 text-xs hover:bg-zinc-50"
                        >
                          ← Volver a incidencias
                      </button>
                      <h4 className="mb-3 text-sm font-semibold text-zinc-800">
                        
                        Detalle de incidencia
                        
                      </h4>

                      <label className="mb-2 block text-xs font-medium text-zinc-600">
                        Título
                        <input
                          value={selectedTopic.title}
                          onChange={(event) =>
                            handleUpdateTopic(selectedTopic.id, {
                              title: event.target.value
                            })
                          }
                          className="mt-1 h-9 w-full border border-zinc-300 px-2 text-sm"
                        />
                      </label>
                      <div className="mb-2 text-xs text-zinc-600">
                        <span className="font-medium">Autor:</span>{" "}
                        {selectedTopic.author || "Sin autor"}
                      </div>

                      <label className="mb-2 block text-xs font-medium text-zinc-600">
                        Asignado a
                        <input
                          value={selectedTopic.assignedTo ?? ""}
                          onChange={(event) =>
                            handleUpdateTopic(selectedTopic.id, {
                              assignedTo: event.target.value
                            })
                          }
                          className="mt-1 h-9 w-full border border-zinc-300 px-2 text-sm"
                          placeholder="Nombre o correo del responsable"
                        />
                      </label>

                      <label className="mb-2 block text-xs font-medium text-zinc-600">
                        Estado
                        <select
                          value={selectedTopic.status}
                          onChange={(event) =>
                            handleUpdateTopic(selectedTopic.id, {
                              status: event.target.value as BcfTopic["status"]
                            })
                          }
                          className="mt-1 h-9 w-full border border-zinc-300 px-2 text-sm"
                        >
                          <option value="open">Open</option>
                          <option value="in_progress">In progress</option>
                          <option value="resolved">Resolved</option>
                          <option value="closed">Closed</option>
                        </select>
                      </label>

                      <label className="mb-2 block text-xs font-medium text-zinc-600">
                        Prioridad
                        <select
                          value={selectedTopic.priority}
                          onChange={(event) =>
                            handleUpdateTopic(selectedTopic.id, {
                              priority: event.target.value as BcfTopic["priority"]
                            })
                          }
                          className="mt-1 h-9 w-full border border-zinc-300 px-2 text-sm"
                        >
                          <option value="low">Low</option>
                          <option value="medium">Medium</option>
                          <option value="high">High</option>
                          <option value="critical">Critical</option>
                        </select>
                      </label>

                      <label className="block text-xs font-medium text-zinc-600">
                        Descripción
                        <textarea
                          value={selectedTopic.description ?? ""}
                          onChange={(event) =>
                            handleUpdateTopic(selectedTopic.id, {
                              description: event.target.value
                            })
                          }
                          className="mt-1 min-h-24 w-full border border-zinc-300 px-2 py-2 text-sm"
                        />
                      </label>
                      <div className="mt-4">
                        <h5 className="mb-2 text-xs font-semibold text-zinc-700">
                          Comentarios
                        </h5>

                        {selectedTopic.comments.length === 0 ? (
                          <div className="mb-2 text-xs text-zinc-500">
                            No hay comentarios.
                          </div>
                        ) : (
                          <div className="mb-2 flex flex-col gap-2">
                            {selectedTopic.comments.map((c) => (
                              <div
                                key={c.id}
                                className="rounded border border-zinc-300 bg-white p-2 text-xs"
                              >
                                <div className="mb-1 text-[10px] text-zinc-500">
                                  {c.author} · {new Date(c.date).toLocaleString()}
                                </div>
                                <div>{c.comment}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        <textarea
                          value={newComment}
                          onChange={(e) => setNewComment(e.target.value)}
                          placeholder="Escribe un comentario..."
                          className="mb-2 min-h-16 w-full border border-zinc-300 px-2 py-2 text-xs"
                        />

                        <button
                          type="button"
                          onClick={() => {
                            handleAddComment(selectedTopic.id, newComment);
                            setNewComment("");
                          }}
                          className="h-8 border border-zinc-300 bg-white px-3 text-xs hover:bg-zinc-50"
                        >
                          Agregar comentario
                        </button>
                      </div>
                    </div>
                  );
                })()
              ) : null}
            </div>
          )}

          {rightPanelTab === "properties" && (
            <div
              style={{
                flex: "1 1 0",
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                paddingTop: "12px"
              }}
              onWheel={(event) => event.stopPropagation()}
            >
              {!hasSelection ? (
                <div className="px-4 py-3 text-sm text-zinc-500">
                  Selecciona un elemento para habilitar sus propiedades.
                </div>
              ) : !propertiesRequested ? (
                <div className="flex flex-col gap-3 px-4 py-3">
                  <div className="text-sm text-zinc-600">
                    La selección está activa. Carga las propiedades solo cuando las
                    necesites.
                  </div>

                  <button
                    type="button"
                    onClick={handleLoadSelectedProperties}
                    disabled={propertiesLoading}
                    className="h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {propertiesLoading ? "Cargando propiedades..." : "Ver propiedades"}
                  </button>
                </div>
              ) : (
                <IfcSelectedPropertiesPanel
                  items={selectedItemsData}
                  containmentData={containmentData}
                  associationsData={associationsData}
                  containmentLoading={containmentLoading}
                  associationsLoading={associationsLoading}
                  onLoadContainment={handleLoadContainment}
                  onLoadAssociations={handleLoadAssociations}
                />
              )}
            </div>
          )}
        </aside>
      </div>

      <IfcModelSelector
        isOpen={isModelSelectorOpen}
        initialSelectedPaths={documentPaths}
        onClose={handleCloseModelSelector}
        onApply={handleApplyModelSelection}
      />
    </section>
  );
}