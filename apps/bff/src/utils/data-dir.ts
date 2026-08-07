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
