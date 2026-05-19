export type ProjectConnectorStatus = "enabled" | "disabled";

export type ProjectStatus = "planning" | "active" | "paused" | "closed";

export type ProjectCard = {
  id: string;
  code: string;
  name: string;
  description?: string;

  status: ProjectStatus;
  startDate?: string;
  endDate?: string;
  estimatedProgress: number;
  budget: number;
  currency: "PEN" | "USD" | "EUR";
  coverImageUrl?: string;
  keycloak: {
    groupPrefix: string;
  };

  nextcloud: {
    status: ProjectConnectorStatus;
    rootPath: string;
    projectFolder: string;
  };

  openProject: {
    status: ProjectConnectorStatus;
    projectId: number;
    identifier?: string;
    name?: string;
    defaultTypeId?: number;
  };

  createdAt: string;
  updatedAt: string;
};

export type CreateProjectCardInput = {
  code: string;
  name: string;
  description?: string;

  nextcloud?: {
    rootPath?: string;
    projectFolder?: string;
  };

  openProject: {
    projectId: number;
    identifier?: string;
    name?: string;
    defaultTypeId?: number;
  };
  
};

export type CreateProjectCardFromPortalInput = {
  code: string;
  name: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: string;
  endDate?: string;
  budget?: number;
  currency?: "PEN" | "USD" | "EUR";
  coverImageUrl?: string;
};

export type UpdateProjectCardInput = {
  name?: string;
  description?: string;
  status?: ProjectStatus;
  startDate?: string;
  endDate?: string;
  budget?: number;
  currency?: "PEN" | "USD" | "EUR";
  coverImageUrl?: string;
};

export type DeleteProjectCardInput = {
  confirmationName: string;
};