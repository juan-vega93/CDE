"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { DocumentsExplorerPanel } from "@/components/documents/documents-explorer-panel";
import { ExplorerToolbar } from "@/components/documents/explorer-toolbar";
import { PortalShell } from "@/components/layout/portal-shell";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import {
  getCachedDocumentExplorerSnapshot,
  getDocumentExplorer
} from "@/services/documents.service";
import type { ExplorerRow, FolderTreeNode, WorkPackageLink } from "@/types/documents";
import { enrichDocumentsWithLinks } from "@/lib/enrich-documents-with-links";
import { DOCUMENT_EXPLORER_REFRESH_EVENT } from "@/lib/document-explorer-events";
import {
  buildFolderTreePatch,
  mergeFolderTrees as mergeFolderTreeNodes,
  normalizeTreePath
} from "@/lib/folder-tree";

function normalizeProjectCode(value: string | null): string {
  return value?.trim().toUpperCase() || "";
}

function normalizePath(value: string | null): string {
  if (!value) return "";
  return normalizeTreePath(value);
}

function getProjectCodeFromPath(path: string): string {
  return (
    path
      .split("/")
      .filter(Boolean)[0]
      ?.trim()
      .toUpperCase() || ""
  );
}

function getParentPath(
  path: string,
  isProjectScoped: boolean,
  projectRootPath: string
): string {
  const cleanPath = path.replace(/\/+$/g, "");

  if (!cleanPath || cleanPath === "/") {
    return "/";
  }

  const parts = cleanPath.split("/").filter(Boolean);
  parts.pop();

  const parent = `/${parts.join("/")}`;

  if (isProjectScoped) {
    return parent.length < projectRootPath.length ? projectRootPath : parent;
  }

  return parent || "/";
}

function mergeFolderTrees(
  current: FolderTreeNode | null,
  incoming: FolderTreeNode | null
): FolderTreeNode | null {
  return mergeFolderTreeNodes(current, incoming);
}

export function DocumentsPageClient() {
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<ExplorerRow[]>([]);
  const [folderTree, setFolderTree] = useState<FolderTreeNode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const renderedExplorerKeyRef = useRef("");

  const projectCode = normalizeProjectCode(searchParams.get("projectCode"));
  const requestedPath = normalizePath(searchParams.get("path"));
  const projectRootPath = projectCode ? `/${projectCode}` : "/";

  const currentPath = useMemo(() => {
    if (!projectCode) {
      return requestedPath || "/";
    }

    if (
      requestedPath &&
      (requestedPath === projectRootPath ||
        requestedPath.startsWith(`${projectRootPath}/`))
    ) {
      return requestedPath;
    }

    return projectRootPath;
  }, [projectCode, projectRootPath, requestedPath]);

  const projectCodeFromPath = getProjectCodeFromPath(currentPath);
  const effectiveProjectCode = projectCode || projectCodeFromPath;
  const isProjectScoped = Boolean(effectiveProjectCode);
  const effectiveProjectRootPath = effectiveProjectCode
    ? `/${effectiveProjectCode}`
    : "/";
  const canGoUp = isProjectScoped
    ? currentPath !== effectiveProjectRootPath
    : currentPath !== "/";
  const parentPath = getParentPath(
    currentPath,
    isProjectScoped,
    effectiveProjectRootPath
  );

  useEffect(() => {
    let cancelled = false;

    async function loadDocuments() {
      const explorerKey = `${effectiveProjectCode}:${currentPath}`;
      const explorerOptions = {
        includeTree: true,
        treeRootPath: effectiveProjectRootPath,
        treeFocusPath: currentPath,
        treeDepth: 1
      };

      if (!effectiveProjectCode) {
        setRows([]);
        setIsLoading(false);
        setError(null);
        return;
      }

      const cachedExplorer = getCachedDocumentExplorerSnapshot(
        currentPath,
        effectiveProjectCode,
        explorerOptions
      );

      if (cachedExplorer && renderedExplorerKeyRef.current !== explorerKey) {
        const cachedBaseRows: ExplorerRow[] = [
          ...cachedExplorer.folders.map((folder) => ({
            kind: "folder" as const,
            name: folder.name,
            path: folder.path,
            type: folder.type
          })),
          ...cachedExplorer.documents.map((doc) => ({
            kind: "document" as const,
            id: doc.id,
            name: doc.name,
            path: doc.path,
            extension: doc.extension,
            size: doc.size,
            modifiedAt: doc.modifiedAt,
            modifiedAtLocal: doc.modifiedAtLocal,
            etag: doc.etag,
            fileId: doc.fileId,
            contentType: doc.contentType,
            workflowStatus: doc.workflowStatus,
            uiStatus: doc.uiStatus,
            bimDerivative: doc.bimDerivative
          }))
        ];

        setRows(
          enrichDocumentsWithLinks(
            cachedBaseRows,
            cachedExplorer.workPackageLinks as WorkPackageLink[]
          )
        );
        const cachedVisibleTree = buildFolderTreePatch(
          effectiveProjectRootPath,
          currentPath,
          cachedBaseRows
        );
        setFolderTree((current) =>
          mergeFolderTrees(
            mergeFolderTrees(current, cachedExplorer.folderTree ?? null),
            cachedVisibleTree
          )
        );
        renderedExplorerKeyRef.current = explorerKey;
      }

      setIsLoading(!cachedExplorer && renderedExplorerKeyRef.current !== explorerKey);
      setError(null);

      try {
        const explorer = await getDocumentExplorer(
          currentPath,
          effectiveProjectCode,
          explorerOptions
        );

        if (cancelled) return;

        const documents = explorer.documents;
        const folders = explorer.folders;

        const baseRows: ExplorerRow[] = [
          ...folders.map((folder) => ({
            kind: "folder" as const,
            name: folder.name,
            path: folder.path,
            type: folder.type
          })),
          ...documents.map((doc) => ({
            kind: "document" as const,
            id: doc.id,
            name: doc.name,
            path: doc.path,
            extension: doc.extension,
            size: doc.size,
            modifiedAt: doc.modifiedAt,
            modifiedAtLocal: doc.modifiedAtLocal,
            etag: doc.etag,
            fileId: doc.fileId,
            contentType: doc.contentType,
            workflowStatus: doc.workflowStatus,
            uiStatus: doc.uiStatus,
            bimDerivative: doc.bimDerivative
          }))
        ];

        setRows(
          enrichDocumentsWithLinks(
            baseRows,
            explorer.workPackageLinks as WorkPackageLink[]
          )
        );
        renderedExplorerKeyRef.current = explorerKey;
        const visibleTree = buildFolderTreePatch(
          effectiveProjectRootPath,
          currentPath,
          baseRows
        );
        setFolderTree((current) =>
          mergeFolderTrees(
            mergeFolderTrees(current, explorer.folderTree ?? null),
            visibleTree
          )
        );
      } catch (err) {
        if (!cancelled) {
          setRows([]);
          setFolderTree((current) => current);
          setError(
            err instanceof Error
              ? err.message
              : "No se pudo obtener la lista de documentos"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadDocuments();

    return () => {
      cancelled = true;
    };
  }, [currentPath, effectiveProjectCode, effectiveProjectRootPath, reloadToken]);

  useEffect(() => {
    function handleRefresh() {
      setReloadToken((current) => current + 1);
    }

    window.addEventListener(DOCUMENT_EXPLORER_REFRESH_EVENT, handleRefresh);

    return () => {
      window.removeEventListener(DOCUMENT_EXPLORER_REFRESH_EVENT, handleRefresh);
    };
  }, []);

  const relativeBreadcrumbParts =
    effectiveProjectCode && currentPath.startsWith(`/${effectiveProjectCode}`)
      ? currentPath
          .replace(`/${effectiveProjectCode}`, "")
          .split("/")
          .filter(Boolean)
      : currentPath.split("/").filter(Boolean);

  const breadcrumbItems = [
    {
      label: "Proyectos",
      href: "/admin/project-cards"
    },
    {
      label: "Documentos",
      href: effectiveProjectCode
        ? `/documents?projectCode=${encodeURIComponent(effectiveProjectCode)}`
        : "/documents"
    },
    ...relativeBreadcrumbParts.map((part, index) => {
      const partialPath = effectiveProjectCode
        ? `/${effectiveProjectCode}/${relativeBreadcrumbParts
            .slice(0, index + 1)
            .join("/")}`
        : `/${relativeBreadcrumbParts.slice(0, index + 1).join("/")}`;

      return {
        label: part,
        href: `/documents?path=${encodeURIComponent(partialPath)}${
          effectiveProjectCode
            ? `&projectCode=${encodeURIComponent(effectiveProjectCode)}`
            : ""
        }`
      };
    })
  ];

  if (!effectiveProjectCode) {
    return (
      <PortalShell>
        <section className="rounded border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Contexto requerido
          </p>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            Selecciona un proyecto
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Documentos se carga solo dentro de un proyecto para evitar mezclar
            permisos, rutas e incidencias entre contratos.
          </p>
          <a
            href="/admin/project-cards"
            className="mt-5 inline-flex rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Volver a proyectos
          </a>
        </section>
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="/admin/project-cards"
            className="inline-flex h-8 items-center rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Volver a proyectos
          </a>

          <Breadcrumbs items={breadcrumbItems} />
        </div>

        <ExplorerToolbar
          currentPath={currentPath}
          parentPath={parentPath}
          canGoUp={canGoUp}
          projectCode={effectiveProjectCode}
        />

        {isLoading && rows.length === 0 ? (
          <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
            Cargando documentos...
          </section>
        ) : error ? (
          <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
            {error}
          </section>
        ) : (
          <DocumentsExplorerPanel
            rows={rows}
            folderTree={folderTree}
            currentPath={currentPath}
            projectCode={effectiveProjectCode}
          />
        )}
      </div>
    </PortalShell>
  );
}
