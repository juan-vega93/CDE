const BFF_URL = process.env.NEXT_PUBLIC_BFF_URL || "http://localhost:4000";

export type PortalRoleKey =
  | "bim-manager"
  | "bim-coordinator"
  | "discipline-lead"
  | "doc-controller"
  | "viewer";

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

export type ProjectMemberStatus = "active" | "inactive";

export type ProjectMember = {
  id: string;
  projectCode: string;

  email: string;
  username: string;
  firstName: string;
  lastName: string;

  roleKey: PortalRoleKey;
  disciplineKey?: string;

  status: ProjectMemberStatus;

  sync: {
    keycloak?: {
      synced: boolean;
      groupName?: string;
      realmRole?: string;
      reason?: string;
    };
    nextcloud?: {
      synced: boolean;
      groupNames?: string[];
      reason?: string;
    };
    openProject?: {
      synced: boolean;
      projectId?: number;
      roleKey?: string;
      createdUser?: boolean;
      removed?: boolean;
      membershipId?: number;
      userId?: number;
      reason?: string;
    };
    cleanup?: {
      keycloakRemovedGroups: string[];
      nextcloudRemovedGroups: string[];
    };
    lastSyncedAt?: string;
  };

  createdAt: string;
  updatedAt: string;
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
export type CreateProjectMemberInput = {
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  password?: string;
  roleKey: PortalRoleKey | string;
  disciplineKey?: string;
};

export type UpdateProjectMemberInput = {
  roleKey?: PortalRoleKey | string;
  disciplineKey?: string;
  status?: ProjectMemberStatus;
};

type ApiResponse<T> = {
  success: boolean;
  data?: T;
  message?: string;
};

async function requestJson<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${BFF_URL}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const rawText = await response.text();

  let payload: ApiResponse<T>;

  try {
    payload = JSON.parse(rawText) as ApiResponse<T>;
  } catch {
    throw new Error(
      `El servidor no devolvió JSON válido. HTTP ${response.status}. Respuesta: ${rawText.slice(
        0,
        200
      )}`
    );
  }

  if (!response.ok || !payload.success) {
    throw new Error(
      payload.message || `Error HTTP ${response.status} llamando a ${path}`
    );
  }

  if (payload.data === undefined) {
    throw new Error(`La respuesta de ${path} no devolvió data`);
  }

  return payload.data;
}

export async function getProjectCards(): Promise<ProjectCard[]> {
  return requestJson<ProjectCard[]>("/api/project-cards");
}

export async function getProjectCard(code: string): Promise<ProjectCard> {
  return requestJson<ProjectCard>(
    `/api/project-cards/${encodeURIComponent(code)}`
  );
}

export async function updateProjectCard(
  code: string,
  input: UpdateProjectCardInput
): Promise<ProjectCard> {
  return requestJson<ProjectCard>(
    `/api/project-cards/${encodeURIComponent(code)}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

export async function createOrUpdateProjectCard(
  input: CreateProjectCardInput
): Promise<ProjectCard> {
  return requestJson<ProjectCard>("/api/project-cards", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
export async function archiveProjectCard(code: string): Promise<ProjectCard> {
  return requestJson<ProjectCard>(
    `/api/project-cards/${encodeURIComponent(code)}/archive`,
    {
      method: "POST"
    }
  );
}
export async function hardDeleteProjectCard(
  code: string,
  input: DeleteProjectCardInput
): Promise<{
  deleted: boolean;
  projectCode: string;
  deletedResources: {
    nextcloudFolder?: string;
    openProjectProjectId?: number;
    keycloakGroups: string[];
    nextcloudGroups: string[];
  };
}> {
  return requestJson<{
    deleted: boolean;
    projectCode: string;
    deletedResources: {
      nextcloudFolder?: string;
      openProjectProjectId?: number;
      keycloakGroups: string[];
      nextcloudGroups: string[];
    };
  }>(`/api/project-cards/${encodeURIComponent(code)}`, {
    method: "DELETE",
    body: JSON.stringify(input)
  });
}
export async function createProjectCardFromPortal(
  input: CreateProjectCardFromPortalInput
): Promise<{
  projectCard: ProjectCard;
  openProject: {
    created: boolean;
    projectId: number;
    identifier: string;
    name: string;
  };
}> {
  return requestJson<{
    projectCard: ProjectCard;
    openProject: {
      created: boolean;
      projectId: number;
      identifier: string;
      name: string;
    };
  }>("/api/project-cards/from-portal", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function provisionProjectCard(code: string): Promise<unknown> {
  return requestJson<unknown>(
    `/api/project-cards/${encodeURIComponent(code)}/provision`,
    {
      method: "POST"
    }
  );
}

export async function getProjectMembers(
  code: string,
  status: "active" | "inactive" | "all" = "active"
): Promise<ProjectMember[]> {
  return requestJson<ProjectMember[]>(
    `/api/project-cards/${encodeURIComponent(code)}/members?status=${status}`
  );
}

export async function addProjectMember(
  code: string,
  input: CreateProjectMemberInput
): Promise<ProjectMember> {
  return requestJson<ProjectMember>(
    `/api/project-cards/${encodeURIComponent(code)}/members`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function updateProjectMember(
  code: string,
  memberId: string,
  input: UpdateProjectMemberInput
): Promise<ProjectMember> {
  return requestJson<ProjectMember>(
    `/api/project-cards/${encodeURIComponent(code)}/members/${encodeURIComponent(
      memberId
    )}`,
    {
      method: "PUT",
      body: JSON.stringify(input)
    }
  );
}

export async function removeProjectMember(
  code: string,
  memberId: string
): Promise<ProjectMember> {
  return requestJson<ProjectMember>(
    `/api/project-cards/${encodeURIComponent(code)}/members/${encodeURIComponent(
      memberId
    )}`,
    {
      method: "DELETE"
    }
  );
}