"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  deleteDocument,
  deleteFolder,
  renameDocument,
  moveDocument,
  moveFolder
} from "@/services/documents.service";
import type { ExplorerRow, DocumentUiStatus } from "@/types/documents";

type DocumentsExplorerProps = {
  rows: ExplorerRow[];
  currentPath: string;
  projectCode?: string;
};

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

function formatDate(date?: string): string {
  if (!date) return "-";

  return new Date(date).toLocaleString("es-PE", {
    timeZone: "America/Lima"
  });
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

export function DocumentsExplorer({
  rows,
  currentPath,
  projectCode = ""
}: DocumentsExplorerProps) {
  const router = useRouter();
  const [deletingPath, setDeletingPath] = useState<string | null>(null);
  const [movingFolderPath, setMovingFolderPath] = useState<string | null>(null);
  const isEmpty = rows.length === 0;

  async function handleDeleteDocument(path: string) {
    const confirmDelete = window.confirm("¿Eliminar este archivo?");

    if (!confirmDelete) {
      return;
    }

    try {
      setDeletingPath(path);
      await deleteDocument(path);
      router.refresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "No se pudo eliminar el archivo";
      window.alert(errorMessage);
    } finally {
      setDeletingPath(null);
    }
  }

  async function handleDeleteFolder(path: string) {
    const confirmDelete = window.confirm(
      "¿Eliminar esta carpeta? Solo funcionará si está vacía."
    );

    if (!confirmDelete) {
      return;
    }

    try {
      setDeletingPath(path);
      await deleteFolder(path);
      router.refresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "No se pudo eliminar la carpeta";
      window.alert(errorMessage);
    } finally {
      setDeletingPath(null);
    }
  }

  async function handleRenameDocument(path: string, currentName: string) {
  const newName = window.prompt("Nuevo nombre del archivo:", currentName);

  if (!newName || newName.trim() === "" || newName === currentName) {
    return;
  }

  try {
    setDeletingPath(path);
    await renameDocument(path, newName.trim());
    router.refresh();
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "No se pudo renombrar el archivo";
    window.alert(errorMessage);
  } finally {
    setDeletingPath(null);
  }
  }

  async function handleRenameFolder(path: string, currentName: string) {
  const newName = window.prompt("Nuevo nombre de la carpeta:", currentName);

  if (!newName || newName.trim() === "" || newName === currentName) {
    return;
  }

  try {
    setDeletingPath(path);
    await renameDocument(path, newName.trim());
    router.refresh();
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "No se pudo renombrar la carpeta";
    window.alert(errorMessage);
  } finally {
    setDeletingPath(null);
  }
 }

 async function handleMoveDocument(path: string) {
  const destination = window.prompt(
    "Ruta destino (ej: /03-WIP/ARQ/02_WORK/Subcarpeta):"
  );

  if (!destination || destination.trim() === "") {
    return;
  }

  try {
    setDeletingPath(path);
    await moveDocument(path, destination.trim());
    router.refresh();
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "No se pudo mover el archivo";
    window.alert(errorMessage);
  } finally {
    setDeletingPath(null);
  }
 }
 async function handleMoveFolder(path: string) {
  const destination = window.prompt(
    "Ruta destino de la carpeta (ej: /03-WIP/ARQ/02_WORK/Subcarpeta):"
  );

  if (!destination || destination.trim() === "") {
    return;
  }

  try {
    setDeletingPath(path);
    await moveFolder(path, destination.trim());
    router.refresh();
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "No se pudo mover la carpeta";
    window.alert(errorMessage);
  } finally {
    setDeletingPath(null);
  }
 }
 function handleMoveFolderInit(path: string) {
  setMovingFolderPath(path);
}



  return (
    <div className="mt-6 overflow-hidden rounded-xl border bg-white">
      {movingFolderPath ? (
        <div className="mb-4 rounded-lg border bg-gray-50 p-4">
          <p className="mb-2 text-sm text-gray-700">
            Selecciona carpeta destino para:
            <span className="font-medium"> {movingFolderPath}</span>
          </p>

          <div className="flex flex-wrap gap-2">
            {rows
              .filter((r) => r.kind === "folder" && r.path !== movingFolderPath)
              .map((folder) => (
                <button
                  key={folder.path}
                  type="button"
                  onClick={async () => {
                    try {
                      setDeletingPath(movingFolderPath);
                      await moveFolder(movingFolderPath, folder.path);
                      setMovingFolderPath(null);
                      router.refresh();
                    } catch (err) {
                      const errorMessage =
                        err instanceof Error
                          ? err.message
                          : "No se pudo mover la carpeta";
                      window.alert(errorMessage);
                    } finally {
                      setDeletingPath(null);
                    }
                  }}
                  className="rounded border border-gray-200 bg-white px-3 py-1 text-sm text-gray-700 hover:bg-gray-100"
                >
                  📁 {folder.name}
                </button>
              ))}
          </div>

          <button
            type="button"
            onClick={() => setMovingFolderPath(null)}
            className="mt-3 text-xs font-medium text-red-600 hover:underline"
          >
            Cancelar
          </button>
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
          </tr>
        </thead>

        <tbody>
          {isEmpty ? (
            <tr>
              <td colSpan={6} className="px-6 py-12 text-center">
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
            rows.map((row, index) => {
              if (row.kind === "folder") {
                return (
                  <tr
                    key={`folder-${row.path}-${index}`}
                    className="text-sm hover:bg-gray-50"
                  >
                    <td className="border-b px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          href={`/documents?path=${encodeURIComponent(row.path)}${
                            projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
                          }`}
                          className="flex items-center gap-2 font-medium text-blue-700 hover:underline"
                        >
                          <span>{getRowIcon("folder")}</span>
                          <span>{row.name}</span>
                        </Link>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleRenameFolder(row.path, row.name)}
                            disabled={deletingPath === row.path}
                            className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Renombrar
                          </button>
                          <button
                              type="button"
                              onClick={() => handleMoveFolderInit(row.path)}
                              disabled={deletingPath === row.path}
                              className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              Mover
                          </button>

                          <button
                            type="button"
                            onClick={() => handleDeleteFolder(row.path)}
                            disabled={deletingPath === row.path}
                            className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {deletingPath === row.path ? "Procesando..." : "Eliminar"}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td className="border-b px-4 py-3">Carpeta</td>
                    <td className="border-b px-4 py-3">-</td>
                    <td className="border-b px-4 py-3">-</td>
                    <td className="border-b px-4 py-3">-</td>
                    <td className="border-b px-4 py-3">-</td>
                  </tr>
                );
              }

              return (
                <tr key={`doc-${row.id}`} className="text-sm hover:bg-gray-50">
                  <td className="border-b px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <Link
                        href={`/documents/${row.id}?path=${encodeURIComponent(currentPath)}${
                          projectCode ? `&projectCode=${encodeURIComponent(projectCode)}` : ""
                        }`}
                        className="flex items-center gap-2 font-medium text-blue-700 hover:underline"
                      >
                        <span>{getRowIcon("document", row.extension)}</span>
                        <span>{row.name}</span>
                      </Link>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleRenameDocument(row.path, row.name)}
                          disabled={deletingPath === row.path}
                          className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Renombrar
                        </button>
                        <button
                            type="button"
                            onClick={() => handleMoveDocument(row.path)}
                            disabled={deletingPath === row.path}
                            className="rounded border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            Mover
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDocument(row.path)}
                          disabled={deletingPath === row.path}
                          className="rounded border border-red-200 bg-red-50 px-2 py-1 text-xs text-red-700 hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {deletingPath === row.path ? "Eliminando..." : "Eliminar"}
                        </button>
                      </div>
                    </div>
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
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}