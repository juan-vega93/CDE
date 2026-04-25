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

function getCurrentProjectKey() {
  const rootPath = process.env.NEXTCLOUD_ROOT_PATH || "";
  const clean = rootPath.replace(/^\/+|\/+$/g, "");
  const segments = clean.split("/").filter(Boolean);

  return segments[segments.length - 1] || "default-project";
}
function buildViewpointsFolderPath() {
  const projectKey = getCurrentProjectKey();
  return `/_meta/${projectKey}/viewpoints`;
}
function buildViewpointsFilePath(documentPath: string) {
  const encoded = Buffer.from(documentPath, "utf8").toString("base64url");
  return `${buildViewpointsFolderPath()}/${encoded}.json`;
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

  const folderPath = buildViewpointsFolderPath();
  const filePath = buildViewpointsFilePath(documentPath);

  await nextcloudAdapter.ensureFolderExists("/.viewer");
  await nextcloudAdapter.ensureFolderExists(folderPath);

  await nextcloudAdapter.uploadTextFile(
    filePath,
    JSON.stringify(viewpoints, null, 2)
  );
}