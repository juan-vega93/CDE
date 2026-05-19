"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { getDocuments, getFolders } from "@/services/documents.service";

type IfcModelSelectorProps = {
  isOpen: boolean;
  initialSelectedPaths: string[];
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
};

type FolderApiResponse = {
  data?: {
    items?: FolderItem[];
  };
};

type DocumentsApiResponse = {
  data?: {
    items?: DocumentItem[];
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
  onChange
}: {
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`inline-flex h-5 w-5 items-center justify-center border text-xs ${
        checked
          ? "border-zinc-700 bg-zinc-700 text-white"
          : "border-zinc-300 bg-white text-transparent"
      }`}
      aria-label={checked ? "Deseleccionar" : "Seleccionar"}
    >
      ✓
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
      className="inline-flex h-5 w-5 items-center justify-center text-sm text-zinc-600"
      aria-label={expanded ? "Colapsar" : "Expandir"}
    >
      {expanded ? "▾" : "▸"}
    </button>
  );
}

export function IfcModelSelector({
  isOpen,
  initialSelectedPaths,
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

  const initialMap = useMemo(
    () => buildInitialSelectedMap(initialSelectedPaths),
    [initialSelectedPaths]
  );
  

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
      const foldersRes = (await getFolders(targetPath)) as FolderApiResponse;
      const docsRes = (await getDocuments(targetPath)) as DocumentsApiResponse;

      const folders = Array.isArray(foldersRes?.data?.items)
        ? foldersRes.data.items.filter((folder) => {
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

      const documents = Array.isArray(docsRes?.data?.items)
        ? docsRes.data.items.filter((doc) => {
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
  }, [rootPath]);

  useEffect(() => {
    if (!isOpen) return;

    const frame = window.requestAnimationFrame(() => {
      setSelectedMap(initialMap);
    });

    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [isOpen, initialMap]);

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
                className="flex items-center gap-2 px-3 py-1 text-sm text-zinc-700"
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

                        return (
                          <div
                            key={doc.path}
                            className="flex items-center gap-2 px-3 py-1 text-sm text-zinc-700"
                            style={{ paddingLeft: `${34 + depth * 18}px` }}
                          >
                            <SelectionCheckbox
                              checked={checked}
                              onChange={() => toggleFile(doc)}
                            />
                            <span className="truncate">{doc.name}</span>
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

              return (
                <div
                  key={doc.path}
                  className="flex items-center gap-2 px-3 py-1 text-sm text-zinc-700"
                  style={{ paddingLeft: `${12 + depth * 18}px` }}
                >
                  <SelectionCheckbox
                    checked={checked}
                    onChange={() => toggleFile(doc)}
                  />
                  <span className="truncate">{doc.name}</span>
                </div>
              );
            })
          : null}
      </div>
    );
  }

  if (!isOpen) return null;

  return (
    <div className="absolute inset-0 z-50 flex justify-end bg-black/20">
      <div className="flex h-full w-[440px] max-w-full flex-col border-l border-zinc-300 bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-zinc-300 px-4 py-3">
          <div>
            <h3 className="text-base font-semibold text-zinc-800">Agregar modelos</h3>
            <p className="text-sm text-zinc-500">
              {normalizedProjectCode
                ? `Proyecto ${normalizedProjectCode} · selecciona IFC/FRAG`
                : "Explora carpetas y selecciona IFC/FRAG"}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
          >
            Cerrar
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {treeState[rootPath] ? (
            renderNode(rootPath)
          ) : (
            <div className="px-4 py-4 text-sm text-zinc-500">
              Cargando árbol...
            </div>
          )}
        </div>

        <div className="border-t border-zinc-300 bg-zinc-50 px-4 py-3">
          <div className="mb-3 text-sm text-zinc-600">
            Seleccionados: {selectedItems.length}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => onApply(selectedItems)}
              className="h-9 border border-zinc-300 bg-zinc-800 px-3 text-sm text-white hover:bg-zinc-700"
            >
              Aplicar selección
            </button>

            <button
              type="button"
              onClick={onClose}
              className="h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}