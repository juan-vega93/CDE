import path from "node:path";

export function getBffDataDir(): string {
  if (process.env.BFF_DATA_DIR?.trim()) {
    return path.resolve(process.env.BFF_DATA_DIR.trim());
  }

  return path.resolve(__dirname, "..", "..", "data");
}

export function getBffDataPath(fileName: string): string {
  return path.join(getBffDataDir(), fileName);
}

/**
 * Mutable development-only state. Keep it outside data fixtures and source files.
 */
export function getBffRuntimePath(...segments: string[]): string {
  const runtimeDir = process.env.BFF_RUNTIME_DIR?.trim()
    ? path.resolve(process.env.BFF_RUNTIME_DIR.trim())
    : path.resolve(process.cwd(), ".runtime");

  return path.join(runtimeDir, ...segments);
}
