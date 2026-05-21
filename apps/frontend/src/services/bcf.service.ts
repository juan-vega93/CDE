import type { BcfTopic } from "@/features/viewer-ifc/types/bcf-topic";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

function normalizeProjectCode(projectCode?: string) {
  return projectCode?.trim().toUpperCase() || "";
}

export async function getBcfTopics(projectCode?: string): Promise<BcfTopic[]> {
  const normalizedProjectCode = normalizeProjectCode(projectCode);

  const query = normalizedProjectCode
    ? `?projectCode=${encodeURIComponent(normalizedProjectCode)}`
    : "";

  const response = await fetch(`${BFF_URL}/api/bcf/topics${query}`, {
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error("No se pudieron cargar los topics BCF");
  }

  const result = await response.json();

  return Array.isArray(result.data) ? result.data : [];
}

export async function saveBcfTopics(
  topics: BcfTopic[],
  projectCode?: string
): Promise<void> {
  const normalizedProjectCode = normalizeProjectCode(projectCode);

  if (!normalizedProjectCode) {
    throw new Error("projectCode es obligatorio para guardar topics BCF");
  }

  const response = await fetch(
    `${BFF_URL}/api/bcf/topics?projectCode=${encodeURIComponent(
      normalizedProjectCode
    )}`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        topics.map((topic) => ({
          ...topic,
          projectCode: normalizedProjectCode
        }))
      )
    }
  );

  if (!response.ok) {
    throw new Error("No se pudieron guardar los topics BCF");
  }
}