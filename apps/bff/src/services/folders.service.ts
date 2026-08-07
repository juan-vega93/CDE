import type { FolderItem, FoldersResponse, FolderTreeNode } from "../types/folder.types";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";
import {
  clearDocumentExplorerCache,
  deleteDerivedFolderForSourceFolder,
  moveDerivedFolderForFolderMove,
  renameDerivedFolderForFolderRename
} from "./documents.service";

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

export async function getFolderTree(
  rootPath: string,
  depth = 4,
  focusPath?: string
): Promise<FolderTreeNode> {
  const cleanRootPath = normalizePortalPath(rootPath);
  const cleanFocusPath = focusPath ? normalizePortalPath(focusPath) : "";
  const safeDepth = Math.min(Math.max(Number(depth) || 1, 1), 8);

  if (
    cleanFocusPath &&
    (cleanFocusPath === cleanRootPath ||
      cleanFocusPath.startsWith(`${cleanRootPath}/`))
  ) {
    return getFocusedFolderTree(cleanRootPath, cleanFocusPath);
  }

  async function buildNode(path: string, remainingDepth: number): Promise<FolderTreeNode> {
    const normalizedPath = normalizePortalPath(path);
    const name =
      normalizedPath === "/"
        ? "Repositorio"
        : normalizedPath.split("/").filter(Boolean).pop() || "Repositorio";

    if (remainingDepth <= 0) {
      return {
        name,
        path: normalizedPath,
        type: "folder",
        children: []
      };
    }

    const response = await getFolders(normalizedPath);
    const children = await Promise.all(
      response.items.map((folder: FolderItem) =>
        buildNode(folder.path, remainingDepth - 1)
      )
    );

    return {
      name,
      path: normalizedPath,
      type: "folder",
      children
    };
  }

  return buildNode(cleanRootPath, safeDepth);
}

async function getFocusedFolderTree(
  rootPath: string,
  focusPath: string
): Promise<FolderTreeNode> {
  const rootSegments = getPathSegments(rootPath);
  const focusSegments = getPathSegments(focusPath);
  const branchPaths: string[] = [];

  for (let index = rootSegments.length; index <= focusSegments.length; index += 1) {
    const path = `/${focusSegments.slice(0, index).join("/")}`;
    branchPaths.push(normalizePortalPath(path));
  }

  if (!branchPaths.includes(rootPath)) {
    branchPaths.unshift(rootPath);
  }

  const uniqueBranchPaths = [...new Set(branchPaths)];
  const folderResponses: Array<{ path: string; folders: FolderItem[] }> = [];

  for (const path of uniqueBranchPaths) {
    folderResponses.push({
      path,
      folders: (await getFolders(path)).items
    });
  }
  const foldersByParent = new Map(
    folderResponses.map((response) => [response.path, response.folders])
  );

  function buildBranchNode(path: string): FolderTreeNode {
    const normalizedPath = normalizePortalPath(path);
    const name =
      normalizedPath === "/"
        ? "Repositorio"
        : normalizedPath.split("/").filter(Boolean).pop() || "Repositorio";
    const childFolders = foldersByParent.get(normalizedPath) ?? [];

    return {
      name,
      path: normalizedPath,
      type: "folder",
      children: childFolders.map((folder) => {
        if (uniqueBranchPaths.includes(normalizePortalPath(folder.path))) {
          return buildBranchNode(folder.path);
        }

        return {
          ...folder,
          path: normalizePortalPath(folder.path),
          children: []
        };
      })
    };
  }

  return buildBranchNode(rootPath);
}

export async function createFolder(folderPath: string): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[folders.service] Mock create folder:", { folderPath });
    clearDocumentExplorerCache();
    return;
  }

  const cleanFolderPath = assertWritableDestinationPath(folderPath);
  await nextcloudAdapter.createFolder(cleanFolderPath);
  clearDocumentExplorerCache();
}

export async function deleteFolder(folderPath: string): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[folders.service] Mock delete folder recursively:", {
      folderPath
    });
    clearDocumentExplorerCache();
    return;
  }

  const cleanFolderPath = assertWritableFolderPath(folderPath);

  await nextcloudAdapter.deletePath(cleanFolderPath);
  await deleteDerivedFolderForSourceFolder(cleanFolderPath);
  clearDocumentExplorerCache();
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
    clearDocumentExplorerCache();
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
  await moveDerivedFolderForFolderMove(
    cleanFolderPath,
    cleanDestinationFolderPath
  );
  clearDocumentExplorerCache();
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
    clearDocumentExplorerCache();
    return;
  }

  const cleanFolderPath = assertWritableFolderPath(folderPath);

  const cleanNewName = newName.trim();

  if (!cleanNewName) {
    throw new Error("El nuevo nombre de la carpeta es obligatorio");
  }

  await nextcloudAdapter.renamePath(cleanFolderPath, cleanNewName);
  await renameDerivedFolderForFolderRename(cleanFolderPath, cleanNewName);
  clearDocumentExplorerCache();
}
