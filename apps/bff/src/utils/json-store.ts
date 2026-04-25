import fs from "fs";
import path from "path";

export function readJsonFile<T>(relativeFilePath: string, fallback: T): T {
  try {
    const absolutePath = path.resolve(process.cwd(), relativeFilePath);

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
    const absolutePath = path.resolve(process.cwd(), relativeFilePath);
    fs.writeFileSync(absolutePath, JSON.stringify(data, null, 2), "utf-8");
  } catch (error) {
    console.error(`[json-store] Error writing ${relativeFilePath}:`, error);
    throw error;
  }
}