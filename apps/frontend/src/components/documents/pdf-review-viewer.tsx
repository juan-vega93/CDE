"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist/types/src/display/api";
import {
  createDocumentAnnotation,
  deleteDocumentAnnotation,
  getDocumentAnnotations,
  updateDocumentAnnotation
} from "@/services/documents.service";
import {
  getProjectMembers,
  type ProjectMember
} from "@/services/project-cards.service";
import type {
  DocumentAnnotation,
  DocumentAnnotationKind,
  DocumentAnnotationMetadata
} from "@/types/documents";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

type PdfReviewViewerProps = {
  fileUrl: string;
  documentName: string;
  documentPath: string;
  projectCode: string;
  documentVersionId?: string | null;
  author?: string;
  backHref: string;
  initialPageNumber?: number;
  initialAnnotationId?: string | null;
};

type Tool =
  | "pan"
  | "issue"
  | "comment"
  | "cloud"
  | "rectangle"
  | "highlight"
  | "arrow"
  | "measurement";

const TYPSA_RED = "#e30613";

function clampPage(value: number, pageCount: number): number {
  return Math.min(Math.max(value, 1), Math.max(pageCount, 1));
}

function annotationLabel(kind: DocumentAnnotationKind): string {
  switch (kind) {
    case "comment":
      return "Comentario";
    case "issue_marker":
      return "Incidencia";
    case "revision_cloud":
      return "Nube";
    case "rectangle":
      return "Marco";
    case "highlight":
      return "Resaltado";
    case "arrow":
      return "Flecha";
    case "measurement":
      return "Medicion";
    default:
      return kind;
  }
}

function toPercent(value?: number): string {
  return `${(Number(value || 0) * 100).toFixed(3)}%`;
}

export function PdfReviewViewer({
  fileUrl,
  documentName,
  documentPath,
  projectCode,
  documentVersionId,
  author,
  backHref,
  initialPageNumber,
  initialAnnotationId
}: PdfReviewViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [pageNumber, setPageNumber] = useState(initialPageNumber || 1);
  const [pageCount, setPageCount] = useState(0);
  const [scale, setScale] = useState(1.25);
  const [tool, setTool] = useState<Tool>("pan");
  const [markColor, setMarkColor] = useState(TYPSA_RED);
  const [annotations, setAnnotations] = useState<DocumentAnnotation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectMembersLoading, setProjectMembersLoading] = useState(false);
  const [error, setError] = useState("");
  const [draftStart, setDraftStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [commentDraft, setCommentDraft] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [commentText, setCommentText] = useState("");
  const [issueDraft, setIssueDraft] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [issueTitle, setIssueTitle] = useState("");
  const [issueDescription, setIssueDescription] = useState("");
  const [issueAssignedTo, setIssueAssignedTo] = useState("");
  const [issueDueDate, setIssueDueDate] = useState("");
  const [issueType, setIssueType] = useState("Coordinacion");
  const [issuePriority, setIssuePriority] = useState("Media");
  const [issueDiscipline, setIssueDiscipline] = useState("Documental");
  const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
  const [issueCommentText, setIssueCommentText] = useState("");

  const currentPageAnnotations = useMemo(
    () =>
      annotations.filter((annotation) => annotation.pageNumber === pageNumber),
    [annotations, pageNumber]
  );
  const openAnnotations = useMemo(
    () => annotations.filter((annotation) => annotation.status === "open"),
    [annotations]
  );
  const selectedIssue = useMemo(
    () =>
      annotations.find(
        (annotation) =>
          annotation.id === selectedIssueId &&
          annotation.kind === "issue_marker"
      ) ?? null,
    [annotations, selectedIssueId]
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");

    async function loadPdf() {
      try {
        const loadedPdf = await pdfjsLib.getDocument({ url: fileUrl }).promise;

        if (cancelled) return;

        setPdf(loadedPdf);
        setPageCount(loadedPdf.numPages);
        setPageNumber((current) => clampPage(current, loadedPdf.numPages));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "No se pudo abrir PDF");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadPdf();

    return () => {
      cancelled = true;
    };
  }, [fileUrl]);

  useEffect(() => {
    if (!projectCode || !documentPath) return;

    let cancelled = false;

    async function loadAnnotations() {
      try {
        const loadedAnnotations = await getDocumentAnnotations({
          projectCode,
          documentPath,
          documentVersionId
        });

        if (!cancelled) {
          setAnnotations(loadedAnnotations);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "No se pudieron cargar las anotaciones"
          );
        }
      }
    }

    void loadAnnotations();

    return () => {
      cancelled = true;
    };
  }, [documentPath, documentVersionId, projectCode]);

  useEffect(() => {
    if (!initialAnnotationId || annotations.length === 0 || pageCount === 0) {
      return;
    }

    const target = annotations.find(
      (annotation) => annotation.id === initialAnnotationId
    );

    if (!target) return;

    setPageNumber(clampPage(target.pageNumber, pageCount));

    if (target.kind === "issue_marker") {
      setSelectedIssueId(target.id);
    }
  }, [annotations, initialAnnotationId, pageCount]);

  useEffect(() => {
    if (!projectCode) {
      setProjectMembers([]);
      return;
    }

    let cancelled = false;
    setProjectMembersLoading(true);

    getProjectMembers(projectCode, "active")
      .then((members) => {
        if (!cancelled) {
          setProjectMembers(members);
        }
      })
      .catch((err) => {
        console.error("[pdf-review] Error loading project members:", err);
        if (!cancelled) {
          setProjectMembers([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setProjectMembersLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [projectCode]);

  useEffect(() => {
    if (!pdf || !canvasRef.current) return;

    let cancelled = false;
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");

    if (!context) return;
    const canvasContext = context;

    async function renderPage() {
      const page = await pdf!.getPage(pageNumber);
      if (cancelled) return;

      const viewport = page.getViewport({ scale });
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = `${Math.floor(viewport.width)}px`;
      canvas.style.height = `${Math.floor(viewport.height)}px`;

      await page.render({
        canvas,
        canvasContext,
        viewport
      }).promise;
    }

    void renderPage();

    return () => {
      cancelled = true;
    };
  }, [pageNumber, pdf, scale]);

  function getNormalizedPoint(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height
    };
  }

  async function addAnnotation(input: {
    kind: DocumentAnnotationKind;
    text?: string;
    x: number;
    y: number;
    width?: number;
    height?: number;
    x2?: number;
    y2?: number;
    value?: number;
    unit?: string;
    metadata?: DocumentAnnotationMetadata;
  }) {
    if (!projectCode) {
      setError("projectCode es obligatorio para guardar anotaciones");
      return;
    }

    const now = new Date().toISOString();
    const optimisticAnnotation: DocumentAnnotation = {
      id: `tmp-${crypto.randomUUID()}`,
      projectCode,
      documentPath,
      documentVersionId,
      pageNumber,
      kind: input.kind,
      text: input.text,
      color: markColor,
      geometry: {
        x: input.x,
        y: input.y,
        width: input.width,
        height: input.height,
        x2: input.x2,
        y2: input.y2,
        value: input.value,
        unit: input.unit
      },
      metadata: input.metadata,
      status: "open",
      author,
      createdAt: now,
      updatedAt: now
    };

    setAnnotations((current) => [...current, optimisticAnnotation]);
    if (input.kind === "issue_marker") {
      setSelectedIssueId(optimisticAnnotation.id);
    }
    setIsSaving(true);
    setError("");

    try {
      const created = await createDocumentAnnotation({
        projectCode,
        documentPath,
        documentVersionId,
        pageNumber,
        kind: input.kind,
        text: input.text,
        color: markColor,
        geometry: {
          x: input.x,
          y: input.y,
          width: input.width,
          height: input.height,
          x2: input.x2,
          y2: input.y2,
          value: input.value,
          unit: input.unit
        },
        metadata: input.metadata,
        author
      });

      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === optimisticAnnotation.id ? created : annotation
        )
      );
      if (input.kind === "issue_marker") {
        setSelectedIssueId(created.id);
      }
    } catch (err) {
      setAnnotations((current) =>
        current.filter((annotation) => annotation.id !== optimisticAnnotation.id)
      );
      setError(
        err instanceof Error ? err.message : "No se pudo guardar la anotacion"
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(annotationId: string) {
    if (!projectCode) return;

    setIsSaving(true);
    setError("");

    try {
      await deleteDocumentAnnotation(annotationId, projectCode);
      setAnnotations((current) =>
        current.filter((annotation) => annotation.id !== annotationId)
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "No se pudo eliminar la anotacion"
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function updateSelectedIssue(input: {
    metadata?: DocumentAnnotationMetadata;
    status?: DocumentAnnotation["status"];
    text?: string;
  }) {
    if (!selectedIssue || !projectCode) return;

    const nextAnnotation: DocumentAnnotation = {
      ...selectedIssue,
      text: input.text ?? selectedIssue.text,
      metadata: input.metadata ?? selectedIssue.metadata,
      status: input.status ?? selectedIssue.status,
      updatedAt: new Date().toISOString()
    };

    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === selectedIssue.id ? nextAnnotation : annotation
      )
    );
    setIsSaving(true);
    setError("");

    try {
      const updated = await updateDocumentAnnotation(selectedIssue.id, {
        projectCode,
        text: nextAnnotation.text,
        metadata: nextAnnotation.metadata,
        status: nextAnnotation.status
      });

      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === selectedIssue.id ? updated : annotation
        )
      );
    } catch (err) {
      setAnnotations((current) =>
        current.map((annotation) =>
          annotation.id === selectedIssue.id ? selectedIssue : annotation
        )
      );
      setError(
        err instanceof Error
          ? err.message
          : "No se pudo actualizar la incidencia"
      );
    } finally {
      setIsSaving(false);
    }
  }

  function updateSelectedIssueMetadata(
    patch: Partial<DocumentAnnotationMetadata>
  ) {
    if (!selectedIssue) return;
    const metadata = {
      ...(selectedIssue.metadata ?? {}),
      ...patch
    };

    void updateSelectedIssue({
      metadata,
      text: metadata.title || selectedIssue.text
    });
  }

  function addSelectedIssueComment() {
    if (!selectedIssue || !issueCommentText.trim()) return;

    const metadata = selectedIssue.metadata ?? {};
    const comments = metadata.comments ?? [];

    void updateSelectedIssue({
      metadata: {
        ...metadata,
        comments: [
          ...comments,
          {
            id: crypto.randomUUID(),
            author,
            text: issueCommentText.trim(),
            createdAt: new Date().toISOString()
          }
        ]
      }
    });
    setIssueCommentText("");
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (tool === "pan") return;

    const point = getNormalizedPoint(event);

    if (tool === "comment") {
      setCommentDraft(point);
      setCommentText("");
      return;
    }

    if (tool === "issue") {
      setIssueDraft(point);
      setIssueTitle("");
      setIssueDescription("");
      setIssueAssignedTo("");
      setIssueDueDate("");
      setIssueType("Coordinacion");
      setIssuePriority("Media");
      setIssueDiscipline("Documental");
      return;
    }

    setDraftStart(point);
  }

  function handlePointerUp(event: React.PointerEvent<HTMLDivElement>) {
    if (
      !draftStart ||
      tool === "pan" ||
      tool === "comment" ||
      tool === "issue"
    ) return;

    const end = getNormalizedPoint(event);
    const x = Math.min(draftStart.x, end.x);
    const y = Math.min(draftStart.y, end.y);
    const width = Math.abs(end.x - draftStart.x);
    const height = Math.abs(end.y - draftStart.y);
    setDraftStart(null);

    const distance = Math.sqrt(
      Math.pow(end.x - draftStart.x, 2) + Math.pow(end.y - draftStart.y, 2)
    );

    if (
      tool === "arrow" ||
      tool === "measurement"
    ) {
      if (distance < 0.01) return;

      void addAnnotation({
        kind: tool,
        x: draftStart.x,
        y: draftStart.y,
        x2: end.x,
        y2: end.y,
        value: tool === "measurement" ? Number((distance * 100).toFixed(2)) : undefined,
        unit: tool === "measurement" ? "u" : undefined
      });
      return;
    }

    if (width < 0.01 || height < 0.01) return;

    void addAnnotation({
      kind:
        tool === "cloud"
          ? "revision_cloud"
          : tool === "highlight"
            ? "highlight"
            : "rectangle",
      x,
      y,
      width,
      height
    });
  }

  function focusAnnotation(annotation: DocumentAnnotation) {
    setPageNumber(clampPage(annotation.pageNumber, pageCount));
  }

  function confirmComment() {
    if (!commentDraft || !commentText.trim()) return;

    void addAnnotation({
      kind: "comment",
      text: commentText.trim(),
      x: commentDraft.x,
      y: commentDraft.y
    });
    setCommentDraft(null);
    setCommentText("");
  }

  function confirmIssue() {
    if (!issueDraft || !issueTitle.trim()) return;

    const snapshotDataUrl = canvasRef.current?.toDataURL("image/png");
    const metadata: DocumentAnnotationMetadata = {
      title: issueTitle.trim(),
      description: issueDescription.trim() || undefined,
      assignedTo: issueAssignedTo.trim() || undefined,
      dueDate: issueDueDate || undefined,
      issueType,
      priority: issuePriority,
      discipline: issueDiscipline,
      location: `Pagina ${pageNumber}`,
      locationDetails: `x=${issueDraft.x.toFixed(3)}, y=${issueDraft.y.toFixed(3)}`,
      snapshotDataUrl
    };

    void addAnnotation({
      kind: "issue_marker",
      text: metadata.title,
      x: issueDraft.x,
      y: issueDraft.y,
      metadata
    });
    setIssueDraft(null);
    setIssueTitle("");
    setIssueDescription("");
    setIssueAssignedTo("");
    setIssueDueDate("");
    setIssueType("Coordinacion");
    setIssuePriority("Media");
    setIssueDiscipline("Documental");
  }

  function formatResponsible(value?: string): string {
    if (!value) return "Sin asignar";

    const member = projectMembers.find(
      (item) =>
        item.email === value ||
        item.username === value ||
        item.id === value
    );

    if (!member) return value;

    return `${member.firstName} ${member.lastName}`.trim() || member.email;
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-0 flex-col overflow-hidden rounded border border-slate-300 bg-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-300 bg-white px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <a
            href={backHref}
            className="rounded border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Volver
          </a>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">
              {documentName}
            </p>
            <p className="text-xs text-slate-500">
              Pagina {pageNumber} de {pageCount || "-"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPageNumber((value) => clampPage(value - 1, pageCount))}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            Anterior
          </button>
          <button
            type="button"
            onClick={() => setPageNumber((value) => clampPage(value + 1, pageCount))}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            Siguiente
          </button>
          <button
            type="button"
            onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            -
          </button>
          <span className="min-w-12 text-center text-sm text-slate-700">
            {Math.round(scale * 100)}%
          </span>
          <button
            type="button"
            onClick={() => setScale((value) => Math.min(3, value + 0.25))}
            className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            +
          </button>
          <a
            href={fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded border border-slate-300 px-2.5 py-1.5 text-sm"
          >
            Descargar
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-slate-300 bg-white p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold uppercase text-slate-500">
              Incidencias del documento
            </p>
            <button
              type="button"
              onClick={() =>
                (window.location.href = `/workflows?projectCode=${encodeURIComponent(
                  projectCode
                )}`)
              }
              className="rounded border border-slate-300 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Ver workflows
            </button>
          </div>

          <div className="mt-3 rounded border border-slate-200 bg-slate-50 p-2">
            <label className="block text-xs font-medium text-slate-600">
              Color de marca
            </label>
            <div className="mt-2 flex items-center gap-2">
              {[TYPSA_RED, "#0078d4", "#00a36c", "#f59e0b", "#111827"].map(
                (color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setMarkColor(color)}
                    className={`h-7 w-7 rounded border ${
                      markColor === color
                        ? "border-slate-900 ring-2 ring-slate-300"
                        : "border-slate-300"
                    }`}
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                )
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={() => setTool("issue")}
            className={`mt-3 w-full rounded px-3 py-2 text-sm font-semibold ${
              tool === "issue"
                ? "bg-red-700 text-white"
                : "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
            }`}
          >
            Generar incidencia
          </button>

          {error ? (
            <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-700">
              {error}
            </div>
          ) : null}

          <div className="mt-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Abiertas
              </h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                {openAnnotations.length}
              </span>
            </div>
            <div className="mt-2 space-y-2">
              {openAnnotations.length ? (
                openAnnotations.map((annotation) => (
                  <article
                    key={annotation.id}
                    className={`rounded border bg-slate-50 p-2 ${
                      annotation.pageNumber === pageNumber
                        ? "border-red-200"
                        : "border-slate-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button
                          type="button"
                          onClick={() => {
                            focusAnnotation(annotation);
                            if (annotation.kind === "issue_marker") {
                              setSelectedIssueId(annotation.id);
                            }
                          }}
                          className="text-left text-xs font-semibold text-slate-900 hover:text-red-700"
                        >
                          {annotation.kind === "issue_marker"
                            ? annotation.metadata?.title || annotation.text || "Incidencia"
                            : annotationLabel(annotation.kind)} · Pag.{" "}
                          {annotation.pageNumber}
                        </button>
                        {annotation.text ? (
                          <p className="mt-1 text-xs text-slate-600">
                            {annotation.text}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleDelete(annotation.id)}
                        className="text-xs font-semibold text-red-700"
                      >
                        Eliminar
                      </button>
                    </div>
                  </article>
                ))
              ) : (
                <p className="rounded border border-dashed border-slate-300 p-3 text-xs text-slate-500">
                  Sin incidencias documentales abiertas.
                </p>
              )}
            </div>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            {isSaving ? "Guardando..." : "Las marcas se guardan en el CDE."}
          </p>
        </aside>

        <main className="relative min-w-0 flex-1 overflow-auto bg-slate-200 p-6">
          <div className="fixed right-5 top-32 z-20 flex flex-col gap-1 rounded bg-slate-950 p-1 shadow-xl">
            {[
              ["pan", "Mover"],
              ["issue", "Incidencia"],
              ["comment", "Comentario"],
              ["cloud", "Nube"],
              ["rectangle", "Marco"],
              ["highlight", "Resaltar"],
              ["arrow", "Flecha"],
              ["measurement", "Medir"]
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setTool(value as Tool)}
                className={`h-9 w-9 rounded text-xs font-semibold ${
                  tool === value
                    ? "bg-red-600 text-white"
                    : "bg-slate-900 text-slate-200 hover:bg-slate-800"
                }`}
                title={label}
              >
                {String(label).slice(0, 1)}
              </button>
            ))}
          </div>

          {isLoading ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-600">
              Cargando PDF...
            </div>
          ) : (
            <div className="mx-auto w-max rounded bg-white shadow">
              <div
                ref={overlayRef}
                className="relative"
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
              >
                <canvas ref={canvasRef} className="block" />
                <div className="pointer-events-none absolute inset-0">
                  {currentPageAnnotations.map((annotation) => {
                    const geometry = annotation.geometry;

                    if (
                      annotation.kind === "comment" ||
                      annotation.kind === "issue_marker"
                    ) {
                      return (
                        <div
                          key={annotation.id}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white px-2 py-1 text-xs font-semibold text-white shadow ${
                            annotation.kind === "issue_marker"
                              ? "bg-red-700 ring-4 ring-red-200"
                              : "bg-red-600"
                          }`}
                          style={{
                            left: toPercent(geometry.x),
                            top: toPercent(geometry.y)
                          }}
                          title={
                            annotation.text ||
                            annotationLabel(annotation.kind)
                          }
                        >
                          {annotation.kind === "issue_marker" ? "I" : "C"}
                        </div>
                      );
                    }

                    if (
                      annotation.kind === "arrow" ||
                      annotation.kind === "measurement"
                    ) {
                      const x1 = Number(geometry.x || 0) * 100;
                      const y1 = Number(geometry.y || 0) * 100;
                      const x2 = Number(geometry.x2 || 0) * 100;
                      const y2 = Number(geometry.y2 || 0) * 100;

                      return (
                        <svg
                          key={annotation.id}
                          className="absolute inset-0 h-full w-full overflow-visible"
                          viewBox="0 0 100 100"
                          preserveAspectRatio="none"
                        >
                          <line
                            x1={x1}
                            y1={y1}
                            x2={x2}
                            y2={y2}
                            stroke={annotation.color}
                            strokeWidth="0.25"
                            markerEnd={
                              annotation.kind === "arrow"
                                ? `url(#arrow-${annotation.id})`
                                : undefined
                            }
                          />
                          <defs>
                            <marker
                              id={`arrow-${annotation.id}`}
                              markerWidth="5"
                              markerHeight="5"
                              refX="4"
                              refY="2.5"
                              orient="auto"
                            >
                              <path
                                d="M 0 0 L 5 2.5 L 0 5 z"
                                fill={annotation.color}
                              />
                            </marker>
                          </defs>
                          {annotation.kind === "measurement" ? (
                            <text
                              x={(x1 + x2) / 2}
                              y={(y1 + y2) / 2}
                              fill={annotation.color}
                              fontSize="2"
                              fontWeight="700"
                            >
                              {geometry.value} {geometry.unit}
                            </text>
                          ) : null}
                        </svg>
                      );
                    }

                    const commonStyle = {
                      left: toPercent(geometry.x),
                      top: toPercent(geometry.y),
                      width: toPercent(geometry.width),
                      height: toPercent(geometry.height)
                    };

                    return (
                      <div
                        key={annotation.id}
                        className={`absolute border-2 ${
                          annotation.kind === "revision_cloud"
                            ? "rounded-[999px] border-dashed"
                            : ""
                        }`}
                        style={{
                          ...commonStyle,
                          borderColor: annotation.color,
                          backgroundColor:
                            annotation.kind === "highlight"
                              ? `${annotation.color}33`
                              : "transparent"
                        }}
                        title={annotationLabel(annotation.kind)}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </main>
        {selectedIssue ? (
          <aside className="w-[360px] shrink-0 overflow-y-auto border-l border-slate-300 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500">
                  Incidencia documental
                </p>
                <h2 className="mt-1 text-lg font-semibold text-slate-900">
                  {selectedIssue.metadata?.title || selectedIssue.text || "Sin titulo"}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedIssueId(null)}
                className="rounded border border-slate-300 px-2 py-1 text-sm"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void updateSelectedIssue({ status: "resolved" })}
                className="flex-1 rounded border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                Resolver
              </button>
              <button
                type="button"
                onClick={() => void updateSelectedIssue({ status: "closed" })}
                className="flex-1 rounded bg-red-700 px-3 py-2 text-xs font-semibold text-white hover:bg-red-800"
              >
                Cerrar incidencia
              </button>
            </div>

            <div className="mt-4 space-y-3">
              {selectedIssue.metadata?.snapshotDataUrl ? (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase text-slate-500">
                    Miniatura de la incidencia
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={selectedIssue.metadata.snapshotDataUrl}
                    alt="Miniatura de incidencia"
                    className="h-36 w-full rounded border border-slate-200 object-cover"
                  />
                </div>
              ) : null}

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Titulo
                </label>
                <input
                  key={`title-${selectedIssue.id}-${selectedIssue.updatedAt}`}
                  defaultValue={selectedIssue.metadata?.title || selectedIssue.text || ""}
                  onBlur={(event) =>
                    updateSelectedIssueMetadata({ title: event.target.value.trim() })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">
                    Estado
                  </label>
                  <select
                    value={selectedIssue.status}
                    onChange={(event) =>
                      void updateSelectedIssue({
                        status: event.target.value as DocumentAnnotation["status"]
                      })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm outline-none focus:border-red-600"
                  >
                    <option value="open">Abierta</option>
                    <option value="resolved">Resuelta</option>
                    <option value="closed">Cerrada</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">
                    Prioridad
                  </label>
                  <select
                    value={selectedIssue.metadata?.priority || "Media"}
                    onChange={(event) =>
                      updateSelectedIssueMetadata({ priority: event.target.value })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm outline-none focus:border-red-600"
                  >
                    <option value="Baja">Baja</option>
                    <option value="Media">Media</option>
                    <option value="Alta">Alta</option>
                    <option value="Critica">Critica</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">
                    Tipo
                  </label>
                  <select
                    value={selectedIssue.metadata?.issueType || "Coordinacion"}
                    onChange={(event) =>
                      updateSelectedIssueMetadata({ issueType: event.target.value })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm outline-none focus:border-red-600"
                  >
                    <option value="Coordinacion">Coordinacion</option>
                    <option value="Revision">Revision</option>
                    <option value="Calidad">Calidad</option>
                    <option value="Diseno">Diseno</option>
                    <option value="Construccion">Construccion</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold uppercase text-slate-500">
                    Disciplina
                  </label>
                  <select
                    value={selectedIssue.metadata?.discipline || "Documental"}
                    onChange={(event) =>
                      updateSelectedIssueMetadata({ discipline: event.target.value })
                    }
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm outline-none focus:border-red-600"
                  >
                    <option value="Documental">Documental</option>
                    <option value="ARQ">ARQ</option>
                    <option value="EST">EST</option>
                    <option value="MEP">MEP</option>
                    <option value="BIM">BIM</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Asignado a
                </label>
                <select
                  value={selectedIssue.metadata?.assignedTo || ""}
                  onChange={(event) =>
                    updateSelectedIssueMetadata({ assignedTo: event.target.value })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-2 text-sm outline-none focus:border-red-600"
                >
                  <option value="">
                    {projectMembersLoading ? "Cargando responsables..." : "Sin asignar"}
                  </option>
                  {projectMembers.map((member) => {
                    const fullName = `${member.firstName} ${member.lastName}`.trim();
                    const label = fullName || member.email || member.username;
                    const value = member.email || member.username || member.id;

                    return (
                      <option key={member.id} value={value}>
                        {label}
                        {member.disciplineKey ? ` - ${member.disciplineKey}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Fecha limite
                </label>
                <input
                  type="date"
                  value={selectedIssue.metadata?.dueDate || ""}
                  onChange={(event) =>
                    updateSelectedIssueMetadata({ dueDate: event.target.value })
                  }
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Descripcion
                </label>
                <textarea
                  key={`description-${selectedIssue.id}-${selectedIssue.updatedAt}`}
                  defaultValue={selectedIssue.metadata?.description || ""}
                  onBlur={(event) =>
                    updateSelectedIssueMetadata({ description: event.target.value.trim() })
                  }
                  rows={4}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                />
              </div>

              <div className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                <p className="font-semibold uppercase text-slate-500">
                  Ubicacion
                </p>
                <p className="mt-1 text-sm text-slate-800">
                  {selectedIssue.metadata?.location || `Pagina ${selectedIssue.pageNumber}`}
                </p>
                <p className="mt-1 font-mono text-[11px]">
                  {selectedIssue.metadata?.locationDetails || "-"}
                </p>
              </div>

              <div className="border-t border-slate-200 pt-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase text-slate-500">
                    Comentarios
                  </p>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                    {selectedIssue.metadata?.comments?.length ?? 0}
                  </span>
                </div>
                <div className="mt-2 space-y-2">
                  {(selectedIssue.metadata?.comments ?? []).map((comment) => (
                    <div
                      key={comment.id}
                      className="rounded border border-slate-200 bg-slate-50 p-2"
                    >
                      <p className="text-xs font-semibold text-slate-700">
                        {comment.author || "Usuario"}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">
                        {comment.text}
                      </p>
                      <p className="mt-1 text-[11px] text-slate-500">
                        {new Date(comment.createdAt).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
                <textarea
                  value={issueCommentText}
                  onChange={(event) => setIssueCommentText(event.target.value)}
                  rows={3}
                  className="mt-3 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                  placeholder="Agregar comentario..."
                />
                <button
                  type="button"
                  onClick={addSelectedIssueComment}
                  disabled={!issueCommentText.trim()}
                  className="mt-2 w-full rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  Agregar comentario
                </button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      {commentDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50">
          <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">
              Nuevo comentario
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Pagina {pageNumber}. El comentario quedara vinculado a este punto.
            </p>
            <textarea
              value={commentText}
              onChange={(event) => setCommentText(event.target.value)}
              autoFocus
              rows={4}
              className="mt-4 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
              placeholder="Describe la observacion..."
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setCommentDraft(null);
                  setCommentText("");
                }}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmComment}
                disabled={!commentText.trim()}
                className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Guardar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {issueDraft ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50">
          <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl">
            <h2 className="text-base font-semibold text-slate-900">
              Generar incidencia documental
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Se creara un marcador en la pagina {pageNumber} y quedara visible
              en Workflows del proyecto.
            </p>
            <label className="mt-4 block text-xs font-semibold uppercase text-slate-500">
              Titulo
            </label>
            <input
              value={issueTitle}
              onChange={(event) => setIssueTitle(event.target.value)}
              autoFocus
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
              placeholder="Ej. Corregir revision, completar firma, revisar plano..."
            />
            <label className="mt-4 block text-xs font-semibold uppercase text-slate-500">
              Descripcion
            </label>
            <textarea
              value={issueDescription}
              onChange={(event) => setIssueDescription(event.target.value)}
              rows={5}
              className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
              placeholder="Detalle de la observacion..."
            />
            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Tipo
                </label>
                <select
                  value={issueType}
                  onChange={(event) => setIssueType(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                >
                  <option value="Coordinacion">Coordinacion</option>
                  <option value="Revision">Revision</option>
                  <option value="Calidad">Calidad</option>
                  <option value="Diseno">Diseno</option>
                  <option value="Construccion">Construccion</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Prioridad
                </label>
                <select
                  value={issuePriority}
                  onChange={(event) => setIssuePriority(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                >
                  <option value="Baja">Baja</option>
                  <option value="Media">Media</option>
                  <option value="Alta">Alta</option>
                  <option value="Critica">Critica</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Disciplina
                </label>
                <select
                  value={issueDiscipline}
                  onChange={(event) => setIssueDiscipline(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                >
                  <option value="Documental">Documental</option>
                  <option value="ARQ">ARQ</option>
                  <option value="EST">EST</option>
                  <option value="MEP">MEP</option>
                  <option value="BIM">BIM</option>
                </select>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Asignado a
                </label>
                <select
                  value={issueAssignedTo}
                  onChange={(event) => setIssueAssignedTo(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                >
                  <option value="">
                    {projectMembersLoading
                      ? "Cargando responsables..."
                      : "Sin asignar"}
                  </option>
                  {projectMembers.map((member) => {
                    const fullName = `${member.firstName} ${member.lastName}`.trim();
                    const label = fullName || member.email || member.username;
                    const value = member.email || member.username || member.id;

                    return (
                      <option key={member.id} value={value}>
                        {label}
                        {member.disciplineKey ? ` - ${member.disciplineKey}` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase text-slate-500">
                  Fecha limite
                </label>
                <input
                  type="date"
                  value={issueDueDate}
                  onChange={(event) => setIssueDueDate(event.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <div>
                <span className="block font-semibold text-slate-800">
                  Documento
                </span>
                <span className="line-clamp-1">{documentName}</span>
              </div>
              <div>
                <span className="block font-semibold text-slate-800">
                  Pagina
                </span>
                {pageNumber}
              </div>
              <div>
                <span className="block font-semibold text-slate-800">
                  Estado
                </span>
                Abierta
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setIssueDraft(null);
                  setIssueTitle("");
                  setIssueDescription("");
                }}
                className="rounded border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={confirmIssue}
                disabled={!issueTitle.trim()}
                className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              >
                Crear incidencia
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
