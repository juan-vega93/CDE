import type { DocumentUiStatus, WorkflowStatus } from "./status.types";

export type BimDerivativeSummary = {
  status: "not_applicable" | "missing" | "pending" | "generated" | "failed";
  fragPath?: string | null;
  generatedAt?: string | null;
  error?: string | null;
};

export type DocumentItem = {
  id: string;
  name: string;
  path: string;
  extension: string;
  size: number;
  modifiedAt: string;
  modifiedAtLocal?: string | null;
  etag?: string | null;
  fileId?: string | null;
  contentType?: string | null;
  uiStatus: DocumentUiStatus;
  workflowStatus: WorkflowStatus | null;
  bimDerivative?: BimDerivativeSummary;
};

export type DocumentsResponse = {
  path: string;
  items: DocumentItem[];
};

export type DocumentVersionItem = {
  id: string;
  label: string;
  fileId?: string | null;
  size?: number;
  modifiedAt?: string | null;
  modifiedAtLocal?: string | null;
  isCurrent: boolean;
};

export type DocumentVersionsResponse = {
  documentPath: string;
  fileId?: string | null;
  versions: DocumentVersionItem[];
};
