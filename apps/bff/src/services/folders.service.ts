import type { FoldersResponse } from "../types/folder.types";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";

const nextcloudAdapter = new NextcloudAdapter();

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

  await nextcloudAdapter.createFolder(folderPath);
}

export async function deleteFolder(folderPath: string): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[folders.service] Mock delete folder:", { folderPath });
    return;
  }

  const folders = await nextcloudAdapter.listFolders(folderPath);
  const documents = await nextcloudAdapter.listDocuments(folderPath);

  if (folders.length > 0 || documents.length > 0) {
    throw new Error("La carpeta no está vacía");
  }

  await nextcloudAdapter.deletePath(folderPath);
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

  const cleanFolderPath = folderPath.startsWith("/")
    ? folderPath
    : `/${folderPath}`;

  const cleanDestinationFolderPath = destinationFolderPath.startsWith("/")
    ? destinationFolderPath
    : `/${destinationFolderPath}`;

  const folderName = cleanFolderPath.split("/").pop();

  if (!folderName) {
    throw new Error("No se pudo determinar el nombre de la carpeta");
  }

  const normalizedDestinationFolderPath =
    cleanDestinationFolderPath.replace(/\/$/, "");

  const destinationPath = `${normalizedDestinationFolderPath}/${folderName}`;

  await nextcloudAdapter.movePath(cleanFolderPath, destinationPath);
}
