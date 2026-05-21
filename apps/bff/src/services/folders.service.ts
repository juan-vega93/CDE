import type { FoldersResponse } from "../types/folder.types";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";

const nextcloudAdapter = new NextcloudAdapter();
const TECHNICAL_FOLDER_NAMES = new Set([
  "_derived",
  "_bcf",
  "_meta",
  ".viewer",
  "_viewer"
]);

function normalizePortalPath(value: string): string {
  const clean = value.trim();

  if (!clean) return "/";
  return clean.startsWith("/") ? clean.replace(/\/$/, "") || "/" : `/${clean.replace(/\/$/, "")}`;
}

function getPathSegments(portalPath: string): string[] {
  return normalizePortalPath(portalPath)
    .split("/")
    .filter(Boolean);
}

function isTechnicalPath(portalPath: string): boolean {
  return getPathSegments(portalPath).some((segment) =>
    TECHNICAL_FOLDER_NAMES.has(segment.trim().toLowerCase())
  );
}

function assertWritableFolderPath(folderPath: string): string {
  const cleanPath = normalizePortalPath(folderPath);
  const segments = getPathSegments(cleanPath);

  if (segments.length <= 1) {
    throw new Error("No se puede modificar la carpeta raíz del proyecto");
  }

  if (isTechnicalPath(cleanPath)) {
    throw new Error("No se puede modificar una carpeta técnica del sistema");
  }

  return cleanPath;
}

function assertWritableDestinationPath(destinationPath: string): string {
  const cleanPath = normalizePortalPath(destinationPath);

  if (isTechnicalPath(cleanPath)) {
    throw new Error("No se puede usar una carpeta técnica como destino");
  }

  return cleanPath;
}

function getMockFolders(path: string): FoldersResponse {
  if (path === "/" || path === "") {
    return {
      path,
      items: [
        { name: "WIP", path: "/WIP", type: "folder" },
        { name: "SHARED", path: "/SHARED", type: "folder" },
        { name: "PUBLISHED", path: "/PUBLISHED", type: "folder" },
        { name: "ARCHIVE", path: "/ARCHIVE", type: "folder" }
      ]
    };
  }

  if (path === "/WIP") {
    return {
      path,
      items: [
        { name: "ARQ", path: "/WIP/ARQ", type: "folder" },
        { name: "STR", path: "/WIP/STR", type: "folder" },
        { name: "MEP", path: "/WIP/MEP", type: "folder" }
      ]
    };
  }

  if (path === "/SHARED") {
    return {
      path,
      items: [
        { name: "ARQ", path: "/SHARED/ARQ", type: "folder" },
        { name: "STR", path: "/SHARED/STR", type: "folder" },
        { name: "MEP", path: "/SHARED/MEP", type: "folder" },
        { name: "CIV", path: "/SHARED/CIV", type: "folder" }
      ]
    };
  }

  if (path === "/PUBLISHED") {
    return {
      path,
      items: [
        { name: "ISSUED", path: "/PUBLISHED/ISSUED", type: "folder" },
        { name: "APPROVED", path: "/PUBLISHED/APPROVED", type: "folder" },
        { name: "AS-BUILT", path: "/PUBLISHED/AS-BUILT", type: "folder" }
      ]
    };
  }

  if (path === "/ARCHIVE") {
    return {
      path,
      items: [
        { name: "2025", path: "/ARCHIVE/2025", type: "folder" },
        { name: "2026", path: "/ARCHIVE/2026", type: "folder" }
      ]
    };
  }

  return {
    path,
    items: []
  };
}

export async function getFolders(path: string): Promise<FoldersResponse> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    return getMockFolders(path);
  }

  try {
    const items = await nextcloudAdapter.listFolders(path);
    return { path, items };
  } catch (error) {
    console.error("[folders.service] Nextcloud real failed, using mock:", error);
    return getMockFolders(path);
  }
}

export async function createFolder(folderPath: string): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[folders.service] Mock create folder:", { folderPath });
    return;
  }

  const cleanFolderPath = assertWritableDestinationPath(folderPath);
  await nextcloudAdapter.createFolder(cleanFolderPath);
}

export async function deleteFolder(folderPath: string): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[folders.service] Mock delete folder recursively:", {
      folderPath
    });
    return;
  }

  const cleanFolderPath = assertWritableFolderPath(folderPath);

  await nextcloudAdapter.deletePath(cleanFolderPath);
}
export async function moveFolder(
  folderPath: string,
  destinationFolderPath: string
): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[folders.service] Mock move folder:", {
      folderPath,
      destinationFolderPath
    });
    return;
  }

  const cleanFolderPath = assertWritableFolderPath(folderPath);
  const cleanDestinationFolderPath =
  assertWritableDestinationPath(destinationFolderPath);

  const folderName = cleanFolderPath.split("/").pop();

  if (!folderName) {
    throw new Error("No se pudo determinar el nombre de la carpeta");
  }

  const normalizedDestinationFolderPath =
    cleanDestinationFolderPath.replace(/\/$/, "");

  const destinationPath = `${normalizedDestinationFolderPath}/${folderName}`;

  if (cleanDestinationFolderPath.startsWith(`${cleanFolderPath}/`)) {
    throw new Error("No se puede mover una carpeta dentro de sí misma");
  }
  await nextcloudAdapter.movePath(cleanFolderPath, destinationPath);
}
export async function renameFolder(
  folderPath: string,
  newName: string
): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[folders.service] Mock rename folder:", {
      folderPath,
      newName
    });
    return;
  }

  const cleanFolderPath = folderPath.startsWith("/")
    ? folderPath
    : `/${folderPath}`;

  const cleanNewName = newName.trim();

  if (!cleanNewName) {
    throw new Error("El nuevo nombre de la carpeta es obligatorio");
  }

  await nextcloudAdapter.renamePath(cleanFolderPath, cleanNewName);
}