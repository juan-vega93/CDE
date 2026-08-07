import Link from "next/link";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth-options";
import { PortalShell } from "@/components/layout/portal-shell";
import { WorkflowIssueActions } from "@/components/workflows/workflow-issue-actions";

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
  description?: string;
  status?: string;
  priority?: string;
  issueType?: string;
  discipline?: string;
  assignedTo?: string;
  dueDate?: string;
  creationDate?: string;
  modifiedDate?: string;
  snapshot?: string | null;
  linkedSelection?: Array<{
    modelId: string;
    expressIds: number[];
  }>;
  openProject?: {
    workPackageId?: string | number;
    syncStatus?: string;
    lastError?: string;
  };
};

type DocumentAnnotation = {
  id: string;
  projectCode: string;
  documentPath: string;
  documentVersionId?: string | null;
  pageNumber: number;
  kind: string;
  text?: string;
  metadata?: {
    title?: string;
    description?: string;
    assignedTo?: string;
    dueDate?: string;
    issueType?: string;
    priority?: string;
    discipline?: string;
    snapshotDataUrl?: string;
    comments?: Array<{
      id: string;
      author?: string;
      text: string;
      createdAt: string;
    }>;
  };
  status: string;
  author?: string;
  createdAt: string;
  updatedAt: string;
};

type CanonicalIssue = {
  id: string;
  projectCode: string;
  title: string;
  description?: string;
  sourceKind: "model" | "document";
  sourceSystem: string;
  sourceId: string;
  issueType?: string;
  status: string;
  priority?: string;
  discipline?: string;
  assignedTo?: string;
  dueDate?: string;
  documentPath?: string;
  documentName?: string;
  pageNumber?: number;
  snapshotUrl?: string;
  elementCount?: number;
  openProjectWorkPackageId?: string;
  openProjectSyncStatus?: string;
  openProjectLastError?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: {
    snapshotDataUrl?: string;
    comments?: unknown[];
  };
};

type ProjectCard = {
  code: string;
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

type WorkflowRow = {
  id: number | string;
  rowKey?: string;
  issueId?: string;
  subject: string;
  origin: "Documento" | "BCF" | "OpenProject";
  projectCode: string;
  status: string;
  priority?: string;
  issueType?: string;
  assignedTo?: string;
  description?: string;
  dueDate?: string;
  discipline?: string;
  snapshotUrl?: string;
  commentsCount?: number;
  syncStatus?: string;
  elementCount?: number;
  relatedName: string;
  relatedPath: string;
  createdAt: string;
  openProjectId?: number;
  bcfTopicId?: string;
  documentAnnotationId?: string;
  documentPageNumber?: number;
};

async function fetchBff<T>(path: string): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_BFF_URL ?? "http://localhost:4000";
  const session = await getServerSession(authOptions);
  const accessToken =
    typeof session?.accessToken === "string" ? session.accessToken : "";

  if (!accessToken) {
    throw new Error(`Sesion sin accessToken al consultar ${path}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    cache: "no-store",
    headers: accessToken
      ? {
          Authorization: `Bearer ${accessToken}`
        }
      : undefined
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `Error consultando ${path}: ${response.status}${text ? ` - ${text.slice(0, 180)}` : ""}`
    );
  }

  const payload = (await response.json()) as ApiResponse<T>;

  if (!payload.success) {
    throw new Error(payload.message ?? `Respuesta inválida de ${path}`);
  }

  return payload.data;
}

async function fetchBffSafe<T>(
  path: string,
  fallback: T
): Promise<{ data: T; error?: string }> {
  try {
    return { data: await fetchBff<T>(path) };
  } catch (error) {
    return {
      data: fallback,
      error: error instanceof Error ? error.message : `Error consultando ${path}`
    };
  }
}

async function fetchProjectScopedList<T>(
  path: string,
  projectCodes: string[]
): Promise<{ data: T[]; errors: string[] }> {
  if (projectCodes.length === 0) {
    return { data: [], errors: [] };
  }

  const results = await Promise.all(
    projectCodes.map((code) =>
      fetchBffSafe<T[]>(
        `${path}?projectCode=${encodeURIComponent(code)}`,
        []
      )
    )
  );

  return {
    data: results.flatMap((result) => result.data),
    errors: results
      .map((result) => result.error)
      .filter((error): error is string => Boolean(error))
  };
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

function getParentPath(documentPath?: string) {
  const parts = String(documentPath || "")
    .split("/")
    .filter(Boolean);

  if (parts.length <= 1) return "/";

  return `/${parts.slice(0, -1).join("/")}`;
}

function getNextcloudDocumentId(documentPath: string) {
  return `nc-${Buffer.from(documentPath).toString("base64url")}`;
}

function getDocumentIssueUrl(row: WorkflowRow) {
  if (!row.documentAnnotationId || !row.relatedPath) return "";

  const params = new URLSearchParams({
    path: getParentPath(row.relatedPath),
    projectCode: row.projectCode,
    page: String(row.documentPageNumber || 1),
    annotationId: row.documentAnnotationId
  });

  return `/documents/${encodeURIComponent(
    getNextcloudDocumentId(row.relatedPath)
  )}?${params.toString()}`;
}

function getOpenProjectUrl(workPackageId: number) {
  const baseUrl = process.env.NEXT_PUBLIC_OPENPROJECT_URL;

  if (!baseUrl) return "";

  return `${baseUrl.replace(/\/$/, "")}/work_packages/${workPackageId}`;
}

function getWorkflowSnapshotUrl(snapshotUrl?: string) {
  const cleanUrl = snapshotUrl?.trim();

  if (!cleanUrl) return "";

  if (cleanUrl.startsWith("data:image/")) {
    return cleanUrl;
  }

  if (cleanUrl.startsWith("/api/")) {
    return `/api/bff-asset?path=${encodeURIComponent(cleanUrl)}`;
  }

  const bffBaseUrl = process.env.NEXT_PUBLIC_BFF_URL;

  if (bffBaseUrl) {
    try {
      const parsed = new URL(cleanUrl);
      const bffBase = new URL(bffBaseUrl);

      if (parsed.origin === bffBase.origin) {
        return `/api/bff-asset?path=${encodeURIComponent(
          `${parsed.pathname}${parsed.search}`
        )}`;
      }
    } catch {
      return cleanUrl;
    }
  }

  return cleanUrl;
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

function formatWorkflowStatus(status: string) {
  const normalized = status.toLowerCase();

  if (normalized === "open") return "Abierta";
  if (normalized === "in_progress") return "En progreso";
  if (normalized === "resolved") return "Resuelto";
  if (normalized === "closed") return "Cerrado";
  if (normalized === "new") return "Nuevo";

  return status || "-";
}

function getKanbanColumn(status: string) {
  const normalized = status.toLowerCase();

  if (["open", "new", "nuevo", "abierta"].includes(normalized)) return "Abiertas";
  if (["in_progress", "en progreso", "asignado"].includes(normalized)) return "En curso";
  if (["in_review", "en revisión", "en revision", "respondido"].includes(normalized)) return "Revision";
  if (["resolved", "approved", "closed", "resuelto", "aprobado", "cerrado"].includes(normalized)) return "Cerradas";
  if (["rejected", "rechazado"].includes(normalized)) return "Cerradas";

  return "Abiertas";
}

function getPriorityLabel(priority?: string) {
  const normalized = String(priority || "").toLowerCase();

  if (normalized === "critical") return "Critica";
  if (normalized === "high") return "Alta";
  if (normalized === "medium") return "Media";
  if (normalized === "low") return "Baja";

  return priority || "-";
}

const STATUS_BADGE_STYLES: Record<string, string> = {
  new: "bg-slate-100 text-slate-700",
  in_progress: "bg-blue-50 text-blue-700",
  in_review: "bg-amber-50 text-amber-700",
  approved: "bg-green-50 text-green-700",
  rejected: "bg-red-50 text-red-700",
  closed: "bg-purple-50 text-purple-700",
  "En progreso": "bg-blue-50 text-blue-700",
  "En revisión": "bg-amber-50 text-amber-700",
  Aprobado: "bg-green-50 text-green-700",
  Rechazado: "bg-red-50 text-red-700",
  Cerrado: "bg-purple-50 text-purple-700",
  Nuevo: "bg-slate-100 text-slate-700",
  Abierta: "bg-red-50 text-red-700",
  Asignado: "bg-sky-50 text-sky-700",
  Respondido: "bg-indigo-50 text-indigo-700",
  Resuelto: "bg-teal-50 text-teal-700"
};

function StatusBadge({ status }: { status: string }) {
  const colorClass = STATUS_BADGE_STYLES[status] ?? "bg-slate-100 text-slate-700";

  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${colorClass}`}>
      {status}
    </span>
  );
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

  if (!projectCode) {
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
            Workflows se consulta por proyecto para que las incidencias BIM,
            revisiones PDF y paquetes documentales respeten el alcance y los
            permisos del proyecto activo.
          </p>
          <Link
            href="/admin/project-cards"
            className="mt-5 inline-flex rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800"
          >
            Volver a proyectos
          </Link>
        </section>
      </PortalShell>
    );
  }

  const projectCardsResult = projectCode
    ? { data: [] as ProjectCard[], error: undefined }
    : await fetchBffSafe<ProjectCard[]>("/api/project-cards", []);
  const scopedProjectCodes = projectCode
    ? [projectCode]
    : projectCardsResult.data
        .map((project) => project.code?.trim().toUpperCase())
        .filter((code): code is string => Boolean(code));

  const [workPackagesResult, linksResult, bcfTopicsResult] = await Promise.all([
    fetchProjectScopedList<WorkPackage>("/api/work-packages", scopedProjectCodes),
    fetchProjectScopedList<WorkPackageLink>("/api/work-package-links", scopedProjectCodes),
    fetchProjectScopedList<BcfTopic>("/api/bcf/topics", scopedProjectCodes)
  ]);
  const issuesResult =
    await fetchProjectScopedList<CanonicalIssue>("/api/issues", scopedProjectCodes);
  const documentAnnotationsResult =
    await fetchProjectScopedList<DocumentAnnotation>(
      "/api/documents/annotations/project",
      scopedProjectCodes
    );

  const workPackages = workPackagesResult.data;
  const links = linksResult.data;
  const bcfTopics = bcfTopicsResult.data;
  const canonicalOpenProjectIds = new Set(
    issuesResult.data
      .map((issue) => Number(issue.openProjectWorkPackageId))
      .filter((id) => Number.isFinite(id))
  );
  const sourceErrors = [
    projectCardsResult.error,
    ...workPackagesResult.errors,
    ...linksResult.errors,
    ...bcfTopicsResult.errors,
    ...issuesResult.errors,
    ...documentAnnotationsResult.errors
  ].filter((error): error is string => Boolean(error));
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

    if (canonicalOpenProjectIds.has(workPackageId)) {
      return [];
    }

    const linkedDocument = linkByWorkPackageId.get(workPackageId);

    if (linkedDocument) {
      if (!isRealProjectDocumentPath(linkedDocument.documentPath)) {
        return [];
      }

      return [
        {
          id: workPackageId,
          rowKey: `wp-document-${workPackageId}`,
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
          rowKey: `wp-bcf-${workPackageId}`,
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
  const bcfTopicIdsWithLiveWorkPackage = new Set(
    workPackages
      .filter((workPackage) => {
        const workPackageId = Number(workPackage.openProjectId ?? workPackage.id);
        return Number.isFinite(workPackageId) && activeBcfWorkPackageIds.has(workPackageId);
      })
      .map((workPackage) => workPackage.bcfTopicId)
      .filter((value): value is string => Boolean(value))
  );

  const canonicalSourceKeys = new Set(
    issuesResult.data.map((issue) => `${issue.sourceSystem}:${issue.sourceId}`)
  );

  const rowsFromCanonicalIssues: WorkflowRow[] = issuesResult.data.map((issue) => {
    const openProjectId = Number(issue.openProjectWorkPackageId);
    const isDocumentAnnotation = issue.sourceSystem === "document_annotation";

    return {
      id: isDocumentAnnotation ? issue.sourceId : issue.openProjectWorkPackageId ?? issue.id,
      rowKey: `canonical-${issue.id}`,
      issueId: issue.id,
      subject: issue.title,
      origin: issue.sourceKind === "model" ? "BCF" : "Documento",
      projectCode: issue.projectCode,
      status: issue.status || "open",
      priority: issue.priority,
      issueType: issue.issueType,
      assignedTo: issue.assignedTo,
      description: issue.description,
      dueDate: issue.dueDate,
      discipline: issue.discipline,
      snapshotUrl:
        issue.snapshotUrl ||
        (typeof issue.metadata?.snapshotDataUrl === "string"
          ? issue.metadata.snapshotDataUrl
          : undefined),
      commentsCount: issue.metadata?.comments?.length,
      syncStatus: issue.openProjectSyncStatus,
      elementCount: issue.elementCount ?? 0,
      relatedName:
        issue.sourceKind === "model"
          ? `Topic BCF ${issue.sourceId}`
          : `${issue.documentName ?? "PDF"} · página ${issue.pageNumber ?? 1}`,
      relatedPath: issue.documentPath ?? issue.snapshotUrl ?? issue.openProjectLastError ?? "",
      createdAt: issue.updatedAt || issue.createdAt,
      openProjectId: Number.isFinite(openProjectId) ? openProjectId : undefined,
      bcfTopicId: issue.sourceSystem === "bcf_topic" ? issue.sourceId : undefined,
      documentAnnotationId: isDocumentAnnotation ? issue.sourceId : undefined,
      documentPageNumber: issue.pageNumber
    };
  });

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

  const rowsFromBcfTopicsOnly: WorkflowRow[] = bcfTopics
    .filter((topic) => topic.projectCode)
    .filter((topic) => !canonicalSourceKeys.has(`bcf_topic:${topic.id}`))
    .filter(
      (topic) =>
        topic.openProject?.syncStatus === "error" ||
        !bcfTopicIdsWithLiveWorkPackage.has(topic.id)
    )
    .map((topic) => {
      const workPackageId = Number(topic.openProject?.workPackageId);

      return {
        id: topic.openProject?.workPackageId ?? topic.id,
        subject: topic.title || `Incidencia BIM ${topic.id}`,
        origin: "BCF" as const,
        projectCode: topic.projectCode ?? "-",
        status: topic.status ?? "open",
        priority: topic.priority,
        issueType: topic.issueType,
        assignedTo: topic.assignedTo,
        syncStatus: topic.openProject?.syncStatus,
        elementCount:
          topic.linkedSelection?.reduce(
            (total, selection) => total + selection.expressIds.length,
            0
          ) ?? 0,
        relatedName: topic.issueType
          ? `Incidencia ${topic.issueType}`
          : `Topic BCF ${topic.id}`,
        relatedPath: topic.snapshot ?? topic.openProject?.lastError ?? "",
        createdAt: topic.creationDate ?? topic.modifiedDate ?? "",
        openProjectId: Number.isFinite(workPackageId) ? workPackageId : undefined,
        bcfTopicId: topic.id
      };
    });

  const rowsFromDocumentAnnotations: WorkflowRow[] =
    documentAnnotationsResult.data
    .filter(
      (annotation) =>
        !canonicalSourceKeys.has(`document_annotation:${annotation.id}`)
    )
    .map((annotation) => ({
      id: annotation.id,
      subject:
        annotation.metadata?.title ||
        annotation.text ||
        `Revision PDF pagina ${annotation.pageNumber}`,
      origin: "Documento" as const,
      projectCode: annotation.projectCode,
      status: annotation.status || "open",
      assignedTo: annotation.metadata?.assignedTo,
      description: annotation.metadata?.description,
      dueDate: annotation.metadata?.dueDate,
      discipline: annotation.metadata?.discipline,
      issueType: annotation.metadata?.issueType,
      priority: annotation.metadata?.priority,
      snapshotUrl: annotation.metadata?.snapshotDataUrl,
      commentsCount: annotation.metadata?.comments?.length ?? 0,
      relatedName: `PDF · pagina ${annotation.pageNumber}`,
      relatedPath: annotation.documentPath,
      createdAt: annotation.updatedAt || annotation.createdAt,
      documentAnnotationId: annotation.id,
      documentPageNumber: annotation.pageNumber
    }));

  const allRows = [
    ...rowsFromCanonicalIssues,
    ...rowsFromWorkPackages,
    ...rowsFromLinksOnly,
    ...rowsFromBcfTopicsOnly,
    ...rowsFromDocumentAnnotations
  ];
  const deduplicatedRows = Array.from(
    allRows
      .reduce((rowsByKey, row) => {
        const semanticKey = row.issueId
          ? `issue:${row.issueId}`
          : row.openProjectId
            ? `op:${row.openProjectId}`
            : row.bcfTopicId
              ? `bcf:${row.bcfTopicId}`
              : row.documentAnnotationId
                ? `doc-annotation:${row.documentAnnotationId}`
                : `${row.origin}:${row.projectCode}:${row.id}`;

        if (!rowsByKey.has(semanticKey)) {
          rowsByKey.set(semanticKey, {
            ...row,
            rowKey: row.rowKey ?? semanticKey
          });
        }

        return rowsByKey;
      }, new Map<string, WorkflowRow>())
      .values()
  );

  // Filter by projectCode if specified
  const rows = (projectCode
    ? deduplicatedRows.filter((row) => row.projectCode === projectCode)
    : deduplicatedRows
  ).sort((a, b) => {
    const ad = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bd = b.createdAt ? new Date(b.createdAt).getTime() : 0;

    return bd - ad;
  });

  const summary = {
    total: rows.length,
    bim: rows.filter((row) => row.origin === "BCF").length,
    documents: rows.filter((row) => row.origin === "Documento").length,
    open: rows.filter((row) => getKanbanColumn(row.status) === "Abiertas").length,
    inProgress: rows.filter((row) => getKanbanColumn(row.status) === "En curso").length,
    closed: rows.filter((row) => getKanbanColumn(row.status) === "Cerradas").length,
    opErrors: rows.filter((row) => row.syncStatus === "error").length
  };

  const kanbanColumns = ["Abiertas", "En curso", "Revision", "Cerradas"] as const;
  const rowsByColumn = new Map<(typeof kanbanColumns)[number], WorkflowRow[]>(
    kanbanColumns.map((column) => [column, []])
  );

  for (const row of rows) {
    const column = getKanbanColumn(row.status) as (typeof kanbanColumns)[number];
    rowsByColumn.get(column)?.push(row);
  }

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

        {sourceErrors.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            Workflows se cargo parcialmente. Fuentes con error:{" "}
            {sourceErrors.join(" | ")}
          </div>
        ) : null}

        <section className="grid gap-3 md:grid-cols-4">
          {[
            ["Total", summary.total, "text-slate-950"],
            ["BIM", summary.bim, "text-red-700"],
            ["Documentos", summary.documents, "text-blue-700"],
            ["Error OP", summary.opErrors, "text-amber-700"]
          ].map(([label, value, colorClass]) => (
            <div
              key={label}
              className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="text-xs font-medium uppercase text-slate-500">
                {label}
              </div>
              <div className={`mt-1 text-2xl font-semibold ${colorClass}`}>
                {value}
              </div>
            </div>
          ))}
        </section>

        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 px-5 py-4">
            <h2 className="text-base font-semibold text-slate-900">
              Tablero Kanban
            </h2>
            <p className="text-sm text-slate-500">
              Incidencias BIM y revisiones documentales agrupadas por estado.
            </p>
          </div>

          <div className="grid gap-3 p-4 lg:grid-cols-4">
            {kanbanColumns.map((column) => {
              const columnRows = rowsByColumn.get(column) ?? [];

              return (
                <div key={column} className="rounded-lg bg-slate-50 p-3">
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-800">
                      {column}
                    </h3>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-medium text-slate-600">
                      {columnRows.length}
                    </span>
                  </div>

                  <div className="flex max-h-[420px] flex-col gap-2 overflow-y-auto">
                    {columnRows.length === 0 ? (
                      <div className="rounded border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">
                        Sin elementos
                      </div>
                    ) : (
                      columnRows.map((row) => {
                        const openProjectUrl =
                          row.openProjectId || typeof row.id === "number"
                            ? getOpenProjectUrl(Number(row.openProjectId ?? row.id))
                            : "";
                        const documentIssueUrl = getDocumentIssueUrl(row);

                        return (
                          <div
                            key={`kanban-${row.rowKey ?? row.origin}-${row.id}`}
                            className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                          >
                            <div className="mb-2 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="truncate text-sm font-semibold text-slate-900">
                                  {row.subject}
                                </div>
                                <div className="mt-1 text-xs text-slate-500">
                                  {row.projectCode} · {formatOriginLabel(row.origin)}
                                </div>
                              </div>
                              {row.syncStatus === "error" ? (
                                <span className="shrink-0 rounded bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                                  OP error
                                </span>
                              ) : null}
                            </div>

                            <div className="mb-2 flex flex-wrap gap-1">
                              <StatusBadge status={formatWorkflowStatus(row.status)} />
                              {row.priority ? (
                                <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
                                  {getPriorityLabel(row.priority)}
                                </span>
                              ) : null}
                            </div>

                            {row.snapshotUrl ? (
                              <div className="mb-2 overflow-hidden rounded border border-slate-200 bg-slate-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={getWorkflowSnapshotUrl(row.snapshotUrl)}
                                  alt={`Miniatura de ${row.subject}`}
                                  className="h-28 w-full object-cover"
                                />
                              </div>
                            ) : null}

                            {row.description ? (
                              <p className="mb-2 line-clamp-2 text-xs text-slate-600">
                                {row.description}
                              </p>
                            ) : null}

                            <div className="text-xs text-slate-500">
                              {row.assignedTo ? `Resp.: ${row.assignedTo}` : "Sin responsable"}
                            </div>
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                              {row.discipline ? <span>Disc.: {row.discipline}</span> : null}
                              {row.dueDate ? <span>Vence: {row.dueDate}</span> : null}
                              {typeof row.commentsCount === "number" ? (
                                <span>Comentarios: {row.commentsCount}</span>
                              ) : null}
                            </div>
                            {row.origin === "BCF" ? (
                              <div className="mt-1 text-xs text-slate-500">
                                Elementos: {row.elementCount ?? 0}
                              </div>
                            ) : null}

                            <div className="mt-3 flex gap-2">
                              {typeof row.id === "number" || row.openProjectId ? (
                                <Link
                                  href={`/workflows/${row.openProjectId ?? row.id}${
                                    row.projectCode && row.projectCode !== "-"
                                      ? `?projectCode=${encodeURIComponent(row.projectCode)}`
                                      : ""
                                  }`}
                                  className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-center text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Detalle
                                </Link>
                              ) : documentIssueUrl ? (
                                <Link
                                  href={documentIssueUrl}
                                  className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-center text-xs font-medium text-slate-700 hover:bg-slate-50"
                                >
                                  Abrir PDF
                                </Link>
                              ) : (
                                <span className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-center text-xs font-medium text-slate-400">
                                  Local CDE
                                </span>
                              )}
                              {openProjectUrl ? (
                                <Link
                                  href={openProjectUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex-1 rounded bg-red-700 px-2 py-1.5 text-center text-xs font-medium text-white hover:bg-red-800"
                                >
                                  OP
                                </Link>
                              ) : null}
                            </div>
                            <WorkflowIssueActions
                              issueId={row.issueId}
                              projectCode={row.projectCode}
                              status={row.status}
                            />
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

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
                    const openProjectUrl =
                      row.openProjectId || typeof row.id === "number"
                        ? getOpenProjectUrl(Number(row.openProjectId ?? row.id))
                        : "";
                    const documentIssueUrl = getDocumentIssueUrl(row);

                    return (
                      <tr
                        key={`table-${row.rowKey ?? row.origin}-${row.id}`}
                        className="hover:bg-slate-50"
                      >
                        <td className="px-5 py-4 font-medium text-slate-900">
                          #{row.id}
                        </td>

                        <td className="px-5 py-4">
                          <div className="flex items-start gap-3">
                            {row.snapshotUrl ? (
                              <div className="h-16 w-24 shrink-0 overflow-hidden rounded border border-slate-200 bg-slate-100">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={getWorkflowSnapshotUrl(row.snapshotUrl)}
                                  alt={`Miniatura de ${row.subject}`}
                                  className="h-full w-full object-cover"
                                />
                              </div>
                            ) : null}
                            <div className="min-w-0">
                              <div className="font-medium text-slate-900">
                                {row.subject}
                              </div>

                              {row.description ? (
                                <div className="mt-1 line-clamp-2 max-w-[420px] text-xs text-slate-600">
                                  {row.description}
                                </div>
                              ) : null}

                              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                                {row.assignedTo ? (
                                  <span>Resp.: {row.assignedTo}</span>
                                ) : null}
                                {row.discipline ? (
                                  <span>Disc.: {row.discipline}</span>
                                ) : null}
                                {row.commentsCount ? (
                                  <span>Comentarios: {row.commentsCount}</span>
                                ) : null}
                              </div>
                            </div>
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
                          <StatusBadge status={row.status} />
                        </td>

                        <td className="px-5 py-4 text-slate-700">
                          {row.relatedName}
                        </td>

                        <td className="px-5 py-4 text-slate-500">
                          {formatDate(row.createdAt)}
                        </td>

                        <td className="px-5 py-4 text-right">
                          <div className="flex justify-end gap-2">
                            {typeof row.id === "number" || row.openProjectId ? (
                              <Link
                                href={`/workflows/${row.openProjectId ?? row.id}${
                                  row.projectCode && row.projectCode !== "-"
                                    ? `?projectCode=${encodeURIComponent(row.projectCode)}`
                                    : ""
                                }`}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Ver detalle
                              </Link>
                            ) : documentIssueUrl ? (
                              <Link
                                href={documentIssueUrl}
                                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                              >
                                Abrir PDF
                              </Link>
                            ) : (
                              <span className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-400">
                                Local CDE
                              </span>
                            )}

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
