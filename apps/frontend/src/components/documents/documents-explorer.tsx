"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  clearDocumentExplorerCache,
  deleteDocument,
  deleteFolder,
  getDocumentVersions,
  getFragGenerationQueueStatus,
  queueDocumentFrag,
  moveDocument,
  moveFolder,
  renameDocument,
  renameFolder,
  sendToReview,
  type FragGenerationQueueStatus
} from "@/services/documents.service";
import { requestDocumentExplorerRefresh } from "@/lib/document-explorer-events";
import type {
  DocumentUiStatus,
  DocumentVersionItem,
  ExplorerRow
} from "@/types/documents";

type DocumentsExplorerProps = {
  rows: ExplorerRow[];
  currentPath: string;
  projectCode?: string;
};

type ActionTarget = {
  kind: "document" | "folder";
  id?: string;
  path: string;
  name: string;
  extension?: string;
} | null;

type DialogMode = "rename" | "move" | "delete" | null;

type CustomAttribute = {
  id: string;
  label: string;
  source: "filenameSegment" | "manual" | "extension" | "contentType" | "etag" | "path";
  segmentIndex?: number;
  manualValue?: string;
};

type ColumnKey =
  | "name"
  | "type"
  | "description"
  | "projectCode"
  | "organization"
  | "volume"
  | "level"
  | "discipline"
  | "size"
  | "modifiedAt"
  | "status"
  | "workflow"
  | "bimDerivative"
  | "version"
  | "contentType"
  | "etag"
  | "path";

const TECHNICAL_FOLDER_NAMES = new Set(["_bcf", "_derived", ".viewer", "_viewer"]);

const COLUMNS: Array<{
  key: ColumnKey;
  label: string;
  defaultVisible: boolean;
}> = [
  { key: "name", label: "Nombre", defaultVisible: true },
  { key: "description", label: "Descripcion", defaultVisible: false },
  { key: "projectCode", label: "Codigo de proyecto", defaultVisible: false },
  { key: "organization", label: "Organizacion", defaultVisible: false },
  { key: "volume", label: "Volumen / sistema", defaultVisible: false },
  { key: "level", label: "Nivel", defaultVisible: false },
  { key: "discipline", label: "Disciplina", defaultVisible: false },
  { key: "type", label: "Tipo", defaultVisible: true },
  { key: "size", label: "Tamano", defaultVisible: true },
  { key: "modifiedAt", label: "Ultima modificacion", defaultVisible: true },
  { key: "status", label: "Estado", defaultVisible: true },
  { key: "workflow", label: "Workflow", defaultVisible: true },
  { key: "bimDerivative", label: "Visor 3D", defaultVisible: true },
  { key: "version", label: "Version", defaultVisible: true },
  { key: "contentType", label: "Content type", defaultVisible: false },
  { key: "etag", label: "ETag", defaultVisible: false },
  { key: "path", label: "Ruta", defaultVisible: false }
];

const DEFAULT_VISIBLE_COLUMNS = COLUMNS.filter((column) => column.defaultVisible).map(
  (column) => column.key
);

function formatBytes(bytes?: number): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function formatUiStatus(status?: DocumentUiStatus): string {
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
      return "-";
  }
}

function getStatusBadgeClass(status?: DocumentUiStatus): string {
  switch (status) {
    case "in_progress":
      return "border-blue-200 bg-blue-50 text-blue-700";
    case "in_review":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "approved":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "rejected":
      return "border-red-200 bg-red-50 text-red-700";
    case "closed":
      return "border-zinc-200 bg-zinc-50 text-zinc-700";
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function getFileExtension(row: ExplorerRow) {
  return row.kind === "document" ? row.extension?.toUpperCase() || "-" : "Carpeta";
}

function parseIso19650Metadata(row: ExplorerRow) {
  const nameWithoutExt = row.name.replace(/\.[^.]+$/, "");
  const parts = nameWithoutExt.split("-");

  return {
    projectCode: parts[0] || "-",
    organization: parts[1] || "-",
    volume: parts[3] || "-",
    level: parts[5] || "-",
    discipline:
      parts[6] ||
      (row.kind === "document" ? row.extension?.toUpperCase() || "-" : "-"),
    description: row.kind === "folder" ? "Carpeta" : row.contentType || "-"
  };
}

function isTechnicalFolder(row: ExplorerRow) {
  if (row.kind !== "folder") return false;
  return row.path
    .split("/")
    .filter(Boolean)
    .some((segment) => TECHNICAL_FOLDER_NAMES.has(segment.toLowerCase()));
}

function isBimDocument(row: ExplorerRow) {
  if (row.kind !== "document") return false;
  const extension = row.extension?.toLowerCase() || "";
  return extension === "ifc" || extension === "frag";
}

function formatBimDerivativeStatus(row: ExplorerRow) {
  if (row.kind !== "document" || !isBimDocument(row)) return "-";

  switch (row.bimDerivative?.status) {
    case "generated":
      return "Visor 3D listo";
    case "pending":
      return "Generando visor 3D";
    case "failed":
      return "Visor 3D fallo";
    case "missing":
    default:
      return "Sin visor 3D";
  }
}

function getBimDerivativeBadgeClass(row: ExplorerRow) {
  switch (row.kind === "document" ? row.bimDerivative?.status : undefined) {
    case "generated":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "pending":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "failed":
      return "border-red-200 bg-red-50 text-red-700";
    case "missing":
    default:
      return "border-slate-200 bg-slate-50 text-slate-700";
  }
}

function isPdfDocument(
  row: ExplorerRow
): row is Extract<ExplorerRow, { kind: "document" }> {
  return row.kind === "document" && row.extension?.toLowerCase() === "pdf";
}

function getVersionLabel(row: ExplorerRow) {
  if (row.kind !== "document") return "-";
  return "V1";
}

function normalizeExplorerPath(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.length ? `/${parts.join("/")}` : "/";
}

function getParentFolder(path: string) {
  const parts = normalizeExplorerPath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.length ? `/${parts.join("/")}` : "/";
}

function getMenuPosition(rect: DOMRect, width = 288, estimatedHeight = 420) {
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

export function DocumentsExplorer({
  rows,
  currentPath,
  projectCode = ""
}: DocumentsExplorerProps) {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<ColumnKey>>(
    () => new Set(DEFAULT_VISIBLE_COLUMNS)
  );
  const [showColumns, setShowColumns] = useState(false);
  const [actionTarget, setActionTarget] = useState<ActionTarget>(null);
  const [actionMenuPosition, setActionMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [inputValue, setInputValue] = useState("");
  const [actionError, setActionError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [versionTarget, setVersionTarget] =
    useState<NonNullable<ActionTarget> | null>(null);
  const [versions, setVersions] = useState<DocumentVersionItem[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);
  const [versionsError, setVersionsError] = useState("");
  const [bulkReviewStatus, setBulkReviewStatus] = useState("");
  const [isBulkReviewing, setIsBulkReviewing] = useState(false);
  const [bimPreparationStatus, setBimPreparationStatus] = useState("");
  const [isPreparingBim, setIsPreparingBim] = useState(false);
  const [fragQueueStatus, setFragQueueStatus] =
    useState<FragGenerationQueueStatus | null>(null);
  const [fragQueueError, setFragQueueError] = useState("");
  const [customAttributes, setCustomAttributes] = useState<CustomAttribute[]>([]);
  const [showAttributeBuilder, setShowAttributeBuilder] = useState(false);
  const [attributeDraft, setAttributeDraft] = useState<{
    label: string;
    source: CustomAttribute["source"];
    segmentIndex: string;
    manualValue: string;
  }>({
    label: "",
    source: "filenameSegment",
    segmentIndex: "0",
    manualValue: ""
  });

  const customAttributeStorageKey = `typsa-cde:document-attributes:${
    projectCode || "global"
  }`;

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(customAttributeStorageKey);
      setCustomAttributes(raw ? (JSON.parse(raw) as CustomAttribute[]) : []);
    } catch {
      setCustomAttributes([]);
    }
  }, [customAttributeStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        customAttributeStorageKey,
        JSON.stringify(customAttributes)
      );
    } catch {
      // La configuracion visual no debe romper el explorador.
    }
  }, [customAttributeStorageKey, customAttributes]);

  const visibleRows = useMemo(
    () => rows.filter((row) => !isTechnicalFolder(row)),
    [rows]
  );
  const renderedColumns = COLUMNS.filter((column) => visibleColumns.has(column.key));
  const selectedRows = visibleRows.filter((row) => selectedPaths.has(row.path));
  const selectedDocuments = selectedRows.filter((row) => row.kind === "document");
  const selectedBimDocuments = selectedDocuments.filter(isBimDocument);
  const selectedBimReadyDocuments = selectedBimDocuments.filter(
    (row) =>
      row.extension?.toLowerCase() === "frag" ||
      row.bimDerivative?.status === "generated"
  );
  const selectedBimPendingDocuments = selectedBimDocuments.filter(
    (row) =>
      row.extension?.toLowerCase() === "ifc" &&
      row.bimDerivative?.status !== "generated"
  );
  const hasPendingBimDerivatives = visibleRows.some(
    (row) =>
      row.kind === "document" &&
      row.extension?.toLowerCase() === "ifc" &&
      row.bimDerivative?.status === "pending"
  );
  const allVisibleSelected =
    visibleRows.length > 0 && visibleRows.every((row) => selectedPaths.has(row.path));
  const someVisibleSelected = visibleRows.some((row) => selectedPaths.has(row.path));

  useEffect(() => {
    if (!hasPendingBimDerivatives) return;

    const intervalId = window.setInterval(() => {
      clearDocumentExplorerCache();
      requestDocumentExplorerRefresh();
    }, 4000);

    return () => window.clearInterval(intervalId);
  }, [hasPendingBimDerivatives]);

  useEffect(() => {
    if (!projectCode) return;

    let cancelled = false;

    async function loadQueueStatus() {
      try {
        const status = await getFragGenerationQueueStatus(projectCode);

        if (!cancelled) {
          setFragQueueStatus(status);
          setFragQueueError("");
        }
      } catch (error) {
        if (!cancelled) {
          setFragQueueStatus(null);
          setFragQueueError(
            error instanceof Error ? error.message : "No se pudo consultar la cola del visor 3D"
          );
        }
      }
    }

    void loadQueueStatus();

    const queueHasWork =
      hasPendingBimDerivatives ||
      Boolean(fragQueueStatus?.activeJobs) ||
      Boolean(fragQueueStatus?.queuedJobs);
    const intervalId = window.setInterval(loadQueueStatus, queueHasWork ? 4000 : 15000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [
    projectCode,
    hasPendingBimDerivatives,
    fragQueueStatus?.activeJobs,
    fragQueueStatus?.queuedJobs
  ]);

  function togglePath(path: string) {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function buildFolderHref(path: string) {
    return `/documents?path=${encodeURIComponent(path)}${
      projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
    }`;
  }

  function openFolder(path: string) {
    window.location.href = buildFolderHref(path);
  }

  function toggleAllVisible() {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (allVisibleSelected) {
        visibleRows.forEach((row) => next.delete(row.path));
      } else {
        visibleRows.forEach((row) => next.add(row.path));
      }
      return next;
    });
  }

  function toggleColumn(column: ColumnKey) {
    if (column === "name") return;
    setVisibleColumns((current) => {
      const next = new Set(current);
      if (next.has(column)) next.delete(column);
      else next.add(column);
      return next;
    });
  }

  function getCellValue(row: ExplorerRow, column: ColumnKey) {
    const metadata = parseIso19650Metadata(row);

    switch (column) {
      case "name":
        return row.name;
      case "type":
        return getFileExtension(row);
      case "description":
        return metadata.description;
      case "projectCode":
        return metadata.projectCode;
      case "organization":
        return metadata.organization;
      case "volume":
        return metadata.volume;
      case "level":
        return metadata.level;
      case "discipline":
        return metadata.discipline;
      case "size":
        return row.kind === "document" ? formatBytes(row.size) : "-";
      case "modifiedAt":
        return row.kind === "document"
          ? row.modifiedAtLocal || formatDate(row.modifiedAt)
          : "-";
      case "status":
        return row.kind === "document" ? formatUiStatus(row.uiStatus) : "-";
      case "workflow":
        return row.kind === "document" && row.workPackageLink
          ? `WP #${row.workPackageLink.workPackageId}`
          : "Sin workflow";
      case "bimDerivative":
        return formatBimDerivativeStatus(row);
      case "version":
        return getVersionLabel(row);
      case "contentType":
        return row.kind === "document" ? row.contentType || "-" : "-";
      case "etag":
        return row.kind === "document" ? row.etag || "-" : "-";
      case "path":
        return row.path;
      default:
        return "-";
    }
  }

  function buildDocumentHref(
    row: Extract<ExplorerRow, { kind: "document" }>,
    documentVersionId?: string | null
  ) {
    if (isBimDocument(row)) {
      const params = new URLSearchParams();
      if (projectCode) params.set("projectCode", projectCode);
      params.append("documentPath", row.path);
      params.append("documentName", row.name);
      if (documentVersionId && documentVersionId !== "current") {
        params.append("documentVersionId", documentVersionId);
      }
      return `/viewer?${params.toString()}`;
    }

    const params = new URLSearchParams({ path: currentPath });
    if (projectCode) params.set("projectCode", projectCode);
    if (documentVersionId && documentVersionId !== "current") {
      params.set("documentVersionId", documentVersionId);
    }

    return `/documents/${row.id}?${params.toString()}`;
  }

  function buildFederatedViewerHref(documents: typeof selectedBimDocuments) {
    const params = new URLSearchParams();
    if (projectCode) params.set("projectCode", projectCode);
    documents.forEach((row) => {
      params.append("documentPath", row.path);
      params.append("documentName", row.name);
    });
    return `/viewer?${params.toString()}`;
  }

  function buildVersionOpenHref(
    target: NonNullable<ActionTarget>,
    documentVersionId: string
  ) {
    const extension = target.extension?.toLowerCase() || "";

    if (extension === "ifc" || extension === "frag") {
      const params = new URLSearchParams();
      if (projectCode) params.set("projectCode", projectCode);
      params.set("documentPath", target.path);
      params.set("documentName", target.name);
      if (documentVersionId !== "current") {
        params.set("documentVersionId", documentVersionId);
      }
      return `/viewer?${params.toString()}`;
    }

    if (extension === "pdf" && target.id) {
      const params = new URLSearchParams({ path: currentPath });
      if (projectCode) params.set("projectCode", projectCode);
      if (documentVersionId !== "current") {
        params.set("documentVersionId", documentVersionId);
      }
      return `/documents/${target.id}?${params.toString()}`;
    }

    return "#";
  }

  async function handleSendSelectedToReview() {
    const documents = selectedDocuments.filter((row) => row.kind === "document");

    if (documents.length === 0) {
      setBulkReviewStatus("Selecciona al menos un archivo.");
      return;
    }

    const projectId = Number(process.env.NEXT_PUBLIC_OPENPROJECT_PROJECT_ID || 3);
    const typeId = Number(process.env.NEXT_PUBLIC_OPENPROJECT_TYPE_ID || 13);

    try {
      setIsBulkReviewing(true);
      setBulkReviewStatus("");

      for (const document of documents) {
        await sendToReview({
          documentId: document.id,
          documentPath: document.path,
          documentName: document.name,
          projectId,
          typeId,
          subject:
            documents.length > 1
              ? `Transmision documental - ${document.name}`
              : `Revision de ${document.name}`,
          description:
            documents.length > 1
              ? `Documento incluido en paquete de revision de ${documents.length} elemento(s).`
              : `Enviar documento ${document.name} a revision tecnica`
        });
      }

      setBulkReviewStatus(
        `${documents.length} documento(s) enviados a revision.`
      );
      requestDocumentExplorerRefresh();
    } catch (error) {
      setBulkReviewStatus(
        error instanceof Error ? error.message : "No se pudo enviar a revision"
      );
    } finally {
      setIsBulkReviewing(false);
    }
  }

  async function handlePrepareBimDocuments(
    documents: Array<Extract<ExplorerRow, { kind: "document" }>>
  ) {
    const ifcDocuments = documents.filter(
      (document) => document.extension?.toLowerCase() === "ifc"
    );

    if (ifcDocuments.length === 0) {
      setBimPreparationStatus("Selecciona al menos un IFC.");
      return;
    }

    try {
      setIsPreparingBim(true);
      setBimPreparationStatus(`Encolando 0/${ifcDocuments.length} IFC...`);

      for (let index = 0; index < ifcDocuments.length; index += 1) {
        const document = ifcDocuments[index];
        setBimPreparationStatus(
          `Encolando ${index + 1}/${ifcDocuments.length}: ${document.name}`
        );
        await queueDocumentFrag(document.path);
      }

      setBimPreparationStatus(
        `${ifcDocuments.length} derivado(s) para visor 3D en cola.`
      );
      requestDocumentExplorerRefresh();
    } catch (error) {
      setBimPreparationStatus(
        error instanceof Error ? error.message : "No se pudo preparar el visor 3D"
      );
    } finally {
      setIsPreparingBim(false);
    }
  }

  function getCustomAttributeValue(row: ExplorerRow, attribute: CustomAttribute) {
    const nameWithoutExtension = row.name.replace(/\.[^.]+$/, "");
    const parts = nameWithoutExtension.split("-");

    switch (attribute.source) {
      case "filenameSegment":
        return parts[attribute.segmentIndex ?? 0] || "-";
      case "manual":
        return attribute.manualValue || "-";
      case "extension":
        return row.kind === "document" ? row.extension?.toUpperCase() || "-" : "-";
      case "contentType":
        return row.kind === "document" ? row.contentType || "-" : "-";
      case "etag":
        return row.kind === "document" ? row.etag || "-" : "-";
      case "path":
        return row.path;
      default:
        return "-";
    }
  }

  function addCustomAttribute() {
    const label = attributeDraft.label.trim();
    const segmentIndex = Number(attributeDraft.segmentIndex);

    if (!label) return;

    setCustomAttributes((current) => [
      ...current,
      {
        id: `${Date.now()}-${label.toLowerCase().replace(/\s+/g, "-")}`,
        label,
        source: attributeDraft.source,
        segmentIndex: Number.isFinite(segmentIndex) ? Math.max(0, segmentIndex) : 0,
        manualValue: attributeDraft.manualValue.trim()
      }
    ]);
    setAttributeDraft({
      label: "",
      source: "filenameSegment",
      segmentIndex: "0",
      manualValue: ""
    });
  }

  function removeCustomAttribute(id: string) {
    setCustomAttributes((current) =>
      current.filter((attribute) => attribute.id !== id)
    );
  }

  function openDialog(target: NonNullable<ActionTarget>, mode: DialogMode) {
    setActionTarget(target);
    setDialogMode(mode);
    setActionError("");

    if (mode === "rename") setInputValue(target.name);
    else if (mode === "move") {
      const normalizedCurrentPath = normalizeExplorerPath(currentPath);
      setInputValue(normalizedCurrentPath);
    }
    else setInputValue("");
  }

  function closeDialog() {
    if (isSubmitting) return;
    setActionTarget(null);
    setDialogMode(null);
    setInputValue("");
    setActionError("");
  }

  async function submitDialog() {
    if (!actionTarget || !dialogMode) return;

    const value = inputValue.trim();

    if ((dialogMode === "rename" || dialogMode === "move") && !value) {
      setActionError("Completa el campo requerido.");
      return;
    }

    if (dialogMode === "delete" && actionTarget.kind === "folder" && value !== actionTarget.name) {
      setActionError(`Para confirmar, escribe exactamente: ${actionTarget.name}`);
      return;
    }

    try {
      setIsSubmitting(true);
      setActionError("");

      if (dialogMode === "rename") {
        if (actionTarget.kind === "folder") await renameFolder(actionTarget.path, value);
        else await renameDocument(actionTarget.path, value);
      }

      if (dialogMode === "move") {
        if (actionTarget.kind === "folder") await moveFolder(actionTarget.path, value);
        else await moveDocument(actionTarget.path, value);
      }

      if (dialogMode === "delete") {
        if (actionTarget.kind === "folder") await deleteFolder(actionTarget.path);
        else await deleteDocument(actionTarget.path);
      }

      setSelectedPaths((current) => {
        const next = new Set(current);
        next.delete(actionTarget.path);
        return next;
      });
      closeDialog();
      requestDocumentExplorerRefresh();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "No se pudo completar la accion");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function openVersions(target: NonNullable<ActionTarget>) {
    if (target.kind !== "document") return;

    setVersionTarget(target);
    setActionTarget(null);
    setActionMenuPosition(null);
    setVersions([]);
    setVersionsError("");
    setIsLoadingVersions(true);

    try {
      const response = await getDocumentVersions(target.path, projectCode);
      setVersions(response.versions);
    } catch (error) {
      setVersionsError(
        error instanceof Error
          ? error.message
          : "No se pudo obtener el historial de versiones"
      );
    } finally {
      setIsLoadingVersions(false);
    }
  }

  function getDestinationOptions(target: NonNullable<ActionTarget>) {
    const current = normalizeExplorerPath(currentPath);
    const currentParts = current.split("/").filter(Boolean);
    const projectRoot = projectCode
      ? `/${projectCode}`
      : currentParts.length
        ? `/${currentParts[0]}`
        : "/";
    const options: Array<{ label: string; path: string; description: string }> = [];
    const seen = new Set<string>();

    function addOption(label: string, path: string, description: string) {
      const normalizedPath = normalizeExplorerPath(path);
      if (seen.has(normalizedPath)) return;
      if (target.kind === "folder") {
        const targetPath = normalizeExplorerPath(target.path);
        if (
          normalizedPath === targetPath ||
          normalizedPath.startsWith(`${targetPath}/`)
        ) {
          return;
        }
      }
      seen.add(normalizedPath);
      options.push({ label, path: normalizedPath, description });
    }

    addOption("Raiz del proyecto", projectRoot, "Nivel principal del proyecto");
    addOption("Carpeta actual", current, "Ubicacion abierta");
    addOption("Carpeta superior", getParentFolder(current), "Subir un nivel");

    visibleRows
      .filter((row) => row.kind === "folder")
      .forEach((folder) =>
        addOption(folder.name, folder.path, "Subcarpeta visible")
      );

    return options;
  }

  return (
    <div className="min-w-0 max-w-full overflow-hidden border-t border-slate-200 bg-white">
      <div className="flex min-w-0 flex-col gap-2 border-b border-slate-200 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
          <label className="inline-flex items-center gap-2 font-medium text-slate-700">
            <input
              type="checkbox"
              checked={allVisibleSelected}
              ref={(input) => {
                if (input) input.indeterminate = someVisibleSelected && !allVisibleSelected;
              }}
              onChange={toggleAllVisible}
              className="h-4 w-4 rounded border-slate-300"
            />
            Seleccionar visibles
          </label>
          {selectedRows.length > 0 ? (
            <>
              <span className="rounded bg-red-50 px-2 py-1 font-semibold text-red-700">
                {selectedRows.length} seleccionado(s)
              </span>
              {selectedBimDocuments.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      void handlePrepareBimDocuments(
                        selectedBimPendingDocuments.length
                          ? selectedBimPendingDocuments
                          : selectedBimDocuments
                      )
                    }
                    disabled={isPreparingBim}
                    className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    {isPreparingBim
                      ? "Preparando..."
                      : selectedBimPendingDocuments.length
                        ? `Preparar visor 3D (${selectedBimPendingDocuments.length})`
                        : "Repreparar visor 3D"}
                  </button>
                  {selectedBimPendingDocuments.length === 0 ? (
                    <Link
                      href={buildFederatedViewerHref(selectedBimReadyDocuments)}
                      prefetch={false}
                      className="rounded border border-slate-300 bg-white px-2 py-1 font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Abrir en visor 3D
                    </Link>
                  ) : (
                    <span className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                      Prepara los IFC antes de federar
                    </span>
                  )}
                </>
              ) : null}
              {selectedDocuments.length > 0 ? (
                <button
                  type="button"
                  onClick={() => void handleSendSelectedToReview()}
                  disabled={isBulkReviewing}
                  className="rounded bg-red-700 px-2 py-1 font-semibold text-white hover:bg-red-800 disabled:opacity-60"
                >
                  {isBulkReviewing ? "Enviando..." : "Enviar a revision"}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setSelectedPaths(new Set())}
                className="rounded border border-slate-300 bg-white px-2 py-1 hover:bg-slate-50"
              >
                Limpiar
              </button>
              {bulkReviewStatus ? (
                <span className="text-xs text-slate-600">{bulkReviewStatus}</span>
              ) : null}
              {bimPreparationStatus ? (
                <span className="text-xs text-slate-600">{bimPreparationStatus}</span>
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {fragQueueStatus?.activeJobs || fragQueueStatus?.queuedJobs ? (
            <span className="rounded border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
              Visor 3D: {fragQueueStatus.activeJobs} activo(s), {fragQueueStatus.queuedJobs} en cola
            </span>
          ) : fragQueueError ? (
            <span className="max-w-72 truncate rounded border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-medium text-red-700">
              {fragQueueError}
            </span>
          ) : null}
          <div className="relative">
          <button
            type="button"
            onClick={() => setShowColumns((current) => !current)}
            className="h-9 rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Columnas
          </button>
          {showColumns ? (
            <div className="absolute right-0 z-30 mt-2 w-80 rounded border border-slate-200 bg-white p-3 shadow-xl">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Configuracion de atributos
              </div>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {COLUMNS.map((column) => (
                  <label
                    key={column.key}
                    className="flex items-center gap-2 rounded px-2 py-1 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    <input
                      type="checkbox"
                      checked={visibleColumns.has(column.key)}
                      disabled={column.key === "name"}
                      onChange={() => toggleColumn(column.key)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {column.label}
                  </label>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setVisibleColumns(new Set(DEFAULT_VISIBLE_COLUMNS))}
                className="mt-3 w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Restablecer
              </button>
              <button
                type="button"
                onClick={() => setShowAttributeBuilder((current) => !current)}
                className="mt-2 w-full rounded border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
              >
                Mas / configurar atributos
              </button>

              {showAttributeBuilder ? (
                <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
                  <input
                    value={attributeDraft.label}
                    onChange={(event) =>
                      setAttributeDraft((current) => ({
                        ...current,
                        label: event.target.value
                      }))
                    }
                    placeholder="Nombre del campo"
                    className="h-9 w-full rounded border border-slate-300 px-2 text-sm"
                  />
                  <select
                    value={attributeDraft.source}
                    onChange={(event) =>
                      setAttributeDraft((current) => ({
                        ...current,
                        source: event.target.value as CustomAttribute["source"]
                      }))
                    }
                    className="h-9 w-full rounded border border-slate-300 px-2 text-sm"
                  >
                    <option value="filenameSegment">Segmento del nombre</option>
                    <option value="manual">Valor fijo/manual</option>
                    <option value="extension">Extension</option>
                    <option value="contentType">Content type</option>
                    <option value="etag">ETag / version marker</option>
                    <option value="path">Ruta</option>
                  </select>
                  {attributeDraft.source === "filenameSegment" ? (
                    <input
                      type="number"
                      min={0}
                      value={attributeDraft.segmentIndex}
                      onChange={(event) =>
                        setAttributeDraft((current) => ({
                          ...current,
                          segmentIndex: event.target.value
                        }))
                      }
                      placeholder="Indice de segmento, base 0"
                      className="h-9 w-full rounded border border-slate-300 px-2 text-sm"
                    />
                  ) : null}
                  {attributeDraft.source === "manual" ? (
                    <input
                      value={attributeDraft.manualValue}
                      onChange={(event) =>
                        setAttributeDraft((current) => ({
                          ...current,
                          manualValue: event.target.value
                        }))
                      }
                      placeholder="Valor fijo"
                      className="h-9 w-full rounded border border-slate-300 px-2 text-sm"
                    />
                  ) : null}
                  <button
                    type="button"
                    onClick={addCustomAttribute}
                    className="w-full rounded bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-red-800"
                  >
                    Agregar campo
                  </button>

                  {customAttributes.length > 0 ? (
                    <div className="space-y-1 pt-1">
                      {customAttributes.map((attribute) => (
                        <div
                          key={attribute.id}
                          className="flex items-center justify-between gap-2 rounded bg-slate-50 px-2 py-1 text-sm"
                        >
                          <span className="truncate">{attribute.label}</span>
                          <button
                            type="button"
                            onClick={() => removeCustomAttribute(attribute.id)}
                            className="text-red-700"
                          >
                            Quitar
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}
          </div>
        </div>
      </div>

      <div className="w-full max-w-full overflow-x-auto overscroll-x-contain">
        <table className="w-full min-w-[1180px] table-fixed border-collapse">
          <thead className="bg-slate-50">
            <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
              <th className="w-10 border-b border-slate-200 px-3 py-2"></th>
              {renderedColumns.map((column) => (
                <th key={column.key} className="border-b border-slate-200 px-3 py-2">
                  {column.label}
                </th>
              ))}
              {customAttributes.map((attribute) => (
                <th
                  key={attribute.id}
                  className="border-b border-slate-200 px-3 py-2"
                >
                  {attribute.label}
                </th>
              ))}
              <th className="w-36 border-b border-slate-200 px-3 py-2 text-right">
                Acciones
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td
                  colSpan={renderedColumns.length + customAttributes.length + 2}
                  className="px-6 py-12 text-center text-sm text-slate-500"
                >
                  Esta carpeta no contiene elementos.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const checked = selectedPaths.has(row.path);

                return (
                  <tr
                    key={row.path}
                    onDoubleClick={(event) => {
                      if (row.kind !== "folder") return;
                      const target = event.target as HTMLElement;
                      if (target.closest("button, a, input, select, textarea")) return;
                      openFolder(row.path);
                    }}
                    className={`text-sm hover:bg-slate-50 ${
                      checked ? "bg-red-50" : ""
                    }`}
                  >
                    <td className="border-b border-slate-200 px-3 py-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePath(row.path)}
                        className="h-4 w-4 rounded border-slate-300"
                        aria-label={`Seleccionar ${row.name}`}
                      />
                    </td>

                    {renderedColumns.map((column) => {
                      const value = getCellValue(row, column.key);

                      if (column.key === "name") {
                        return (
                          <td
                            key={column.key}
                            className="w-[320px] max-w-[320px] truncate border-b border-slate-200 px-3 py-2"
                          >
                            {row.kind === "folder" ? (
                              <a
                                href={buildFolderHref(row.path)}
                                onClick={(event) => {
                                  event.preventDefault();
                                  openFolder(row.path);
                                }}
                                onDoubleClick={(event) => {
                                  event.preventDefault();
                                  openFolder(row.path);
                                }}
                                className="font-medium text-blue-700 hover:underline"
                              >
                                <span>{row.name}</span>
                              </a>
                            ) : (
                              <Link
                                href={buildDocumentHref(row)}
                                prefetch={false}
                                className="font-medium text-blue-700 hover:underline"
                              >
                                <span>{row.name}</span>
                              </Link>
                            )}
                          </td>
                        );
                      }

                      if (column.key === "status" && row.kind === "document") {
                        return (
                          <td key={column.key} className="border-b border-slate-200 px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getStatusBadgeClass(
                                row.uiStatus
                              )}`}
                            >
                              {value}
                            </span>
                          </td>
                        );
                      }

                      if (
                        column.key === "workflow" &&
                        row.kind === "document" &&
                        row.workPackageLink
                      ) {
                        return (
                          <td key={column.key} className="border-b border-slate-200 px-3 py-2">
                            <Link
                              href={`/workflows/${row.workPackageLink.workPackageId}${
                                projectCode
                                  ? `?projectCode=${encodeURIComponent(projectCode)}`
                                  : ""
                              }`}
                              prefetch={false}
                              className="font-medium text-blue-700 hover:underline"
                            >
                              {value}
                            </Link>
                          </td>
                        );
                      }

                      if (column.key === "bimDerivative" && row.kind === "document") {
                        return (
                          <td key={column.key} className="border-b border-slate-200 px-3 py-2">
                            <span
                              className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${getBimDerivativeBadgeClass(
                                row
                              )}`}
                              title={row.bimDerivative?.error || String(value)}
                            >
                              {value}
                            </span>
                          </td>
                        );
                      }

                      return (
                        <td
                          key={column.key}
                          className="max-w-[360px] truncate border-b border-slate-200 px-3 py-2 text-slate-700"
                          title={String(value)}
                        >
                          {value}
                        </td>
                      );
                    })}

                    {customAttributes.map((attribute) => {
                      const value = getCustomAttributeValue(row, attribute);

                      return (
                        <td
                          key={attribute.id}
                          className="max-w-[320px] truncate border-b border-slate-200 px-3 py-2 text-slate-700"
                          title={String(value)}
                        >
                          {value}
                        </td>
                      );
                    })}

                    <td className="w-36 border-b border-slate-200 px-3 py-2 text-right">
                      <div className="inline-flex min-w-max items-center gap-1">
                      {isBimDocument(row) ? (
                        row.kind === "document" &&
                        row.extension?.toLowerCase() === "ifc" &&
                        row.bimDerivative?.status !== "generated" ? (
                          <button
                            type="button"
                            onClick={() => void handlePrepareBimDocuments([row])}
                            disabled={isPreparingBim}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                          >
                            Preparar
                          </button>
                        ) : (
                          <Link
                            href={`/viewer?projectCode=${encodeURIComponent(
                              projectCode
                            )}&documentPath=${encodeURIComponent(
                              row.path
                            )}&documentName=${encodeURIComponent(row.name)}`}
                            prefetch={false}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            Visor 3D
                          </Link>
                        )
                      ) : null}
                        {isPdfDocument(row) ? (
                          <Link
                            href={buildDocumentHref(row)}
                            prefetch={false}
                            className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                          >
                            PDF
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          onClick={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setActionTarget({
                              kind: row.kind,
                              id: row.kind === "document" ? row.id : undefined,
                              path: row.path,
                              name: row.name,
                              extension: row.kind === "document" ? row.extension : undefined
                            });
                            setActionMenuPosition(getMenuPosition(rect));
                          }}
                          className="h-8 w-8 rounded-full border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                          aria-label={`Acciones de ${row.name}`}
                        >
                          ...
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {actionTarget && !dialogMode ? (
        <div
          className="fixed inset-0 z-[100000] bg-transparent"
          onClick={() => {
            setActionTarget(null);
            setActionMenuPosition(null);
          }}
        >
          <div
            className="absolute max-h-[calc(100vh-2rem)] w-72 overflow-y-auto rounded border border-slate-200 bg-white py-1 shadow-xl"
            style={{
              top: actionMenuPosition?.top ?? 0,
              left: actionMenuPosition?.left ?? 0
            }}
            onClick={(event) => event.stopPropagation()}
            >
            <button
              type="button"
              onClick={() => openDialog(actionTarget, "move")}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Desplazar
            </button>
            <button
              type="button"
              disabled
              className="block w-full px-3 py-2 text-left text-sm text-slate-400"
            >
              Copiar
            </button>
            <button
              type="button"
              onClick={() => openDialog(actionTarget, "rename")}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Cambiar nombre
            </button>
            <button
              type="button"
              disabled
              className="block w-full px-3 py-2 text-left text-sm text-slate-400"
            >
              Compartir
            </button>
            <button
              type="button"
              disabled
              className="block w-full px-3 py-2 text-left text-sm text-slate-400"
            >
              Bloquear
            </button>
            <button
              type="button"
              onClick={() => openDialog(actionTarget, "delete")}
              className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
            >
              Suprimir
            </button>
            <div className="my-1 border-t border-slate-100" />
            <button
              type="button"
              disabled
              className="block w-full px-3 py-2 text-left text-sm text-slate-400"
            >
              Editar valores de atributo
            </button>
            <button
              type="button"
              disabled={
                actionTarget.kind !== "document" ||
                actionTarget.extension?.toLowerCase() !== "ifc" ||
                isPreparingBim
              }
              onClick={() => {
                if (
                  actionTarget.kind !== "document" ||
                  actionTarget.extension?.toLowerCase() !== "ifc"
                ) {
                  return;
                }

                const target = actionTarget;
                setActionTarget(null);
                setActionMenuPosition(null);
                void handlePrepareBimDocuments([
                  {
                    kind: "document",
                    id: target.id || target.path,
                    name: target.name,
                    path: target.path,
                    extension: target.extension || "ifc",
                    size: 0,
                    modifiedAt: "",
                    workflowStatus: null,
                    uiStatus: "pending"
                  }
                ]);
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-white"
            >
              Preparar visor 3D / reintentar derivado
            </button>
            <button
              type="button"
              disabled={actionTarget.kind !== "document"}
              onClick={() => void openVersions(actionTarget)}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-white"
            >
              Ver historial de versiones
            </button>
            <button
              type="button"
              disabled
              className="block w-full px-3 py-2 text-left text-sm text-slate-400"
            >
              Ver actividades de archivos
            </button>
            <button
              type="button"
              disabled
              className="block w-full px-3 py-2 text-left text-sm text-slate-400"
            >
              Descargar archivo de origen
            </button>
            <button
              type="button"
              disabled={actionTarget.kind !== "document"}
              onClick={() => {
                if (actionTarget.kind !== "document") return;
                setSelectedPaths(new Set([actionTarget.path]));
                setActionTarget(null);
                setActionMenuPosition(null);
                setBulkReviewStatus("Archivo listo para enviar desde la barra de seleccion.");
              }}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-400 disabled:hover:bg-white"
            >
              Enviar para revision
            </button>
            <button
              type="button"
              disabled
              className="block w-full px-3 py-2 text-left text-sm text-slate-400"
            >
              Crear informe de transmision
            </button>
          </div>
        </div>
      ) : null}

      {actionTarget && dialogMode ? (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-lg rounded bg-white shadow-xl">
            <div className="border-b border-slate-200 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {dialogMode === "rename"
                  ? "Cambiar nombre"
                  : dialogMode === "move"
                    ? "Desplazar elemento"
                    : "Suprimir elemento"}
              </h2>
              <p className="mt-1 break-all text-sm text-slate-500">
                {actionTarget.path}
              </p>
            </div>

            <div className="space-y-4 px-5 py-5">
              {dialogMode === "delete" ? (
                actionTarget.kind === "folder" ? (
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Para confirmar, escribe exactamente: {actionTarget.name}
                    </label>
                    <input
                      value={inputValue}
                      onChange={(event) => setInputValue(event.target.value)}
                      className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                    />
                  </div>
                ) : (
                  <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                    Se eliminara el archivo seleccionado.
                  </div>
                )
              ) : dialogMode === "move" ? (
                <div>
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Seleccionar carpeta de destino
                  </label>
                  <div className="max-h-80 overflow-y-auto rounded border border-slate-200 bg-slate-50 p-2">
                    {getDestinationOptions(actionTarget).map((option) => {
                      const selected = normalizeExplorerPath(inputValue) === option.path;

                      return (
                        <button
                          key={option.path}
                          type="button"
                          onClick={() => setInputValue(option.path)}
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
                </div>
              ) : (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Nuevo nombre
                  </label>
                  <input
                    value={inputValue}
                    onChange={(event) => setInputValue(event.target.value)}
                    className="w-full rounded border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-600"
                  />
                </div>
              )}

              {actionError ? (
                <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
              <button
                type="button"
                onClick={closeDialog}
                disabled={isSubmitting}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void submitDialog()}
                disabled={isSubmitting}
                className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {isSubmitting ? "Procesando..." : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {versionTarget ? (
        <div className="fixed inset-0 z-[100000] flex items-center justify-end bg-black/30">
          <aside className="h-full w-full max-w-md overflow-y-auto border-l border-slate-200 bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900">
                  Historial de versiones
                </h2>
                <p className="mt-1 truncate text-sm text-slate-500">
                  {versionTarget.name}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setVersionTarget(null);
                  setVersions([]);
                  setVersionsError("");
                }}
                className="h-8 w-8 rounded border border-slate-300 text-slate-700 hover:bg-slate-50"
                aria-label="Cerrar historial"
              >
                x
              </button>
            </div>

            <div className="space-y-2 p-4">
              {isLoadingVersions ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  Cargando versiones...
                </div>
              ) : versionsError ? (
                <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                  {versionsError}
                </div>
              ) : versions.length === 0 ? (
                <div className="rounded border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
                  No hay historial disponible.
                </div>
              ) : (
                versions
                  .slice()
                  .reverse()
                  .map((version) => (
                    <div
                      key={version.id}
                      className={`rounded border p-3 ${
                        version.isCurrent
                          ? "border-red-200 bg-red-50"
                          : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold text-slate-900">
                            {version.label}
                          </div>
                          <div className="mt-1 text-xs text-slate-500">
                            {version.modifiedAtLocal || "-"} - {" "}
                            {version.size ? formatBytes(version.size) : "-"}
                          </div>
                        </div>
                      </div>
                      <div className="mt-3 flex gap-2">
                        <Link
                          href={buildVersionOpenHref(versionTarget, version.id)}
                          prefetch={false}
                          className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          Abrir version
                        </Link>
                        <button
                          type="button"
                          disabled
                          className="rounded border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-400"
                        >
                          Comparar
                        </button>
                      </div>
                    </div>
                  ))
              )}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
