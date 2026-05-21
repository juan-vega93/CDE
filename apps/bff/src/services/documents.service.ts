import type { DocumentsResponse, DocumentItem } from "../types/document.types";
import { mapWorkflowStatusToUiStatus } from "./status-mapping.service";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";
import { generateFragFromDocument } from "./fragments.service";
import path from "path";

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

function assertWritableDocumentPath(documentPath: string): string {
  const cleanPath = normalizePortalPath(documentPath);

  if (isTechnicalPath(cleanPath)) {
    throw new Error("No se puede modificar un archivo dentro de una carpeta técnica del sistema");
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

function buildMockDocuments(path: string): DocumentItem[] {
  if (path === "/WIP/ARQ") {
    const status1 = "Nuevo" as const;
    const status2 = "En progreso" as const;

    return [
      {
        id: "doc-wip-arq-001",
        name: "Borrador_Arquitectura_N01.pdf",
        path: `${path}/Borrador_Arquitectura_N01.pdf`,
        extension: "pdf",
        size: 1325000,
        modifiedAt: new Date().toISOString(),
        workflowStatus: status1,
        uiStatus: mapWorkflowStatusToUiStatus(status1)
      },
      {
        id: "doc-wip-arq-002",
        name: "Planta_Preliminar_Areas.docx",
        path: `${path}/Planta_Preliminar_Areas.docx`,
        extension: "docx",
        size: 640000,
        modifiedAt: new Date().toISOString(),
        workflowStatus: status2,
        uiStatus: mapWorkflowStatusToUiStatus(status2)
      }
    ];
  }

  if (path === "/SHARED/ARQ") {
    const status1 = "Nuevo" as const;
    const status2 = "En revisión" as const;
    const status3 = "Aprobado" as const;

    return [
      {
        id: "doc-shared-arq-001",
        name: "Plano_Arquitectura_N01.pdf",
        path: `${path}/Plano_Arquitectura_N01.pdf`,
        extension: "pdf",
        size: 2451200,
        modifiedAt: new Date().toISOString(),
        workflowStatus: status1,
        uiStatus: mapWorkflowStatusToUiStatus(status1)
      },
      {
        id: "doc-shared-arq-002",
        name: "Memoria_Descriptiva_Z01.docx",
        path: `${path}/Memoria_Descriptiva_Z01.docx`,
        extension: "docx",
        size: 845312,
        modifiedAt: new Date().toISOString(),
        workflowStatus: status2,
        uiStatus: mapWorkflowStatusToUiStatus(status2)
      },
      {
        id: "doc-shared-arq-003",
        name: "Modelo_Coordinacion_IFC.ifc",
        path: `${path}/Modelo_Coordinacion_IFC.ifc`,
        extension: "ifc",
        size: 12485312,
        modifiedAt: new Date().toISOString(),
        workflowStatus: status3,
        uiStatus: mapWorkflowStatusToUiStatus(status3)
      }
    ];
  }

  return [];
}

export async function getDocuments(path: string): Promise<DocumentsResponse> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    return {
      path,
      items: buildMockDocuments(path)
    };
  }

  try {
    const items = await nextcloudAdapter.listDocuments(path);
    return { path, items };
  } catch (error) {
    console.error("[documents.service] Nextcloud real failed, using mock:", error);

    return {
      path,
      items: buildMockDocuments(path)
    };
  }
}

export async function getDocumentById(
  id: string,
  path: string
): Promise<DocumentItem | null> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    const documents = buildMockDocuments(path);
    return documents.find((doc) => doc.id === id) ?? null;
  }

  try {
    const documents = await nextcloudAdapter.listDocuments(path);
    return documents.find((doc) => doc.id === id) ?? null;
  } catch (error) {
    console.error("[documents.service] Nextcloud real get by id failed, using mock:", error);

    const documents = buildMockDocuments(path);
    return documents.find((doc) => doc.id === id) ?? null;
  }
  
}

export async function uploadDocument(
  targetPath: string,
  fileBuffer: Buffer,
  contentType?: string
): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[documents.service] Mock upload:", {
      targetPath,
      size: fileBuffer.length,
      contentType
    });
    return;
  }

  const cleanTargetPath = assertWritableDocumentPath(targetPath);
  await nextcloudAdapter.uploadFile(cleanTargetPath, fileBuffer, contentType);
}

export async function deleteDocument(documentPath: string): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[documents.service] Mock delete document:", { documentPath });
    return;
  }

  const cleanDocumentPath = assertWritableDocumentPath(documentPath);

  await nextcloudAdapter.deletePath(cleanDocumentPath);

  const fragPath = getDerivedFragPath(cleanDocumentPath);
  try {
    await nextcloudAdapter.deletePath(fragPath);
  } catch (error) {
    console.warn("[documents.service] No se pudo eliminar derivado FRAG:", error);
  }
}

export async function renameDocument(
  documentPath: string,
  newName: string
): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[documents.service] Mock rename:", {
      documentPath,
      newName
    });
    return;
  }

  const cleanDocumentPath = assertWritableDocumentPath(documentPath);

  const parts = cleanDocumentPath.split("/");
  parts[parts.length - 1] = newName;
  const newDocumentPath = parts.join("/");
  assertWritableDocumentPath(newDocumentPath);

  await nextcloudAdapter.renamePath(cleanDocumentPath, newName);

  const oldFragPath = getDerivedFragPath(cleanDocumentPath);
  const newFragPath = getDerivedFragPath(newDocumentPath);

  try {
    await nextcloudAdapter.movePath(oldFragPath, newFragPath);
  } catch (error) {
    console.warn("[documents.service] No se pudo renombrar derivado FRAG:", error);
  }
}

export async function moveDocument(
  documentPath: string,
  destinationFolderPath: string
): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[documents.service] Mock move document:", {
      documentPath,
      destinationFolderPath
    });
    return;
  }

  const cleanDocumentPath = assertWritableDocumentPath(documentPath);
  const cleanDestinationFolderPath =
    assertWritableDestinationPath(destinationFolderPath);

  const fileName = cleanDocumentPath.split("/").pop();

  if (!fileName) {
    throw new Error("No se pudo determinar el nombre del archivo");
  }

  const normalizedDestinationFolderPath = cleanDestinationFolderPath.replace(/\/$/, "");
  const destinationPath = `${normalizedDestinationFolderPath}/${fileName}`;

  await nextcloudAdapter.movePath(cleanDocumentPath, destinationPath);

  const oldFragPath = getDerivedFragPath(cleanDocumentPath);
  const newFragPath = getDerivedFragPath(destinationPath);

  try {
    await nextcloudAdapter.movePath(oldFragPath, newFragPath);
  } catch (error) {
    console.warn("[documents.service] No se pudo mover derivado FRAG:", error);
  }
}

export async function moveFolder(
  folderPath: string,
  destinationFolderPath: string
): Promise<void> {
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_BFF_URL}/api/folders/move`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        folderPath,
        destinationFolderPath
      })
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "No se pudo mover la carpeta");
  }
}

export async function getDocumentContent(documentPath: string): Promise<{
  buffer: Buffer;
  contentType: string;
  fileName: string;
  size?: number;
}> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    throw new Error(
      "La descarga real de documentos no está disponible en modo mock"
    );
  }

  return nextcloudAdapter.downloadFile(documentPath);
}

export async function getViewerSource(documentPath: string): Promise<{
  kind: "ifc" | "frag";
  modelUrl: string;
}> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";
  const BFF_BASE_URL = process.env.BFF_BASE_URL || "http://localhost:4000";

  if (!documentPath.trim()) {
    throw new Error("documentPath es requerido");
  }

  if (useMock) {
    return {
      kind: "ifc",
      modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
        documentPath
      )}`
    };
  }

  const fragPath = getDerivedFragPath(documentPath);

  try {
    const exists = await nextcloudAdapter.fileExists(fragPath);

    if (exists) {
      return {
        kind: "frag",
        modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
          fragPath
        )}`
      };
    }
  } catch (error) {
    console.warn(
      "[documents.service] Error verificando FRAG, fallback a IFC:",
      error
    );
  }

  return {
    kind: "ifc",
    modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
      documentPath
    )}`
  };
}

export async function generateAndStoreFrag(documentPath: string): Promise<{
  fragPath: string;
}> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (!documentPath.trim()) {
    throw new Error("documentPath es requerido");
  }

  if (useMock) {
    throw new Error("La generación de FRAG no está disponible en modo mock");
  }

  const fragPath = getDerivedFragPath(documentPath);
  const fragBytes = await generateFragFromDocument(documentPath);

  await ensureDerivedFolderExists(fragPath);

  await nextcloudAdapter.uploadFile(
    fragPath,
    Buffer.from(fragBytes),
    "application/octet-stream"
  );

  return { fragPath };
}

function getDerivedFragPath(documentPath: string): string {
  const cleanPath = documentPath.startsWith("/")
    ? documentPath.slice(1)
    : documentPath;

  const parts = cleanPath.split("/").filter(Boolean);

  if (parts.length < 2) {
    const parsed = path.posix.parse(cleanPath);
    return path.posix.join("/_derived", parsed.dir, `${parsed.name}.frag`);
  }

  const projectCode = parts[0];
  const fileName = parts[parts.length - 1];
  const relativeFolder = parts.slice(1, -1).join("/");

  const parsed = path.posix.parse(fileName);
  const fragFileName = `${parsed.name}.frag`;

  return path.posix.join(
    "/",
    projectCode,
    "_derived",
    relativeFolder,
    fragFileName
  );
}

async function ensureDerivedFolderExists(filePath: string): Promise<void> {
  const folderPath = path.posix.dirname(filePath);

  if (folderPath === "/" || folderPath === ".") return;

  const segments = folderPath.split("/").filter(Boolean);
  let currentPath = "";

  for (const segment of segments) {
    currentPath += `/${segment}`;

    try {
      await nextcloudAdapter.createFolder(currentPath);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);

      // ignorar si la carpeta ya existe
      if (
        message.includes("405") ||
        message.includes("Method Not Allowed") ||
        message.includes("409") ||
        message.includes("Conflict")
      ) {
        continue;
      }

      throw error;
    }
  }
}