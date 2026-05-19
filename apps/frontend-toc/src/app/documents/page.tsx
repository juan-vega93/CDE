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
  }>;
};

export default async function DocumentsPage({
  searchParams
}: DocumentsPageProps) {
  const resolvedSearchParams = await searchParams;
  const rawPath = resolvedSearchParams?.path;

  const currentPath =
    typeof rawPath === "string"
      ? rawPath
      : Array.isArray(rawPath)
      ? rawPath[0]
      : "/";

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
      <div className="mx-auto max-w-6xl">
        <Breadcrumbs items={breadcrumbItems} />

        <h1 className="mt-4 text-2xl font-semibold">Documentos</h1>

        <ExplorerToolbar currentPath={currentPath} parentPath={parentPath} />

        <DocumentsExplorerPanel rows={rows} currentPath={currentPath} />
      </div>
    </PortalShell>
  );
}