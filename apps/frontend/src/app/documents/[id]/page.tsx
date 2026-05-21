import Link from "next/link";
import { PortalShell } from "@/components/layout/portal-shell";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { SendToReviewButton } from "@/components/documents/send-to-review-button";
import {
  getDocumentById,
  getWorkPackageLinkByDocumentId
} from "@/services/documents.service";
import type { DocumentUiStatus } from "@/types/documents";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUiStatus(status: DocumentUiStatus): string {
  switch (status) {
    case "pending":
      return "Pendiente";
    case "in_progress":
      return "En progreso";
    case "in_review":
      return "En revisión";
    case "approved":
      return "Aprobado";
    case "rejected":
      return "Rechazado";
    case "closed":
      return "Cerrado";
    default:
      return status;
  }
}

function getStatusBadgeClass(status: DocumentUiStatus): string {
  switch (status) {
    case "pending":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "in_progress":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "in_review":
      return "bg-yellow-100 text-yellow-700 border-yellow-200";
    case "approved":
      return "bg-green-100 text-green-700 border-green-200";
    case "rejected":
      return "bg-red-100 text-red-700 border-red-200";
    case "closed":
      return "bg-zinc-100 text-zinc-700 border-zinc-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function StatusBadge({ status }: { status: DocumentUiStatus }) {
  return (
    <span
      className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
        status
      )}`}
    >
      {formatUiStatus(status)}
    </span>
  );
}

type DocumentDetailPageProps = {
  params: Promise<{
    id: string;
  }>;
  searchParams: Promise<{
    path?: string | string[];
    projectCode?: string | string[];
  }>;
};

export default async function DocumentDetailPage({
  params,
  searchParams
}: DocumentDetailPageProps) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const rawPath = resolvedSearchParams?.path;
  const rawProjectCode = resolvedSearchParams?.projectCode;

  const projectCode =
    typeof rawProjectCode === "string"
      ? rawProjectCode.trim().toUpperCase()
      : Array.isArray(rawProjectCode)
      ? rawProjectCode[0]?.trim().toUpperCase()
      : "";

  const currentPath =
    typeof rawPath === "string"
      ? rawPath
      : Array.isArray(rawPath)
      ? rawPath[0]
      : "/";
  const documentsHref = `/documents?path=${encodeURIComponent(currentPath)}${
    projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
  }`;

  const [document, workPackageLink] = await Promise.all([
    getDocumentById(id, currentPath),
    getWorkPackageLinkByDocumentId(id)
  ]);

  const isIfcDocument = document.extension?.toLowerCase() === "ifc";

  return (
    <PortalShell>
      <div className="mx-auto max-w-5xl">
        <Link
          href={documentsHref}
          className="inline-flex rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          ← Volver a documentos
        </Link>
        <Breadcrumbs
          items={[
            {
              label: "Documentos",
              href: projectCode
                ? `/documents?projectCode=${encodeURIComponent(projectCode)}`
                : "/documents"
            },
            {
              label: currentPath.replace(`/${projectCode}`, "") || "/",
              href: documentsHref
            },
            { label: document.name }
          ]}
        />

        <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Detalle de documento</h1>
            <p className="mt-2 text-sm text-gray-600">{document.name}</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <SendToReviewButton
              documentId={document.id}
              documentPath={document.path}
              documentName={document.name}
              projectId={3}
              typeId={13}
              isAlreadyLinked={!!workPackageLink}
            />

            {isIfcDocument ? (
              <Link
                href={`/viewer?projectCode=${encodeURIComponent(
                  projectCode
                )}&documentId=${document.id}&documentName=${encodeURIComponent(
                  document.name
                )}&documentPath=${encodeURIComponent(document.path)}`}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Abrir visor BIM
              </Link>
            ) : null}

            {workPackageLink ? (
              <Link
                href={`/workflows/${workPackageLink.workPackageId}`}
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Ver workflow
              </Link>
            ) : (
              <button
                disabled
                className="cursor-not-allowed rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-500"
              >
                Ver workflow
              </button>
            )}
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <section className="rounded-xl border bg-white p-6 lg:col-span-2">
            <h2 className="text-lg font-semibold">Información general</h2>

            <dl className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <dt className="text-sm text-gray-500">Código documento</dt>
                <dd className="break-all font-medium">
                  {document.name.replace(/\.[^/.]+$/, "")}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-gray-500">Extensión</dt>
                <dd className="uppercase font-medium">
                  {document.extension || "-"}
                </dd>
              </div>

              <div className="md:col-span-2">
                <dt className="text-sm text-gray-500">Nombre archivo</dt>
                <dd className="break-all">{document.name}</dd>
              </div>

              <div className="md:col-span-2">
                <dt className="text-sm text-gray-500">Ruta</dt>
                <dd className="break-all text-sm text-gray-700">
                  {document.path}
                </dd>
              </div>

              <div>
                <dt className="text-sm text-gray-500">Tamaño</dt>
                <dd>{formatBytes(document.size)}</dd>
              </div>

              <div>
                <dt className="text-sm text-gray-500">Última modificación</dt>
                <dd>{new Date(document.modifiedAt).toLocaleString()}</dd>
              </div>
            </dl>
          </section>

          <aside className="rounded-xl border bg-white p-6">
            <h2 className="text-lg font-semibold">Estado</h2>

            <div className="mt-4 space-y-4">
              <div>
                <p className="text-sm text-gray-500">Estado portal</p>
                <div className="mt-2">
                  <StatusBadge status={document.uiStatus} />
                </div>
              </div>

              <div>
                <p className="text-sm text-gray-500">Estado workflow</p>
                <p className="mt-2 font-medium">
                  {workPackageLink?.workPackageStatusName ??
                    document.workflowStatus ??
                    "-"}
                </p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Contenedor actual</p>
                <p className="mt-2 font-medium">{currentPath}</p>
              </div>

              <div>
                <p className="text-sm text-gray-500">Vínculo con workflow</p>

                {workPackageLink ? (
                  <div className="mt-2 rounded-lg border bg-gray-50 p-3 text-sm">
                    <p>
                      <span className="font-medium">WP:</span>{" "}
                      #{workPackageLink.workPackageId}
                    </p>
                    <p>
                      <span className="font-medium">Tipo:</span>{" "}
                      {workPackageLink.linkType}
                    </p>
                    <p>
                      <span className="font-medium">Estado:</span>{" "}
                      {workPackageLink.workPackageStatusName ??
                        workPackageLink.status}
                    </p>
                    {workPackageLink.lastSyncedAt ? (
                      <p>
                        <span className="font-medium">Última sync:</span>{" "}
                        {new Date(workPackageLink.lastSyncedAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-gray-600">
                    Este documento aún no tiene un workflow vinculado.
                  </p>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}