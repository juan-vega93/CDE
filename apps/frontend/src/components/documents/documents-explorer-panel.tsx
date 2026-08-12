"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { DocumentsExplorer } from "@/components/documents/documents-explorer";
import {
  deleteFolder,
  getFolders,
  moveFolder,
  renameFolder
} from "@/services/documents.service";
import { requestDocumentExplorerRefresh } from "@/lib/document-explorer-events";
import {
  buildFolderTreePatch,
  getTreeAncestors,
  getTreeParentPath,
  mergeFolderTrees as mergeFolderTreeNodes,
  normalizeTreePath
} from "@/lib/folder-tree";
import type { ExplorerRow, FolderTreeNode } from "@/types/documents";

type DocumentsExplorerPanelProps = {
  rows: ExplorerRow[];
  folderTree?: FolderTreeNode | null;
  currentPath: string;
  projectCode?: string;
};

type FolderActionTarget = {
  path: string;
  name: string;
} | null;

type FolderDialogMode = "rename" | "move" | "delete" | null;

function normalizeExplorerPath(path: string) {
  return normalizeTreePath(path);
}

function getParentFolder(path: string) {
  return getTreeParentPath(path);
}
function mergeFolderTrees(
  current: FolderTreeNode | null,
  incoming: FolderTreeNode | null
): FolderTreeNode | null {
  return mergeFolderTreeNodes(current, incoming);
}

function getMenuPosition(rect: DOMRect, width = 256, estimatedHeight = 180) {
  const left = Math.min(
    Math.max(12, rect.right - width),
    Math.max(12, window.innerWidth - width - 12)
  );
  const opensDown = rect.bottom + estimatedHeight + 12 <= window.innerHeight;
  const top = opensDown
    ? rect.bottom + 8
    : Math.max(12, rect.top - estimatedHeight - 8);

  return { top, left };
}

export function DocumentsExplorerPanel({
  rows,
  folderTree = null,
  currentPath,
  projectCode = ""
}: DocumentsExplorerPanelProps) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set([normalizeExplorerPath(currentPath)])
  );
  const [folderActionTarget, setFolderActionTarget] =
    useState<FolderActionTarget>(null);
  const [folderMenuPosition, setFolderMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [folderDialogMode, setFolderDialogMode] =
    useState<FolderDialogMode>(null);
  const [folderInputValue, setFolderInputValue] = useState("");
  const [folderActionError, setFolderActionError] = useState("");
  const [isFolderSubmitting, setIsFolderSubmitting] = useState(false);
  const [localFolderTree, setLocalFolderTree] = useState<FolderTreeNode | null>(
    folderTree
  );
  const [loadingTreePaths, setLoadingTreePaths] = useState<Set<string>>(
    () => new Set()
  );

  useEffect(() => {
    setLocalFolderTree((current) => mergeFolderTrees(current, folderTree));
  }, [folderTree]);


  const projectRootPath = useMemo(() => {
    const normalizedCurrentPath = normalizeExplorerPath(currentPath);
    const firstPathPart =
      normalizedCurrentPath.split("/").filter(Boolean)[0] || projectCode;
    return firstPathPart ? `/${firstPathPart}` : "/";
  }, [currentPath, projectCode]);

  useEffect(() => {
    const visiblePatch = buildFolderTreePatch(projectRootPath, currentPath, rows);
    setLocalFolderTree((current) => mergeFolderTrees(current, visiblePatch));
  }, [projectRootPath, currentPath, rows]);

  useEffect(() => {
    const ancestors = getTreeAncestors(currentPath);
    setExpandedFolders((current) => {
      const next = new Set(current);
      ancestors.forEach((ancestor) => next.add(ancestor));
      return next;
    });
  }, [currentPath]);

  const normalizedQuery = query.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (!normalizedQuery) {
      return rows;
    }

    return rows.filter((row) => {
      const values = [
        row.name,
        row.path,
        row.kind,
        row.kind === "document" ? row.extension : "",
        row.kind === "document" ? row.workflowStatus : "",
        row.kind === "document" ? row.uiStatus : ""
      ]
        .join(" ")
        .toLowerCase();

      return values.includes(normalizedQuery);
    });
  }, [rows, normalizedQuery]);

  const stats = useMemo(() => {
    const folders = rows.filter((row) => row.kind === "folder").length;
    const documents = rows.filter((row) => row.kind === "document").length;
    const bim = rows.filter(
      (row) =>
        row.kind === "document" &&
        ["ifc", "frag"].includes(String(row.extension || "").toLowerCase())
    ).length;
    const withWorkflow = rows.filter(
      (row) => row.kind === "document" && Boolean(row.workPackageLink)
    ).length;

    return { folders, documents, bim, withWorkflow };
  }, [rows]);

  const folderRows = useMemo(
    () => rows.filter((row) => row.kind === "folder"),
    [rows]
  );

  const pathParts = currentPath.split("/").filter(Boolean);
  const activeFolderTree = localFolderTree ?? folderTree;
  const hasTreeChildren = Boolean(activeFolderTree?.children.length);

  function buildHref(path: string) {
    return `/documents?path=${encodeURIComponent(path)}${
      projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
    }`;
  }

  function toggleExpanded(path: string) {
    const normalizedPath = normalizeExplorerPath(path);
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(normalizedPath)) next.delete(normalizedPath);
      else next.add(normalizedPath);
      return next;
    });
  }

  function openFolderDialog(
    target: NonNullable<FolderActionTarget>,
    mode: FolderDialogMode
  ) {
    setFolderActionTarget(target);
    setFolderDialogMode(mode);
    setFolderActionError("");

    if (mode === "rename") setFolderInputValue(target.name);
    else if (mode === "move") setFolderInputValue(normalizeExplorerPath(currentPath));
    else setFolderInputValue("");
  }

  function closeFolderDialog() {
    if (isFolderSubmitting) return;
    setFolderActionTarget(null);
    setFolderDialogMode(null);
    setFolderInputValue("");
    setFolderActionError("");
  }

  function getFolderDestinationOptions(target: NonNullable<FolderActionTarget>) {
    const current = normalizeExplorerPath(currentPath);
    const currentParts = current.split("/").filter(Boolean);
    const projectRoot = projectCode
      ? `/${projectCode}`
      : currentParts.length
        ? `/${currentParts[0]}`
        : "/";
    const options: Array<{ label: string; path: string; description: string }> = [];
    const seen = new Set<string>();
    const targetPath = normalizeExplorerPath(target.path);

    function addOption(label: string, path: string, description: string) {
      const normalizedPath = normalizeExplorerPath(path);
      if (seen.has(normalizedPath)) return;
      if (
        normalizedPath === targetPath ||
        normalizedPath.startsWith(`${targetPath}/`)
      ) {
        return;
      }
      seen.add(normalizedPath);
      options.push({ label, path: normalizedPath, description });
    }

    addOption("Raiz del proyecto", projectRoot, "Nivel principal del proyecto");
    addOption("Carpeta actual", current, "Ubicacion abierta");
    addOption("Carpeta superior", getParentFolder(current), "Subir un nivel");

    function addTreeOptions(node: FolderTreeNode) {
      addOption(node.name, node.path, "Carpeta del proyecto");
      node.children.forEach(addTreeOptions);
    }

    if (activeFolderTree) {
      addTreeOptions(activeFolderTree);
    } else {
      folderRows.forEach((folder) =>
        addOption(folder.name, folder.path, "Subcarpeta visible")
      );
    }

    return options;
  }

  async function submitFolderDialog() {
    if (!folderActionTarget || !folderDialogMode) return;

    const value = folderInputValue.trim();

    if ((folderDialogMode === "rename" || folderDialogMode === "move") && !value) {
      setFolderActionError("Completa el campo requerido.");
      return;
    }

    if (folderDialogMode === "delete" && value !== folderActionTarget.name) {
      setFolderActionError(
        `Para confirmar, escribe exactamente: ${folderActionTarget.name}`
      );
      return;
    }

    try {
      setIsFolderSubmitting(true);
      setFolderActionError("");

      if (folderDialogMode === "rename") {
        await renameFolder(folderActionTarget.path, value);
      }

      if (folderDialogMode === "move") {
        await moveFolder(folderActionTarget.path, value);
      }

      if (folderDialogMode === "delete") {
        await deleteFolder(folderActionTarget.path);
      }

      closeFolderDialog();
      requestDocumentExplorerRefresh();
    } catch (error) {
      setFolderActionError(
        error instanceof Error ? error.message : "No se pudo completar la accion"
      );
    } finally {
      setIsFolderSubmitting(false);
    }
  }

  function renderTreeRow({
    href,
    label,
    path,
    depth,
    isCurrent = false,
    showActions = false
  }: {
    href: string;
    label: string;
    path: string;
    depth: number;
    isCurrent?: boolean;
    showActions?: boolean;
  }) {
    const normalizedPath = normalizeExplorerPath(path);
    const normalizedCurrentPath = normalizeExplorerPath(currentPath);
    const expanded =
      expandedFolders.has(normalizedPath) ||
      normalizedCurrentPath.startsWith(`${normalizedPath}/`);

    const treeNode = activeFolderTree
      ? findTreeNode(activeFolderTree, normalizedPath)
      : null;
    const hasKnownChildren = Boolean(treeNode?.children.length);
    const isLoadingChildren = loadingTreePaths.has(normalizedPath);

    return (
      <div key={normalizedPath}>
        <div
          className={`group flex items-center gap-1 rounded px-2 py-1.5 text-slate-700 hover:bg-white ${
            isCurrent ? "bg-white font-semibold text-slate-900" : ""
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
        >
          <button
            type="button"
            onClick={() => {
              if (!hasKnownChildren) {
                void loadTreeChildren(normalizedPath);
              }

              toggleExpanded(normalizedPath);
            }}
            className="h-6 w-6 shrink-0 rounded text-slate-500 hover:bg-slate-100 disabled:cursor-default disabled:text-slate-300 disabled:hover:bg-transparent"
            aria-label={`Expandir ${label}`}
          >
            {isLoadingChildren ? "..." : expanded ? "v" : ">"}
          </button>
          <a
            href={href}
            onClick={(event) => {
              event.preventDefault();
              router.push(href);
            }}
            className="min-w-0 flex-1 truncate text-left"
          >
            {label}
          </a>
          {showActions ? (
            <button
              type="button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const rect = event.currentTarget.getBoundingClientRect();
                setFolderActionTarget({ path: normalizedPath, name: label });
                setFolderMenuPosition(getMenuPosition(rect));
              }}
              className="h-7 w-7 shrink-0 rounded text-slate-500 opacity-100 hover:bg-slate-100 lg:opacity-0 lg:group-hover:opacity-100"
              aria-label={`Acciones de ${label}`}
            >
              ...
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  function findTreeNode(node: FolderTreeNode, path: string): FolderTreeNode | null {
    if (normalizeExplorerPath(node.path) === normalizeExplorerPath(path)) {
      return node;
    }

    for (const child of node.children) {
      const match = findTreeNode(child, path);
      if (match) return match;
    }

    return null;
  }

  function sortFolderTreeChildren(children: FolderTreeNode[]) {
    return [...children].sort((left, right) =>
      left.name.localeCompare(right.name, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
  }

  function mergeFolderNodeChildren(
    existingChildren: FolderTreeNode[],
    incomingChildren: FolderTreeNode[]
  ) {
    const existingByPath = new Map(
      existingChildren.map((child) => [normalizeExplorerPath(child.path), child])
    );
    const incomingPaths = new Set(
      incomingChildren.map((child) => normalizeExplorerPath(child.path))
    );

    const mergedIncoming = incomingChildren.map((child) => {
      const normalizedPath = normalizeExplorerPath(child.path);
      const existing = existingByPath.get(normalizedPath);

      if (!existing) return child;

      return {
        ...existing,
        ...child,
        children: existing.children.length > 0 ? existing.children : child.children
      };
    });

    const retainedExisting = existingChildren.filter(
      (child) => !incomingPaths.has(normalizeExplorerPath(child.path))
    );

    return sortFolderTreeChildren([...mergedIncoming, ...retainedExisting]);
  }

  async function loadTreeChildren(path: string) {
    const normalizedPath = normalizeExplorerPath(path);

    if (!activeFolderTree || loadingTreePaths.has(normalizedPath)) return;

    setLoadingTreePaths((current) => new Set(current).add(normalizedPath));

    try {
      const response = await getFolders(normalizedPath, projectCode);
      const children = response.data.items.map((folder) => ({
        ...folder,
        path: normalizeExplorerPath(folder.path),
        children: []
      }));

      setLocalFolderTree((current) => {
        if (!current) return current;

        function updateNode(node: FolderTreeNode): FolderTreeNode {
          if (normalizeExplorerPath(node.path) === normalizedPath) {
            return { ...node, children: mergeFolderNodeChildren(node.children, children) };
          }

          return {
            ...node,
            children: node.children.map(updateNode)
          };
        }

        return updateNode(current);
      });
    } finally {
      setLoadingTreePaths((current) => {
        const next = new Set(current);
        next.delete(normalizedPath);
        return next;
      });
    }
  }

  function renderTreeNode(node: FolderTreeNode, depth: number) {
    const normalizedPath = normalizeExplorerPath(node.path);
    const normalizedCurrentPath = normalizeExplorerPath(currentPath);
    const expanded =
      expandedFolders.has(normalizedPath) ||
      normalizedCurrentPath.startsWith(`${normalizedPath}/`);

    return (
      <div key={normalizedPath}>
        {renderTreeRow({
          href: buildHref(normalizedPath),
          label: node.name,
          path: normalizedPath,
          depth,
          isCurrent:
            normalizeExplorerPath(currentPath) === normalizeExplorerPath(normalizedPath),
          showActions: normalizedPath !== normalizeExplorerPath(projectCode ? `/${projectCode}` : "/")
        })}
        {expanded && node.children.length > 0 ? (
          <div>
            {node.children.map((child) => renderTreeNode(child, depth + 1))}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <section className="h-[calc(100vh-140px)] min-h-[640px] w-full max-w-full overflow-hidden rounded border border-slate-300 bg-white shadow-sm">
      <div className="grid h-full min-h-0 min-w-0 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden border-b border-slate-200 bg-slate-50 lg:border-b-0 lg:border-r">
          <div className="border-b border-slate-200 px-3 py-2">
            <h2 className="text-sm font-semibold text-slate-900">Archivos</h2>
            <p className="mt-1 text-xs text-slate-500">
              Carpetas del proyecto y ubicacion actual
            </p>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-2 text-sm">
            {activeFolderTree && hasTreeChildren ? (
              renderTreeNode(activeFolderTree, 0)
            ) : (
              <>
                {renderTreeRow({
                  href: buildHref(projectCode ? `/${projectCode}` : "/"),
                  label: projectCode || "Repositorio",
                  path: projectCode ? `/${projectCode}` : "/",
                  depth: 0,
                  isCurrent:
                    normalizeExplorerPath(currentPath) ===
                    normalizeExplorerPath(projectCode ? `/${projectCode}` : "/")
                })}

                {pathParts.slice(projectCode ? 1 : 0).map((part, index) => {
                  const rootOffset = projectCode ? 1 : 0;
                  const partial = `/${pathParts
                    .slice(0, rootOffset + index + 1)
                    .join("/")}`;

                  return renderTreeRow({
                    href: buildHref(partial),
                    label: part,
                    path: partial,
                    depth: index + 1,
                    isCurrent:
                      normalizeExplorerPath(currentPath) ===
                      normalizeExplorerPath(partial),
                    showActions: partial !== `/${projectCode}`
                  });
                })}
              </>
            )}

            {!folderTree || !hasTreeChildren ? (
              <div className="mt-2 border-t border-slate-200 pt-2">
              {folderRows.length > 0 ? (
                folderRows.map((folder) =>
                  renderTreeRow({
                    href: buildHref(folder.path),
                    label: folder.name,
                    path: folder.path,
                    depth: Math.max(1, pathParts.length),
                    showActions: true
                  })
                )
              ) : (
                <div className="px-2 py-3 text-xs text-slate-500">
                  No hay subcarpetas visibles.
                </div>
              )}
              </div>
            ) : null}
          </nav>
        </aside>

        <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
          <div className="grid min-w-0 gap-2 border-b border-slate-200 p-3 md:grid-cols-[1fr_auto] md:items-center">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Contenido
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {filteredRows.length} elemento(s) visible(s) en esta ubicacion
              </p>
            </div>

            <div className="w-full min-w-0 md:w-[420px]">
              <input
                type="text"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nombre, extension, estado o ruta..."
                className="h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm outline-none placeholder:text-slate-400 focus:border-red-600"
              />
            </div>
          </div>

          <div className="grid min-w-0 gap-2 border-b border-slate-200 bg-slate-50 p-2 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded border border-slate-200 bg-white px-3 py-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Carpetas
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {stats.folders}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-3 py-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Archivos
              </div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {stats.documents}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-3 py-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                BIM
              </div>
              <div className="mt-1 text-xl font-semibold text-red-700">
                {stats.bim}
              </div>
            </div>
            <div className="rounded border border-slate-200 bg-white px-3 py-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Con workflow
              </div>
              <div className="mt-1 text-xl font-semibold text-blue-700">
                {stats.withWorkflow}
              </div>
            </div>
          </div>

          <div className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain">
            <DocumentsExplorer
              rows={filteredRows}
              currentPath={currentPath}
              projectCode={projectCode}
            />
          </div>
        </div>
      </div>

      {folderActionTarget && !folderDialogMode ? (
        <div
          className="fixed inset-0 z-[100000] bg-transparent"
          onClick={() => {
            setFolderActionTarget(null);
            setFolderMenuPosition(null);
          }}
        >
          <div
            className="absolute max-h-[calc(100vh-2rem)] w-64 overflow-y-auto rounded border border-slate-200 bg-white py-1 shadow-xl"
            style={{
              top: folderMenuPosition?.top ?? 0,
              left: folderMenuPosition?.left ?? 0
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => openFolderDialog(folderActionTarget, "rename")}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Cambiar nombre
            </button>
            <button
              type="button"
              onClick={() => openFolderDialog(folderActionTarget, "move")}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Desplazar
            </button>
            <button
              type="button"
              onClick={() => openFolderDialog(folderActionTarget, "delete")}
              className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            >
              Suprimir
            </button>
          </div>
        </div>
      ) : null}

      {folderActionTarget && folderDialogMode ? (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {folderDialogMode === "rename"
                  ? "Cambiar nombre"
                  : folderDialogMode === "move"
                    ? "Seleccionar carpeta de destino"
                    : "Suprimir carpeta"}
              </h2>
              <p className="mt-1 break-all text-sm text-slate-500">
                {folderActionTarget.path}
              </p>
            </div>

            <div className="space-y-4 px-5 py-5">
              {folderDialogMode === "move" ? (
                <div className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                  {getFolderDestinationOptions(folderActionTarget).map((option) => {
                    const selected =
                      normalizeExplorerPath(folderInputValue) === option.path;

                    return (
                      <button
                        key={option.path}
                        type="button"
                        onClick={() => setFolderInputValue(option.path)}
                        className={`mb-2 block w-full rounded border px-3 py-2 text-left text-sm last:mb-0 ${
                          selected
                            ? "border-red-300 bg-red-50 text-red-900"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                        }`}
                      >
                        <span className="block font-semibold">{option.label}</span>
                        <span className="block text-xs text-slate-500">
                          {option.description}
                        </span>
                        <span className="mt-1 block break-all text-xs text-slate-600">
                          {option.path}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : folderDialogMode === "delete" ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Para confirmar, escribe exactamente: {folderActionTarget.name}
                  </label>
                  <input
                    value={folderInputValue}
                    onChange={(event) => setFolderInputValue(event.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                  />
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Nuevo nombre
                  </label>
                  <input
                    value={folderInputValue}
                    onChange={(event) => setFolderInputValue(event.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                  />
                </div>
              )}

              {folderActionError ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {folderActionError}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeFolderDialog}
                disabled={isFolderSubmitting}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submitFolderDialog()}
                disabled={isFolderSubmitting}
                className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {isFolderSubmitting ? "Procesando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
