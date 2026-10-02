import { toCanonicalBimModelKey } from "./bim-model-identity";
import { toBimRevisionId, type BimProcessingContext } from "./bim-revision-identity";

/** Header describes the exact buffer sent by /documents/content, never a latest DB revision. */
export function getIfcContentContext(documentPath: string, buffer: Uint8Array): BimProcessingContext | undefined {
  if (!documentPath.toLowerCase().endsWith(".ifc")) return undefined;
  const modelKey = toCanonicalBimModelKey(documentPath);
  const projectCode = modelKey.split("/")[1].toUpperCase();
  return { projectCode, modelKey, revisionId: toBimRevisionId(buffer) };
}
