import { createHash, randomUUID } from "node:crypto";
import type { Dirent, Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import type { DocumentItem } from "../types/document.types";
import type { FolderItem } from "../types/folder.types";
import { getBffRuntimePath } from "../utils/data-dir";

export type MockDocumentDirectory = {
  folders: FolderItem[];
  documents: DocumentItem[];
};

function normalizePortalPath(value: string): string {
  const clean = value.trim();

  if (!clean.startsWith("/")) {
    throw new Error("La ruta documental debe comenzar con '/'");
  }

  const segments = clean.split("/").filter(Boolean);
  for (const segment of segments) {
    if (
      segment === "." ||
      segment === ".." ||
      segment.includes("\\") ||
      segment.includes("\0")
    ) {
      throw new Error("La ruta documental no es válida");
    }
  }

  return segments.length ? `/${segments.join("/")}` : "/";
}

function getStorageRoot(): string {
  return path.resolve(getBffRuntimePath("nextcloud-mock"));
}

function resolveStoragePath(portalPath: string, options: { allowRoot?: boolean } = {}): {
  portalPath: string;
  absolutePath: string;
} {
  const normalizedPath = normalizePortalPath(portalPath);
  const segments = normalizedPath.split("/").filter(Boolean);

  if (!options.allowRoot && segments.length === 0) {
    throw new Error("La ruta documental debe identificar un archivo o carpeta");
  }

  const root = getStorageRoot();
  const absolutePath = path.resolve(root, ...segments);
  const rootPrefix = root.endsWith(path.sep) ? root : `${root}${path.sep}`;

  if (absolutePath !== root && !absolutePath.startsWith(rootPrefix)) {
    throw new Error("La ruta documental sale del almacenamiento mock");
  }

  return { portalPath: normalizedPath, absolutePath };
}

function getContentType(fileName: string): string {
  switch (path.posix.extname(fileName).toLowerCase()) {
    case ".ifc":
      return "application/x-step";
    case ".pdf":
      return "application/pdf";
    case ".json":
      return "application/json";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function toDocumentItem(portalPath: string, stats: Stats): DocumentItem {
  const name = path.posix.basename(portalPath);
  const extension = path.posix.extname(name).slice(1).toLowerCase();
  const etag = `${Math.trunc(stats.mtimeMs)}-${stats.size}`;

  return {
    id: `mock-${createHash("sha256").update(portalPath).digest("hex").slice(0, 24)}`,
    name,
    path: portalPath,
    extension,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    etag,
    fileId: etag,
    contentType: getContentType(name),
    workflowStatus: null,
    uiStatus: "pending"
  };
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";
}

export async function writeMockDocument(
  documentPath: string,
  content: Buffer
): Promise<void> {
  const { absolutePath } = resolveStoragePath(documentPath);
  const parentPath = path.dirname(absolutePath);
  const temporaryPath = path.join(parentPath, `.${path.basename(absolutePath)}.${randomUUID()}.tmp`);

  await fs.mkdir(parentPath, { recursive: true });

  try {
    await fs.writeFile(temporaryPath, content);
    await fs.rename(temporaryPath, absolutePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readMockDocument(documentPath: string): Promise<{
  buffer: Buffer;
  contentType: string;
  fileName: string;
  size: number;
}> {
  const { portalPath, absolutePath } = resolveStoragePath(documentPath);
  const [buffer, stats] = await Promise.all([
    fs.readFile(absolutePath),
    fs.stat(absolutePath, { bigint: false })
  ]);

  if (!stats.isFile()) {
    throw new Error("La ruta no identifica un documento");
  }

  const fileName = path.posix.basename(portalPath);
  return {
    buffer,
    contentType: getContentType(fileName),
    fileName,
    size: stats.size
  };
}

export async function listMockDocumentDirectory(directoryPath: string): Promise<MockDocumentDirectory> {
  const { portalPath, absolutePath } = resolveStoragePath(directoryPath, { allowRoot: true });
  let entries: Dirent[];

  try {
    entries = await fs.readdir(absolutePath, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (isMissing(error)) return { folders: [], documents: [] };
    throw error;
  }

  const folders: FolderItem[] = [];
  const documents: DocumentItem[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    const childPortalPath = portalPath === "/" ? `/${entry.name}` : `${portalPath}/${entry.name}`;
    const childAbsolutePath = path.join(absolutePath, entry.name);

    if (entry.isDirectory()) {
      folders.push({ name: entry.name, path: childPortalPath, type: "folder" });
    } else if (entry.isFile()) {
      documents.push(
        toDocumentItem(
          childPortalPath,
          await fs.stat(childAbsolutePath, { bigint: false })
        )
      );
    }
  }

  folders.sort((left, right) => left.name.localeCompare(right.name));
  documents.sort((left, right) => left.name.localeCompare(right.name));
  return { folders, documents };
}

export async function createMockDocumentFolder(folderPath: string): Promise<void> {
  const { absolutePath } = resolveStoragePath(folderPath);
  await fs.mkdir(absolutePath, { recursive: true });
}

export async function deleteMockDocument(documentPath: string): Promise<void> {
  const { absolutePath } = resolveStoragePath(documentPath);
  await fs.rm(absolutePath);
}

export async function renameMockDocument(documentPath: string, newName: string): Promise<void> {
  if (!newName || newName.includes("/") || newName.includes("\\") || newName === "." || newName === "..") {
    throw new Error("El nombre del documento no es válido");
  }

  const source = resolveStoragePath(documentPath);
  const destination = resolveStoragePath(
    `${path.posix.dirname(source.portalPath)}/${newName}`
  );
  await fs.rename(source.absolutePath, destination.absolutePath);
}

export async function moveMockDocument(
  documentPath: string,
  destinationFolderPath: string
): Promise<void> {
  const source = resolveStoragePath(documentPath);
  const destinationFolder = resolveStoragePath(destinationFolderPath, { allowRoot: true });
  const destination = resolveStoragePath(
    `${destinationFolder.portalPath}/${path.posix.basename(source.portalPath)}`
  );

  await fs.mkdir(destinationFolder.absolutePath, { recursive: true });
  await fs.rename(source.absolutePath, destination.absolutePath);
}
