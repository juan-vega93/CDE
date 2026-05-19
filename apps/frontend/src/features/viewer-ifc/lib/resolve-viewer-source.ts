const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

type ResolveViewerSourceParams = {
  documentId?: string;
  ifcUrl?: string;
  documentPath?: string;
  documentName?: string;
};

type ViewerSourceApiResponse = {
  success: boolean;
  data?: ViewerSource;
  message?: string;
};

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
  documentName
}: ResolveViewerSourceParams): Promise<ViewerSource> {
  if (ifcUrl) {
    return {
      kind: "ifc",
      modelUrl: ifcUrl,
      documentPath,
      documentName
    };
  }

  if (documentPath) {
    try {
      const response = await fetch(
        `${BFF_URL}/api/documents/viewer-source?documentPath=${encodeURIComponent(
          documentPath
        )}`,
        {
          cache: "no-store"
        }
      );

      if (response.ok) {
        const json = (await response.json()) as ViewerSourceApiResponse;

        if (json.success && json.data) {
          return {
            ...json.data,
            documentPath,
            documentName
          };
        }
      }
    } catch (error) {
      console.warn(
        "[resolveViewerSource] Error resolviendo viewer-source, fallback a IFC:",
        error
      );
    }

    return {
      kind: "ifc",
      modelUrl: `${BFF_URL}/api/documents/content?path=${encodeURIComponent(
        documentPath
      )}`,
      documentPath,
      documentName
    };
  }

  if (documentId) {
  throw new Error(
    `No se pudo resolver la fuente del visor para documentId='${documentId}'.`
  );
}

throw new Error(
  "No se pudo resolver la fuente del visor: falta documentPath, ifcUrl o documentId válido."
);
}