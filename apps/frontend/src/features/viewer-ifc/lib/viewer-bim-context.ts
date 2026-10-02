/** Transported by the BFF. No frontend canonicalization, hashing or legacy alias conversion. */
export type ViewerBimContext = Readonly<{
  projectCode: string;
  modelKey: string;
  revisionId: string;
}>;

/** Read only from the authenticated content response handed to IfcLoader. */
export function getIfcResponseContext(response: Response, documentPath?: string): ViewerBimContext | undefined {
  const header = response.headers.get("x-bim-context");
  if (!header) return undefined;
  const context = JSON.parse(decodeURIComponent(header)) as ViewerBimContext;
  if (!context || typeof context.projectCode !== "string" || !context.projectCode ||
      typeof context.modelKey !== "string" || !context.modelKey.startsWith("/") ||
      typeof context.revisionId !== "string" || context.revisionId.length !== 71 || !/^sha256:[0-9a-f]{64}$/.test(context.revisionId) ||
      (documentPath !== undefined && context.modelKey !== documentPath)) {
    throw new Error("Invalid exact-content BIM context");
  }
  return Object.freeze({ projectCode: context.projectCode, modelKey: context.modelKey, revisionId: context.revisionId });
}

/** Only call after the guarded FRAG download and runtime load have succeeded. */
export function getLoadedBimContext(source: {
  kind: "ifc" | "frag";
  bimContext?: ViewerBimContext;
}): ViewerBimContext | undefined {
  return source.kind === "frag" && source.bimContext
    ? Object.freeze({ ...source.bimContext }) : undefined;
}
