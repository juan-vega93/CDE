import { DocumentsExplorerPanel } from "@/components/documents/documents-explorer-panel";
import { ExplorerToolbar } from "@/components/documents/explorer-toolbar";
import { PortalShell } from "@/components/layout/portal-shell";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { getParentPath } from "@/lib/get-parent-path";
import { pathToBreadcrumbs } from "@/lib/path-to-breadcrumbs";
import {
  getDocuments,
  getFolders,
  getWorkPackageLinks
} from "@/services/documents.service";
import type { ExplorerRow } from "@/types/documents";
import { enrichDocumentsWithLinks } from "@/lib/enrich-documents-with-links";

type DocumentsPageProps = {
  searchParams: Promise<{
    path?: string | string[];
    projectCode?: string | string[];
  }>;
};

export default async function DocumentsPage({
  searchParams
}: DocumentsPageProps) {
  const resolvedSearchParams = await searchParams;

  const rawPath = resolvedSearchParams?.path;
  const rawProjectCode = resolvedSearchParams?.projectCode;

  const projectCode =
    typeof rawProjectCode === "string"
      ? rawProjectCode.trim().toUpperCase()
      : Array.isArray(rawProjectCode)
      ? rawProjectCode[0]?.trim().toUpperCase()
      : "";

  const requestedPath =
  typeof rawPath === "string"
    ? rawPath
    : Array.isArray(rawPath)
      ? rawPath[0]
      : "";
  const projectRootPath = projectCode ? `/${projectCode}` : "/";
  const normalizedRequestedPath = requestedPath
  ? requestedPath.startsWith("/")
    ? requestedPath
    : `/${requestedPath}`
  : "";

const currentPath = projectCode
  ? normalizedRequestedPath &&
    (normalizedRequestedPath === projectRootPath ||
      normalizedRequestedPath.startsWith(`${projectRootPath}/`))
    ? normalizedRequestedPath
    : projectRootPath
  : normalizedRequestedPath || "/";

  const isProjectScoped = Boolean(projectCode);

  const canGoUp = isProjectScoped
    ? currentPath !== projectRootPath
    : currentPath !== "/";

  function getParentPath(path: string) {
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
  const [documentsResponse, foldersResponse, workPackageLinks] =
    await Promise.all([
      getDocuments(currentPath),
      getFolders(currentPath),
      getWorkPackageLinks()
    ]);

  const documents = documentsResponse.data.items;
  const folders = foldersResponse.data.items;
  const breadcrumbItems = pathToBreadcrumbs(currentPath);
  const parentPath = getParentPath(currentPath);

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
      workflowStatus: doc.workflowStatus,
      uiStatus: doc.uiStatus
    }))
  ];

  const rows = enrichDocumentsWithLinks(baseRows, workPackageLinks);

  return (
  <PortalShell>
    <div className="space-y-5">
      <a
        href="/admin/project-cards"
        className="inline-flex rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        ← Volver a proyectos
      </a>

      <div className="text-sm text-slate-500">
        <span>Proyectos</span>
        <span className="mx-2">/</span>
        <span>Documentos</span>
        {projectCode && (
          <>
            <span className="mx-2">/</span>
            <span className="font-semibold text-slate-800">{projectCode}</span>
          </>
        )}
      </div>

      <h1 className="text-2xl font-semibold">Documentos</h1>

      <ExplorerToolbar
        currentPath={currentPath}
        parentPath={parentPath}
        canGoUp={canGoUp}
        projectCode={projectCode}
      />

      <DocumentsExplorerPanel
        rows={rows}
        currentPath={currentPath}
        projectCode={projectCode}
      />
    </div>
  </PortalShell>
);
}