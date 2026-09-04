import type {
  DocumentVersionsResponse,
  DocumentsResponse,
  DocumentItem
} from "../types/document.types";
import { mapWorkflowStatusToUiStatus } from "./status-mapping.service";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";
import { generateFragFromBuffer, generateFragFromDocument } from "./fragments.service";
import { indexBimPropertiesFromBuffer } from "./bim-property-indexer.service";
import path from "path";
import { getWorkPackageLinks } from "./work-package-links.service";
import type { FolderItem } from "../types/folder.types";
import type { WorkPackageLink } from "../types/work-package-link.types";
import { recordTiming } from "../utils/request-timing";
import { isDatabaseEnabled } from "../db/client";
import {
  upsertBimIndexJob,
  upsertBimModel,
  upsertBimModelDerivative,
  type BimModelStatus
} from "../db/bim-index-store";
import {
  buildBimDerivativeId,
  deleteBimDerivativesForSource,
  findBimDerivative,
  findBimDerivativeRecord,
  getProjectCodeFromPath,
  getStableFragPath,
  remapBimDerivativeSourceFolder,
  remapBimDerivativeSourcePath,
  upsertBimDerivative
} from "./bim-derivatives.service";

const nextcloudAdapter = new NextcloudAdapter();
type CurrentBimDerivativeIdentity = {
  id: string;
  projectCode: string;
  sourcePath: string;
  sourceName: string;
  fileId?: string | null;
  versionId: string;
  versionKey?: string | null;
  fragPath: string;
};

function getBimIndexSourceHash(identity: CurrentBimDerivativeIdentity): string {
  return identity.versionKey?.trim() || identity.fileId?.trim() || identity.id;
}

function getBimIndexModelKey(identity: CurrentBimDerivativeIdentity): string {
  return `frag:${identity.sourcePath}`.toLowerCase();
}

function mapDerivativeStatusToBimStatus(status: "pending" | "generated" | "failed"): BimModelStatus {
  if (status === "failed") return "failed";
  return "pending";
}

async function registerBimIndexCandidate(
  identity: CurrentBimDerivativeIdentity,
  input: {
    derivativeStatus: "pending" | "generated" | "failed";
    phase: string;
    errorMessage?: string | null;
  }
): Promise<void> {
  if (!isDatabaseEnabled()) return;

  try {
    const sourceHash = getBimIndexSourceHash(identity);
    const modelKey = getBimIndexModelKey(identity);
    const modelStatus = mapDerivativeStatusToBimStatus(input.derivativeStatus);
    const model = await upsertBimModel({
      projectCode: identity.projectCode,
      documentId: identity.fileId ?? undefined,
      documentPath: identity.sourcePath,
      documentName: identity.sourceName,
      sourceVersion: identity.versionId,
      sourceHash,
      modelKey,
      status: modelStatus,
      errorMessage: input.errorMessage ?? undefined,
      metadata: {
        derivativeId: identity.id,
        fragPath: identity.fragPath,
        sourceKind: "nextcloud-ifc",
        versionKey: identity.versionKey ?? null
      }
    });

    await upsertBimModelDerivative({
      bimModelId: model.id,
      derivativeType: "frag",
      storagePath: identity.fragPath,
      sourceHash,
      status: input.derivativeStatus === "generated" ? "ready" : modelStatus,
      metadata: {
        derivativeId: identity.id,
        sourcePath: identity.sourcePath,
        sourceName: identity.sourceName,
        versionId: identity.versionId,
        versionKey: identity.versionKey ?? null
      }
    });

    await upsertBimIndexJob({
      projectCode: identity.projectCode,
      documentPath: identity.sourcePath,
      sourceHash,
      status: input.derivativeStatus === "failed" ? "failed" : "pending",
      errorMessage: input.errorMessage ?? undefined,
      stats: {
        modelKey,
        documentName: identity.sourceName,
        derivativeId: identity.id,
        fragPath: identity.fragPath,
        phase: input.phase,
        needsPropertyExtraction: input.derivativeStatus === "generated"
      }
    });
  } catch (error) {
    console.warn("[documents.service] No se pudo registrar candidato de indice BIM:", error);
  }
}

const TECHNICAL_FOLDER_NAMES = new Set([
  "_derived",
  "_bcf",
  "_meta",
  ".viewer",
  "_viewer"
]);

function withBimDerivativeStatus(document: DocumentItem): DocumentItem {
  const extension = document.extension?.toLowerCase() || "";

  if (extension !== "ifc" && extension !== "frag") {
    return {
      ...document,
      bimDerivative: { status: "not_applicable" }
    };
  }

  if (extension === "frag") {
    return {
      ...document,
      bimDerivative: {
        status: "generated",
        fragPath: document.path,
        generatedAt: document.modifiedAt ?? null
      }
    };
  }

  const derivative = findBimDerivativeRecord({
    sourcePath: document.path,
    fileId: document.fileId ?? null,
    versionId: "current",
    versionKey: document.etag ?? document.modifiedAt ?? null
  });

  if (!derivative) {
    return {
      ...document,
      bimDerivative: { status: "missing" }
    };
  }

  return {
    ...document,
    bimDerivative: {
      status: derivative.status,
      fragPath: derivative.fragPath,
      generatedAt: derivative.generatedAt ?? null,
      error: derivative.error ?? null
    }
  };
}

function withBimDerivativeStatuses(documents: DocumentItem[]): DocumentItem[] {
  return documents.map(withBimDerivativeStatus);
}
type DocumentExplorerData = {
  path: string;
  folders: FolderItem[];
  documents: DocumentItem[];
  workPackageLinks: WorkPackageLink[];
};

type DocumentExplorerCacheEntry = {
  expiresAt: number;
  data: DocumentExplorerData;
};

const documentExplorerCache = new Map<string, DocumentExplorerCacheEntry>();
const fragGenerationQueue: string[] = [];
const queuedFragGenerationPaths = new Set<string>();
const activeFragGenerationPromises = new Map<string, Promise<{ fragPath: string }>>();
const activeBimPropertyIndexPromises = new Map<string, Promise<{
  documentPath: string;
  status: "ready";
  elementCount: number;
  propertyCount: number;
}>>();
let activeFragGenerationJobs = 0;

function getDocumentExplorerCacheTtlMs(): number {
  const raw = Number(process.env.BFF_DOCUMENT_EXPLORER_CACHE_TTL_MS || "300000");
  return Number.isFinite(raw) ? Math.max(0, Math.min(raw, 300000)) : 300000;
}

export function clearDocumentExplorerCache(): void {
  documentExplorerCache.clear();
}

function getFragGenerationConcurrency(): number {
  const raw = Number(process.env.BFF_UPLOAD_FRAG_CONCURRENCY || "1");
  return Number.isFinite(raw) ? Math.max(1, Math.min(raw, 4)) : 1;
}

export function enqueueFragGeneration(documentPath: string): void {
  const cleanDocumentPath = normalizePortalPath(documentPath);

  if (!cleanDocumentPath.toLowerCase().endsWith(".ifc")) return;
  if (queuedFragGenerationPaths.has(cleanDocumentPath)) return;

  queuedFragGenerationPaths.add(cleanDocumentPath);
  fragGenerationQueue.push(cleanDocumentPath);
  void runNextFragGenerationJob();
}

export async function indexDocumentBimProperties(documentPath: string): Promise<{
  documentPath: string;
  status: "active" | "ready";
  elementCount?: number;
  propertyCount?: number;
}> {
  const cleanDocumentPath = normalizePortalPath(documentPath);
  if (!cleanDocumentPath.toLowerCase().endsWith(".ifc")) {
    throw new Error("Solo se pueden indexar propiedades desde archivos IFC");
  }

  const active = activeBimPropertyIndexPromises.get(cleanDocumentPath);
  if (active) {
    return { documentPath: cleanDocumentPath, status: "active" };
  }

  const promise = (async () => {
    const identity = await buildCurrentDerivativeIdentity(cleanDocumentPath);
    const sourceHash = getBimIndexSourceHash(identity);
    const modelKey = getBimIndexModelKey(identity);
    const ifcFile = await getDocumentContent(cleanDocumentPath);
    const result = await indexBimPropertiesFromBuffer({
      projectCode: identity.projectCode,
      documentId: identity.fileId ?? undefined,
      documentPath: identity.sourcePath,
      documentName: identity.sourceName,
      sourceVersion: identity.versionId,
      sourceHash,
      modelKey,
      ifcBuffer: ifcFile.buffer
    });

    clearDocumentExplorerCache();
    return {
      documentPath: cleanDocumentPath,
      status: "ready" as const,
      elementCount: result.elementCount,
      propertyCount: result.propertyCount
    };
  })().finally(() => {
    activeBimPropertyIndexPromises.delete(cleanDocumentPath);
  });

  activeBimPropertyIndexPromises.set(cleanDocumentPath, promise);
  return promise;
}
export function getFragGenerationQueueStatus(): {
  activeJobs: number;
  concurrency: number;
  queuedJobs: number;
  queuedPaths: string[];
  activePaths: string[];
} {
  return {
    activeJobs: activeFragGenerationJobs,
    concurrency: getFragGenerationConcurrency(),
    queuedJobs: fragGenerationQueue.length,
    queuedPaths: [...fragGenerationQueue],
    activePaths: [...activeFragGenerationPromises.keys()]
  };
}

export async function queueFragGeneration(documentPath: string): Promise<{
  documentPath: string;
  status: "queued" | "generated" | "active";
  fragPath?: string;
}> {
  const cleanDocumentPath = normalizePortalPath(documentPath);

  if (!cleanDocumentPath.toLowerCase().endsWith(".ifc")) {
    throw new Error("Solo se pueden preparar archivos IFC para BIM");
  }

  const identity = await buildCurrentDerivativeIdentity(cleanDocumentPath);
  const existingDerivative = findBimDerivativeRecord({
    sourcePath: identity.sourcePath,
    fileId: identity.fileId,
    versionId: identity.versionId,
    versionKey: identity.versionKey
  });

  if (existingDerivative?.status === "generated") {
    try {
      const exists = await nextcloudAdapter.fileExists(existingDerivative.fragPath);
      if (exists) {
        void registerBimIndexCandidate(identity, {
          derivativeStatus: "generated",
          phase: "frag-existing"
        });
        return {
          documentPath: cleanDocumentPath,
          status: "generated",
          fragPath: existingDerivative.fragPath
        };
      }
    } catch {
      // Si no se puede comprobar, se encola regeneracion.
    }
  }

  upsertBimDerivative({
    id: identity.id,
    projectCode: identity.projectCode,
    sourcePath: identity.sourcePath,
    sourceName: identity.sourceName,
    fileId: identity.fileId,
    versionId: identity.versionId,
    versionKey: identity.versionKey,
    fragPath: identity.fragPath,
    status: "pending",
    error: null,
    generatedAt: null
  });

  void registerBimIndexCandidate(identity, {
    derivativeStatus: "pending",
    phase: "frag-queued"
  });

  clearDocumentExplorerCache();

  if (activeFragGenerationPromises.has(cleanDocumentPath)) {
    return {
      documentPath: cleanDocumentPath,
      status: "active",
      fragPath: identity.fragPath
    };
  }

  enqueueFragGeneration(cleanDocumentPath);

  return {
    documentPath: cleanDocumentPath,
    status: "queued",
    fragPath: identity.fragPath
  };
}

async function runNextFragGenerationJob(): Promise<void> {
  if (activeFragGenerationJobs >= getFragGenerationConcurrency()) return;

  const documentPath = fragGenerationQueue.shift();
  if (!documentPath) return;

  activeFragGenerationJobs += 1;
  const startedAt = Date.now();

  try {
    clearDocumentExplorerCache();
    console.log("[FRAG QUEUE START]", {
      documentPath,
      queued: fragGenerationQueue.length
    });

    const fragResult = await generateAndStoreFrag(documentPath);

    console.log("[FRAG QUEUE OK]", {
      documentPath,
      fragPath: fragResult.fragPath,
      durationMs: Date.now() - startedAt
    });
  } catch (error) {
    console.error("[FRAG QUEUE ERROR]", {
      documentPath,
      durationMs: Date.now() - startedAt,
      error
    });
  } finally {
    queuedFragGenerationPaths.delete(documentPath);
    activeFragGenerationJobs -= 1;
    clearDocumentExplorerCache();
    void runNextFragGenerationJob();
  }
}

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

async function getCurrentDocumentMetadata(documentPath: string): Promise<{
  fileId?: string | null;
  etag?: string | null;
  size?: number | null;
  modifiedAt?: string | null;
}> {
  const cleanDocumentPath = normalizePortalPath(documentPath);
  const parentPath = path.posix.dirname(cleanDocumentPath);
  const fileName = path.posix.basename(cleanDocumentPath);

  try {
    const documents = await nextcloudAdapter.listDocuments(parentPath);
    const document = documents.find((item) => item.name === fileName);

    return {
      fileId: document?.fileId ?? null,
      etag: document?.etag ?? null,
      size: document?.size ?? null,
      modifiedAt: document?.modifiedAt ?? null
    };
  } catch (error) {
    console.warn("[documents.service] No se pudo leer metadata del documento:", {
      documentPath: cleanDocumentPath,
      error
    });

    return {};
  }
}

async function buildCurrentDerivativeIdentity(documentPath: string): Promise<{
  id: string;
  projectCode: string;
  sourcePath: string;
  sourceName: string;
  fileId?: string | null;
  versionId: string;
  versionKey?: string | null;
  fragPath: string;
}> {
  const sourcePath = normalizePortalPath(documentPath);
  const sourceName = path.posix.basename(sourcePath);
  const projectCode = getProjectCodeFromPath(sourcePath);
  const metadata = await getCurrentDocumentMetadata(sourcePath);
  const versionKey =
    metadata.etag?.trim() ||
    [metadata.modifiedAt, metadata.size].filter(Boolean).join(":") ||
    null;
  const versionId = "current";
  const id = buildBimDerivativeId({
    projectCode,
    sourcePath,
    fileId: metadata.fileId,
    versionId,
    versionKey
  });

  return {
    id,
    projectCode,
    sourcePath,
    sourceName,
    fileId: metadata.fileId,
    versionId,
    versionKey,
    fragPath: getStableFragPath({ projectCode, derivativeId: id })
  };
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

function filterLinksForDocuments(
  links: WorkPackageLink[],
  documents: DocumentItem[]
): WorkPackageLink[] {
  const documentIds = new Set(documents.map((document) => document.id));
  const documentPaths = new Set(documents.map((document) => document.path));

  return links.filter(
    (link) =>
      documentIds.has(link.documentId) || documentPaths.has(link.documentPath)
  );
}

export async function getDocuments(path: string): Promise<DocumentsResponse> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    return {
      path,
      items: withBimDerivativeStatuses(buildMockDocuments(path))
    };
  }

  try {
    const items = await nextcloudAdapter.listDocuments(path);
    return { path, items: withBimDerivativeStatuses(items) };
  } catch (error) {
    console.error("[documents.service] Nextcloud real failed, using mock:", error);

    return {
      path,
      items: withBimDerivativeStatuses(buildMockDocuments(path))
    };
  }
}

export async function getDocumentExplorer(path: string): Promise<DocumentExplorerData> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";
  const cleanPath = normalizePortalPath(path);
  const cacheKey = `${useMock ? "mock" : "real"}:${cleanPath}`;
  const cached = documentExplorerCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    recordTiming("document.explorer_cache", 0, cleanPath);
    return cached.data;
  }

  function cacheAndReturn(data: DocumentExplorerData): DocumentExplorerData {
    const ttlMs = getDocumentExplorerCacheTtlMs();

    if (ttlMs > 0) {
      documentExplorerCache.set(cacheKey, {
        expiresAt: Date.now() + ttlMs,
        data
      });
    }

    return data;
  }

  if (useMock) {
    const documents = withBimDerivativeStatuses(buildMockDocuments(cleanPath));

    return cacheAndReturn({
      path: cleanPath,
      folders: [],
      documents,
      workPackageLinks: filterLinksForDocuments(getWorkPackageLinks(), documents)
    });
  }

  try {
    const directory = await nextcloudAdapter.listDirectory(cleanPath);

    return cacheAndReturn({
      path: cleanPath,
      folders: directory.folders,
      documents: withBimDerivativeStatuses(directory.documents),
      workPackageLinks: filterLinksForDocuments(
        getWorkPackageLinks(),
        directory.documents
      )
    });
  } catch (error) {
    console.error("[documents.service] Nextcloud explorer failed, using mock:", error);
    const documents = withBimDerivativeStatuses(buildMockDocuments(cleanPath));

    return cacheAndReturn({
      path: cleanPath,
      folders: [],
      documents,
      workPackageLinks: filterLinksForDocuments(getWorkPackageLinks(), documents)
    });
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

export async function getDocumentVersions(
  documentPath: string
): Promise<DocumentVersionsResponse> {
  const cleanDocumentPath = normalizePortalPath(documentPath);
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  const currentVersion = {
    id: "current",
    label: "V1",
    fileId: null,
    isCurrent: true
  };

  if (useMock) {
    return {
      documentPath: cleanDocumentPath,
      fileId: null,
      versions: [currentVersion]
    };
  }

  try {
    const parentPath = path.posix.dirname(cleanDocumentPath);
    const fileName = path.posix.basename(cleanDocumentPath);
    const documents = await nextcloudAdapter.listDocuments(parentPath);
    const document = documents.find((item) => item.name === fileName);

    if (!document?.fileId) {
      return {
        documentPath: cleanDocumentPath,
        fileId: null,
        versions: [currentVersion]
      };
    }

    const historicalVersions = await nextcloudAdapter.listFileVersions(
      document.fileId
    );
    const versionCount = historicalVersions.length + 1;

    return {
      documentPath: cleanDocumentPath,
      fileId: document.fileId,
      versions: [
        ...historicalVersions.map((version, index) => ({
          ...version,
          label: `V${index + 1}`,
          fileId: document.fileId,
          isCurrent: false
        })),
        {
          id: "current",
          label: `V${versionCount}`,
          fileId: document.fileId,
          size: document.size,
          modifiedAt: document.modifiedAt,
          modifiedAtLocal: document.modifiedAtLocal,
          isCurrent: true
        }
      ]
    };
  } catch (error) {
    console.warn("[documents.service] No se pudo obtener versionado:", error);

    return {
      documentPath: cleanDocumentPath,
      fileId: null,
      versions: [currentVersion]
    };
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
    clearDocumentExplorerCache();
    return;
  }

  const cleanTargetPath = assertWritableDocumentPath(targetPath);
  await nextcloudAdapter.uploadFile(cleanTargetPath, fileBuffer, contentType);
  clearDocumentExplorerCache();
}

export async function deleteDocument(documentPath: string): Promise<void> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (useMock) {
    console.log("[documents.service] Mock delete document:", { documentPath });
    clearDocumentExplorerCache();
    return;
  }

  const cleanDocumentPath = assertWritableDocumentPath(documentPath);

  await nextcloudAdapter.deletePath(cleanDocumentPath);

  const registeredDerivatives = deleteBimDerivativesForSource(cleanDocumentPath);
  for (const derivative of registeredDerivatives) {
    try {
      await nextcloudAdapter.deletePath(derivative.fragPath);
    } catch (error) {
      console.warn("[documents.service] No se pudo eliminar derivado registrado:", error);
    }
  }

  const fragPath = getDerivedFragPath(cleanDocumentPath);
  try {
    await nextcloudAdapter.deletePath(fragPath);
  } catch (error) {
    console.warn("[documents.service] No se pudo eliminar derivado FRAG:", error);
  }
  clearDocumentExplorerCache();
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
    clearDocumentExplorerCache();
    return;
  }

  const cleanDocumentPath = assertWritableDocumentPath(documentPath);

  const parts = cleanDocumentPath.split("/");
  parts[parts.length - 1] = newName;
  const newDocumentPath = parts.join("/");
  assertWritableDocumentPath(newDocumentPath);

  await nextcloudAdapter.renamePath(cleanDocumentPath, newName);

  remapBimDerivativeSourcePath(cleanDocumentPath, newDocumentPath);

  const oldFragPath = getDerivedFragPath(cleanDocumentPath);
  const newFragPath = getDerivedFragPath(newDocumentPath);

  try {
    await nextcloudAdapter.movePath(oldFragPath, newFragPath);
  } catch (error) {
    console.warn("[documents.service] No se pudo renombrar derivado FRAG:", error);
  }
  clearDocumentExplorerCache();
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
    clearDocumentExplorerCache();
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

  remapBimDerivativeSourcePath(cleanDocumentPath, destinationPath);

  const oldFragPath = getDerivedFragPath(cleanDocumentPath);
  const newFragPath = getDerivedFragPath(destinationPath);

  try {
    await nextcloudAdapter.movePath(oldFragPath, newFragPath);
  } catch (error) {
    console.warn("[documents.service] No se pudo mover derivado FRAG:", error);
  }
  clearDocumentExplorerCache();
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

export async function getDocumentContent(
  documentPath: string,
  documentVersionId?: string | null
): Promise<{
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

  const cleanVersionId = documentVersionId?.trim();

  if (!cleanVersionId || cleanVersionId === "current") {
    return nextcloudAdapter.downloadFile(documentPath);
  }

  const versions = await getDocumentVersions(documentPath);
  const fileId = versions.fileId?.trim();
  const version = versions.versions.find((item) => item.id === cleanVersionId);

  if (!fileId || !version || version.isCurrent) {
    return nextcloudAdapter.downloadFile(documentPath);
  }

  return nextcloudAdapter.downloadFileVersion({
    fileId,
    versionId: version.id,
    fileName: path.posix.basename(normalizePortalPath(documentPath))
  });
}

export async function getViewerSource(
  documentPath: string,
  documentVersionId?: string | null
): Promise<{
  kind: "ifc" | "frag";
  modelUrl: string;
  fragPath?: string;
  generated?: boolean;
}> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";
  const BFF_BASE_URL =
    process.env.BFF_PUBLIC_URL ||
    process.env.BFF_BASE_URL ||
    "http://localhost:4000";

  if (!documentPath.trim()) {
    throw new Error("documentPath es requerido");
  }

  const cleanVersionId = documentVersionId?.trim();
  const versionQuery =
    cleanVersionId && cleanVersionId !== "current"
      ? `&documentVersionId=${encodeURIComponent(cleanVersionId)}`
      : "";

  if (useMock) {
    return {
      kind: "ifc",
      modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
        documentPath
      )}${versionQuery}`
    };
  }

  if (cleanVersionId && cleanVersionId !== "current") {
    return {
      kind: "ifc",
      modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
        documentPath
      )}${versionQuery}`
    };
  }

  const identity = await buildCurrentDerivativeIdentity(documentPath);
  const registeredDerivative = findBimDerivative({
    sourcePath: identity.sourcePath,
    fileId: identity.fileId,
    versionId: identity.versionId,
    versionKey: identity.versionKey
  });

  if (registeredDerivative) {
    try {
      const exists = await nextcloudAdapter.fileExists(registeredDerivative.fragPath);

      if (exists) {
        void registerBimIndexCandidate(identity, {
          derivativeStatus: "generated",
          phase: "frag-viewer-source"
        });
        return {
          kind: "frag",
          fragPath: registeredDerivative.fragPath,
          modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
            registeredDerivative.fragPath
          )}`
        };
      }
    } catch (error) {
      console.warn(
        "[documents.service] Error verificando FRAG registrado, fallback:",
        error
      );
    }
  }

  const fragPath = getDerivedFragPath(documentPath);

  try {
    const exists = await nextcloudAdapter.fileExists(fragPath);

    if (exists) {
      upsertBimDerivative({
        id: identity.id,
        projectCode: identity.projectCode,
        sourcePath: identity.sourcePath,
        sourceName: identity.sourceName,
        fileId: identity.fileId,
        versionId: identity.versionId,
        versionKey: identity.versionKey,
        fragPath,
        status: "generated",
        generatedAt: new Date().toISOString()
      });

      void registerBimIndexCandidate(identity, {
        derivativeStatus: "generated",
        phase: "frag-detected"
      });

      return {
        kind: "frag",
        fragPath,
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

  const shouldAutoGenerate =
    process.env.BFF_AUTO_GENERATE_FRAG_ON_VIEWER_SOURCE === "true" &&
    documentPath.trim().toLowerCase().endsWith(".ifc");
  const shouldQueueGenerate =
    process.env.BFF_QUEUE_FRAG_ON_VIEWER_SOURCE === "true" &&
    documentPath.trim().toLowerCase().endsWith(".ifc");

  if (shouldAutoGenerate) {
    try {
      const result = await generateAndStoreFrag(documentPath);

      return {
        kind: "frag",
        fragPath: result.fragPath,
        generated: true,
        modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
          result.fragPath
        )}`
      };
    } catch (error) {
      console.warn(
        "[documents.service] No se pudo regenerar FRAG, fallback a IFC:",
        error
      );
    }
  }

  if (shouldQueueGenerate) {
    enqueueFragGeneration(documentPath);
  }

  return {
    kind: "ifc",
    modelUrl: `${BFF_BASE_URL}/api/documents/content?path=${encodeURIComponent(
      documentPath
    )}${versionQuery}`
  };
}

export async function generateAndStoreFrag(documentPath: string): Promise<{
  fragPath: string;
}> {
  const cleanDocumentPath = normalizePortalPath(documentPath);
  const activeGeneration = activeFragGenerationPromises.get(cleanDocumentPath);

  if (activeGeneration) {
    return activeGeneration;
  }

  const generationPromise = generateAndStoreFragInternal(cleanDocumentPath).finally(() => {
    activeFragGenerationPromises.delete(cleanDocumentPath);
  });

  activeFragGenerationPromises.set(cleanDocumentPath, generationPromise);
  return generationPromise;
}

async function generateAndStoreFragInternal(documentPath: string): Promise<{
  fragPath: string;
}> {
  const useMock = process.env.USE_NEXTCLOUD_MOCK !== "false";

  if (!documentPath.trim()) {
    throw new Error("documentPath es requerido");
  }

  if (useMock) {
    throw new Error("La generación de FRAG no está disponible en modo mock");
  }

  const identity = await buildCurrentDerivativeIdentity(documentPath);
  const existingDerivative = findBimDerivative({
    sourcePath: identity.sourcePath,
    fileId: identity.fileId,
    versionId: identity.versionId,
    versionKey: identity.versionKey
  });

  if (existingDerivative) {
    try {
      const exists = await nextcloudAdapter.fileExists(existingDerivative.fragPath);
      if (exists) {
        void registerBimIndexCandidate(identity, {
          derivativeStatus: "generated",
          phase: "frag-existing"
        });
        return { fragPath: existingDerivative.fragPath };
      }
    } catch {
      // Si no se puede comprobar, regeneramos para dejar el derivado consistente.
    }
  }

  upsertBimDerivative({
    id: identity.id,
    projectCode: identity.projectCode,
    sourcePath: identity.sourcePath,
    sourceName: identity.sourceName,
    fileId: identity.fileId,
    versionId: identity.versionId,
    versionKey: identity.versionKey,
    fragPath: identity.fragPath,
    status: "pending",
    generatedAt: null
  });

  void registerBimIndexCandidate(identity, {
    derivativeStatus: "pending",
    phase: "frag-generating"
  });

  const fragPath = identity.fragPath;
  try {
        const ifcFile = await getDocumentContent(documentPath);
    const fragBytes = await generateFragFromBuffer(ifcFile.buffer);

    await ensureDerivedFolderExists(fragPath);

    await nextcloudAdapter.uploadFile(
      fragPath,
      Buffer.from(fragBytes),
      "application/octet-stream"
    );

    await nextcloudAdapter.uploadTextFile(
      `${fragPath}.meta.json`,
      JSON.stringify(
        {
          derivativeId: identity.id,
          sourcePath: identity.sourcePath,
          sourceName: identity.sourceName,
          fileId: identity.fileId,
          versionId: identity.versionId,
          versionKey: identity.versionKey,
          fragPath,
          generatedAt: new Date().toISOString(),
          derivativeVersion: 1
        },
        null,
        2
      )
    );

    upsertBimDerivative({
      id: identity.id,
      projectCode: identity.projectCode,
      sourcePath: identity.sourcePath,
      sourceName: identity.sourceName,
      fileId: identity.fileId,
      versionId: identity.versionId,
      versionKey: identity.versionKey,
      fragPath,
      status: "generated",
      generatedAt: new Date().toISOString()
    });

    await registerBimIndexCandidate(identity, {
      derivativeStatus: "generated",
      phase: "frag-generated"
    });

    void indexDocumentBimProperties(documentPath).catch((error) => {
      console.warn("[documents.service] No se pudo indexar propiedades BIM en servidor:", error);
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    upsertBimDerivative({
      id: identity.id,
      projectCode: identity.projectCode,
      sourcePath: identity.sourcePath,
      sourceName: identity.sourceName,
      fileId: identity.fileId,
      versionId: identity.versionId,
      versionKey: identity.versionKey,
      fragPath,
      status: "failed",
      error: errorMessage,
      generatedAt: null
    });

    void registerBimIndexCandidate(identity, {
      derivativeStatus: "failed",
      phase: "frag-failed",
      errorMessage
    });

    throw error;
  }

  return { fragPath };
}

export async function moveDerivedFolderForFolderMove(
  sourceFolderPath: string,
  destinationFolderPath: string
): Promise<void> {
  const sourceDerivedFolderPath = getDerivedFolderPathForSourceFolder(sourceFolderPath);
  const sourceFolderName = normalizePortalPath(sourceFolderPath).split("/").pop();

  if (!sourceFolderName) return;

  const destinationSourceFolderPath = path.posix.join(
    normalizePortalPath(destinationFolderPath),
    sourceFolderName
  );
  const destinationDerivedFolderPath =
    getDerivedFolderPathForSourceFolder(destinationSourceFolderPath);

  remapBimDerivativeSourceFolder(sourceFolderPath, destinationSourceFolderPath);

  await moveDerivedFolder(sourceDerivedFolderPath, destinationDerivedFolderPath);
}

export async function renameDerivedFolderForFolderRename(
  folderPath: string,
  newName: string
): Promise<void> {
  const sourceDerivedFolderPath = getDerivedFolderPathForSourceFolder(folderPath);
  const cleanFolderPath = normalizePortalPath(folderPath);
  const parentFolderPath = path.posix.dirname(cleanFolderPath);
  const destinationSourceFolderPath = path.posix.join(parentFolderPath, newName);
  const destinationDerivedFolderPath =
    getDerivedFolderPathForSourceFolder(destinationSourceFolderPath);

  remapBimDerivativeSourceFolder(cleanFolderPath, destinationSourceFolderPath);

  await moveDerivedFolder(sourceDerivedFolderPath, destinationDerivedFolderPath);
}

export async function deleteDerivedFolderForSourceFolder(
  folderPath: string
): Promise<void> {
  const derivedFolderPath = getDerivedFolderPathForSourceFolder(folderPath);

  try {
    await nextcloudAdapter.deletePath(derivedFolderPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("404") || message.includes("Not Found")) {
      return;
    }

    console.warn("[documents.service] No se pudo eliminar carpeta derivada:", error);
  }
}

async function moveDerivedFolder(
  sourceDerivedFolderPath: string,
  destinationDerivedFolderPath: string
): Promise<void> {
  try {
    await ensureDerivedFolderExists(
      path.posix.join(path.posix.dirname(destinationDerivedFolderPath), "__parent__.frag")
    );
    await nextcloudAdapter.movePath(sourceDerivedFolderPath, destinationDerivedFolderPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("404") || message.includes("Not Found")) {
      return;
    }

    console.warn("[documents.service] No se pudo mover carpeta derivada:", {
      sourceDerivedFolderPath,
      destinationDerivedFolderPath,
      error
    });
  }
}

function getDerivedFolderPathForSourceFolder(sourceFolderPath: string): string {
  const cleanPath = normalizePortalPath(sourceFolderPath);
  const parts = cleanPath.split("/").filter(Boolean);

  if (parts.length < 2) {
    throw new Error("No se pudo determinar la carpeta derivada");
  }

  const projectCode = parts[0];
  const relativeFolder = parts.slice(1).join("/");

  return path.posix.join("/", projectCode, "_derived", relativeFolder);
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
