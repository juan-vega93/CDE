import fs from "node:fs/promises";
import path from "node:path";
import { IdentityProvisioningService } from "./identity-provisioning.service";
import { ProjectCardsService } from "./project-cards.service";
import {
  PORTAL_ROLE_MAPPING,
  buildProjectRoleGroupName,
  normalizePortalRoleKey,
  type PortalRoleKey
} from "../config/role-mapping.config";
import type {
  CreateProjectMemberInput,
  ProjectMember,
  UpdateProjectMemberInput
} from "../types/project-member.types";
import { KeycloakAdminService } from "./keycloak-admin.service";
import { NextcloudProvisioningService } from "./nextcloud-provisioning.service";
import { OpenProjectMembersService } from "./openproject-members.service";

const DATA_DIR = path.resolve(process.cwd(), "data");
const PROJECT_MEMBERS_FILE = path.join(DATA_DIR, "project-members.json");

function createId(): string {
  return `member_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function normalizeProjectCode(code: string): string {
  const normalized = code.trim().toUpperCase();

  if (!normalized) {
    throw new Error("El código del proyecto es obligatorio");
  }

  return normalized;
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(PROJECT_MEMBERS_FILE);
  } catch {
    await fs.writeFile(PROJECT_MEMBERS_FILE, "[]", "utf-8");
  }
}

export class ProjectMembersService {
  private identityProvisioningService = new IdentityProvisioningService();
  private projectCardsService = new ProjectCardsService();
  private keycloakAdminService = new KeycloakAdminService();
  private nextcloudProvisioningService = new NextcloudProvisioningService();
  private openProjectMembersService = new OpenProjectMembersService();

  async getAll(): Promise<ProjectMember[]> {
    await ensureDataFile();

    const raw = await fs.readFile(PROJECT_MEMBERS_FILE, "utf-8");
    return JSON.parse(raw) as ProjectMember[];
  }

  async saveAll(projectMembers: ProjectMember[]): Promise<void> {
    await ensureDataFile();

    await fs.writeFile(
      PROJECT_MEMBERS_FILE,
      JSON.stringify(projectMembers, null, 2),
      "utf-8"
    );
  }

  async getByProjectCode(projectCode: string): Promise<ProjectMember[]> {
    const normalizedProjectCode = normalizeProjectCode(projectCode);
    const projectMembers = await this.getAll();

    return projectMembers.filter(
      (member) => member.projectCode.toUpperCase() === normalizedProjectCode
    );
  }

  async addOrUpdateProjectMember(
    projectCode: string,
    input: CreateProjectMemberInput
  ): Promise<ProjectMember> {
    const normalizedProjectCode = normalizeProjectCode(projectCode);

    const projectCard = await this.projectCardsService.requireByCode(
      normalizedProjectCode
    );

    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const roleKey: PortalRoleKey = normalizePortalRoleKey(String(input.roleKey));
    const disciplineKey = input.disciplineKey?.trim().toUpperCase();

    if (!email || !username || !firstName || !lastName) {
      throw new Error("email, username, firstName y lastName son obligatorios");
    }

    const provisionResult =
      await this.identityProvisioningService.provisionUser({
        email,
        username,
        firstName,
        lastName,
        password: input.password,
        roleKey,
        projectCode: normalizedProjectCode,
        disciplineKey
      });

    const now = new Date().toISOString();

    const projectMembers = await this.getAll();

    const existingIndex = projectMembers.findIndex(
      (member) =>
        member.projectCode.toUpperCase() === normalizedProjectCode &&
        member.email.toLowerCase() === email
    );

    const existing = existingIndex >= 0 ? projectMembers[existingIndex] : null;

    const projectMember: ProjectMember = {
      id: existing?.id ?? createId(),
      projectCode: normalizedProjectCode,

      email,
      username,
      firstName,
      lastName,

      roleKey,
      disciplineKey,

      status: "active",

      sync: {
        keycloak: {
          synced: provisionResult.keycloak.userSynced,
          groupName: provisionResult.keycloak.groupName,
          realmRole: provisionResult.keycloak.realmRole
        },
        nextcloud: {
          synced: provisionResult.nextcloud.synced,
          groupNames: provisionResult.nextcloud.groupNames,
          reason: provisionResult.nextcloud.reason
        },
        openProject: {
          synced: provisionResult.openProject.synced,
          projectId: provisionResult.openProject.projectId,
          roleKey: provisionResult.openProject.roleKey,
          createdUser: provisionResult.openProject.createdUser,
          reason: provisionResult.openProject.reason
        },
        lastSyncedAt: now
      },

      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      projectMembers[existingIndex] = projectMember;
    } else {
      projectMembers.push(projectMember);
    }

    await this.saveAll(projectMembers);

    return projectMember;
  }
  private async cleanupProjectRoleGroups(params: {
    projectCode: string;
    email: string;
    username: string;
    keepRoleKey: PortalRoleKey;
  }): Promise<{
    keycloakRemovedGroups: string[];
    nextcloudRemovedGroups: string[];
  }> {
    const keycloakRemovedGroups: string[] = [];
    const nextcloudRemovedGroups: string[] = [];

    const roleKeys = Object.keys(PORTAL_ROLE_MAPPING) as PortalRoleKey[];

    const groupsToRemove = roleKeys
      .filter((roleKey) => roleKey !== params.keepRoleKey)
      .map((roleKey) => buildProjectRoleGroupName(params.projectCode, roleKey));

    const keycloakUser = await this.keycloakAdminService.findUserByEmail(
      params.email
    );

    for (const groupName of groupsToRemove) {
      if (keycloakUser) {
        await this.keycloakAdminService.removeUserFromGroupByName(
          keycloakUser.id,
          groupName
        );
        keycloakRemovedGroups.push(groupName);
      }

      await this.nextcloudProvisioningService.removeUserFromGroup(
        params.username,
        groupName
      );
      nextcloudRemovedGroups.push(groupName);
    }

    return {
      keycloakRemovedGroups,
      nextcloudRemovedGroups
    };
  }
  private async removeMemberFromProjectGroups(params: {
    projectCode: string;
    email: string;
    username: string;
    disciplineKey?: string;
  }): Promise<{
    keycloakRemovedGroups: string[];
    nextcloudRemovedGroups: string[];
  }> {
    const keycloakRemovedGroups: string[] = [];
    const nextcloudRemovedGroups: string[] = [];

    const roleKeys = Object.keys(PORTAL_ROLE_MAPPING) as PortalRoleKey[];

    const groupsToRemove = roleKeys.map((roleKey) =>
      buildProjectRoleGroupName(params.projectCode, roleKey)
    );

    if (params.disciplineKey?.trim()) {
      groupsToRemove.push(
        `${params.projectCode}_${params.disciplineKey.trim().toUpperCase()}`
      );
    }

    const keycloakUser = await this.keycloakAdminService.findUserByEmail(
      params.email
    );

    for (const groupName of groupsToRemove) {
      if (keycloakUser) {
        await this.keycloakAdminService.removeUserFromGroupByName(
          keycloakUser.id,
          groupName
        );
        keycloakRemovedGroups.push(groupName);
      }

      await this.nextcloudProvisioningService.removeUserFromGroup(
        params.username,
        groupName
      );
      nextcloudRemovedGroups.push(groupName);
    }

    return {
      keycloakRemovedGroups,
      nextcloudRemovedGroups
    };
  }
  async updateProjectMember(
    projectCode: string,
    memberId: string,
    input: UpdateProjectMemberInput
    ): Promise<ProjectMember> {
    const normalizedProjectCode = normalizeProjectCode(projectCode);

    await this.projectCardsService.requireByCode(normalizedProjectCode);

    const projectMembers = await this.getAll();

    const existingIndex = projectMembers.findIndex(
        (member) =>
        member.projectCode.toUpperCase() === normalizedProjectCode &&
        member.id === memberId
    );

    if (existingIndex < 0) {
        throw new Error(
        `No existe el miembro '${memberId}' en el proyecto '${normalizedProjectCode}'`
        );
    }

    const existing = projectMembers[existingIndex];

    const nextRoleKey: PortalRoleKey = input.roleKey
        ? normalizePortalRoleKey(String(input.roleKey))
        : existing.roleKey;

    const nextDisciplineKey =
        input.disciplineKey !== undefined
        ? input.disciplineKey.trim().toUpperCase()
        : existing.disciplineKey;

    const nextStatus = input.status ?? existing.status;

    if (nextStatus !== "active") {
        const now = new Date().toISOString();

        const updatedMember: ProjectMember = {
        ...existing,
        roleKey: nextRoleKey,
        disciplineKey: nextDisciplineKey,
        status: nextStatus,
        updatedAt: now
        };

        projectMembers[existingIndex] = updatedMember;
        await this.saveAll(projectMembers);

        return updatedMember;
    }

    const provisionResult =
        await this.identityProvisioningService.provisionUser({
        email: existing.email,
        username: existing.username,
        firstName: existing.firstName,
        lastName: existing.lastName,
        roleKey: nextRoleKey,
        projectCode: normalizedProjectCode,
        disciplineKey: nextDisciplineKey
        });

    const cleanupResult = await this.cleanupProjectRoleGroups({
      projectCode: normalizedProjectCode,
      email: existing.email,
      username: existing.username,
      keepRoleKey: nextRoleKey
    });
      
    const now = new Date().toISOString();

    const updatedMember: ProjectMember = {
        ...existing,
        roleKey: nextRoleKey,
        disciplineKey: nextDisciplineKey,
        status: nextStatus,
        sync: {
        keycloak: {
            synced: provisionResult.keycloak.userSynced,
            groupName: provisionResult.keycloak.groupName,
            realmRole: provisionResult.keycloak.realmRole
        },
        nextcloud: {
            synced: provisionResult.nextcloud.synced,
            groupNames: provisionResult.nextcloud.groupNames,
            reason: provisionResult.nextcloud.reason
        },
        openProject: {
            synced: provisionResult.openProject.synced,
            projectId: provisionResult.openProject.projectId,
            roleKey: provisionResult.openProject.roleKey,
            createdUser: provisionResult.openProject.createdUser,
            reason: provisionResult.openProject.reason
        },
        cleanup: cleanupResult,
        lastSyncedAt: now
        },
        updatedAt: now
    };

    projectMembers[existingIndex] = updatedMember;

    await this.saveAll(projectMembers);

    return updatedMember;
  }
  async removeProjectMember(
    projectCode: string,
    memberId: string
  ): Promise<ProjectMember> {
    const normalizedProjectCode = normalizeProjectCode(projectCode);

    const projectCard = await this.projectCardsService.requireByCode(
      normalizedProjectCode
    );

    const projectMembers = await this.getAll();

    const existingIndex = projectMembers.findIndex(
      (member) =>
        member.projectCode.toUpperCase() === normalizedProjectCode &&
        member.id === memberId
    );

    if (existingIndex < 0) {
      throw new Error(
        `No existe el miembro '${memberId}' en el proyecto '${normalizedProjectCode}'`
      );
    }

    const existing = projectMembers[existingIndex];

    const cleanupResult = await this.removeMemberFromProjectGroups({
      projectCode: normalizedProjectCode,
      email: existing.email,
      username: existing.username,
      disciplineKey: existing.disciplineKey
    });
    const openProjectRemovalResult =
      await this.openProjectMembersService.removeProjectMemberByEmail({
        email: existing.email,
        projectId: projectCard.openProject.projectId
      });

    const now = new Date().toISOString();

    const updatedMember: ProjectMember = {
      ...existing,
      status: "inactive",
      sync: {
        ...existing.sync,
        cleanup: cleanupResult,
        openProject: {
          synced: openProjectRemovalResult.synced,
          projectId: projectCard.openProject.projectId,
          removed: openProjectRemovalResult.removed,
          membershipId: openProjectRemovalResult.membershipId,
          userId: openProjectRemovalResult.userId,
          reason: openProjectRemovalResult.reason
        },
        lastSyncedAt: now
      },
      updatedAt: now
    };
    projectMembers[existingIndex] = updatedMember;

    await this.saveAll(projectMembers);

    return updatedMember;
  }
}