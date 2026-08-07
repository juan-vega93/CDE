import "dotenv/config";
import fs from "fs/promises";
import { getDatabasePool } from "./client";
import { getBffDataPath } from "../utils/data-dir";
import type { BcfTopic } from "../services/bcf-topics.service";
import { upsertIssueFromBcfTopic } from "../services/issues.service";
import type { DocumentAnnotation } from "../types/document-annotation.types";
import { upsertIssueFromDocumentAnnotation } from "../services/issues.service";

async function readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(getBffDataPath(fileName), "utf-8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function normalizeProjectCode(projectCode?: string): string {
  return projectCode?.trim().toUpperCase() || "";
}

function normalizePath(documentPath: string): string {
  const cleanPath = documentPath.trim();
  return cleanPath.startsWith("/") ? cleanPath : `/${cleanPath}`;
}

async function backfillBcfTopics(): Promise<number> {
  const topics = await readJsonFile<BcfTopic[]>("bcf-topics.json", []);
  let inserted = 0;

  for (const topic of topics) {
    const projectCode = normalizeProjectCode(topic.projectCode);
    if (!projectCode) {
      console.warn(`[db:backfill] skipped BCF topic without projectCode: ${topic.id}`);
      continue;
    }

    const payload: BcfTopic = { ...topic, projectCode };

    await getDatabasePool().query(
      `
        insert into cde_bcf_topics (
          id,
          project_code,
          payload,
          created_at,
          updated_at,
          deleted_at
        )
        values ($1, $2, $3::jsonb, $4, $5, null)
        on conflict (project_code, id) do update set
          payload = excluded.payload,
          updated_at = excluded.updated_at,
          deleted_at = null
      `,
      [
        payload.id,
        projectCode,
        JSON.stringify(payload),
        payload.creationDate,
        payload.modifiedDate
      ]
    );

    await upsertIssueFromBcfTopic(payload);
    inserted += 1;
  }

  return inserted;
}

async function backfillDocumentAnnotations(): Promise<number> {
  const annotations = await readJsonFile<DocumentAnnotation[]>(
    "document-annotations.json",
    []
  );
  let inserted = 0;

  for (const annotation of annotations) {
    const projectCode = normalizeProjectCode(annotation.projectCode);
    if (!projectCode) {
      console.warn(
        `[db:backfill] skipped document annotation without projectCode: ${annotation.id}`
      );
      continue;
    }

    const payload: DocumentAnnotation = {
      ...annotation,
      projectCode,
      documentPath: normalizePath(annotation.documentPath),
      documentVersionId: annotation.documentVersionId || null
    };

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
          updated_at,
          deleted_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12, $13, $14, null)
        on conflict (id) do update set
          project_code = excluded.project_code,
          document_path = excluded.document_path,
          document_version_id = excluded.document_version_id,
          page_number = excluded.page_number,
          kind = excluded.kind,
          text = excluded.text,
          color = excluded.color,
          geometry = excluded.geometry,
          metadata = excluded.metadata,
          status = excluded.status,
          author = excluded.author,
          updated_at = excluded.updated_at,
          deleted_at = null
      `,
      [
        payload.id,
        payload.projectCode,
        payload.documentPath,
        payload.documentVersionId ?? null,
        payload.pageNumber,
        payload.kind,
        payload.text ?? null,
        payload.color,
        JSON.stringify(payload.geometry ?? {}),
        JSON.stringify(payload.metadata ?? {}),
        payload.status,
        payload.author ?? null,
        payload.createdAt,
        payload.updatedAt
      ]
    );

    await upsertIssueFromDocumentAnnotation(payload);
    inserted += 1;
  }

  return inserted;
}

async function main(): Promise<void> {
  const bcfCount = await backfillBcfTopics();
  const annotationCount = await backfillDocumentAnnotations();

  console.log(`[db:backfill] BCF topics: ${bcfCount}`);
  console.log(`[db:backfill] document annotations: ${annotationCount}`);

  await getDatabasePool().end();
}

main().catch(async (error) => {
  console.error("[db:backfill] failed:", error);
  await getDatabasePool().end().catch(() => undefined);
  process.exitCode = 1;
});
