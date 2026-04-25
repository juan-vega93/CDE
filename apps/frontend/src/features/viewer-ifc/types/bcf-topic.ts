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

export type BcfTopic = {
  id: string;
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
  comments: BcfTopicComment[];
  attachments: BcfTopicAttachment[];
};
