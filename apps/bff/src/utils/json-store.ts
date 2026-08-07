import fs from "fs";
import path from "path";
import { getBffDataPath } from "./data-dir";

function resolveJsonPath(relativeFilePath: string): string {
  const normalizedPath = relativeFilePath.replace(/\\/g, "/");

  if (normalizedPath.startsWith("data/")) {
    return getBffDataPath(normalizedPath.slice("data/".length));
  }

  return path.resolve(process.cwd(), relativeFilePath);
}

export function readJsonFile<T>(relativeFilePath: string, fallback: T): T {
  try {
    const absolutePath = resolveJsonPath(relativeFilePath);

    if (!fs.existsSync(absolutePath)) {
      return fallback;
    }

    const fileContent = fs.readFileSync(absolutePath, "utf-8");
    return JSON.parse(fileContent) as T;
  } catch (error) {
    console.error(`[json-store] Error reading ${relativeFilePath}:`, error);
    return fallback;
  }
}

export function writeJsonFile<T>(relativeFilePath: string, data: T): void {
  try {
    const absolutePath = resolveJsonPath(relativeFilePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`[json-store] Error writing ${relativeFilePath}:`, error);
    throw error;
  }
}
