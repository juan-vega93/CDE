import type { DocumentUiStatus, WorkflowStatus } from "./status.types";

export type DocumentItem = {
  id: string;
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: string;
  modifiedAtLocal?: string | null; // 👉 NUEVO
  uiStatus: DocumentUiStatus;
  workflowStatus: WorkflowStatus | null;
};

export type DocumentsResponse = {
  path: string;
  items: DocumentItem[];
};