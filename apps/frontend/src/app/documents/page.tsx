import { DocumentsExplorerPanel } from "@/components/documents/documents-explorer-panel";
import { ExplorerToolbar } from "@/components/documents/explorer-toolbar";
import { PortalShell } from "@/components/layout/portal-shell";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
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

  const projectCodeFromPath =
    currentPath
      .split("/")
      .filter(Boolean)[0]
      ?.trim()
      .toUpperCase() || "";

  const effectiveProjectCode = projectCode || projectCodeFromPath;
  const isProjectScoped = Boolean(effectiveProjectCode);
  const effectiveProjectRootPath = effectiveProjectCode
    ? `/${effectiveProjectCode}`
    : "/";

  const canGoUp = isProjectScoped
    ? currentPath !== effectiveProjectRootPath
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
      return parent.length < effectiveProjectRootPath.length
        ? effectiveProjectRootPath
        : parent;
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

      <Breadcrumbs items={breadcrumbItems} />

      <h1 className="text-2xl font-semibold">Documentos</h1>

      <ExplorerToolbar
        currentPath={currentPath}
        parentPath={parentPath}
        canGoUp={canGoUp}
        projectCode={effectiveProjectCode}
      />

      <DocumentsExplorerPanel
        rows={rows}
        currentPath={currentPath}
        projectCode={effectiveProjectCode}
      />
    </div>
  </PortalShell>
);
}