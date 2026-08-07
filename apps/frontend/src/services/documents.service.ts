"use client";

import { bffAssetFetch, bffFetch, getBffUrl } from "./bff-client";
import type {
  DocumentsApiResponse,
  CreateDocumentAnnotationInput,
  DocumentAnnotationApiResponse,
  DocumentAnnotationsApiResponse,
  UpdateDocumentAnnotationInput,
  DocumentItem,
  DocumentVersionsApiResponse,
  FoldersApiResponse,
  FolderTreeApiResponse,
  DocumentExplorerApiResponse,
  SendToReviewInput,
  SendToReviewResponse,
  WorkPackage,
  WorkPackageLinkApiResponse,
  WorkPackageLinksApiResponse
} from "@/types/documents";

const EXPLORER_CACHE_TTL_MS = 5 * 60_000;
const SESSION_EXPLORER_CACHE_PREFIX = "cde:document-explorer:";

type CacheEntry<T> = {
  createdAt: number;
  data: T;
};

export type FragGenerationQueueStatus = {
  activeJobs: number;
  concurrency: number;
  queuedJobs: number;
  queuedPaths: string[];
  activePaths: string[];
};

const documentExplorerCache = new Map<
  string,
  CacheEntry<DocumentExplorerApiResponse["data"]>
>();
const foldersCache = new Map<string, CacheEntry<FoldersApiResponse>>();

function buildCacheKey(path: string, projectCode: string, extra = "") {
  return `${projectCode || "global"}:${path}:${extra}`;
}

function getCached<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.createdAt > EXPLORER_CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return cached.data;
}

function readSessionCachedExplorer(
  key: string
): DocumentExplorerApiResponse["data"] | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(
      `${SESSION_EXPLORER_CACHE_PREFIX}${key}`
    );

    if (!raw) return null;

    const parsed = JSON.parse(raw) as CacheEntry<DocumentExplorerApiResponse["data"]>;

    if (Date.now() - parsed.createdAt > EXPLORER_CACHE_TTL_MS) {
      window.sessionStorage.removeItem(`${SESSION_EXPLORER_CACHE_PREFIX}${key}`);
      return null;
    }

    return parsed.data;
  } catch {
    return null;
  }
}

function writeSessionCachedExplorer(
  key: string,
  data: DocumentExplorerApiResponse["data"]
) {
  if (typeof window === "undefined") return;

  try {
    window.sessionStorage.setItem(
      `${SESSION_EXPLORER_CACHE_PREFIX}${key}`,
      JSON.stringify({
        createdAt: Date.now(),
        data
      })
    );
  } catch {
    // sessionStorage puede estar lleno o bloqueado; el cache en memoria sigue activo.
  }
}

export function clearDocumentExplorerCache() {
  documentExplorerCache.clear();
  foldersCache.clear();

  if (typeof window === "undefined") return;

  try {
    for (let index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
      const key = window.sessionStorage.key(index);

      if (key?.startsWith(SESSION_EXPLORER_CACHE_PREFIX)) {
        window.sessionStorage.removeItem(key);
      }
    }
  } catch {
    // Si sessionStorage no esta disponible, basta con limpiar memoria.
  }
}

export async function getDocuments(
  path = "/SHARED/ARQ",
  projectCode = ""
): Promise<DocumentsApiResponse> {
  const params = new URLSearchParams({ path });

  if (projectCode) {
    params.set("projectCode", projectCode);
  }

  const res = await bffFetch(`/api/documents?${params.toString()}`);

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de documentos");
  }

  return res.json();
}

export async function getFolders(
  path = "/",
  projectCode = ""
): Promise<FoldersApiResponse> {
  const cacheKey = buildCacheKey(path, projectCode);
  const cached = getCached(foldersCache, cacheKey);
  if (cached) return cached;

  const params = new URLSearchParams({ path });

  if (projectCode) {
    params.set("projectCode", projectCode);
  }

  const res = await bffFetch(`/api/folders?${params.toString()}`);

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de carpetas");
  }

  const payload = (await res.json()) as FoldersApiResponse;
  foldersCache.set(cacheKey, {
    createdAt: Date.now(),
    data: payload
  });
  return payload;
}

export async function getFolderTree(
  rootPath = "/",
  projectCode = "",
  depth = 5,
  focusPath = ""
): Promise<FolderTreeApiResponse["data"]> {
  const params = new URLSearchParams({
    rootPath,
    depth: String(depth)
  });

  if (focusPath) {
    params.set("focusPath", focusPath);
  }

  if (projectCode) {
    params.set("projectCode", projectCode);
  }

  const res = await bffFetch(`/api/folders/tree?${params.toString()}`);

  if (!res.ok) {
    throw new Error("No se pudo obtener el arbol de carpetas");
  }

  const json = (await res.json()) as FolderTreeApiResponse;

  if (!json.success) {
    throw new Error(json.message || "No se pudo obtener el arbol de carpetas");
  }

  return json.data;
}

export async function getDocumentExplorer(
  path = "/",
  projectCode = "",
  options: {
    includeTree?: boolean;
    treeRootPath?: string;
    treeFocusPath?: string;
    treeDepth?: number;
  } = {}
): Promise<DocumentExplorerApiResponse["data"]> {
  const params = buildDocumentExplorerParams(path, projectCode, options);

  const cacheKey = buildCacheKey(path, projectCode, params.toString());
  const cached = getCached(documentExplorerCache, cacheKey);
  if (cached) return cached;

  const sessionCached = readSessionCachedExplorer(cacheKey);
  if (sessionCached) {
    documentExplorerCache.set(cacheKey, {
      createdAt: Date.now(),
      data: sessionCached
    });
    return sessionCached;
  }

  const res = await bffFetch(`/api/documents/explorer?${params.toString()}`);

  if (!res.ok) {
    throw new Error("No se pudo obtener el explorador documental");
  }

  const json = (await res.json()) as DocumentExplorerApiResponse;

  if (!json.success) {
    throw new Error(json.message || "No se pudo obtener el explorador documental");
  }

  documentExplorerCache.set(cacheKey, {
    createdAt: Date.now(),
    data: json.data
  });
  writeSessionCachedExplorer(cacheKey, json.data);
  return json.data;
}

function buildDocumentExplorerParams(
  path: string,
  projectCode: string,
  options: {
    includeTree?: boolean;
    treeRootPath?: string;
    treeFocusPath?: string;
    treeDepth?: number;
  } = {}
) {
  const params = new URLSearchParams({ path });

  if (projectCode) {
    params.set("projectCode", projectCode);
  }

  if (options.includeTree) {
    params.set("includeTree", "true");
  }

  if (options.treeRootPath) {
    params.set("treeRootPath", options.treeRootPath);
  }

  if (options.treeFocusPath) {
    params.set("treeFocusPath", options.treeFocusPath);
  }

  if (typeof options.treeDepth === "number") {
    params.set("treeDepth", String(options.treeDepth));
  }

  return params;
}

export function getCachedDocumentExplorerSnapshot(
  path = "/",
  projectCode = "",
  options: {
    includeTree?: boolean;
    treeRootPath?: string;
    treeFocusPath?: string;
    treeDepth?: number;
  } = {}
): DocumentExplorerApiResponse["data"] | null {
  const params = buildDocumentExplorerParams(path, projectCode, options);
  const cacheKey = buildCacheKey(path, projectCode, params.toString());
  const cached = getCached(documentExplorerCache, cacheKey);
  if (cached) return cached;

  const sessionCached = readSessionCachedExplorer(cacheKey);
  if (sessionCached) {
    documentExplorerCache.set(cacheKey, {
      createdAt: Date.now(),
      data: sessionCached
    });
    return sessionCached;
  }

  return null;
}

export async function getDocumentById(
  id: string,
  path = "/SHARED/ARQ",
  projectCode = ""
): Promise<DocumentItem> {
  const params = new URLSearchParams({ path });

  if (projectCode) {
    params.set("projectCode", projectCode);
  }

  const res = await bffFetch(
    `/api/documents/${encodeURIComponent(id)}?${params.toString()}`
  );

  if (!res.ok) {
    throw new Error("No se pudo obtener el documento");
  }

  const json = await res.json();
  return json.data;
}

export async function getDocumentVersions(
  documentPath: string,
  projectCode = ""
): Promise<DocumentVersionsApiResponse["data"]> {
  const params = new URLSearchParams({ path: documentPath });

  if (projectCode) {
    params.set("projectCode", projectCode);
  }

  const res = await bffFetch(`/api/documents/versions?${params.toString()}`);

  if (!res.ok) {
    throw new Error("No se pudo obtener el historial de versiones");
  }

  const json = (await res.json()) as DocumentVersionsApiResponse;

  if (!json.success) {
    throw new Error(json.message || "No se pudo obtener el historial de versiones");
  }

  return json.data;
}

export async function getDocumentAnnotations(input: {
  projectCode: string;
  documentPath: string;
  documentVersionId?: string | null;
}) {
  const params = new URLSearchParams({
    projectCode: input.projectCode,
    documentPath: input.documentPath
  });

  if (input.documentVersionId) {
    params.set("documentVersionId", input.documentVersionId);
  }

  const res = await bffFetch(`/api/documents/annotations?${params.toString()}`);

  if (!res.ok) {
    throw new Error("No se pudieron obtener las anotaciones");
  }

  const json = (await res.json()) as DocumentAnnotationsApiResponse;

  if (!json.success) {
    throw new Error(json.message || "No se pudieron obtener las anotaciones");
  }

  return json.data;
}

export async function getProjectDocumentAnnotations(projectCode: string) {
  const params = new URLSearchParams({ projectCode });
  const res = await bffFetch(
    `/api/documents/annotations/project?${params.toString()}`
  );

  if (!res.ok) {
    throw new Error("No se pudieron obtener las incidencias documentales");
  }

  const json = (await res.json()) as DocumentAnnotationsApiResponse;

  if (!json.success) {
    throw new Error(
      json.message || "No se pudieron obtener las incidencias documentales"
    );
  }

  return json.data;
}

export async function createDocumentAnnotation(
  input: CreateDocumentAnnotationInput
) {
  const res = await bffFetch("/api/documents/annotations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const json = (await res.json()) as DocumentAnnotationApiResponse;

  if (!res.ok || !json.success) {
    throw new Error(json.message || "No se pudo crear la anotacion");
  }

  return json.data;
}

export async function deleteDocumentAnnotation(
  annotationId: string,
  projectCode: string
) {
  const params = new URLSearchParams({ projectCode });
  const res = await bffFetch(
    `/api/documents/annotations/${encodeURIComponent(
      annotationId
    )}?${params.toString()}`,
    { method: "DELETE" }
  );

  const json = await res.json();

  if (!res.ok || !json.success) {
    throw new Error(json.message || "No se pudo eliminar la anotacion");
  }

  return json.data;
}

export async function updateDocumentAnnotation(
  annotationId: string,
  input: UpdateDocumentAnnotationInput
) {
  const res = await bffFetch(
    `/api/documents/annotations/${encodeURIComponent(annotationId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(input)
    }
  );

  const json = (await res.json()) as DocumentAnnotationApiResponse;

  if (!res.ok || !json.success) {
    throw new Error(json.message || "No se pudo actualizar la incidencia");
  }

  return json.data;
}

export function getDocumentContentUrl(
  documentPath: string,
  documentVersionId?: string | null
) {
  const params = new URLSearchParams({ path: documentPath });

  if (documentVersionId && documentVersionId !== "current") {
    params.set("documentVersionId", documentVersionId);
  }

  return getBffUrl(`/api/documents/content?${params.toString()}`);
}

export async function getDocumentContentBlobUrl(
  documentPath: string,
  documentVersionId?: string | null
): Promise<string> {
  const response = await bffAssetFetch(
    getDocumentContentUrl(documentPath, documentVersionId)
  );

  if (!response.ok) {
    throw new Error("No se pudo descargar el contenido del documento");
  }

  return URL.createObjectURL(await response.blob());
}

export async function sendToReview(
  input: SendToReviewInput
): Promise<SendToReviewResponse> {
  const res = await bffFetch("/api/reviews/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });

  const payload = await res.json();

  if (!res.ok || !payload.success) {
    throw new Error(
      payload.message || payload.error || "No se pudo enviar el documento a revisión"
    );
  }

  return payload;
}
export async function updateWorkPackageStatus(
  id: number,
  status: string
): Promise<WorkPackage> {
  const res = await bffFetch(`/api/work-packages/${id}/status`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ status })
  });

  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(
      payload.message || payload.error || "No se pudo actualizar el estado"
    );
  }

  const json = await res.json();
  return json.data;
}

export async function getWorkPackageLinkByDocumentId(
  documentId: string
) {
  const res = await bffFetch(
    `/api/work-package-links/document/${encodeURIComponent(documentId)}`
  );

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    throw new Error("No se pudo obtener el vínculo del documento");
  }

  const json: WorkPackageLinkApiResponse = await res.json();
  return json.data;
}
export async function getWorkPackageById(
  id: number
): Promise<WorkPackage> {
  const res = await bffFetch(`/api/work-packages/${id}`);

  if (!res.ok) {
    throw new Error("No se pudo obtener el workflow");
  }

  const json = await res.json();
  return json.data;
}

export async function getWorkPackageLinks() {
  const res = await bffFetch("/api/work-package-links");

  if (!res.ok) {
    throw new Error("No se pudo obtener la lista de vínculos");
  }

  const json: WorkPackageLinksApiResponse = await res.json();
  return json.data;
}
export async function uploadDocument(
  file: File,
  targetFolderPath: string,
  projectCode = ""
) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("targetFolderPath", targetFolderPath);
  if (projectCode) {
    formData.append("projectCode", projectCode);
  }

  const res = await bffFetch("/api/documents/upload", {
    method: "POST",
    body: formData
  });

  if (!res.ok) {
    let errorMessage = "No se pudo subir el archivo";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  clearDocumentExplorerCache();
  return res.json();
}

export async function uploadDocuments(
  files: File[],
  targetFolderPath: string,
  projectCode = ""
) {
  const concurrency = 3;
  const results: unknown[] = new Array(files.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await uploadDocument(files[index], targetFolderPath, projectCode);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, files.length) }, () => worker())
  );

  clearDocumentExplorerCache();
  return results;
}

export async function generateDocumentFrag(documentPath: string) {
  const res = await bffFetch("/api/documents/generate-frag", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ documentPath })
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "No se pudo preparar el derivado BIM");
  }

  clearDocumentExplorerCache();
  return json.data as { fragPath: string };
}

export async function queueDocumentFrag(documentPath: string) {
  const res = await bffFetch("/api/documents/queue-frag", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ documentPath })
  });

  const json = await res.json().catch(() => null);

  if (!res.ok || !json?.success) {
    throw new Error(json?.message || "No se pudo encolar el derivado BIM");
  }

  clearDocumentExplorerCache();
  return json.data as {
    documentPath: string;
    status: "queued" | "generated" | "active";
    fragPath?: string;
  };
}

export async function getFragGenerationQueueStatus(projectCode: string) {
  const params = new URLSearchParams({ projectCode });
  const res = await bffFetch(`/api/documents/frag-queue?${params.toString()}`);
  const json = (await res.json().catch(() => null)) as {
    success?: boolean;
    data?: FragGenerationQueueStatus;
    message?: string;
  } | null;

  if (!res.ok || !json?.success || !json.data) {
    throw new Error(json?.message || "No se pudo consultar la cola BIM");
  }

  return json.data;
}

export async function createFolder(
  parentPath: string,
  folderName: string,
  projectCode = ""
) {
  const res = await bffFetch("/api/folders", {
  method: "POST",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    parentPath,
    folderName,
    projectCode
  })
});

  if (!res.ok) {
    let errorMessage = "No se pudo crear la carpeta";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  clearDocumentExplorerCache();
  return res.json();
}
export async function deleteDocument(documentPath: string) {
  const res = await bffFetch("/api/documents", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      documentPath
    })
  });

  const payload = await res.json();

  if (!res.ok || !payload.success) {
    throw new Error(
      payload.message || payload.error || "No se pudo eliminar el archivo"
    );
  }

  clearDocumentExplorerCache();
  return payload.data;
}
export async function deleteFolder(folderPath: string) {
  const res = await bffFetch("/api/folders", {
  method: "DELETE",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    folderPath
  })
});

  if (!res.ok) {
    let errorMessage = "No se pudo eliminar la carpeta";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  clearDocumentExplorerCache();
  return res.json();
}
export async function renameDocument(
  documentPath: string,
  newName: string
) {
  const res = await bffFetch("/api/documents/rename", {
  method: "PUT",
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify({
    documentPath,
    newName
  })
});

  if (!res.ok) {
    let errorMessage = "No se pudo renombrar el documento";

    try {
      const errorJson = await res.json();
      if (errorJson?.message) {
        errorMessage = errorJson.message;
      }
    } catch {
      // mantener mensaje genérico
    }

    throw new Error(errorMessage);
  }

  clearDocumentExplorerCache();
  return res.json();
}

export async function moveDocument(
  documentPath: string,
  destinationFolderPath: string
): Promise<void> {
  const response = await bffFetch(
  "/api/documents/move",
  {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      documentPath,
      destinationFolderPath
    })
  }
);

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "No se pudo mover el documento");
  }

  clearDocumentExplorerCache();
}
export async function moveFolder(
  folderPath: string,
  destinationFolderPath: string
): Promise<void> {
  const response = await bffFetch(
  "/api/folders/move",
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

  clearDocumentExplorerCache();
}
export async function renameFolder(folderPath: string, newName: string) {
  const response = await bffFetch(
  "/api/folders/rename",
  {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      folderPath,
      newName
    })
  }
);

  const payload = await response.json();

  if (!response.ok || !payload.success) {
    throw new Error(
      payload.message || payload.error || "No se pudo renombrar la carpeta"
    );
  }

  clearDocumentExplorerCache();
  return payload.data;
}
