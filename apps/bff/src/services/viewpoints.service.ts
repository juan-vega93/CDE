import { NextcloudAdapter } from "../adapters/nextcloud.adapter";

const nextcloudAdapter = new NextcloudAdapter();

export type StoredViewerViewpoint = {
  id: string;
  name: string;
  camera: {
    position: [number, number, number];
    target: [number, number, number];
  };
  visibility: {
    hidden: Record<string, number[]>;
  };
};
function normalizePortalPath(value: string): string {
  const clean = value.trim();

  if (!clean) return "/";
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function getProjectCodeFromDocumentPath(documentPath: string): string {
  const cleanPath = normalizePortalPath(documentPath);
  const segments = cleanPath.split("/").filter(Boolean);

  const projectCode = segments[0]?.trim().toUpperCase();

  if (!projectCode) {
    throw new Error("No se pudo determinar el proyecto del documentPath");
  }

  return projectCode;
}

function buildViewpointsFolderPath(documentPath: string) {
  const projectCode = getProjectCodeFromDocumentPath(documentPath);
  return `/${projectCode}/_viewer/viewpoints`;
}

function buildViewpointsFilePath(documentPath: string) {
  const cleanDocumentPath = normalizePortalPath(documentPath);
  const encoded = Buffer.from(cleanDocumentPath, "utf8").toString("base64url");

  return `${buildViewpointsFolderPath(cleanDocumentPath)}/${encoded}.json`;
}


export async function getViewpoints(documentPath: string) {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    return [];
  }

  const filePath = buildViewpointsFilePath(documentPath);

  try {
    const text = await nextcloudAdapter.downloadTextFile(filePath);
    const parsed = JSON.parse(text) as StoredViewerViewpoint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";

    // Si no existe todavía el archivo, devolvemos lista vacía.
    if (message.includes("404")) {
      return [];
    }

    throw error;
  }
}

export async function saveViewpoints(
  documentPath: string,
  viewpoints: StoredViewerViewpoint[]
) {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[viewpoints.service] Mock save:", {
      documentPath,
      count: viewpoints.length
    });
    return;
  }

  const projectCode = getProjectCodeFromDocumentPath(documentPath);
  const viewerRootPath = `/${projectCode}/_viewer`;
  const folderPath = buildViewpointsFolderPath(documentPath);
  const filePath = buildViewpointsFilePath(documentPath);

  await nextcloudAdapter.ensureFolderExists(viewerRootPath);
  await nextcloudAdapter.ensureFolderExists(folderPath);

  await nextcloudAdapter.uploadTextFile(
    filePath,
    JSON.stringify(viewpoints, null, 2)
  );
}