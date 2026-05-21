export type BcfTopicStatus =
  | "open"
  | "in_progress"
  | "resolved"
  | "closed";

export type BcfTopicPriority =
  | "low"
  | "medium"
  | "high"
  | "critical";

export type BcfTopicComment = {
  id: string;
  author?: string;
  date: string;
  comment: string;
};
export type BcfTopicAttachment = {
  id: string;
  name: string;
  type: string;
  size: number;
  dataUrl: string;
  createdAt: string;
};
export type BcfTopicAnnotation = {
  id: string;
  type: "pin3d" | "text3d" | "revisionCloud";
  text: string;
  color: string;
  position?: [number, number, number];
  points?: [number, number, number][];
  createdAt: string;
  author?: string;
};

export type BcfTopicMeasurement = {
  id: string;
  type: "distance";
  points: [[number, number, number], [number, number, number]];
  value: number;
  unit: "m";
  createdAt: string;
  author?: string;
};

export type BcfTopicOpenProjectInfo = {
  projectId?: string;
  topicGuid?: string;
  workPackageId?: number | string;
  href?: string;
  lastSyncedAt?: string;
  lastSyncedHash?: string;
  syncStatus?: "not_synced" | "synced" | "pending_push" | "pending_pull" | "conflict" | "error";
  lastError?: string;
};

export type BcfTopic = {
  id: string;
  projectCode?: string;
  title: string;
  description?: string;
  status: BcfTopicStatus;
  priority: BcfTopicPriority;
  author?: string;
  assignedTo?: string;
  creationDate: string;
  modifiedDate: string;
  viewpointId?: string;  
  snapshot?: string | null;
  nativeViewpointGuid?: string;
  clippingPlanes?: {
    normal: [number, number, number];
    origin: [number, number, number];
  }[];
  comments: BcfTopicComment[];
  attachments: BcfTopicAttachment[];
  annotations: BcfTopicAnnotation[];
  measurements: BcfTopicMeasurement[];
  openProject?: BcfTopicOpenProjectInfo;
};
