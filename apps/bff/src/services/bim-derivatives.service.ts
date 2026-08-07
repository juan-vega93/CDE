import { createHash } from "crypto";
import path from "path";
import { readJsonFile, writeJsonFile } from "../utils/json-store";

export type BimDerivativeStatus = "generated" | "failed" | "pending";

export type BimDerivativeRecord = {
  id: string;
  projectCode: string;
  sourcePath: string;
  sourceName: string;
  fileId?: string | null;
  versionId: string;
  versionKey?: string | null;
  fragPath: string;
  status: BimDerivativeStatus;
  error?: string | null;
  generatedAt?: string | null;
  updatedAt: string;
};

type BimDerivativesStore = {
  records: BimDerivativeRecord[];
};

const STORE_PATH = "data/bim-derivatives.json";

function normalizePortalPath(value: string): string {
  const clean = value.trim();
  if (!clean) return "/";
  return clean.startsWith("/") ? clean.replace(/\/$/, "") || "/" : `/${clean.replace(/\/$/, "")}`;
}

function readStore(): BimDerivativesStore {
  return readJsonFile<BimDerivativesStore>(STORE_PATH, { records: [] });
}

function writeStore(store: BimDerivativesStore): void {
  writeJsonFile(STORE_PATH, store);
}

export function getProjectCodeFromPath(documentPath: string): string {
  return normalizePortalPath(documentPath).split("/").filter(Boolean)[0] ?? "";
}

export function buildBimDerivativeId(input: {
  projectCode: string;
  sourcePath: string;
  fileId?: string | null;
  versionId?: string | null;
  versionKey?: string | null;
}): string {
  const identity = [
    input.projectCode.trim().toUpperCase(),
    input.fileId?.trim() || normalizePortalPath(input.sourcePath),
    input.versionId?.trim() || "current",
    input.versionKey?.trim() || ""
  ].join("|");

  return createHash("sha256").update(identity).digest("hex").slice(0, 32);
}

export function getStableFragPath(input: {
  projectCode: string;
  derivativeId: string;
}): string {
  return path.posix.join(
    "/",
    input.projectCode.trim().toUpperCase(),
    "_derived",
    "_frags",
    `${input.derivativeId}.frag`
  );
}

export function findBimDerivative(input: {
  sourcePath: string;
  fileId?: string | null;
  versionId?: string | null;
  versionKey?: string | null;
}): BimDerivativeRecord | null {
  const store = readStore();
  const sourcePath = normalizePortalPath(input.sourcePath);
  const versionId = input.versionId?.trim() || "current";
  const fileId = input.fileId?.trim();
  const versionKey = input.versionKey?.trim();

  return (
    store.records.find((record) => {
      if (record.status !== "generated") return false;
      if (record.sourcePath !== sourcePath) return false;
      if (record.versionId !== versionId) return false;

      if (fileId && record.fileId && record.fileId !== fileId) return false;
      if (versionKey && record.versionKey && record.versionKey !== versionKey) {
        return false;
      }

      return true;
    }) ?? null
  );
}

export function findBimDerivativeRecord(input: {
  sourcePath: string;
  fileId?: string | null;
  versionId?: string | null;
  versionKey?: string | null;
}): BimDerivativeRecord | null {
  const store = readStore();
  const sourcePath = normalizePortalPath(input.sourcePath);
  const versionId = input.versionId?.trim() || "current";
  const fileId = input.fileId?.trim();
  const versionKey = input.versionKey?.trim();

  return (
    store.records
      .filter((record) => {
        if (record.sourcePath !== sourcePath) return false;
        if (record.versionId !== versionId) return false;
        if (fileId && record.fileId && record.fileId !== fileId) return false;
        if (versionKey && record.versionKey && record.versionKey !== versionKey) {
          return false;
        }
        return true;
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null
  );
}

export function upsertBimDerivative(
  input: Omit<BimDerivativeRecord, "updatedAt">
): BimDerivativeRecord {
  const store = readStore();
  const now = new Date().toISOString();
  const record: BimDerivativeRecord = {
    ...input,
    sourcePath: normalizePortalPath(input.sourcePath),
    updatedAt: now
  };

  const index = store.records.findIndex((item) => item.id === record.id);

  if (index >= 0) {
    store.records[index] = {
      ...store.records[index],
      ...record
    };
  } else {
    store.records.push(record);
  }

  writeStore(store);
  return record;
}

export function remapBimDerivativeSourcePath(
  oldSourcePath: string,
  newSourcePath: string
): void {
  const cleanOldPath = normalizePortalPath(oldSourcePath);
  const cleanNewPath = normalizePortalPath(newSourcePath);
  const newName = path.posix.basename(cleanNewPath);
  const store = readStore();
  let changed = false;

  store.records = store.records.map((record) => {
    if (record.sourcePath !== cleanOldPath) return record;
    changed = true;
    return {
      ...record,
      sourcePath: cleanNewPath,
      sourceName: newName,
      updatedAt: new Date().toISOString()
    };
  });

  if (changed) writeStore(store);
}

export function remapBimDerivativeSourceFolder(
  oldFolderPath: string,
  newFolderPath: string
): void {
  const cleanOldFolder = normalizePortalPath(oldFolderPath).replace(/\/$/, "");
  const cleanNewFolder = normalizePortalPath(newFolderPath).replace(/\/$/, "");
  const store = readStore();
  let changed = false;

  store.records = store.records.map((record) => {
    if (
      record.sourcePath !== cleanOldFolder &&
      !record.sourcePath.startsWith(`${cleanOldFolder}/`)
    ) {
      return record;
    }

    const suffix =
      record.sourcePath === cleanOldFolder
        ? ""
        : record.sourcePath.slice(cleanOldFolder.length);
    const sourcePath = `${cleanNewFolder}${suffix}`;

    changed = true;

    return {
      ...record,
      sourcePath,
      sourceName: path.posix.basename(sourcePath),
      updatedAt: new Date().toISOString()
    };
  });

  if (changed) writeStore(store);
}

export function deleteBimDerivativesForSource(sourcePath: string): BimDerivativeRecord[] {
  const cleanSourcePath = normalizePortalPath(sourcePath);
  const store = readStore();
  const deleted = store.records.filter((record) => record.sourcePath === cleanSourcePath);

  if (!deleted.length) return [];

  store.records = store.records.filter((record) => record.sourcePath !== cleanSourcePath);
  writeStore(store);

  return deleted;
}
