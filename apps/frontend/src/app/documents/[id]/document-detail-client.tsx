"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { PortalShell } from "@/components/layout/portal-shell";
import { Breadcrumbs } from "@/components/navigation/breadcrumbs";
import { PdfReviewViewer } from "@/components/documents/pdf-review-viewer";
import {
  getDocumentById,
  getDocumentContentBlobUrl,
  getWorkPackageLinkByDocumentId
} from "@/services/documents.service";
import type {
  DocumentItem,
  DocumentUiStatus,
  WorkPackageLink
} from "@/types/documents";

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
      return "En revision";
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

function getPreviewKind(extension?: string) {
  const ext = String(extension || "")
    .replace(".", "")
    .trim()
    .toLowerCase();

  if (ext === "pdf") return "pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return "image";
  if (["doc", "docx", "xls", "xlsx", "ppt", "pptx"].includes(ext)) {
    return "download";
  }

  return "unsupported";
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

export function DocumentDetailClient() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const id = String(params.id || "");
  const projectCode = searchParams.get("projectCode")?.trim().toUpperCase() || "";
  const currentPath = searchParams.get("path") || "/";
  const initialPageNumber = Number(searchParams.get("page") || "1");
  const initialAnnotationId = searchParams.get("annotationId");
  const documentVersionId = searchParams.get("documentVersionId") || "current";
  const documentsHref = `/documents?path=${encodeURIComponent(currentPath)}${
    projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
  }`;
  const [document, setDocument] = useState<DocumentItem | null>(null);
  const [workPackageLink, setWorkPackageLink] =
    useState<WorkPackageLink | null>(null);
  const [contentBlobUrl, setContentBlobUrl] = useState("");
  const [isLoadingContent, setIsLoadingContent] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";

    async function loadDocument() {
      setError("");

      try {
        const [loadedDocument, loadedWorkPackageLink] = await Promise.all([
          getDocumentById(id, currentPath, projectCode),
          getWorkPackageLinkByDocumentId(id)
        ]);

        if (cancelled) return;

        setDocument(loadedDocument);
        setWorkPackageLink(loadedWorkPackageLink);

        const previewKind = getPreviewKind(loadedDocument.extension);

        if (["pdf", "image", "download", "unsupported"].includes(previewKind)) {
          if (!cancelled) {
            setIsLoadingContent(true);
          }

          objectUrl = await getDocumentContentBlobUrl(
            loadedDocument.path,
            documentVersionId
          );

          if (!cancelled) {
            setContentBlobUrl(objectUrl);
            setIsLoadingContent(false);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setIsLoadingContent(false);
          setError(
            err instanceof Error
              ? err.message
              : "No se pudo cargar el documento"
          );
        }
      }
    }

    void loadDocument();

    return () => {
      cancelled = true;

      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [currentPath, documentVersionId, id, projectCode]);

  if (error) {
    return (
      <PortalShell>
        <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          {error}
        </section>
      </PortalShell>
    );
  }

  if (!document) {
    return (
      <PortalShell>
        <section className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
          Cargando documento...
        </section>
      </PortalShell>
    );
  }

  const isIfcDocument = document.extension?.toLowerCase() === "ifc";
  const previewKind = getPreviewKind(document.extension);

  if (previewKind === "pdf") {
    return (
      <PortalShell>
        {contentBlobUrl ? (
          <PdfReviewViewer
            fileUrl={contentBlobUrl}
            documentName={document.name}
            documentPath={document.path}
            projectCode={projectCode}
            documentVersionId={documentVersionId}
            author={undefined}
            backHref={documentsHref}
            initialPageNumber={
              Number.isFinite(initialPageNumber) && initialPageNumber > 0
                ? initialPageNumber
                : 1
            }
            initialAnnotationId={initialAnnotationId}
          />
        ) : (
          <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col gap-3">
            <section className="flex min-h-0 flex-1 items-center justify-center rounded border border-slate-300 bg-white text-sm text-slate-500">
              {isLoadingContent ? "Cargando PDF..." : "Preparando vista PDF..."}
            </section>
          </div>
        )}
      </PortalShell>
    );
  }

  return (
    <PortalShell>
      <div className="mx-auto max-w-7xl px-4">
        <Link
          href={documentsHref}
          className="inline-flex rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Volver a documentos
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
            {contentBlobUrl ? (
              <Link
                href={contentBlobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Descargar
              </Link>
            ) : null}
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
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2.2fr)_minmax(360px,0.8fr)]">
          {!isIfcDocument ? (
            <section className="rounded-xl border bg-white p-6">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-lg font-semibold">Vista previa</h2>
                  <p className="mt-1 text-sm text-gray-500">
                    Visualizacion rapida del archivo seleccionado.
                  </p>
                </div>

                {contentBlobUrl ? (
                  <Link
                    href={contentBlobUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                  >
                    Abrir en nueva pestana
                  </Link>
                ) : null}
              </div>

              {previewKind === "image" && contentBlobUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={contentBlobUrl}
                  alt={document.name}
                  className="max-h-[78vh] w-full rounded-xl border border-slate-300 bg-white object-contain"
                />
              ) : null}

              {previewKind === "download" || previewKind === "unsupported" ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <p className="text-sm text-slate-600">
                    No hay vista previa disponible para este tipo de archivo.
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}

          <aside className="rounded-xl border bg-white p-6">
            <h2 className="text-lg font-semibold">Informacion general</h2>

            <dl className="mt-4 grid grid-cols-1 gap-4">
              <div>
                <dt className="text-sm text-gray-500">Codigo documento</dt>
                <dd className="break-all font-medium">
                  {document.name.replace(/\.[^/.]+$/, "")}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Extension</dt>
                <dd className="font-medium uppercase">
                  {document.extension || "-"}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Ruta</dt>
                <dd className="break-all text-sm text-gray-700">
                  {document.path}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Tamano</dt>
                <dd>{formatBytes(document.size)}</dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Estado portal</dt>
                <dd className="mt-2">
                  <StatusBadge status={document.uiStatus} />
                </dd>
              </div>
              <div>
                <dt className="text-sm text-gray-500">Workflow</dt>
                <dd className="mt-2 font-medium">
                  {workPackageLink?.workPackageStatusName ??
                    document.workflowStatus ??
                    "-"}
                </dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </PortalShell>
  );
}
