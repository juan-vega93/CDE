import type { BcfTopic } from "@/features/viewer-ifc/types/bcf-topic";
type BcfTopicOpenProjectPayload = BcfTopic & {
  projectCode?: string;
  openProjectProjectId?: number;
};

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

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

  const baseUrl = process.env.NEXT_PUBLIC_BFF_URL ?? "";

  return `${baseUrl}${value.startsWith("/") ? value : `/${value}`}`;
}
export async function createWorkPackageFromBcfTopic(
  topic: BcfTopicOpenProjectPayload,
  snapshotUrl?: string | null,
  attachmentUrls?: string[]
): Promise<WorkPackageResult> {
  const payload = {
  subject: topic.title,
  description: topic.description || "",
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

  const response = await fetch(`${BFF_URL}/api/work-packages/from-bcf-topic`, {
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