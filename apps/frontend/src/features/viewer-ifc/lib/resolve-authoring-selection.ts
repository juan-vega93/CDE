import { bffFetch } from "@/services/bff-client";
import type { ViewerBimContext } from "./viewer-bim-context";

export type AuthoringSelection = {
  context: ViewerBimContext;
  authoringElement: {
    identityKey: string;
    rootLocalId?: number;
    authoringElementId?: string;
    resolutionMethod: "corroborated_aggregate" | "standalone" | "singleton_fallback";
    identityConfidence: "high" | "unknown";
    resolutionStatus: "resolved" | "fallback";
    sourceContainer?: string;
  };
  members: { localId: number; geometryStatus: "present" | "absent" | "unknown" }[];
};

export async function resolveAuthoringSelection(
  context: ViewerBimContext,
  localId: number,
  signal: AbortSignal
): Promise<AuthoringSelection | null> {
  const query = new URLSearchParams({
    projectCode: context.projectCode,
    modelKey: context.modelKey,
    revisionId: context.revisionId,
    localId: String(localId)
  });
  const response = await bffFetch(`/api/bim-index/authoring/resolve?${query}`, {
    signal,
    retryUnauthorized: false
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Authoring resolve HTTP ${response.status}`);
  const payload = await response.json() as { success?: boolean; data?: AuthoringSelection };
  const data = payload.data;
  // Fail closed on an inconsistent response; never expand into another revision.
  if (!payload.success || !data ||
      data.context?.projectCode !== context.projectCode ||
      data.context?.modelKey !== context.modelKey ||
      data.context?.revisionId !== context.revisionId ||
      typeof data.authoringElement?.identityKey !== "string" ||
      !Array.isArray(data.members) ||
      !data.members.some((member) => member.localId === localId) ||
      !data.members.every((member) => Number.isSafeInteger(member.localId) && member.localId > 0 &&
        ["present", "absent", "unknown"].includes(member.geometryStatus))) {
    throw new Error("Invalid authoring selection response");
  }
  return data;
}
