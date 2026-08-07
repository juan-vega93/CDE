import crypto from "crypto";
import { getDatabasePool, isDatabaseEnabled } from "../db/client";
import { readJsonFile, writeJsonFile } from "../utils/json-store";
import type { DocumentAnnotation } from "../types/document-annotation.types";
import type { CanonicalIssue, CanonicalIssueSourceKind } from "../types/issue.types";
import type { BcfTopic } from "./bcf-topics.service";

const STORE_PATH = "data/issues.json";

function normalizeProjectCode(projectCode: string): string {
  return projectCode.trim().toUpperCase();
}

function normalizeStatus(status?: string): string {
  if (!status) return "open";
  if (status === "resolved") return "closed";
  return status;
}

function cleanText(value?: string | null): string | undefined {
  const clean = value?.trim();
  return clean || undefined;
}

function issueTitleFromDocumentAnnotation(annotation: DocumentAnnotation): string {
  return (
    cleanText(annotation.metadata?.title) ??
    cleanText(annotation.text) ??
    `Incidencia documental pagina ${annotation.pageNumber}`
  );
}

function documentNameFromPath(documentPath: string): string {
  return documentPath.split("/").filter(Boolean).pop() ?? documentPath;
}

function readJsonIssues(): CanonicalIssue[] {
  return readJsonFile<CanonicalIssue[]>(STORE_PATH, []);
}

function writeJsonIssues(issues: CanonicalIssue[]): void {
  writeJsonFile(STORE_PATH, issues);
}

function mapIssueRow(row: any): CanonicalIssue {
  const dueDate =
    row.due_date instanceof Date
      ? row.due_date.toISOString().slice(0, 10)
      : cleanText(row.due_date);

  return {
    id: row.id,
    projectCode: row.project_code,
    title: row.title,
    description: row.description ?? undefined,
    sourceKind: row.source_kind,
    sourceSystem: row.source_system,
    sourceId: row.source_id,
    issueType: row.issue_type,
    status: row.status,
    priority: row.priority,
    discipline: row.discipline ?? undefined,
    author: row.author ?? undefined,
    assignedTo: row.assigned_to ?? undefined,
    dueDate,
    documentPath: row.document_path ?? undefined,
    documentName: row.document_name ?? undefined,
    documentVersionId: row.document_version_id ?? undefined,
    pageNumber: row.page_number === null ? undefined : Number(row.page_number),
    snapshotUrl: row.snapshot_url ?? undefined,
    viewpointId: row.viewpoint_id ?? undefined,
    nativeViewpointGuid: row.native_viewpoint_guid ?? undefined,
    location: row.location ?? {},
    metadata: row.metadata ?? {},
    elementCount: Number(row.element_count ?? 0),
    openProjectProjectRef: row.openproject_project_ref ?? undefined,
    openProjectWorkPackageId: row.openproject_work_package_id ?? undefined,
    openProjectSyncStatus: row.openproject_sync_status ?? "not_synced",
    openProjectLastError: row.openproject_last_error ?? undefined,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

async function persistIssue(issue: CanonicalIssue): Promise<CanonicalIssue> {
  const projectCode = normalizeProjectCode(issue.projectCode);

  if (isDatabaseEnabled()) {
    const existing = await getDatabasePool().query(
      `
        select id from cde_issues
        where project_code = $1
          and source_system = $2
          and source_id = $3
          and deleted_at is null
        limit 1
      `,
      [projectCode, issue.sourceSystem, issue.sourceId]
    );

    const issueId = existing.rows[0]?.id ?? issue.id;

    const result = await getDatabasePool().query(
      `
        insert into cde_issues (
          id,
          project_code,
          title,
          description,
          source_kind,
          source_system,
          source_id,
          issue_type,
          status,
          priority,
          discipline,
          author,
          assigned_to,
          due_date,
          document_path,
          document_name,
          document_version_id,
          page_number,
          snapshot_url,
          viewpoint_id,
          native_viewpoint_guid,
          location,
          metadata,
          element_count,
          openproject_project_ref,
          openproject_work_package_id,
          openproject_sync_status,
          openproject_last_error,
          created_at,
          updated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22::jsonb, $23::jsonb,
          $24, $25, $26, $27, $28, $29, $30
        )
        on conflict (id) do update set
          title = excluded.title,
          description = excluded.description,
          source_kind = excluded.source_kind,
          source_system = excluded.source_system,
          source_id = excluded.source_id,
          issue_type = excluded.issue_type,
          status = cde_issues.status,
          priority = cde_issues.priority,
          discipline = coalesce(cde_issues.discipline, excluded.discipline),
          assigned_to = coalesce(cde_issues.assigned_to, excluded.assigned_to),
          due_date = coalesce(cde_issues.due_date, excluded.due_date),
          document_path = excluded.document_path,
          document_name = excluded.document_name,
          document_version_id = excluded.document_version_id,
          page_number = excluded.page_number,
          snapshot_url = excluded.snapshot_url,
          viewpoint_id = excluded.viewpoint_id,
          native_viewpoint_guid = excluded.native_viewpoint_guid,
          location = excluded.location,
          metadata = excluded.metadata,
          element_count = excluded.element_count,
          openproject_project_ref = excluded.openproject_project_ref,
          openproject_work_package_id = excluded.openproject_work_package_id,
          openproject_sync_status = excluded.openproject_sync_status,
          openproject_last_error = excluded.openproject_last_error,
          updated_at = excluded.updated_at
        returning *
      `,
      [
        issueId,
        projectCode,
        issue.title,
        issue.description ?? null,
        issue.sourceKind,
        issue.sourceSystem,
        issue.sourceId,
        issue.issueType,
        issue.status,
        issue.priority,
        issue.discipline ?? null,
        issue.author ?? null,
        issue.assignedTo ?? null,
        issue.dueDate || null,
        issue.documentPath ?? null,
        issue.documentName ?? null,
        issue.documentVersionId ?? null,
        issue.pageNumber ?? null,
        issue.snapshotUrl ?? null,
        issue.viewpointId ?? null,
        issue.nativeViewpointGuid ?? null,
        JSON.stringify(issue.location ?? {}),
        JSON.stringify(issue.metadata ?? {}),
        issue.elementCount,
        issue.openProjectProjectRef ?? null,
        issue.openProjectWorkPackageId ?? null,
        issue.openProjectSyncStatus,
        issue.openProjectLastError ?? null,
        issue.createdAt,
        issue.updatedAt
      ]
    );

    return mapIssueRow(result.rows[0]);
  }

  const issues = readJsonIssues();
  const existingIndex = issues.findIndex(
    (currentIssue) =>
      normalizeProjectCode(currentIssue.projectCode) === projectCode &&
      currentIssue.sourceSystem === issue.sourceSystem &&
      currentIssue.sourceId === issue.sourceId
  );
  const nextIssue = {
    ...issue,
    id: existingIndex >= 0 ? issues[existingIndex].id : issue.id,
    projectCode,
    status: existingIndex >= 0 ? issues[existingIndex].status : issue.status,
    priority: existingIndex >= 0 ? issues[existingIndex].priority : issue.priority,
    discipline:
      existingIndex >= 0
        ? issues[existingIndex].discipline ?? issue.discipline
        : issue.discipline,
    assignedTo:
      existingIndex >= 0
        ? issues[existingIndex].assignedTo ?? issue.assignedTo
        : issue.assignedTo,
    dueDate:
      existingIndex >= 0
        ? issues[existingIndex].dueDate ?? issue.dueDate
        : issue.dueDate
  };

  if (existingIndex >= 0) {
    issues[existingIndex] = nextIssue;
  } else {
    issues.push(nextIssue);
  }

  writeJsonIssues(issues);
  return nextIssue;
}

export async function listProjectIssues(projectCodeInput: string): Promise<CanonicalIssue[]> {
  const projectCode = normalizeProjectCode(projectCodeInput);

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        select *
        from cde_issues
        where project_code = $1 and deleted_at is null
        order by updated_at desc
      `,
      [projectCode]
    );

    return result.rows.map(mapIssueRow);
  }

  return readJsonIssues()
    .filter((issue) => normalizeProjectCode(issue.projectCode) === projectCode)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function updateIssue(input: {
  id: string;
  projectCode: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  issueType?: string;
  discipline?: string;
  assignedTo?: string;
  dueDate?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<CanonicalIssue | null> {
  const projectCode = normalizeProjectCode(input.projectCode);
  const now = new Date().toISOString();

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        update cde_issues
        set
          title = coalesce($3, title),
          description = coalesce($4, description),
          status = coalesce($5, status),
          priority = coalesce($6, priority),
          issue_type = coalesce($7, issue_type),
          discipline = coalesce($8, discipline),
          assigned_to = coalesce($9, assigned_to),
          due_date = case when $13::boolean then $10 else due_date end,
          metadata = coalesce($11::jsonb, metadata),
          updated_at = $12
        where id = $1
          and project_code = $2
          and deleted_at is null
        returning *
      `,
      [
        input.id,
        projectCode,
        input.title ?? null,
        input.description ?? null,
        input.status ?? null,
        input.priority ?? null,
        input.issueType ?? null,
        input.discipline ?? null,
        input.assignedTo ?? null,
        input.dueDate === undefined ? null : input.dueDate || null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        now,
        Object.prototype.hasOwnProperty.call(input, "dueDate")
      ]
    );

    const row = result.rows[0];
    return row ? mapIssueRow(row) : null;
  }

  const issues = readJsonIssues();
  const issueIndex = issues.findIndex(
    (issue) => issue.id === input.id && normalizeProjectCode(issue.projectCode) === projectCode
  );

  if (issueIndex < 0) return null;

  const currentIssue = issues[issueIndex];
  const updatedIssue: CanonicalIssue = {
    ...currentIssue,
    title: input.title ?? currentIssue.title,
    description: input.description ?? currentIssue.description,
    status: input.status ?? currentIssue.status,
    priority: input.priority ?? currentIssue.priority,
    issueType: input.issueType ?? currentIssue.issueType,
    discipline: input.discipline ?? currentIssue.discipline,
    assignedTo: input.assignedTo ?? currentIssue.assignedTo,
    dueDate: input.dueDate === undefined ? currentIssue.dueDate : input.dueDate || undefined,
    metadata: input.metadata ?? currentIssue.metadata,
    updatedAt: now
  };

  issues[issueIndex] = updatedIssue;
  writeJsonIssues(issues);
  return updatedIssue;
}

export async function deleteIssue(input: {
  id: string;
  projectCode: string;
}): Promise<boolean> {
  const projectCode = normalizeProjectCode(input.projectCode);

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        update cde_issues
        set deleted_at = now(), updated_at = now()
        where id = $1 and project_code = $2 and deleted_at is null
      `,
      [input.id, projectCode]
    );

    return (result.rowCount ?? 0) > 0;
  }

  const issues = readJsonIssues();
  const nextIssues = issues.filter(
    (issue) =>
      !(issue.id === input.id && normalizeProjectCode(issue.projectCode) === projectCode)
  );

  if (nextIssues.length === issues.length) return false;

  writeJsonIssues(nextIssues);
  return true;
}

export async function upsertIssueFromDocumentAnnotation(
  annotation: DocumentAnnotation
): Promise<CanonicalIssue | null> {
  if (annotation.kind !== "issue_marker") return null;

  const metadata = annotation.metadata ?? {};
  const now = annotation.updatedAt || new Date().toISOString();

  return persistIssue({
    id: crypto.randomUUID(),
    projectCode: annotation.projectCode,
    title: issueTitleFromDocumentAnnotation(annotation),
    description: cleanText(metadata.description) ?? cleanText(annotation.text),
    sourceKind: "document",
    sourceSystem: "document_annotation",
    sourceId: annotation.id,
    issueType: cleanText(metadata.issueType) ?? "coordination",
    status: normalizeStatus(annotation.status),
    priority: cleanText(metadata.priority) ?? "medium",
    discipline: cleanText(metadata.discipline),
    author: cleanText(annotation.author),
    assignedTo: cleanText(metadata.assignedTo),
    dueDate: cleanText(metadata.dueDate),
    documentPath: annotation.documentPath,
    documentName: documentNameFromPath(annotation.documentPath),
    documentVersionId: annotation.documentVersionId ?? null,
    pageNumber: annotation.pageNumber,
    snapshotUrl: cleanText(metadata.snapshotDataUrl),
    location: {
      pageNumber: annotation.pageNumber,
      geometry: annotation.geometry,
      location: metadata.location,
      locationDetails: metadata.locationDetails
    },
    metadata: metadata as Record<string, unknown>,
    elementCount: 0,
    openProjectSyncStatus: "not_synced",
    createdAt: annotation.createdAt,
    updatedAt: now
  });
}

export async function upsertIssueFromBcfTopic(topic: BcfTopic): Promise<CanonicalIssue | null> {
  if (!topic.projectCode) return null;

  const sourceKind: CanonicalIssueSourceKind =
    topic.source?.kind === "document" ? "document" : "model";
  const elementCount =
    topic.linkedSelection?.reduce(
      (count, selection) => count + selection.expressIds.length,
      0
    ) ?? 0;

  return persistIssue({
    id: crypto.randomUUID(),
    projectCode: topic.projectCode,
    title: topic.title,
    description: topic.description,
    sourceKind,
    sourceSystem: "bcf_topic",
    sourceId: topic.id,
    issueType: topic.issueType ?? "coordination",
    status: normalizeStatus(topic.status),
    priority: topic.priority ?? "medium",
    discipline: topic.discipline,
    author: topic.author,
    assignedTo: topic.assignedTo,
    dueDate: topic.dueDate,
    documentPath: topic.source?.documentPaths?.[0],
    documentName: topic.source?.documentNames?.[0],
    snapshotUrl: topic.snapshot ?? undefined,
    viewpointId: topic.viewpointId,
    nativeViewpointGuid: topic.nativeViewpointGuid,
    location: {
      clippingPlanes: topic.clippingPlanes,
      linkedSelection: topic.linkedSelection
    },
    metadata: {
      source: topic.source,
      comments: topic.comments,
      attachments: topic.attachments,
      annotations: topic.annotations,
      measurements: topic.measurements
    },
    elementCount,
    openProjectProjectRef: topic.openProject?.projectId,
    openProjectWorkPackageId:
      topic.openProject?.workPackageId === undefined
        ? undefined
        : String(topic.openProject.workPackageId),
    openProjectSyncStatus: topic.openProject?.syncStatus ?? "not_synced",
    openProjectLastError: topic.openProject?.lastError,
    createdAt: topic.creationDate,
    updatedAt: topic.modifiedDate
  });
}

export async function deleteIssueBySource(input: {
  projectCode: string;
  sourceSystem: string;
  sourceId: string;
}): Promise<void> {
  const projectCode = normalizeProjectCode(input.projectCode);

  if (isDatabaseEnabled()) {
    await getDatabasePool().query(
      `
        update cde_issues
        set deleted_at = now(), updated_at = now()
        where project_code = $1
          and source_system = $2
          and source_id = $3
          and deleted_at is null
      `,
      [projectCode, input.sourceSystem, input.sourceId]
    );
    return;
  }

  const issues = readJsonIssues().filter(
    (issue) =>
      !(
        normalizeProjectCode(issue.projectCode) === projectCode &&
        issue.sourceSystem === input.sourceSystem &&
        issue.sourceId === input.sourceId
      )
  );
  writeJsonIssues(issues);
}
