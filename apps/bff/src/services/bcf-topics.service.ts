import fs from "fs/promises";
import path from "path";

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

export type BcfTopic = {
  id: string;
  projectCode?: string;
  title: string;
  description?: string;
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
  comments: BcfTopicComment[];
  attachments: BcfTopicAttachment[];
  annotations?: BcfTopicAnnotation[];
  measurements?: BcfTopicMeasurement[];
  openProject?: BcfTopicOpenProjectInfo;
};

const DATA_DIR = path.join(process.cwd(), "data");
const TOPICS_FILE = path.join(DATA_DIR, "bcf-topics.json");

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

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
  await ensureDataFile();

  const raw = await fs.readFile(TOPICS_FILE, "utf-8");
  return JSON.parse(raw) as BcfTopic[];
}

async function writeAllBcfTopics(topics: BcfTopic[]): Promise<void> {
  await ensureDataFile();

  await fs.writeFile(
    TOPICS_FILE,
    JSON.stringify(topics, null, 2),
    "utf-8"
  );
}

export async function getBcfTopics(projectCode?: string): Promise<BcfTopic[]> {
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

  const allTopics = await readAllBcfTopics();

  const otherProjectTopics = allTopics.filter(
    (topic) =>
      normalizeProjectCode(topic.projectCode) !== normalizedProjectCode
  );

  const topicsForProject = topics.map((topic) => ({
    ...topic,
    projectCode: normalizedProjectCode
  }));

  await writeAllBcfTopics([...otherProjectTopics, ...topicsForProject]);
}