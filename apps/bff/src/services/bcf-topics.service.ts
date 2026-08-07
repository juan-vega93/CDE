import fs from "fs/promises";
import path from "path";
import { getDatabasePool, isDatabaseEnabled } from "../db/client";
import { getBffDataPath } from "../utils/data-dir";
import { deleteIssueBySource, upsertIssueFromBcfTopic } from "./issues.service";

export type BcfTopicStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed";

export type BcfTopicPriority =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type BcfTopicIssueType =
  | "coordination"
  | "clash"
  | "design"
  | "parameter"
  | "constructability"
  | "safety"
  | "other";

export type BcfTopicComment = {
  id: string;
  author?: string;
  date: string;
  comment: string;
};

export type BcfTopicAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  createdAt: string;
};

export type BcfTopicAnnotation = {
  id: string;
  type: "pin3d" | "text3d" | "revisionCloud";
  text: string;
  color: string;
  position?: [number, number, number];
  points?: [number, number, number][];
  createdAt: string;
  author?: string;
};

export type BcfTopicMeasurement = {
  id: string;
  type: "distance";
  points: [[number, number, number], [number, number, number]];
  value: number;
  unit: "m";
  createdAt: string;
  author?: string;
};

export type BcfTopicOpenProjectInfo = {
  projectId?: string;
  topicGuid?: string;
  workPackageId?: number | string;
  href?: string;
  lastSyncedAt?: string;
  lastSyncedHash?: string;
  syncStatus?: "not_synced" | "synced" | "pending_push" | "pending_pull" | "conflict" | "error";
  lastError?: string;
};

export type BcfTopicLinkedSelection = {
  modelId: string;
  expressIds: number[];
};

export type BcfTopicSourceInfo = {
  kind: "model" | "document";
  modelNames?: string[];
  documentPaths?: string[];
  documentNames?: string[];
};

export type BcfTopic = {
  id: string;
  projectCode?: string;
  title: string;
  description?: string;
  issueType?: BcfTopicIssueType;
  discipline?: string;
  dueDate?: string;
  status: BcfTopicStatus;
  priority: BcfTopicPriority;
  author?: string;
  assignedTo?: string;
  creationDate: string;
  modifiedDate: string;
  viewpointId?: string;
  snapshot?: string | null;
  nativeViewpointGuid?: string;
  clippingPlanes?: {
    normal: [number, number, number];
    origin: [number, number, number];
  }[];
  source?: BcfTopicSourceInfo;
  linkedSelection?: BcfTopicLinkedSelection[];
  comments: BcfTopicComment[];
  attachments: BcfTopicAttachment[];
  annotations?: BcfTopicAnnotation[];
  measurements?: BcfTopicMeasurement[];
  openProject?: BcfTopicOpenProjectInfo;
};

const TOPICS_FILE = getBffDataPath("bcf-topics.json");

async function ensureDataFile() {
  await fs.mkdir(path.dirname(TOPICS_FILE), { recursive: true });

  try {
    await fs.access(TOPICS_FILE);
  } catch {
    await fs.writeFile(TOPICS_FILE, "[]", "utf-8");
  }
}

function normalizeProjectCode(projectCode?: string): string {
  return projectCode?.trim().toUpperCase() || "";
}

async function readAllBcfTopics(): Promise<BcfTopic[]> {
  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        select payload
        from cde_bcf_topics
        where deleted_at is null
        order by updated_at desc
      `
    );

    return result.rows.map((row) => row.payload as BcfTopic);
  }

  await ensureDataFile();

  const raw = await fs.readFile(TOPICS_FILE, "utf-8");
  return JSON.parse(raw) as BcfTopic[];
}

async function writeAllBcfTopics(topics: BcfTopic[]): Promise<void> {
  if (isDatabaseEnabled()) {
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      await client.query("begin");
      await client.query("update cde_bcf_topics set deleted_at = now(), updated_at = now()");

      for (const topic of topics) {
        const projectCode = normalizeProjectCode(topic.projectCode);

        if (!projectCode) continue;

        await client.query(
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
            topic.id,
            projectCode,
            JSON.stringify({ ...topic, projectCode }),
            topic.creationDate,
            topic.modifiedDate
          ]
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    return;
  }

  await ensureDataFile();

  await fs.writeFile(
    TOPICS_FILE,
    JSON.stringify(topics, null, 2),
    "utf-8"
  );
}

async function syncBcfIssueSafely(topic: BcfTopic): Promise<void> {
  try {
    await upsertIssueFromBcfTopic(topic);
  } catch (error) {
    console.warn("[bcf-topics] issue sync failed:", error);
  }
}

export async function getBcfTopics(projectCode?: string): Promise<BcfTopic[]> {
  if (isDatabaseEnabled()) {
    const normalizedProjectCode = normalizeProjectCode(projectCode);

    const result = normalizedProjectCode
      ? await getDatabasePool().query(
          `
            select payload
            from cde_bcf_topics
            where project_code = $1 and deleted_at is null
            order by updated_at desc
          `,
          [normalizedProjectCode]
        )
      : await getDatabasePool().query(
          `
            select payload
            from cde_bcf_topics
            where deleted_at is null
            order by updated_at desc
          `
        );

    return result.rows.map((row) => row.payload as BcfTopic);
  }

  const allTopics = await readAllBcfTopics();
  const normalizedProjectCode = normalizeProjectCode(projectCode);

  if (!normalizedProjectCode) {
    return allTopics;
  }

  return allTopics.filter(
    (topic) =>
      normalizeProjectCode(topic.projectCode) === normalizedProjectCode
  );
}

export async function saveBcfTopics(
  topics: BcfTopic[],
  projectCode?: string
): Promise<void> {
  const normalizedProjectCode = normalizeProjectCode(projectCode);

  if (!normalizedProjectCode) {
    await writeAllBcfTopics(topics);
    return;
  }

  const topicsForProject = topics.map((topic) => ({
    ...topic,
    projectCode: normalizedProjectCode
  }));

  if (isDatabaseEnabled()) {
    const topicIds = topicsForProject.map((topic) => topic.id);
    const pool = getDatabasePool();
    const client = await pool.connect();

    try {
      await client.query("begin");

      if (topicIds.length > 0) {
        await client.query(
          `
            update cde_bcf_topics
            set deleted_at = now(), updated_at = now()
            where project_code = $1
              and deleted_at is null
              and not (id = any($2::text[]))
          `,
          [normalizedProjectCode, topicIds]
        );
      } else {
        await client.query(
          `
            update cde_bcf_topics
            set deleted_at = now(), updated_at = now()
            where project_code = $1 and deleted_at is null
          `,
          [normalizedProjectCode]
        );
      }

      for (const topic of topicsForProject) {
        await client.query(
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
            topic.id,
            normalizedProjectCode,
            JSON.stringify(topic),
            topic.creationDate,
            topic.modifiedDate
          ]
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }

    for (const topic of topicsForProject) {
      await syncBcfIssueSafely(topic);
    }

    return;
  }

  const allTopics = await readAllBcfTopics();

  const otherProjectTopics = allTopics.filter(
    (topic) =>
      normalizeProjectCode(topic.projectCode) !== normalizedProjectCode
  );

  await writeAllBcfTopics([...otherProjectTopics, ...topicsForProject]);

  for (const topic of topicsForProject) {
    await syncBcfIssueSafely(topic);
  }
}

export async function deleteBcfTopic(
  topicId: string,
  projectCode?: string
): Promise<boolean> {
  const normalizedProjectCode = normalizeProjectCode(projectCode);

  if (isDatabaseEnabled()) {
    const result = await getDatabasePool().query(
      `
        update cde_bcf_topics
        set deleted_at = now(), updated_at = now()
        where id = $1
          and ($2 = '' or project_code = $2)
          and deleted_at is null
      `,
      [topicId, normalizedProjectCode]
    );

    const deleted = (result.rowCount ?? 0) > 0;

    if (deleted && normalizedProjectCode) {
      await deleteIssueBySource({
        projectCode: normalizedProjectCode,
        sourceSystem: "bcf_topic",
        sourceId: topicId
      });
    }

    return deleted;
  }

  const allTopics = await readAllBcfTopics();

  const nextTopics = allTopics.filter((topic) => {
    if (topic.id !== topicId) return true;
    if (!normalizedProjectCode) return false;

    return normalizeProjectCode(topic.projectCode) !== normalizedProjectCode;
  });

  if (nextTopics.length === allTopics.length) {
    return false;
  }

  await writeAllBcfTopics(nextTopics);

  if (normalizedProjectCode) {
    await deleteIssueBySource({
      projectCode: normalizedProjectCode,
      sourceSystem: "bcf_topic",
      sourceId: topicId
    });
  }

  return true;
}

export async function updateBcfTopicFromIssue(input: {
  topicId: string;
  projectCode: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: string;
  issueType?: string;
  discipline?: string;
  assignedTo?: string;
  dueDate?: string;
}): Promise<BcfTopic | null> {
  const normalizedProjectCode = normalizeProjectCode(input.projectCode);
  const allTopics = await getBcfTopics(normalizedProjectCode);
  const topicIndex = allTopics.findIndex(
    (topic) =>
      topic.id === input.topicId &&
      normalizeProjectCode(topic.projectCode) === normalizedProjectCode
  );

  if (topicIndex < 0) return null;

  const currentTopic = allTopics[topicIndex];
  const status =
    input.status === "in_review"
      ? "in_progress"
      : input.status === "new"
        ? "open"
        : input.status;
  const priority =
    input.priority === "critical"
      ? "critical"
      : input.priority === "high"
        ? "high"
        : input.priority === "low"
          ? "low"
          : input.priority === "medium"
            ? "medium"
            : undefined;

  const updatedTopic: BcfTopic = {
    ...currentTopic,
    title: input.title ?? currentTopic.title,
    description: input.description ?? currentTopic.description,
    status: (status as BcfTopicStatus | undefined) ?? currentTopic.status,
    priority: priority ?? currentTopic.priority,
    issueType:
      (input.issueType as BcfTopicIssueType | undefined) ??
      currentTopic.issueType,
    discipline: input.discipline ?? currentTopic.discipline,
    assignedTo: input.assignedTo ?? currentTopic.assignedTo,
    dueDate: input.dueDate ?? currentTopic.dueDate,
    modifiedDate: new Date().toISOString()
  };

  allTopics[topicIndex] = updatedTopic;

  if (isDatabaseEnabled()) {
    await getDatabasePool().query(
      `
        update cde_bcf_topics
        set payload = $3::jsonb, updated_at = $4, deleted_at = null
        where id = $1 and project_code = $2
      `,
      [
        updatedTopic.id,
        normalizedProjectCode,
        JSON.stringify(updatedTopic),
        updatedTopic.modifiedDate
      ]
    );
  } else {
    const allStoredTopics = await readAllBcfTopics();
    const storedIndex = allStoredTopics.findIndex(
      (topic) =>
        topic.id === updatedTopic.id &&
        normalizeProjectCode(topic.projectCode) === normalizedProjectCode
    );

    if (storedIndex >= 0) {
      allStoredTopics[storedIndex] = updatedTopic;
      await writeAllBcfTopics(allStoredTopics);
    }
  }

  await syncBcfIssueSafely(updatedTopic);

  return updatedTopic;
}
