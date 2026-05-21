export type WorkflowStatus =
  | "Nuevo"
  | "Asignado"
  | "En progreso"
  | "En revisión"
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
  workflowStatus: WorkflowStatus | null;
  uiStatus: DocumentUiStatus;
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
export type FolderItem = {
  name: string;
  path: string;
  type: "folder";
};

export type FoldersApiResponse = {
  success: boolean;
  data: {
    path: string;
    items: FolderItem[];
  };
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
      workflowStatus: WorkflowStatus | null;
      uiStatus: DocumentUiStatus;
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