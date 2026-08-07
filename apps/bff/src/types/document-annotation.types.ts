export type DocumentAnnotationKind =
  | "comment"
  | "issue_marker"
  | "revision_cloud"
  | "rectangle"
  | "highlight"
  | "arrow"
  | "measurement";

export type DocumentAnnotationGeometry = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  value?: number;
  unit?: string;
  points?: { x: number; y: number }[];
};

export type DocumentAnnotationMetadata = {
  title?: string;
  description?: string;
  assignedTo?: string;
  dueDate?: string;
  issueType?: string;
  priority?: string;
  discipline?: string;
  location?: string;
  locationDetails?: string;
  snapshotDataUrl?: string;
  comments?: DocumentAnnotationComment[];
};

export type DocumentAnnotationComment = {
  id: string;
  author?: string;
  text: string;
  createdAt: string;
};

export type DocumentAnnotation = {
  id: string;
  projectCode: string;
  documentPath: string;
  documentVersionId?: string | null;
  pageNumber: number;
  kind: DocumentAnnotationKind;
  text?: string;
  color: string;
  geometry: DocumentAnnotationGeometry;
  metadata?: DocumentAnnotationMetadata;
  status: "open" | "resolved" | "closed";
  author?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateDocumentAnnotationInput = {
  projectCode: string;
  documentPath: string;
  documentVersionId?: string | null;
  pageNumber: number;
  kind: DocumentAnnotationKind;
  text?: string;
  color?: string;
  geometry: DocumentAnnotationGeometry;
  metadata?: DocumentAnnotationMetadata;
  author?: string;
};

export type UpdateDocumentAnnotationInput = {
  id: string;
  projectCode: string;
  text?: string;
  color?: string;
  metadata?: DocumentAnnotationMetadata;
  status?: DocumentAnnotation["status"];
};
