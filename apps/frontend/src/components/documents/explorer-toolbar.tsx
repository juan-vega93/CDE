"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import {
  createFolder,
  uploadDocuments
} from "@/services/documents.service";
import { requestDocumentExplorerRefresh } from "@/lib/document-explorer-events";

type ExplorerToolbarProps = {
  currentPath: string;
  parentPath: string;
  canGoUp?: boolean;
  projectCode?: string;
};

function sanitizeFolderName(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]/g, "-");
}

export function ExplorerToolbar({
  currentPath,
  parentPath,
  canGoUp = false,
  projectCode = ""
}: ExplorerToolbarProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);

  const parentHref = useMemo(() => {
    const params = new URLSearchParams();
    params.set("path", parentPath);
    if (projectCode) params.set("projectCode", projectCode);
    return `/documents?${params.toString()}`;
  }, [parentPath, projectCode]);

  function handleOpenFilePicker() {
    fileInputRef.current?.click();
  }

  async function uploadFileList(fileList: FileList | File[]) {
    const files = Array.from(fileList);

    if (!files.length) return;

    try {
      setIsUploading(true);
      setMessage(null);
      setError(null);

      await uploadDocuments(files, currentPath, projectCode);

      setMessage(
        files.length === 1
          ? `Archivo "${files[0].name}" subido correctamente.`
          : `${files.length} archivos subidos correctamente.`
      );
      requestDocumentExplorerRefresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "No se pudieron subir los archivos";
      setError(errorMessage);
    } finally {
      setIsUploading(false);
      setIsDragging(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const files = event.target.files;
    if (!files?.length) return;
    await uploadFileList(files);
  }

  async function handleCreateFolder() {
    const folderName = sanitizeFolderName(newFolderName);

    if (!folderName) {
      setError("El nombre de la carpeta es obligatorio");
      return;
    }

    try {
      setIsCreatingFolder(true);
      setMessage(null);
      setError(null);

      await createFolder(currentPath, folderName, projectCode);

      setMessage(`Carpeta "${folderName}" creada correctamente.`);
      setNewFolderName("");
      requestDocumentExplorerRefresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "No se pudo crear la carpeta";
      setError(errorMessage);
    } finally {
      setIsCreatingFolder(false);
    }
  }

  return (
    <section className="w-full max-w-full overflow-hidden rounded border border-slate-300 bg-white">
      <div className="flex min-w-0 flex-col gap-2 border-b border-slate-200 px-3 py-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-semibold uppercase tracking-wide">
              Ubicacion actual
            </span>
            {projectCode ? (
              <span className="rounded bg-slate-100 px-2 py-1 font-medium text-slate-700">
                {projectCode}
              </span>
            ) : null}
          </div>
          <p className="mt-0.5 truncate text-sm font-semibold text-slate-900">
            {currentPath}
          </p>
        </div>

        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
          {canGoUp ? (
            <Link
              href={parentHref}
              className="inline-flex h-9 items-center rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Subir nivel
            </Link>
          ) : null}

          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            type="button"
            onClick={handleOpenFilePicker}
            disabled={isUploading}
            className="inline-flex h-9 items-center rounded bg-red-700 px-3 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "Subiendo..." : "Subir archivos"}
          </button>
        </div>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          void uploadFileList(event.dataTransfer.files);
        }}
        className={`border-b border-slate-200 px-3 py-2 ${
          isDragging ? "bg-red-50" : "bg-slate-50"
        }`}
      >
        <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm text-slate-500">
              Arrastra varios archivos aqui o usa el boton de carga. Los IFC se
              procesan para visor BIM.
            </p>
          </div>

          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:min-w-[320px] lg:w-auto">
            <input
              type="text"
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateFolder();
                }
              }}
              placeholder="Nombre de subcarpeta"
              className="h-9 min-w-0 flex-1 rounded border border-slate-300 bg-white px-3 text-sm outline-none focus:border-red-600"
            />
            <button
              type="button"
              onClick={() => void handleCreateFolder()}
              disabled={isCreatingFolder}
              className="inline-flex h-9 items-center rounded border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCreatingFolder ? "Creando..." : "Crear carpeta"}
            </button>
          </div>
        </div>
      </div>

      {message || error ? (
        <div
          className={`px-4 py-3 text-sm ${
            error ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {error || message}
        </div>
      ) : null}
    </section>
  );
}
