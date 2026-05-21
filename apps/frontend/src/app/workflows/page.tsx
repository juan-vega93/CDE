import Link from "next/link";
import { PortalShell } from "@/components/layout/portal-shell";

type WorkPackage = {
  id: number;
  subject: string;
  description?: string;
  status?: string;
  createdAt?: string;
  openProjectId?: number;
  bcfTopicId?: string;
  projectCode?: string;
  snapshotUrl?: string;
  viewpointInfo?: string;
};

type WorkPackageLink = {
  id: string;
  documentId: string;
  documentPath: string;
  documentName?: string;
  workPackageId: number;
  linkType?: string;
  status?: string;
  workPackageStatusName?: string;
  createdAt?: string;
  updatedAt?: string;
};
type BcfTopic = {
  id: string;
  projectCode?: string;
  title: string;
  status?: string;
  openProject?: {
    workPackageId?: string | number;
    syncStatus?: string;
  };
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type WorkflowRow = {
  id: number;
  subject: string;
  origin: "Documento" | "BCF" | "OpenProject";
  projectCode: string;
  status: string;
  relatedName: string;
  relatedPath: string;
  createdAt: string;
};

async function fetchBff<T>(path: string): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:4000";

  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Error consultando ${path}`);
  }

  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    throw new Error(payload.message ?? `Respuesta inválida de ${path}`);
  }

  return payload.data;
}

function getProjectCodeFromPath(path?: string) {
  return (
    String(path || "")
      .split("/")
      .filter(Boolean)[0] || "-"
  );
}

function getFileNameFromPath(path?: string) {
  const parts = String(path || "")
    .split("/")
    .filter(Boolean);

  return parts[parts.length - 1] || "-";
}

function getOpenProjectUrl(workPackageId: number) {
  const baseUrl = process.env.NEXT_PUBLIC_OPENPROJECT_URL;

  if (!baseUrl) return "";

  return `${baseUrl.replace(/\/$/, "")}/work_packages/${workPackageId}`;
}

function formatDate(value?: string) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  return date.toLocaleString();
}

function formatOriginLabel(origin: WorkflowRow["origin"]) {
  if (origin === "BCF") return "Incidencia BCF";
  if (origin === "Documento") return "Revisión documental";

  return "OpenProject";
}

type WorkflowsPageProps = {
  searchParams: Promise<{
    projectCode?: string | string[];
  }>;
};

export default async function WorkflowsPage({
  searchParams
}: WorkflowsPageProps) {
  const resolvedSearchParams = await searchParams;

  const rawProjectCode = resolvedSearchParams?.projectCode;
  const projectCode =
    typeof rawProjectCode === "string"
      ? rawProjectCode.trim().toUpperCase()
      : Array.isArray(rawProjectCode)
      ? rawProjectCode[0]?.trim().toUpperCase()
      : "";

  const [workPackages, links, bcfTopics] = await Promise.all([
    fetchBff<WorkPackage[]>("/api/work-packages"),
    fetchBff<WorkPackageLink[]>("/api/work-package-links"),
    fetchBff<BcfTopic[]>("/api/bcf/topics")
  ]);
  const activeBcfTopicIds = new Set(
    bcfTopics
      .filter((topic) => topic.projectCode)
      .map((topic) => topic.id)
  );

  const activeBcfWorkPackageIds = new Set(
    bcfTopics
      .filter((topic) => topic.projectCode && topic.openProject?.workPackageId)
      .map((topic) => Number(topic.openProject?.workPackageId))
      .filter((id) => Number.isFinite(id))
  );

  const ignoredRootFolders = new Set([
    "WIP",
    "SHARED",
    "PUBLISHED",
    "ARCHIVE",
    "ARCHIVED"
  ]);

  function isRealProjectDocumentPath(path?: string) {
    const firstSegment = getProjectCodeFromPath(path);

    if (!firstSegment || firstSegment === "-") return false;

    return !ignoredRootFolders.has(firstSegment.toUpperCase());
  }
  

  const linkByWorkPackageId = new Map<number, WorkPackageLink>();

  for (const link of links) {
    linkByWorkPackageId.set(Number(link.workPackageId), link);
  }

  const rowsFromWorkPackages: WorkflowRow[] = workPackages.flatMap(
  (wp): WorkflowRow[] => {
    const workPackageId = Number(wp.openProjectId ?? wp.id);
    const linkedDocument = linkByWorkPackageId.get(workPackageId);

    if (linkedDocument) {
      if (!isRealProjectDocumentPath(linkedDocument.documentPath)) {
        return [];
      }

      return [
        {
          id: workPackageId,
          subject: wp.subject || `Work Package #${workPackageId}`,
          origin: "Documento",
          projectCode: getProjectCodeFromPath(linkedDocument.documentPath),
          status:
            linkedDocument.workPackageStatusName ??
            linkedDocument.status ??
            wp.status ??
            "-",
          relatedName:
            linkedDocument.documentName ??
            getFileNameFromPath(linkedDocument.documentPath),
          relatedPath: linkedDocument.documentPath,
          createdAt: linkedDocument.createdAt ?? wp.createdAt ?? ""
        }
      ];
    }

    if (wp.bcfTopicId) {
      const bcfStillExists =
        activeBcfTopicIds.has(wp.bcfTopicId) ||
        activeBcfWorkPackageIds.has(workPackageId);

      if (!bcfStillExists) {
        return [];
      }

      return [
        {
          id: workPackageId,
          subject: wp.subject || `Incidencia BCF #${workPackageId}`,
          origin: "BCF" as const,
          projectCode: wp.projectCode ?? "-",
          status: wp.status ?? "-",
          relatedName: `Topic BCF ${wp.bcfTopicId}`,
          relatedPath: wp.snapshotUrl ?? wp.viewpointInfo ?? "",
          createdAt: wp.createdAt ?? ""
        }
      ];
    }

    return [];
      }
  );

  const existingIds = new Set(rowsFromWorkPackages.map((row) => row.id));

  const rowsFromLinksOnly: WorkflowRow[] = links
  .filter((link) => !existingIds.has(Number(link.workPackageId)))
  .filter((link) => isRealProjectDocumentPath(link.documentPath))
    .map((link) => ({
      id: Number(link.workPackageId),
      subject: `Revisión documental #${link.workPackageId}`,
      origin: "Documento" as const,
      projectCode: getProjectCodeFromPath(link.documentPath),
      status: link.workPackageStatusName ?? link.status ?? "-",
      relatedName: link.documentName ?? getFileNameFromPath(link.documentPath),
      relatedPath: link.documentPath,
      createdAt: link.createdAt ?? ""
    }));

  const allRows = [...rowsFromWorkPackages, ...rowsFromLinksOnly];

  // Filter by projectCode if specified
  const rows = (projectCode
    ? allRows.filter((row) => row.projectCode === projectCode)
    : allRows
  ).sort((a, b) => {
    const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;

    return bd - ad;
  });

  return (
    <PortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950">
            Workflows
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            {projectCode
              ? `Workflows del proyecto ${projectCode}`
              : "Incidencias BCF y revisiones documentales sincronizadas con OpenProject."}
          </p>
        </div>

        {projectCode && (
          <Link
            href={`/documents?projectCode=${encodeURIComponent(projectCode)}`}
            className="inline-flex rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            ← Volver a documentos
          </Link>
        )}

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">
                Work Packages
              </h2>
              <p className="text-sm text-slate-500">
                {rows.length} elemento(s) encontrado(s)
              </p>
            </div>
          </div>

          {rows.length === 0 ? (
            <div className="px-5 py-10 text-sm text-slate-500">
              No hay workflows registrados todavía.
            </div>
          ) : (
            <div className="max-h-[calc(100vh-260px)] overflow-auto">
              <table className="min-w-[1200px] text-left text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-5 py-3">ID</th>
                    <th className="px-5 py-3">Título</th>
                    <th className="px-5 py-3">Origen</th>
                    <th className="px-5 py-3">Proyecto</th>
                    <th className="px-5 py-3">Estado</th>
                    <th className="px-5 py-3">Relacionado</th>
                    <th className="px-5 py-3">Fecha</th>
                    <th className="px-5 py-3 text-right">Acción</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-200">
                  {rows.map((row) => {
                    const openProjectUrl = getOpenProjectUrl(row.id);

                    return (
                      <tr
                        key={`${row.origin}-${row.id}`}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-5 py-4 font-medium text-slate-900">
                          #{row.id}
                        </td>

                        <td className="px-5 py-4">
                          <div className="font-medium text-slate-900">
                            {row.subject}
                          </div>

                          {row.relatedPath ? (
                            <div className="mt-1 max-w-[360px] truncate text-xs text-slate-500">
                              {row.relatedPath.startsWith("http") ||
                              row.relatedPath.startsWith("/api/")
                                ? "Documento vinculado / snapshot"
                                : row.relatedPath}
                            </div>
                          ) : null}
                        </td>

                        <td className="px-5 py-4">
                          <span
                            className={
                              row.origin === "BCF"
                                ? "rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700"
                                : row.origin === "Documento"
                                  ? "rounded-full bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                                  : "rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700"
                            }
                          >
                            {formatOriginLabel(row.origin)}
                          </span>
                        </td>

                        <td className="px-5 py-4 font-medium text-slate-700">
                          {row.projectCode}
                        </td>

                        <td className="px-5 py-4">
                          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700">
                            {row.status}
                          </span>
                        </td>

                        <td className="px-5 py-4 text-slate-700">
                          {row.relatedName}
                        </td>

                        <td className="px-5 py-4 text-slate-500">
                          {formatDate(row.createdAt)}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            <Link
                              href={`/workflows/${row.id}`}
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              Ver detalle
                            </Link>

                            {openProjectUrl ? (
                              <Link
                                href={openProjectUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="rounded-lg bg-red-700 px-3 py-2 text-xs font-medium text-white hover:bg-red-800"
                              >
                                OpenProject
                              </Link>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </PortalShell>
  );
}