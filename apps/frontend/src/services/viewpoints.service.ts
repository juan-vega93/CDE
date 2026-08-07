import type { ViewerViewpoint } from "@/features/viewer-ifc/types/viewpoint";
import { bffFetch } from "./bff-client";

type ApiResponse<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export async function getViewpoints(documentPath: string): Promise<ViewerViewpoint[]> {
  const res = await bffFetch(
    `/api/viewpoints?documentPath=${encodeURIComponent(documentPath)}`
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
  const res = await bffFetch("/api/viewpoints", {
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
