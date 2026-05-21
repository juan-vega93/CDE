"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDocument,
  deleteFolder,
  renameDocument,
  renameFolder,
  moveDocument,
  moveFolder
} from "@/services/documents.service";
import type { ExplorerRow, DocumentUiStatus } from "@/types/documents";

type DocumentsExplorerProps = {
  rows: ExplorerRow[];
  currentPath: string;
  projectCode?: string;
};
type RenameTarget = {
  kind: "document" | "folder";
  path: string;
  currentName: string;
} | null;
type ActionsTarget = {
  kind: "document" | "folder";
  path: string;
  name: string;
  extension?: string;
} | null;
type MoveTarget = {
  kind: "document" | "folder";
  path: string;
  name: string;
} | null;
type DeleteTarget = {
  kind: "document" | "folder";
  path: string;
  name: string;
} | null;

function formatBytes(bytes?: number): string {
  if (!bytes) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


function formatUiStatus(status?: DocumentUiStatus): string {
  if (!status) return "-";

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


function getFileTypeLabel(extension?: string): string {
  if (!extension) return "Carpeta";
  return extension.toUpperCase();
}

function formatDate(value?: string | number | Date | null) {
  if (!value) return "-";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Lima",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).formatToParts(date);

  const getPart = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const day = Number(getPart("day"));
  const month = Number(getPart("month"));
  const year = getPart("year");

  const hour24 = Number(getPart("hour"));
  const minute = getPart("minute");
  const second = getPart("second");

  const period = hour24 >= 12 ? "p. m." : "a. m.";
  const hour12 = hour24 % 12 || 12;

  return `${day}/${month}/${year}, ${hour12}:${minute}:${second} ${period}`;
}

function getRowIcon(kind: ExplorerRow["kind"], extension?: string): string {
  if (kind === "folder") return "📁";

  switch ((extension || "").toLowerCase()) {
    case "pdf":
      return "📄";
    case "docx":
      return "📝";
    case "ifc":
      return "🧩";
    default:
      return "📦";
  }
}
const TECHNICAL_FOLDER_NAMES = new Set([
  "_bcf",
  "_derived",
  ".viewer",
  "_viewer"
]);

function isTechnicalFolderRow(row: ExplorerRow): boolean {
  if (row.kind !== "folder") return false;

  const name = String(row.name || "").trim().toLowerCase();

  if (TECHNICAL_FOLDER_NAMES.has(name)) {
    return true;
  }

  const pathSegments = String(row.path || "")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.trim().toLowerCase());

  return pathSegments.some((segment) => TECHNICAL_FOLDER_NAMES.has(segment));
}
function isBimViewerDocument(row: ExplorerRow): boolean {
  if (row.kind !== "document") return false;

  const extension = String(row.extension || "")
    .replace(".", "")
    .trim()
    .toLowerCase();

  const name = String(row.name || "").trim().toLowerCase();

  return (
    extension === "ifc" ||
    extension === "frag" ||
    name.endsWith(".ifc") ||
    name.endsWith(".frag")
  );
}
export function DocumentsExplorer({
  rows,
  currentPath,
  projectCode = ""
}: DocumentsExplorerProps) {
  const router = useRouter();
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [actionsTarget, setActionsTarget] = useState<ActionsTarget>(null);
  const [renameTarget, setRenameTarget] = useState<RenameTarget>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionError, setActionError] = useState("");
  const [moveTarget, setMoveTarget] = useState<MoveTarget>(null);
  const [moveValue, setMoveValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null);
  const [deleteConfirmationValue, setDeleteConfirmationValue] = useState("");
  const [actionsMenuPosition, setActionsMenuPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  const visibleRows = rows.filter((row) => !isTechnicalFolderRow(row));
  const isEmpty = visibleRows.length === 0;

  useEffect(() => {
  if (!actionsTarget) return;

  function handleCloseMenu() {
    setActionsTarget(null);
    setActionsMenuPosition(null);
  }

  window.addEventListener("click", handleCloseMenu);
  window.addEventListener("scroll", handleCloseMenu, true);

  return () => {
    window.removeEventListener("click", handleCloseMenu);
    window.removeEventListener("scroll", handleCloseMenu, true);
  };
}, [actionsTarget]);

  function handleDeleteDocument(path: string, name?: string) {
    setActionError("");
    setDeleteTarget({
      kind: "document",
      path,
      name: name || path.split("/").filter(Boolean).at(-1) || "Archivo"
    });
    setDeleteConfirmationValue("");
  }

  function handleDeleteFolder(path: string, name?: string) {
    setActionError("");
    setDeleteTarget({
      kind: "folder",
      path,
      name: name || path.split("/").filter(Boolean).at(-1) || "Carpeta"
    });
    setDeleteConfirmationValue("");
  }
  function closeActionsMenu() {
    setActionsTarget(null);
    setActionsMenuPosition(null);
  }

  function openActionsMenu(
    event: React.MouseEvent<HTMLButtonElement>,
    target: NonNullable<ActionsTarget>
  ) {
    event.preventDefault();
    event.stopPropagation();

    const rect = event.currentTarget.getBoundingClientRect();

    setActionsTarget(target);
    setActionsMenuPosition({
      top: rect.bottom + 8,
      left: Math.max(16, rect.right - 192)
    });
  }

  function handleRenameDocument(path: string, currentName: string) {
    setActionError("");
    setRenameTarget({
      kind: "document",
      path,
      currentName
    });
    setRenameValue(currentName);
  }
  

  function handleRenameFolder(path: string, currentName: string) {
    setActionError("");
    setRenameTarget({
      kind: "folder",
      path,
      currentName
    });
    setRenameValue(currentName);
  }
  function closeRenameModal() {
    if (deletingPath) return;

    setRenameTarget(null);
    setRenameValue("");
    setActionError("");
  }

  async function submitRename() {
    if (!renameTarget) return;

    const nextName = renameValue.trim();

    if (!nextName) {
      setActionError("El nombre no puede estar vacío.");
      return;
    }

    if (nextName === renameTarget.currentName) {
      closeRenameModal();
      return;
    }

    try {
      setActionError("");
      setDeletingPath(renameTarget.path);

      if (renameTarget.kind === "folder") {
        await renameFolder(renameTarget.path, nextName);
      } else {
        await renameDocument(renameTarget.path, nextName);
      }

      setRenameTarget(null);
      setRenameValue("");
      router.refresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : renameTarget.kind === "folder"
            ? "No se pudo renombrar la carpeta"
            : "No se pudo renombrar el archivo";

      setActionError(errorMessage);
    } finally {
      setDeletingPath(null);
    }
  }
  function closeMoveModal() {
  if (deletingPath) return;

  setMoveTarget(null);
  setMoveValue("");
  setActionError("");
}

async function submitMove() {
  if (!moveTarget) return;

  const destinationPath = moveValue.trim();

  if (!destinationPath) {
    setActionError("Selecciona una carpeta destino.");
    return;
  }

  if (destinationPath === moveTarget.path) {
    setActionError("No puedes mover el elemento hacia sí mismo.");
    return;
  }

  if (
    moveTarget.kind === "folder" &&
    destinationPath.startsWith(`${moveTarget.path}/`)
  ) {
    setActionError("No puedes mover una carpeta dentro de sí misma.");
    return;
  }

  try {
    setActionError("");
    setDeletingPath(moveTarget.path);

    if (moveTarget.kind === "folder") {
      await moveFolder(moveTarget.path, destinationPath);
    } else {
      await moveDocument(moveTarget.path, destinationPath);
    }

    setMoveTarget(null);
    setMoveValue("");
    router.refresh();
  } catch (err) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : moveTarget.kind === "folder"
          ? "No se pudo mover la carpeta"
          : "No se pudo mover el archivo";

    setActionError(errorMessage);
  } finally {
    setDeletingPath(null);
  }
}
function closeDeleteModal() {
  if (deletingPath) return;

  setDeleteTarget(null);
  setDeleteConfirmationValue("");
  setActionError("");
}

async function submitDelete() {
  if (!deleteTarget) return;

  if (deleteTarget.kind === "folder") {
    const expectedName = deleteTarget.name.trim();
    const typedName = deleteConfirmationValue.trim();

    if (typedName !== expectedName) {
      setActionError(`Para confirmar, escribe exactamente: ${expectedName}`);
      return;
    }
  }

  try {
    setActionError("");
    setDeletingPath(deleteTarget.path);

    if (deleteTarget.kind === "folder") {
      await deleteFolder(deleteTarget.path);
    } else {
      await deleteDocument(deleteTarget.path);
    }

    setDeleteTarget(null);
    setDeleteConfirmationValue("");
    router.refresh();
  } catch (err) {
    const errorMessage =
      err instanceof Error
        ? err.message
        : deleteTarget.kind === "folder"
          ? "No se pudo eliminar la carpeta"
          : "No se pudo eliminar el archivo";

    setActionError(errorMessage);
  } finally {
    setDeletingPath(null);
  }
}

 function handleMoveDocument(path: string, name?: string) {
  setActionError("");
  setMoveTarget({
    kind: "document",
    path,
    name: name || path.split("/").filter(Boolean).at(-1) || "Archivo"
  });
  setMoveValue("");
}

 function handleMoveFolderInit(path: string, name?: string) {
  setActionError("");
  setMoveTarget({
    kind: "folder",
    path,
    name: name || path.split("/").filter(Boolean).at(-1) || "Carpeta"
  });
  setMoveValue("");
}
function normalizeExplorerPath(pathValue: string) {
  const clean = pathValue.trim();

  if (!clean) return "/";
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function getParentFolder(pathValue: string) {
  const normalized = normalizeExplorerPath(pathValue);
  const parts = normalized.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return normalized;
  }

  return `/${parts.slice(0, -1).join("/")}`;
}

function canUseMoveDestination(destinationPath: string, target: NonNullable<MoveTarget>) {
  const normalizedDestination = normalizeExplorerPath(destinationPath);
  const normalizedTarget = normalizeExplorerPath(target.path);

  if (normalizedDestination === normalizedTarget) {
    return false;
  }

  if (
    target.kind === "folder" &&
    normalizedDestination.startsWith(`${normalizedTarget}/`)
  ) {
    return false;
  }

  return true;
}

function getMoveDestinationOptions(target: NonNullable<MoveTarget>) {
  const options: Array<{
    label: string;
    path: string;
    description: string;
  }> = [];

  const seen = new Set<string>();

  function addOption(label: string, pathValue: string, description: string) {
    const normalizedPath = normalizeExplorerPath(pathValue);

    if (seen.has(normalizedPath)) return;
    if (!canUseMoveDestination(normalizedPath, target)) return;

    seen.add(normalizedPath);

    options.push({
      label,
      path: normalizedPath,
      description
    });
  }

  const normalizedCurrentPath = normalizeExplorerPath(currentPath);
  const currentParts = normalizedCurrentPath.split("/").filter(Boolean);
  const projectRoot = projectCode ? `/${projectCode}` : `/${currentParts[0] || ""}`;

  const parentPath = getParentFolder(normalizedCurrentPath);

  if (parentPath && parentPath !== normalizedCurrentPath) {
    addOption("Carpeta superior", parentPath, "Subir un nivel");
  }

  const currentFolderName = currentParts.at(-1)?.toUpperCase() || "";
  const parentOfCurrent = getParentFolder(normalizedCurrentPath);

  const standardWorkflowFolders = ["01_INPUT", "02_WORK", "03_EXPORT"];

  if (standardWorkflowFolders.includes(currentFolderName)) {
    standardWorkflowFolders.forEach((folderName) => {
      const siblingPath = `${parentOfCurrent}/${folderName}`;

      if (siblingPath !== normalizedCurrentPath) {
        addOption(folderName, siblingPath, "Carpeta hermana del flujo actual");
      }
    });
  }

  visibleRows
    .filter((row) => row.kind === "folder")
    .forEach((folder) => {
      addOption(folder.name, folder.path, "Carpeta visible en esta ubicación");
    });

  if (projectRoot && projectRoot !== normalizedCurrentPath) {
    addOption("Raíz del proyecto", projectRoot, "Volver al nivel principal del proyecto");
  }

  return options;
}

const moveDestinationOptions = moveTarget
  ? getMoveDestinationOptions(moveTarget)
  : [];


  return (
    <div className="mt-6 overflow-hidden rounded-xl border bg-white">
      {renameTarget ? (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {renameTarget.kind === "folder"
                  ? "Renombrar carpeta"
                  : "Renombrar archivo"}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                Actualiza el nombre sin cambiar la ubicación del elemento.
              </p>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Nuevo nombre
                </label>
                <input
                  value={renameValue}
                  onChange={(event) => setRenameValue(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitRename();
                    }

                    if (event.key === "Escape") {
                      closeRenameModal();
                    }
                  }}
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                />
              </div>

              {actionError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={closeRenameModal}
                disabled={Boolean(deletingPath)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => void submitRename()}
                disabled={Boolean(deletingPath)}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingPath ? "Guardando..." : "Guardar cambios"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {moveTarget ? (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-lg font-semibold text-slate-900">
                {moveTarget.kind === "folder"
                  ? "Mover carpeta"
                  : "Mover archivo"}
              </h2>

              <p className="mt-1 text-sm text-slate-500">
                Indica la carpeta destino dentro del proyecto.
              </p>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">
                  Elemento
                </div>
                <div className="mt-1 break-all text-sm font-semibold text-slate-900">
                  {moveTarget.name}
                </div>
                <div className="mt-1 break-all text-xs text-slate-500">
                  {moveTarget.path}
                </div>
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">
                  Carpeta destino
                </label>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                    Destinos sugeridos
                  </div>

                  <div className="flex max-h-56 flex-col gap-2 overflow-y-auto">
                    {moveDestinationOptions.length > 0 ? (
                      moveDestinationOptions.map((destination) => {
                        const isSelected = moveValue === destination.path;

                        return (
                          <button
                            key={destination.path}
                            type="button"
                            onClick={() => setMoveValue(destination.path)}
                            className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition ${
                              isSelected
                                ? "border-red-300 bg-red-50 text-red-800"
                                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                            }`}
                          >
                            <span>📁</span>
                            <span>
                              <span className="block font-medium">{destination.label}</span>
                              <span className="block text-xs text-slate-500">
                                {destination.description}
                              </span>
                              <span className="block break-all text-xs text-slate-500">
                                {destination.path}
                              </span>
                            </span>
                          </button>
                        );
                      })
                    ) : (
                      <div className="rounded-lg border border-dashed border-slate-300 bg-white px-3 py-4 text-sm text-slate-500">
                        No hay destinos sugeridos para este elemento.
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-slate-500">
                    Ruta destino seleccionada
                  </label>

                  <input
                    value={moveValue}
                    onChange={(event) => setMoveValue(event.target.value)}
                    placeholder="Selecciona una carpeta o pega una ruta"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                  />
                </div>

                <p className="mt-2 text-xs text-slate-500">
                  Puedes elegir un destino sugerido o pegar manualmente una ruta si necesitas mover a otra carpeta.
                </p>
              </div>

              {actionError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={closeMoveModal}
                disabled={Boolean(deletingPath)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => void submitMove()}
                disabled={Boolean(deletingPath)}
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingPath ? "Moviendo..." : "Mover"}
              </button>
            </div>
          </div>
        </div>
      ) : null}    
      {deleteTarget ? (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="border-b border-red-100 bg-red-50 px-5 py-4">
              <h2 className="text-lg font-semibold text-red-800">
                {deleteTarget.kind === "folder"
                  ? "Eliminar carpeta"
                  : "Eliminar archivo"}
              </h2>

              <p className="mt-1 text-sm text-red-700">
                {deleteTarget.kind === "folder"
                  ? "Esta acción eliminará la carpeta y todo su contenido interno. Verifica antes de continuar."
                  : "Esta acción eliminará el archivo seleccionado. Verifica antes de continuar."}
              </p>
            </div>

            <div className="space-y-4 px-5 py-5">
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-3">
                <div className="text-xs font-medium uppercase tracking-wide text-red-700">
                  Elemento
                </div>

                <div className="mt-1 break-all text-sm font-semibold text-slate-900">
                  {deleteTarget.name}
                </div>

                <div className="mt-1 break-all text-xs text-slate-600">
                  {deleteTarget.path}
                </div>
              </div>

              {deleteTarget.kind === "folder" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Para confirmar, escribe exactamente:
                </label>

                <div className="mb-2 rounded-lg bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-900">
                  {deleteTarget.name}
                </div>

                <input
                  value={deleteConfirmationValue}
                  onChange={(event) =>
                    setDeleteConfirmationValue(event.target.value)
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void submitDelete();
                    }

                    if (event.key === "Escape") {
                      closeDeleteModal();
                    }
                  }}
                  autoFocus
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-red-500 focus:ring-2 focus:ring-red-100"
                />
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                Se eliminará este archivo. Esta acción no eliminará carpetas ni otros contenidos.
              </div>
            )}

              {actionError ? (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {actionError}
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-3 border-t border-slate-100 px-5 py-4">
              <button
                type="button"
                onClick={closeDeleteModal}
                disabled={Boolean(deletingPath)}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancelar
              </button>

              <button
                type="button"
                onClick={() => void submitDelete()}
                disabled={
                  Boolean(deletingPath) ||
                  (deleteTarget.kind === "folder" &&
                    deleteConfirmationValue.trim() !== deleteTarget.name.trim())
                }
                className="rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingPath
                  ? "Eliminando..."
                  : deleteTarget.kind === "folder"
                    ? "Eliminar carpeta y contenido"
                    : "Eliminar archivo"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <table className="min-w-full border-collapse">
        <thead className="bg-gray-50">
          <tr className="text-left text-sm">
            <th className="border-b px-4 py-3">Nombre</th>
            <th className="border-b px-4 py-3">Tipo</th>
            <th className="border-b px-4 py-3">Tamaño</th>
            <th className="border-b px-4 py-3">Última modificación</th>
            <th className="border-b px-4 py-3">Estado</th>
            <th className="border-b px-4 py-3">Workflow</th>
            <th className="border-b px-4 py-3 text-right">Acciones</th>
          </tr>
        </thead>

        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={7} className="px-6 py-12 text-center">
                <div className="mx-auto max-w-md">
                  <div className="text-4xl">📂</div>
                  <h3 className="mt-3 text-base font-semibold text-gray-900">
                    Esta carpeta no contiene elementos
                  </h3>
                  <p className="mt-2 text-sm text-gray-600">
                    No se encontraron subcarpetas ni documentos en{" "}
                    <span className="font-medium">{currentPath}</span>.
                  </p>
                </div>
              </td>
            </tr>
          ) : (
            visibleRows.map((row, index) => {
              if (row.kind === "folder") {
                return (
                  <tr
                    key={`folder-${row.path}-${index}`}
                    className="text-sm hover:bg-gray-50"
                  >
                    <td className="border-b px-4 py-3">
                      <Link
                        href={`/documents?path=${encodeURIComponent(row.path)}${
                          projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
                        }`}
                        className="flex items-center gap-2 font-medium text-blue-700 hover:underline"
                      >
                        <span>{getRowIcon("folder")}</span>
                        <span>{row.name}</span>
                      </Link>
                    </td>

                    <td className="border-b px-4 py-3">Carpeta</td>
                    <td className="border-b px-4 py-3">-</td>
                    <td className="border-b px-4 py-3">-</td>
                    <td className="border-b px-4 py-3">-</td>
                    <td className="border-b px-4 py-3">-</td>

                    <td className="border-b px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(event) =>
                          openActionsMenu(event, {
                            kind: "folder",
                            path: row.path,
                            name: row.name
                          })
                        }
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-700 shadow-sm hover:bg-slate-50"
                        aria-label={`Acciones de ${row.name}`}
                      >
                        ⋯
                      </button>
                    </td>
                  </tr>
                );
              }

              return (
                <tr key={`doc-${row.id}`} className="text-sm hover:bg-gray-50">
                  <td className="border-b px-4 py-3">
                    <Link
                      href={`/documents/${row.id}?path=${encodeURIComponent(currentPath)}${
                        projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
                      }`}
                      className="flex items-center gap-2 font-medium text-blue-700 hover:underline"
                    >
                      <span>{getRowIcon("document", row.extension)}</span>
                      <span>{row.name}</span>
                    </Link>
                  </td>

                  <td className="border-b px-4 py-3">
                    {getFileTypeLabel(row.extension)}
                  </td>

                  <td className="border-b px-4 py-3">
                    {formatBytes(row.size)}
                  </td>

                  <td className="border-b px-4 py-3">
                    {formatDate(row.modifiedAt)}
                  </td>

                  <td className="border-b px-4 py-3">
                    <StatusBadge status={row.uiStatus} />
                  </td>

                  <td className="border-b px-4 py-3">
                    {row.workPackageLink ? (
                      <Link
                        href={`/workflows/${row.workPackageLink.workPackageId}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        WP #{row.workPackageLink.workPackageId} ·{" "}
                        {row.workPackageLink.linkType}
                      </Link>
                    ) : (
                      <span className="text-gray-500">Sin workflow</span>
                    )}
                  </td>

                  <td className="border-b px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={(event) =>
                        openActionsMenu(event, {
                          kind: "document",
                          path: row.path,
                          name: row.name,
                          extension: row.extension
                        })
                      }
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 bg-white text-lg leading-none text-slate-700 shadow-sm hover:bg-slate-50"
                      aria-label={`Acciones de ${row.name}`}
                    >
                      ⋯
                    </button>
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
      {actionsTarget && actionsMenuPosition ? (
        <div
          className="fixed z-[100000] w-48 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-left shadow-2xl"
          style={{
            top: actionsMenuPosition.top,
            left: actionsMenuPosition.left
          }}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();

              const target = actionsTarget;
              closeActionsMenu();

              if (target.kind === "folder") {
                handleRenameFolder(target.path, target.name);
              } else {
                handleRenameDocument(target.path, target.name);
              }
            }}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Renombrar
          </button>

          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();

              const target = actionsTarget;
              closeActionsMenu();

              if (target.kind === "folder") {
                handleMoveFolderInit(target.path, target.name);
              } else {
                handleMoveDocument(target.path, target.name);
              }
            }}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Mover
          </button>

          {actionsTarget.kind === "document" &&
          (() => {
            const extension = String(actionsTarget.extension || "")
              .replace(".", "")
              .trim()
              .toLowerCase();

            const name = String(actionsTarget.name || "")
              .trim()
              .toLowerCase();

            return (
              extension === "ifc" ||
              extension === "frag" ||
              name.endsWith(".ifc") ||
              name.endsWith(".frag")
            );
          })() ? (
            <Link
              href={`/viewer?projectCode=${encodeURIComponent(
                projectCode
              )}&documentPath=${encodeURIComponent(
                actionsTarget.path
              )}&documentName=${encodeURIComponent(actionsTarget.name)}`}
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
              onClick={closeActionsMenu}
            >
              Abrir en visor BIM
            </Link>
          ) : null}

          <button
            type="button"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();

              const target = actionsTarget;
              closeActionsMenu();

              if (target.kind === "folder") {
                handleDeleteFolder(target.path, target.name);
              } else {
                handleDeleteDocument(target.path, target.name);
              }
            }}
            className="block w-full px-3 py-2 text-left text-sm text-red-700 hover:bg-red-50"
          >
            Eliminar
          </button>
        </div>
      ) : null}

    </div>
  );
}