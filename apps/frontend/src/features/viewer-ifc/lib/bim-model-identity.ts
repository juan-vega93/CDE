import type { ViewerSource } from "@/features/viewer-ifc/lib/resolve-viewer-source";

/**
 * Transitional compatibility for the current PostgreSQL key (frag:/path) and
 * IFC fallback sources (ifc:/path). Persistent identity never uses runtimeModelId.
 */
export function getCompatibleBimModelKeys(value: string | undefined): string[] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return [];

  const path = normalized.replace(/^(?:ifc|frag):/, "");
  if (!path.startsWith("/")) return [normalized];

  return Array.from(new Set([normalized, path, `ifc:${path}`, `frag:${path}`]));
}

export type LiveViewerBimModel = {
  key: string;
  modelId?: string;
  source: ViewerSource;
};

export type ResolvedLiveBimModel = {
  projectCode: string;
  runtimeModelId: string;
  modelKey: string;
  documentPath?: string;
  modelKeyAliases: string[];
};

export function createLiveBimModelResolver(input: {
  projectCode?: string;
  models: LiveViewerBimModel[];
}) {
  const projectCode = input.projectCode?.trim().toUpperCase() ?? "";
  const entries = input.models
    .filter((model): model is LiveViewerBimModel & { modelId: string } => Boolean(model.modelId))
    .map((model) => {
      const documentPath = model.source.documentPath?.trim();
      const aliases = new Set([
        ...getCompatibleBimModelKeys(model.key),
        ...getCompatibleBimModelKeys(documentPath)
      ]);

      return {
        projectCode,
        runtimeModelId: model.modelId,
        modelKey: model.key,
        documentPath,
        modelKeyAliases: [...aliases]
      } satisfies ResolvedLiveBimModel;
    });

  function fromRuntimeModelId(runtimeModelId: string): ResolvedLiveBimModel | null {
    return entries.find((entry) => entry.runtimeModelId === runtimeModelId) ?? null;
  }

  function toRuntimeModelId(modelKeyOrDocumentPath: string): string | null {
    const aliases = new Set(getCompatibleBimModelKeys(modelKeyOrDocumentPath));
    const entry = entries.find((candidate) =>
      candidate.modelKeyAliases.some((alias) => aliases.has(alias))
    );
    return entry?.runtimeModelId ?? null;
  }

  return { fromRuntimeModelId, toRuntimeModelId };
}
