import type { BcfTopic } from "@/features/viewer-ifc/types/bcf-topic";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

export async function getBcfTopics(): Promise<BcfTopic[]> {
  const response = await fetch(`${BFF_URL}/api/bcf/topics`);

  if (!response.ok) {
    throw new Error("No se pudieron cargar los topics BCF");
  }

  const result = await response.json();

  return Array.isArray(result.data) ? result.data : [];
}

export async function saveBcfTopics(topics: BcfTopic[]): Promise<void> {
  const response = await fetch(`${BFF_URL}/api/bcf/topics`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(topics)
  });

  if (!response.ok) {
    throw new Error("No se pudieron guardar los topics BCF");
  }
}