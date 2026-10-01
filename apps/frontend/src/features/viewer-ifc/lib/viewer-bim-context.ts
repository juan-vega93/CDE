/** Transported by the BFF. No frontend canonicalization, hashing or legacy alias conversion. */
export type ViewerBimContext = Readonly<{
  projectCode: string;
  modelKey: string;
  revisionId: string;
}>;

/** Only call after the guarded FRAG download and runtime load have succeeded. */
export function getLoadedBimContext(source: {
  kind: "ifc" | "frag";
  bimContext?: ViewerBimContext;
}): ViewerBimContext | undefined {
  return source.kind === "frag" && source.bimContext
    ? Object.freeze({ ...source.bimContext }) : undefined;
}
