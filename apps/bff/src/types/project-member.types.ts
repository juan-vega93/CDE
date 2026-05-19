import type { PortalRoleKey } from "../config/role-mapping.config";

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