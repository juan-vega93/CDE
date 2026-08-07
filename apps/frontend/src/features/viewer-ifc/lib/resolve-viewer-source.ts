import { bffFetch, getBffUrl } from "@/services/bff-client";

type ResolveViewerSourceParams = {
  documentId?: string;
  ifcUrl?: string;
  documentPath?: string;
  documentName?: string;
  documentVersionId?: string;
  requireFrag?: boolean;
};

type ViewerSourceApiResponse = {
  success: boolean;
  data?: ViewerSource;
  message?: string;
};

type ViewerSourceCacheEntry = {
  source: ViewerSource;
  timestamp: number;
};

const VIEWER_SOURCE_CACHE_TTL_MS = 5 * 60 * 1000;
const viewerSourceCache = new Map<string, ViewerSourceCacheEntry>();

function describeFetchError(error: unknown) {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "La generacion FRAG excedio el tiempo limite.";
  }

  if (error instanceof TypeError && error.message.toLowerCase().includes("fetch")) {
    return "No se pudo contactar al BFF durante la generacion FRAG. Verifica que el BFF siga ejecutandose y revisa su consola.";
  }

  return error instanceof Error ? error.message : String(error);
}

export type ViewerSource =
  | {
      kind: "ifc";
      modelUrl: string;
      documentPath?: string;
      documentName?: string;
    }
  | {
      kind: "frag";
      modelUrl: string;
      metadataUrl?: string;
      documentPath?: string;
      documentName?: string;
    };

export async function resolveViewerSource({
  documentId,
  ifcUrl,
  documentPath,
  documentName,
  documentVersionId,
  requireFrag = false
}: ResolveViewerSourceParams): Promise<ViewerSource> {
  const cacheKey = [
    documentId ?? "",
    ifcUrl ?? "",
    documentPath ?? "",
    documentVersionId ?? "current",
    requireFrag ? "require-frag" : "fallback-ok"
  ].join("|");

  const cached = viewerSourceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < VIEWER_SOURCE_CACHE_TTL_MS) {
    return {
      ...cached.source,
      documentPath: cached.source.documentPath ?? documentPath,
      documentName: cached.source.documentName ?? documentName
    };
  }

  const cacheAndReturn = (source: ViewerSource) => {
    viewerSourceCache.set(cacheKey, {
      source,
      timestamp: Date.now()
    });

    return source;
  };

  async function queueMissingRequiredFrag(path: string): Promise<never> {
    if (documentVersionId && documentVersionId !== "current") {
      throw new Error(
        "No se puede federar una version historica sin FRAG generado para esa version."
      );
    }

    try {
      const response = await bffFetch("/api/documents/queue-frag", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ documentPath: path })
      });

      if (!response.ok) {
        const json = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;

        throw new Error(json?.message || "No se pudo encolar el FRAG");
      }
    } catch (error) {
      throw new Error(
        `${describeFetchError(error)} Archivo: ${documentName || path}`
      );
    }

    throw new Error(
      `El modelo aun no tiene FRAG listo. Se encolo la preparacion BIM para ${documentName || path}. Vuelve a documentos y abre el visor cuando figure como "FRAG listo".`
    );
  }

  if (ifcUrl) {
    return cacheAndReturn({
      kind: "ifc",
      modelUrl: ifcUrl,
      documentPath,
      documentName
    });
  }

  if (documentPath) {
    try {
      const params = new URLSearchParams({ documentPath });

      if (documentVersionId && documentVersionId !== "current") {
        params.set("documentVersionId", documentVersionId);
      }

      const response = await bffFetch(
        `/api/documents/viewer-source?${params.toString()}`
      );

      if (response.ok) {
        const json = (await response.json()) as ViewerSourceApiResponse;

        if (json.success && json.data) {
          if (requireFrag && json.data.kind !== "frag") {
            return cacheAndReturn(await queueMissingRequiredFrag(documentPath));
          }

          return cacheAndReturn({
            ...json.data,
            documentPath,
            documentName
          });
        }
      }
    } catch (error) {
      if (requireFrag) {
        throw new Error(
          `${describeFetchError(error)} Archivo: ${documentName || documentPath}`
        );
      }

      console.warn(
        "[resolveViewerSource] Error resolviendo viewer-source, fallback a IFC:",
        error
      );
    }

    if (requireFrag) {
      return cacheAndReturn(await queueMissingRequiredFrag(documentPath));
    }

    return cacheAndReturn({
      kind: "ifc",
      modelUrl: getBffUrl(
        `/api/documents/content?${new URLSearchParams({
          path: documentPath,
          ...(documentVersionId && documentVersionId !== "current"
            ? { documentVersionId }
            : {})
        }).toString()}`
      ),
      documentPath,
      documentName
    });
  }

  if (documentId) {
    throw new Error(
      `No se pudo resolver la fuente del visor para documentId='${documentId}'.`
    );
  }

  throw new Error(
    "No se pudo resolver la fuente del visor: falta documentPath, ifcUrl o documentId valido."
  );
}
