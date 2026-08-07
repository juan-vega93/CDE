import type { BcfTopic } from "@/features/viewer-ifc/types/bcf-topic";
import { bffFetch, getBffUrl } from "./bff-client";
type BcfTopicOpenProjectPayload = BcfTopic & {
  projectCode?: string;
  openProjectProjectId?: number;
};

export type WorkPackageResult = {
  id: number;
  subject: string;
  description: string;
  status: string;
  createdAt: string;
  openProjectId?: number | string;
  bcfTopicId?: string;
  snapshotUrl?: string;
  attachmentUrls?: string[];
  viewpointInfo?: string;
};

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

/**
 * Crea un WorkPackage en OpenProject desde un BCF topic.
 * Envia toda la metadata: titulo, descripcion, snapshot, adjuntos, estado, prioridad.
 */
function toBffAbsoluteUrl(value?: string | null) {
  if (!value) return "";

  if (value.startsWith("http") || value.startsWith("data:")) {
    return value;
  }

  return getBffUrl(value.startsWith("/") ? value : `/${value}`);
}

function buildBimIssueDescription(topic: BcfTopicOpenProjectPayload) {
  const lines = [topic.description || ""].filter(Boolean);
  const metadata: string[] = [];

  if (topic.issueType) metadata.push(`Tipo BIM: ${topic.issueType}`);
  if (topic.discipline) metadata.push(`Disciplina: ${topic.discipline}`);
  if (topic.dueDate) metadata.push(`Fecha limite: ${topic.dueDate}`);
  if (topic.projectCode) metadata.push(`Proyecto CDE: ${topic.projectCode}`);
  if (topic.source?.modelNames?.length) {
    metadata.push(`Modelos: ${topic.source.modelNames.join(", ")}`);
  }
  if (topic.linkedSelection?.length) {
    const totalElements = topic.linkedSelection.reduce(
      (total, selection) => total + selection.expressIds.length,
      0
    );
    metadata.push(`Elementos vinculados: ${totalElements}`);
  }
  if (topic.viewpointId) metadata.push(`Viewpoint CDE: ${topic.viewpointId}`);
  if (topic.nativeViewpointGuid) metadata.push(`Viewpoint BCF: ${topic.nativeViewpointGuid}`);

  if (metadata.length) {
    lines.push(["--- Metadata BIM CDE ---", ...metadata].join("\n"));
  }

  return lines.join("\n\n") || "Creado desde el visor BIM del CDE Portal";
}

export async function createWorkPackageFromBcfTopic(
  topic: BcfTopicOpenProjectPayload,
  snapshotUrl?: string | null,
  attachmentUrls?: string[]
): Promise<WorkPackageResult> {
const payload = {
  subject: topic.title,
  description: buildBimIssueDescription(topic),
  bcfTopicId: topic.id,
  projectCode: topic.projectCode,
  openProjectProjectId: topic.openProjectProjectId,
  status: topic.status,
  priority: topic.priority,
  assignedTo: topic.assignedTo || "",
  author: topic.author || "",
  snapshotUrl: toBffAbsoluteUrl(snapshotUrl || topic.snapshot),
  attachmentUrls:
    attachmentUrls?.map((url) => toBffAbsoluteUrl(url)).filter(Boolean) ||
    topic.attachments
      ?.map((a) => toBffAbsoluteUrl(a.dataUrl))
      .filter(Boolean) ||
    [],
  viewpointInfo: topic.nativeViewpointGuid
    ? `guid:${topic.nativeViewpointGuid}`
    : undefined
};
  console.log("[WP Service] creating work package from BCF topic", {
    subject: payload.subject,
    bcfTopicId: payload.bcfTopicId,
    hasSnapshot: !!payload.snapshotUrl,
    attachmentsCount: payload.attachmentUrls?.length ?? 0,
  });

  const response = await bffFetch("/api/work-packages/from-bcf-topic", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const result: ApiResponse<WorkPackageResult> = await response.json();

  if (!result.success) {
    throw new Error(result.message ?? "Error creando WorkPackage desde BCF topic");
  }

  return result.data;
}
