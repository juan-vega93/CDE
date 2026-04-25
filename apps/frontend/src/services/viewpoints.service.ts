import type { ViewerViewpoint } from "@/features/viewer-ifc/types/viewpoint";

const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL;

if (!BFF_URL) {
  throw new Error("Falta definir NEXT_PUBLIC_BFF_URL en .env.local");
}

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export async function getViewpoints(documentPath: string): Promise<ViewerViewpoint[]> {
  const res = await fetch(
    `${BFF_URL}/api/viewpoints?documentPath=${encodeURIComponent(documentPath)}`,
    {
      cache: "no-store"
    }
  );

  if (!res.ok) {
    throw new Error("No se pudieron obtener los viewpoints");
  }

  const json: ApiResponse<ViewerViewpoint[]> = await res.json();
  return json.data;
}

export async function saveViewpoints(
  documentPath: string,
  viewpoints: ViewerViewpoint[]
): Promise<void> {
  const res = await fetch(`${BFF_URL}/api/viewpoints`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      documentPath,
      viewpoints
    })
  });

  if (!res.ok) {
    throw new Error("No se pudieron guardar los viewpoints");
  }
}