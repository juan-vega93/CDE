export type WorkPackageStatus = "new" | "in_review" | "approved" | "rejected" | "closed";

export type WorkPackage = {
  id: number;
  subject: string;
  description: string;
  status: WorkPackageStatus;
  assigneeId?: number;
  dueDate?: string;
  createdAt: string;
  openProjectId?: number;
  bcfTopicId?: string;
  snapshotUrl?: string;
  attachmentUrls?: string[];
  viewpointInfo?: string;
};

export type CreateWorkPackageInput = {
  subject: string;
  description: string;
  assigneeId?: number;
  dueDate?: string;
  /** ID del topic BCF local asociado (opcional) */
  bcfTopicId?: string;
  /** URL del snapshot/imagen del topic */
  snapshotUrl?: string;
  /** URLs de adjuntos del topic */
  attachmentUrls?: string[];
  /** Informacion de viewpoint (camara, clipping planes, etc) */
  viewpointInfo?: string;
  /** Estado del BCF topic (open, in_progress, resolved, closed) */
  status?: string;
  /** Prioridad del BCF topic */
  priority?: string;
  /** Persona asignada */
  assignedTo?: string;
  /** Autor del topic */
  author?: string;
};