export type WorkPackageStatus = "new" | "in_review" | "approved" | "rejected" | "closed";

export type WorkPackage = {
  id: number;
  subject: string;
  description: string;
  status: WorkPackageStatus;
  assigneeId?: number;
  dueDate?: string;
  createdAt: string;
};

export type CreateWorkPackageInput = {
  subject: string;
  description: string;
  assigneeId?: number;
  dueDate?: string;
};