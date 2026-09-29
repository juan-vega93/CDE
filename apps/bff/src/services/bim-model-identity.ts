declare const canonicalBimModelKey: unique symbol;

/** Logical document identity, scoped externally by project; not a legacy/source key. */
export type CanonicalBimModelKey = string & { readonly [canonicalBimModelKey]: true };

/**
 * Strict BIM Core boundary. Uses the documentary leading/trailing slash convention
 * without case folding, URL decoding, Unicode normalization or URL fallbacks.
 * Dots/backslashes/NUL are rejected as in documentary storage. Repeated separators
 * are rejected rather than reconciling the differing legacy normalizers.
 * Query/hash/percent characters within a path remain literal filename characters.
 * Supply the authoritative documentPath, never a lowercased legacy modelKey.
 * This does not establish continuity across document moves or renames.
 */
export function toCanonicalBimModelKey(documentPath: string | null | undefined): CanonicalBimModelKey {
  if (typeof documentPath !== "string" || !documentPath.trim()) {
    throw new Error("A documentPath is required for canonical BIM model identity");
  }
  const path = documentPath.trim();
  // Reject URL schemes (including legacy ifc:/frag:), network URLs and Windows paths.
  if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith("//") || /[\\\0]/.test(path)) {
    throw new Error("Canonical BIM model identity requires a documentary path, not a URL or source key");
  }
  const absolutePath = path.startsWith("/") ? path : `/${path}`;
  const normalizedPath = absolutePath.replace(/\/$/, "");
  const segments = normalizedPath.slice(1).split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("Invalid or ambiguous documentPath for canonical BIM model identity");
  }
  return normalizedPath as CanonicalBimModelKey;
}
