"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createFolder, uploadDocument } from "@/services/documents.service";

type ExplorerToolbarProps = {
  currentPath: string;
  parentPath: string | null;
};

export function ExplorerToolbar({
  currentPath,
  parentPath
}: ExplorerToolbarProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isUploading, setIsUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);


  function handleOpenFilePicker() {
    fileInputRef.current?.click();
  }

  async function handleFileChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    try {
      setIsUploading(true);
      setMessage(null);
      setError(null);

      await uploadDocument(file, currentPath);

      setMessage(`Archivo "${file.name}" subido correctamente.`);
      router.refresh();
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : "No se pudo subir el archivo";
      setError(errorMessage);
    } finally {
      setIsUploading(false);

      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  }

  async function handleCreateFolder() {
  if (!newFolderName.trim()) {
    setError("El nombre de la carpeta es obligatorio");
    return;
  }

  try {
    setIsCreatingFolder(true);
    setMessage(null);
    setError(null);

    await createFolder(currentPath, newFolderName.trim());

    setMessage(`Carpeta "${newFolderName.trim()}" creada correctamente.`);
    setNewFolderName("");
    router.refresh();
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : "No se pudo crear la carpeta";
    setError(errorMessage);
  } finally {
    setIsCreatingFolder(false);
  }
}

  return (
    <div className="mt-4 rounded-xl border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Ubicación actual
          </p>
          <p className="mt-1 text-sm font-medium text-gray-900">{currentPath}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={handleFileChange}
          />

          <button
            type="button"
            onClick={handleOpenFilePicker}
            disabled={isUploading}
            className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isUploading ? "Subiendo..." : "Subir archivo"}
          </button>

          {parentPath ? (
            <Link
              href={
                parentPath === "/"
                  ? "/documents"
                  : `/documents?path=${encodeURIComponent(parentPath)}`
              }
              className="rounded-lg border px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              ← Subir nivel
            </Link>
          ) : null}
        </div>
      </div>
     
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-4">
        <input
          type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Nombre de nueva carpeta"
              className="rounded-lg border px-3 py-2 text-sm"
          />
        <button
            type="button"
              onClick={handleCreateFolder}
              disabled={isCreatingFolder}
              className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isCreatingFolder ? "Creando..." : "Crear carpeta"}
        </button>
      </div>
    

      {message ? (
        <p className="mt-3 text-sm text-green-700">{message}</p>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-red-700">{error}</p>
      ) : null}
    </div>
  );
}