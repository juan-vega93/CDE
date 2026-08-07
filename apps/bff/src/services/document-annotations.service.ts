import crypto from "crypto";
import { getDatabasePool, isDatabaseEnabled } from "../db/client";
import { readJsonFile, writeJsonFile } from "../utils/json-store";
import {
  deleteIssueBySource,
  upsertIssueFromDocumentAnnotation
} from "./issues.service";
import type {
  CreateDocumentAnnotationInput,
  DocumentAnnotation,
  UpdateDocumentAnnotationInput
} from "../types/document-annotation.types";

const STORE_PATH = "data/document-annotations.json";

function normalizeProjectCode(projectCode: string): string {
  return projectCode.trim().toUpperCase();
}

function normalizePath(documentPath: string): string {
  const cleanPath = documentPath.trim();
  if (!cleanPath) return "/";
  return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
}

function normalizeVersionId(versionId?: string | null): string | null {
  const clean = versionId?.trim();
  return clean || null;
}

function readJsonAnnotations(): DocumentAnnotation[] {
  return readJsonFile<DocumentAnnotation[]>(STORE_PATH, []);
}

function writeJsonAnnotations(annotations: DocumentAnnotation[]): void {
  writeJsonFile(STORE_PATH, annotations);
}

async function syncDocumentIssueSafely(annotation: DocumentAnnotation): Promise<void> {
  if (annotation.kind !== "issue_marker") return;

  try {
    await upsertIssueFromDocumentAnnotation(annotation);
  } catch (error) {
    console.warn("[document-annotations] issue sync failed:", error);
  }
}

export async function listDocumentAnnotations(input: {
  projectCode: string;
  documentPath: string;
  documentVersionId?: string | null;
}): Promise<DocumentAnnotation[]> {
  const projectCode = normalizeProjectCode(input.projectCode);
  const documentPath = normalizePath(input.documentPath);
  const documentVersionId = normalizeVersionId(input.documentVersionId);

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        select
          id,
          project_code,
          document_path,
          document_version_id,
          page_number,
          kind,
          text,
          color,
          geometry,
          metadata,
          status,
          author,
          created_at,
          updated_at
        from cde_document_annotations
        where project_code = $1
          and document_path = $2
          and coalesce(document_version_id, '') = coalesce($3, '')
          and deleted_at is null
        order by page_number asc, created_at asc
      `,
      [projectCode, documentPath, documentVersionId]
    );

    return result.rows.map((row) => ({
      id: row.id,
      projectCode: row.project_code,
      documentPath: row.document_path,
      documentVersionId: row.document_version_id,
      pageNumber: Number(row.page_number),
      kind: row.kind,
      text: row.text ?? undefined,
      color: row.color,
      geometry: row.geometry ?? {},
      metadata: row.metadata ?? {},
      status: row.status,
      author: row.author ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
  }

  return readJsonAnnotations().filter(
    (annotation) =>
      normalizeProjectCode(annotation.projectCode) === projectCode &&
      normalizePath(annotation.documentPath) === documentPath &&
      normalizeVersionId(annotation.documentVersionId) === documentVersionId
  );
}

export async function listProjectDocumentAnnotations(
  projectCodeInput: string
): Promise<DocumentAnnotation[]> {
  const projectCode = normalizeProjectCode(projectCodeInput);

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        select
          id,
          project_code,
          document_path,
          document_version_id,
          page_number,
          kind,
          text,
          color,
          geometry,
          metadata,
          status,
          author,
          created_at,
          updated_at
        from cde_document_annotations
        where project_code = $1 and deleted_at is null
        order by updated_at desc
      `,
      [projectCode]
    );

    return result.rows.map((row) => ({
      id: row.id,
      projectCode: row.project_code,
      documentPath: row.document_path,
      documentVersionId: row.document_version_id,
      pageNumber: Number(row.page_number),
      kind: row.kind,
      text: row.text ?? undefined,
      color: row.color,
      geometry: row.geometry ?? {},
      metadata: row.metadata ?? {},
      status: row.status,
      author: row.author ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    }));
  }

  return readJsonAnnotations().filter(
    (annotation) => normalizeProjectCode(annotation.projectCode) === projectCode
  );
}

export async function createDocumentAnnotation(
  input: CreateDocumentAnnotationInput
): Promise<DocumentAnnotation> {
  const now = new Date().toISOString();
  const annotation: DocumentAnnotation = {
    id: crypto.randomUUID(),
    projectCode: normalizeProjectCode(input.projectCode),
    documentPath: normalizePath(input.documentPath),
    documentVersionId: normalizeVersionId(input.documentVersionId),
    pageNumber: input.pageNumber,
    kind: input.kind,
    text: input.text?.trim() || undefined,
    color: input.color?.trim() || "#e30613",
    geometry: input.geometry,
    metadata: input.metadata ?? {},
    status: "open",
    author: input.author?.trim() || undefined,
    createdAt: now,
    updatedAt: now
  };

  if (isDatabaseEnabled()) {
    await getDatabasePool().query(
      `
        insert into cde_document_annotations (
          id,
          project_code,
          document_path,
          document_version_id,
          page_number,
          kind,
          text,
          color,
          geometry,
          metadata,
          status,
          author,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      [
        annotation.id,
        annotation.projectCode,
        annotation.documentPath,
        annotation.documentVersionId,
        annotation.pageNumber,
        annotation.kind,
        annotation.text ?? null,
        annotation.color,
        JSON.stringify(annotation.geometry),
        JSON.stringify(annotation.metadata ?? {}),
        annotation.status,
        annotation.author ?? null,
        annotation.createdAt,
        annotation.updatedAt
      ]
    );

    await syncDocumentIssueSafely(annotation);
    return annotation;
  }

  const annotations = readJsonAnnotations();
  annotations.push(annotation);
  writeJsonAnnotations(annotations);
  await syncDocumentIssueSafely(annotation);
  return annotation;
}

export async function updateDocumentAnnotation(
  input: UpdateDocumentAnnotationInput
): Promise<DocumentAnnotation | null> {
  const projectCode = normalizeProjectCode(input.projectCode);
  const now = new Date().toISOString();

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        update cde_document_annotations
        set
          text = coalesce($3, text),
          color = coalesce($4, color),
          metadata = coalesce($5::jsonb, metadata),
          status = coalesce($6::text, status),
          updated_at = $7
        where id = $1
          and project_code = $2
          and deleted_at is null
        returning
          id,
          project_code,
          document_path,
          document_version_id,
          page_number,
          kind,
          text,
          color,
          geometry,
          metadata,
          status,
          author,
          created_at,
          updated_at
      `,
      [
        input.id,
        projectCode,
        input.text ?? null,
        input.color ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.status ?? null,
        now
      ]
    );

    const row = result.rows[0];
    if (!row) return null;

    const annotation = {
      id: row.id,
      projectCode: row.project_code,
      documentPath: row.document_path,
      documentVersionId: row.document_version_id,
      pageNumber: Number(row.page_number),
      kind: row.kind,
      text: row.text ?? undefined,
      color: row.color,
      geometry: row.geometry ?? {},
      metadata: row.metadata ?? {},
      status: row.status,
      author: row.author ?? undefined,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString()
    };

    await syncDocumentIssueSafely(annotation);
    return annotation;
  }

  const annotations = readJsonAnnotations();
  const index = annotations.findIndex(
    (annotation) =>
      annotation.id === input.id &&
      normalizeProjectCode(annotation.projectCode) === projectCode
  );

  if (index < 0) return null;

  const current = annotations[index];
  const updated: DocumentAnnotation = {
    ...current,
    text: input.text ?? current.text,
    color: input.color ?? current.color,
    metadata: input.metadata ?? current.metadata,
    status: input.status ?? current.status,
    updatedAt: now
  };

  annotations[index] = updated;
  writeJsonAnnotations(annotations);
  await syncDocumentIssueSafely(updated);
  return updated;
}

export async function deleteDocumentAnnotation(input: {
  id: string;
  projectCode: string;
}): Promise<boolean> {
  const projectCode = normalizeProjectCode(input.projectCode);

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        update cde_document_annotations
        set deleted_at = now(), updated_at = now()
        where id = $1 and project_code = $2 and deleted_at is null
      `,
      [input.id, projectCode]
    );

    const deleted = (result.rowCount ?? 0) > 0;
    if (deleted) {
      await deleteIssueBySource({
        projectCode,
        sourceSystem: "document_annotation",
        sourceId: input.id
      });
    }

    return deleted;
  }

  const annotations = readJsonAnnotations();
  const nextAnnotations = annotations.filter(
    (annotation) =>
      !(
        annotation.id === input.id &&
        normalizeProjectCode(annotation.projectCode) === projectCode
      )
  );

  if (nextAnnotations.length === annotations.length) return false;

  writeJsonAnnotations(nextAnnotations);
  await deleteIssueBySource({
    projectCode,
    sourceSystem: "document_annotation",
    sourceId: input.id
  });
  return true;
}
