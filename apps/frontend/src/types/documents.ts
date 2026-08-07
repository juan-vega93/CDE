export type WorkflowStatus =
  | "Nuevo"
  | "Asignado"
  | "En progreso"
  | "En revision"
  | "Respondido"
  | "Resuelto"
  | "Aprobado"
  | "Rechazado"
  | "Cerrado";

export type DocumentUiStatus =
  | "pending"
  | "in_progress"
  | "in_review"
  | "approved"
  | "rejected"
  | "closed";

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
  workflowStatus: WorkflowStatus | null;
  uiStatus: DocumentUiStatus;
  bimDerivative?: BimDerivativeSummary;
};

export type BimDerivativeSummary = {
  status: "not_applicable" | "missing" | "pending" | "generated" | "failed";
  fragPath?: string | null;
  generatedAt?: string | null;
  error?: string | null;
};

export type DocumentsApiResponse = {
  success: boolean;
  data: {
    path: string;
    items: DocumentItem[];
  };
};

export type DocumentApiResponse = {
  success: boolean;
  data: DocumentItem;
  message?: string;
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

export type DocumentVersionsApiResponse = {
  success: boolean;
  data: {
    documentPath: string;
    fileId?: string | null;
    versions: DocumentVersionItem[];
  };
  message?: string;
};

export type FolderItem = {
  name: string;
  path: string;
  type: "folder";
};

export type FolderTreeNode = FolderItem & {
  children: FolderTreeNode[];
};

export type FoldersApiResponse = {
  success: boolean;
  data: {
    path: string;
    items: FolderItem[];
  };
};

export type FolderTreeApiResponse = {
  success: boolean;
  data: {
    rootPath: string;
    depth: number;
    tree: FolderTreeNode;
  };
  message?: string;
};

export type ExplorerRow =
  | {
      kind: "folder";
      name: string;
      path: string;
      type: "folder";
    }
  | {
      kind: "document";
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
      workflowStatus: WorkflowStatus | null;
      uiStatus: DocumentUiStatus;
      bimDerivative?: BimDerivativeSummary;
      workPackageLink?: WorkPackageLink | null;
    };

export type SendToReviewInput = {
  documentId: string;
  documentPath: string;
  documentName: string;
  projectId: number;
  typeId: number;
  subject: string;
  description: string;
  assigneeId?: number;
  dueDate?: string;
};

export type WorkPackageStatus =
  | "new"
  | "in_progress"
  | "in_review"
  | "approved"
  | "rejected"
  | "closed";

export type WorkPackage = {
  id: number;
  subject: string;
  description: string;
  status: WorkPackageStatus;
  assigneeId?: number;
  dueDate?: string;
  createdAt: string;
};

export type WorkPackageLinkType = "review" | "issue" | "approval";

export type WorkPackageLinkStatus = "active" | "closed" | "broken";

export type WorkPackageLink = {
  id: string;
  documentId: string;
  documentPath: string;
  documentName?: string;
  workPackageId: number;
  projectId?: number;
  typeId?: number;
  linkType?: WorkPackageLinkType;
  status: WorkPackageLinkStatus;
  workPackageStatusName?: string;
  workPackageStatusId?: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type SendToReviewResponse = {
  success: boolean;
  data: {
    workPackage: WorkPackage;
    link: WorkPackageLink;
  };
  message?: string;
};

export type WorkPackageLinkApiResponse = {
  success: boolean;
  data: WorkPackageLink;
  message?: string;
};

export type WorkPackageLinksApiResponse = {
  success: boolean;
  data: WorkPackageLink[];
  message?: string;
};

export type DocumentExplorerApiResponse = {
  success: boolean;
  data: {
    path: string;
    folders: FolderItem[];
    documents: DocumentItem[];
    workPackageLinks: WorkPackageLink[];
    folderTree?: FolderTreeNode | null;
  };
  message?: string;
};

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
  projectCode: string;
  text?: string;
  color?: string;
  metadata?: DocumentAnnotationMetadata;
  status?: DocumentAnnotation["status"];
};

export type DocumentAnnotationsApiResponse = {
  success: boolean;
  data: DocumentAnnotation[];
  message?: string;
};

export type DocumentAnnotationApiResponse = {
  success: boolean;
  data: DocumentAnnotation;
  message?: string;
};
