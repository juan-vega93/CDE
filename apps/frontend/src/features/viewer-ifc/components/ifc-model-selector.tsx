"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDocumentExplorer } from "@/services/documents.service";

type IfcModelSelectorProps = {
  isOpen: boolean;
  initialSelectedPaths: string[];
  disabledPaths?: string[];
  projectCode?: string;
  onClose: () => void;
  onApply: (selected: Array<{ path: string; name: string }>) => void;
};

type FolderItem = {
  name: string;
  path: string;
  type?: string;
};

type DocumentItem = {
  id: string;
  name: string;
  path: string;
  extension?: string;
  bimDerivative?: {
    status?: string;
    error?: string | null;
  };
};

type TreeNodeState = {
  folders: FolderItem[];
  documents: DocumentItem[];
  loaded: boolean;
  loading: boolean;
  expanded: boolean;
};

function isBimViewerFile(fileName: string) {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".ifc") || lower.endsWith(".frag");
}

function isReadyForFederation(doc: DocumentItem) {
  const extension = doc.extension?.toLowerCase() || doc.name.split(".").pop()?.toLowerCase() || "";

  if (extension === "frag") return true;
  if (extension !== "ifc") return false;

  return doc.bimDerivative?.status === "generated";
}

function getBimStatusLabel(doc: DocumentItem) {
  const extension = doc.extension?.toLowerCase() || doc.name.split(".").pop()?.toLowerCase() || "";

  if (extension === "frag") return "FRAG";
  if (doc.bimDerivative?.status === "generated") return "FRAG listo";
  if (doc.bimDerivative?.status === "pending") return "Generando";
  if (doc.bimDerivative?.status === "failed") return "FRAG fallido";
  return "Sin FRAG";
}

function buildInitialSelectedMap(paths: string[]) {
  const initialMap: Record<string, { path: string; name: string }> = {};

  for (const currentPath of paths) {
    const name = decodeURIComponent(currentPath.split("/").pop() || currentPath);
    initialMap[currentPath] = { path: currentPath, name };
  }

  return initialMap;
}

function SelectionCheckbox({
  checked,
  disabled = false,
  onChange
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onChange();
      }}
      disabled={disabled}
      className={`inline-flex h-5 w-5 items-center justify-center border text-xs ${
        disabled
          ? "border-zinc-700 bg-zinc-800 text-zinc-500"
          : checked
          ? "border-red-500 bg-red-600 text-white"
          : "border-zinc-600 bg-zinc-900 text-transparent"
      }`}
      aria-label={disabled ? "Modelo ya cargado" : checked ? "Deseleccionar" : "Seleccionar"}
    >
      x
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
      className="inline-flex h-5 w-5 items-center justify-center text-sm text-zinc-400 hover:text-white"
      aria-label={expanded ? "Colapsar" : "Expandir"}
    >
      {expanded ? "v" : ">"}
    </button>
  );
}

export function IfcModelSelector({
  isOpen,
  initialSelectedPaths,
  disabledPaths = [],
  projectCode = "",
  onClose,
  onApply
}: IfcModelSelectorProps) {
  const [treeState, setTreeState] = useState<Record<string, TreeNodeState>>({});
  const [selectedMap, setSelectedMap] = useState<
    Record<string, { path: string; name: string }>
  >({});

  const normalizedProjectCode = projectCode.trim().toUpperCase();
  const rootPath = normalizedProjectCode ? `/${normalizedProjectCode}` : "/";

  const initialSelectedKey = useMemo(
    () => initialSelectedPaths.join("|"),
    [initialSelectedPaths]
  );
  const disabledPathSet = useMemo(() => new Set(disabledPaths), [disabledPaths]);
  

  const loadNode = useCallback(async (targetPath: string) => {
    setTreeState((prev) => ({
      ...prev,
      [targetPath]: {
        folders: prev[targetPath]?.folders ?? [],
        documents: prev[targetPath]?.documents ?? [],
        loaded: false,
        loading: true,
        expanded: prev[targetPath]?.expanded ?? targetPath === rootPath
      }
    }));

    try {
      const explorer = await getDocumentExplorer(targetPath, normalizedProjectCode);

      const folders = Array.isArray(explorer.folders)
        ? explorer.folders.filter((folder) => {
            const folderName = String(folder.name || "").trim().toLowerCase();

            const folderPathRaw = String(folder.path || "");
            const folderPath = folderPathRaw.startsWith("/")
              ? folderPathRaw
              : `/${folderPathRaw}`;

            const isTechnicalFolder = [
              ".viewer",
              "_viewer",
              "_derived",
              "_bcf"
            ].includes(folderName);

            const isInsideRoot =
              rootPath === "/" ||
              folderPath === rootPath ||
              folderPath.startsWith(`${rootPath}/`);

            return folderPath !== rootPath && isInsideRoot && !isTechnicalFolder;
          })
        : [];

      const documents = Array.isArray(explorer.documents)
        ? explorer.documents.filter((doc) => {
            const documentPathRaw = String(doc.path || "");
            const documentPath = documentPathRaw.startsWith("/")
              ? documentPathRaw
              : `/${documentPathRaw}`;

            const isInsideRoot =
              rootPath === "/" ||
              documentPath === rootPath ||
              documentPath.startsWith(`${rootPath}/`);

            return isInsideRoot && isBimViewerFile(doc.name);
          })
        : [];

      setTreeState((prev) => ({
        ...prev,
        [targetPath]: {
          folders,
          documents,
          loaded: true,
          loading: false,
          expanded: prev[targetPath]?.expanded ?? targetPath === rootPath
        }
      }));
    } catch (error) {
      console.error("[ifc-model-selector] Error loading node:", targetPath, error);

      setTreeState((prev) => ({
        ...prev,
        [targetPath]: {
          folders: [],
          documents: [],
          loaded: true,
          loading: false,
          expanded: prev[targetPath]?.expanded ?? targetPath === rootPath
        }
      }));
    }
  }, [normalizedProjectCode, rootPath]);

  useEffect(() => {
    if (!isOpen) return;

    const frame = window.requestAnimationFrame(() => {
      setSelectedMap(buildInitialSelectedMap(initialSelectedPaths));
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
    // Reset only when the modal is opened or the selected path set materially changes.
    // Depending on the raw array identity here can clear user selection on re-render.
  }, [isOpen, initialSelectedKey]);

  useEffect(() => {
    if (!isOpen) return;
    if (treeState[rootPath]?.loaded || treeState[rootPath]?.loading) return;

    const frame = window.requestAnimationFrame(() => {
      void loadNode(rootPath);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen, loadNode, rootPath, treeState]);

  async function toggleFolder(targetPath: string) {
    const current = treeState[targetPath];

    if (!current) {
      setTreeState((prev) => ({
        ...prev,
        [targetPath]: {
          folders: [],
          documents: [],
          loaded: false,
          loading: false,
          expanded: true
        }
      }));

      await loadNode(targetPath);
      return;
    }

    if (!current.loaded) {
      setTreeState((prev) => ({
        ...prev,
        [targetPath]: {
          ...prev[targetPath],
          expanded: true
        }
      }));

      if (!current.loading) {
        await loadNode(targetPath);
      }
      return;
    }

    setTreeState((prev) => ({
      ...prev,
      [targetPath]: {
        ...prev[targetPath],
        expanded: !prev[targetPath].expanded
      }
    }));
  }

  function toggleFile(doc: DocumentItem) {
    if (disabledPathSet.has(doc.path)) return;
    if (!isReadyForFederation(doc)) return;

    setSelectedMap((prev) => {
      if (prev[doc.path]) {
        const next = { ...prev };
        delete next[doc.path];
        return next;
      }

      return {
        ...prev,
        [doc.path]: {
          path: doc.path,
          name: doc.name
        }
      };
    });
  }

  const selectedItems = useMemo(() => Object.values(selectedMap), [selectedMap]);

  function renderNode(targetPath: string, depth = 0): React.ReactNode {
    const node = treeState[targetPath];
    if (!node) return null;

    return (
      <div key={targetPath}>
        {node.folders.map((folder) => {
          const folderState = treeState[folder.path];

          return (
            <div key={folder.path}>
              <div
                className="flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
                style={{ paddingLeft: `${12 + depth * 18}px` }}
              >
                <ExpandButton
                  expanded={folderState?.expanded ?? false}
                  onClick={() => {
                    void toggleFolder(folder.path);
                  }}
                />
                <span className="truncate">{folder.name}</span>
              </div>

              {folderState?.expanded ? (
                <div>
                  {folderState.loading ? (
                    <div
                      className="px-3 py-1 text-xs text-zinc-500"
                      style={{ paddingLeft: `${34 + depth * 18}px` }}
                    >
                      Cargando...
                    </div>
                  ) : null}

                  {folderState.loaded ? renderNode(folder.path, depth + 1) : null}

                  {folderState.loaded
                    ? folderState.documents.map((doc) => {
                        const checked = Boolean(selectedMap[doc.path]);
                        const ready = isReadyForFederation(doc);
                        const disabled = disabledPathSet.has(doc.path) || !ready;

                        return (
                          <div
                            key={doc.path}
                            onClick={() => toggleFile(doc)}
                            className={`flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm ${
                              disabled
                                ? "cursor-not-allowed text-zinc-600"
                                : "cursor-pointer text-zinc-300 hover:bg-zinc-800"
                            }`}
                            style={{ paddingLeft: `${34 + depth * 18}px` }}
                          >
                            <SelectionCheckbox
                              checked={checked}
                              disabled={disabled}
                              onChange={() => toggleFile(doc)}
                            />
                            <span className="truncate">{doc.name}</span>
                            <span
                              className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                                ready
                                  ? "border-emerald-700 bg-emerald-950 text-emerald-200"
                                  : "border-amber-700 bg-amber-950 text-amber-200"
                              }`}
                              title={doc.bimDerivative?.error || getBimStatusLabel(doc)}
                            >
                              {getBimStatusLabel(doc)}
                            </span>
                            {disabledPathSet.has(doc.path) ? (
                              <span className="shrink-0 text-[10px] uppercase text-zinc-500">
                                Cargado
                              </span>
                            ) : null}
                          </div>
                        );
                      })
                    : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {targetPath === rootPath
          ? node.documents.map((doc) => {
              const checked = Boolean(selectedMap[doc.path]);
              const ready = isReadyForFederation(doc);
              const disabled = disabledPathSet.has(doc.path) || !ready;

              return (
                <div
                  key={doc.path}
                  onClick={() => toggleFile(doc)}
                  className={`flex min-w-0 items-center gap-2 px-3 py-1.5 text-sm ${
                    disabled
                      ? "cursor-not-allowed text-zinc-600"
                      : "cursor-pointer text-zinc-300 hover:bg-zinc-800"
                  }`}
                  style={{ paddingLeft: `${12 + depth * 18}px` }}
                >
                  <SelectionCheckbox
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggleFile(doc)}
                  />
                  <span className="truncate">{doc.name}</span>
                  <span
                    className={`ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] uppercase ${
                      ready
                        ? "border-emerald-700 bg-emerald-950 text-emerald-200"
                        : "border-amber-700 bg-amber-950 text-amber-200"
                    }`}
                    title={doc.bimDerivative?.error || getBimStatusLabel(doc)}
                  >
                    {getBimStatusLabel(doc)}
                  </span>
                  {disabledPathSet.has(doc.path) ? (
                    <span className="shrink-0 text-[10px] uppercase text-zinc-500">
                      Cargado
                    </span>
                  ) : null}
                </div>
              );
            })
          : null}
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex justify-start bg-black/45">
      <div className="flex h-full w-[390px] max-w-full flex-col border-r border-zinc-700 bg-zinc-950 text-zinc-100 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-zinc-100">Agregar modelos</h3>
            <p className="text-xs text-zinc-400">
              {normalizedProjectCode
                ? `Proyecto ${normalizedProjectCode} - selecciona IFC/FRAG`
                : "Explora carpetas y selecciona IFC/FRAG"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-8 border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
          >
            Cerrar
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-2">
          {treeState[rootPath] ? (
            renderNode(rootPath)
          ) : (
            <div className="px-4 py-4 text-sm text-zinc-400">
              Cargando arbol...
            </div>
          )}
        </div>

        <div className="border-t border-zinc-800 bg-zinc-900 px-4 py-3">
          <div className="mb-3 text-sm text-zinc-300">
            Seleccionados: {selectedItems.length}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApply(selectedItems)}
              className="min-h-9 border border-red-700 bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-500"
            >
              Aplicar seleccion
            </button>

            <button
              type="button"
              onClick={onClose}
              className="min-h-9 border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
