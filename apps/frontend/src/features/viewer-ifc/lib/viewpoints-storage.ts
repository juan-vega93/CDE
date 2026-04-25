import type { ViewerViewpoint } from "@/features/viewer-ifc/types/viewpoint";

function buildStorageKey(documentId?: string) {
  return `viewer-ifc:viewpoints:${documentId || "default"}`;
}

export function loadStoredViewpoints(documentId?: string): ViewerViewpoint[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(buildStorageKey(documentId));
    if (!raw) return [];

    const parsed = JSON.parse(raw) as ViewerViewpoint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("[viewer-ifc] Error loading viewpoints from localStorage:", error);
    return [];
  }
}

export function saveStoredViewpoints(
  viewpoints: ViewerViewpoint[],
  documentId?: string
) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      buildStorageKey(documentId),
      JSON.stringify(viewpoints)
    );
  } catch (error) {
    console.error("[viewer-ifc] Error saving viewpoints to localStorage:", error);
  }
}