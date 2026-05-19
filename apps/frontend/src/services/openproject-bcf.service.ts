import type { BcfTopic } from "@/features/viewer-ifc/types/bcf-topic";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

export type OpenProjectBcfSyncResult = {
  ok: boolean;
  openProject?: {
    projectId?: string;
    topicGuid?: string;
    href?: string;
    lastSyncedAt?: string;
    lastSyncedHash?: string;
  };
  warnings: string[];
  errors: string[];
};

export type OpenProjectProject = {
  project_id: string;
  name: string;
};

export type OpenProjectRemoteTopic = {
  guid: string;
  topic_type?: string;
  topic_status?: string;
  priority?: string;
  title: string;
  description?: string;
  creation_date?: string;
  creation_author?: string;
  modified_date?: string;
  modified_author?: string;
  assigned_to?: string;
  labels?: string[];
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export async function checkOpenProjectBcfHealth(): Promise<{
  baseUrl: string;
  mode: string;
  bcfApiReachable: boolean;
  bcfApiStatus: number | null;
}> {
  const response = await fetch(`${BFF_URL}/api/openproject-bcf/health`);
  const result: ApiResponse<{
    baseUrl: string;
    mode: string;
    bcfApiReachable: boolean;
    bcfApiStatus: number | null;
  }> = await response.json();

  if (!result.success) {
    throw new Error(result.message ?? "OpenProject BCF health check failed");
  }

  return result.data;
}

export async function getOpenProjectBcfProjects(): Promise<
  OpenProjectProject[]
> {
  const response = await fetch(`${BFF_URL}/api/openproject-bcf/projects`);
  const result: ApiResponse<OpenProjectProject[]> = await response.json();

  if (!result.success) {
    throw new Error(
      result.message ?? "No se pudieron listar proyectos OpenProject BCF"
    );
  }

  return result.data;
}

export async function getOpenProjectBcfTopics(
  projectId: string
): Promise<OpenProjectRemoteTopic[]> {
  const response = await fetch(
    `${BFF_URL}/api/openproject-bcf/projects/${encodeURIComponent(projectId)}/topics`
  );
  const result: ApiResponse<OpenProjectRemoteTopic[]> = await response.json();

  if (!result.success) {
    throw new Error(result.message ?? "No se pudieron listar topics de OpenProject");
  }

  return result.data;
}

export async function pushTopicToOpenProject(
  projectId: string,
  topic: BcfTopic
): Promise<OpenProjectBcfSyncResult> {
  console.log("[OP Sync] pushing topic", {
    customId: topic.id,
    title: topic.title,
    projectId
  });

  const response = await fetch(`${BFF_URL}/api/openproject-bcf/topics/push`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, topic })
  });

  const result: ApiResponse<OpenProjectBcfSyncResult> = await response.json();

  console.log("[OP Sync] push result", result);

  if (!result.success) {
    throw new Error(result.message ?? "Error enviando topic a OpenProject");
  }

  return result.data;
}

export async function pullTopicFromOpenProject(
  projectId: string,
  topicGuid: string
): Promise<OpenProjectBcfSyncResult> {
  console.log("[OP Sync] pulling topic", { projectId, topicGuid });

  const response = await fetch(`${BFF_URL}/api/openproject-bcf/topics/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, topicGuid })
  });

  const result: ApiResponse<OpenProjectBcfSyncResult> = await response.json();

  console.log("[OP Sync] pull result", result);

  if (!result.success) {
    throw new Error(result.message ?? "Error trayendo topic de OpenProject");
  }

  return result.data;
}

export async function syncTopicWithOpenProject(
  projectId: string,
  topic: BcfTopic,
  direction: "push" | "pull" | "both" = "push"
): Promise<OpenProjectBcfSyncResult> {
  console.log("[OP Sync] syncing topic", {
    customId: topic.id,
    title: topic.title,
    projectId,
    direction
  });

  const response = await fetch(`${BFF_URL}/api/openproject-bcf/topics/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, topic, direction })
  });

  const result: ApiResponse<OpenProjectBcfSyncResult> = await response.json();

  console.log("[OP Sync] sync result", result);

  if (!result.success) {
    throw new Error(result.message ?? "Error sincronizando topic con OpenProject");
  }

  return result.data;
}