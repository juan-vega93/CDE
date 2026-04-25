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

  workPackageStatusId?: number;
  workPackageStatusName?: string;
  lastSyncedAt?: string;

  createdAt: string;
  updatedAt: string;
};

export type CreateWorkPackageLinkInput = {
  documentId: string;
  documentPath: string;
  documentName: string;
  workPackageId: number;
  projectId: number;
  typeId: number;
  linkType: WorkPackageLinkType;
};