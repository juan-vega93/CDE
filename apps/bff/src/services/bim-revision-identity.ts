import { createHash } from "node:crypto";
import { toCanonicalBimModelKey, type CanonicalBimModelKey } from "./bim-model-identity";

declare const bimRevisionId: unique symbol;
export type BimRevisionId = string & { readonly [bimRevisionId]: true };

export type BimProcessingContext = Readonly<{
  projectCode: string;
  modelKey: CanonicalBimModelKey;
  revisionId: BimRevisionId;
}>;

/** Exact content identity; no decoding or normalization. Parsing validity is web-ifc's job. */
export function toBimRevisionId(ifcBytes: Uint8Array): BimRevisionId {
  if (!(ifcBytes instanceof Uint8Array) || ifcBytes.byteLength === 0) {
    throw new Error("BIM revision identity requires non-empty IFC bytes");
  }
  return `sha256:${createHash("sha256").update(ifcBytes).digest("hex")}` as BimRevisionId;
}

/**
 * Own the exact byte snapshot handed to web-ifc, before any asynchronous work.
 * Hash once; callers must pass ifcBytes unchanged to extraction and carry context.
 * Legacy sourceHash/modelKey/version labels never substitute for these identities.
 * This context is internal and does not establish a persistent SQL generation.
 */
export function prepareBimIfcInput(input: {
  projectCode: string;
  documentPath: string;
  ifcBuffer: Uint8Array;
}): { ifcBytes: Uint8Array; context: BimProcessingContext } {
  if (!input.projectCode.trim()) throw new Error("BIM processing requires projectCode");
  const modelKey = toCanonicalBimModelKey(input.documentPath);
  if (!(input.ifcBuffer instanceof Uint8Array)) {
    throw new Error("BIM revision identity requires non-empty IFC bytes");
  }
  const ifcBytes = new Uint8Array(input.ifcBuffer);
  const context: BimProcessingContext = Object.freeze({
    projectCode: input.projectCode,
    modelKey,
    revisionId: toBimRevisionId(ifcBytes)
  });
  return { ifcBytes, context };
}
