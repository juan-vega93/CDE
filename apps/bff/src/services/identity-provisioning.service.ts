import { KeycloakAdminService } from "./keycloak-admin.service";
import { NextcloudProvisioningService } from "./nextcloud-provisioning.service";
import { OpenProjectMembersService } from "./openproject-members.service";
import { ProjectCardsService } from "./project-cards.service";
import {
  PORTAL_ROLE_MAPPING,
  PortalRoleKey,
  buildProjectDisciplineGroupName,
  buildProjectRoleGroupName,
  normalizePortalRoleKey
} from "../config/role-mapping.config";


type ProvisionUserInput = {
  email: string;
  firstName: string;
  lastName: string;
  username: string;
  password?: string;

  /**
   * Modo legacy actual.
   * Mantener por compatibilidad con el frontend existente.
   */
  groupName?: string;
  roleName?: string;

  /**
   * Nuevo modo recomendado.
   * Todavía no depende de Project Cards.
   */
  projectCode?: string;
  roleKey?: string;
  disciplineKey?: string;
  openProjectProjectId?: number;
};

type ProvisionUserResult = {
  userId: string;
  email?: string;
  username?: string;
  roleKey: PortalRoleKey;
  keycloak: {
    userSynced: boolean;
    groupName: string;
    realmRole: string;
  };
  nextcloud: {
    synced: boolean;
    groupNames: string[];
    reason?: string;
  };
  openProject: {
    synced: boolean;
    projectId?: number;
    roleKey: string;
    createdUser?: boolean;
    reason?: string;
  };
};

function getRequiredProvisionPassword(inputPassword?: string): string {
  const password = inputPassword || process.env.DEFAULT_PROVISIONING_PASSWORD;

  if (!password) {
    throw new Error(
      "No se recibió password y falta DEFAULT_PROVISIONING_PASSWORD en el .env del BFF"
    );
  }

  return password;
}

function buildDisplayName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();
}

export class IdentityProvisioningService {
  private keycloakAdminService = new KeycloakAdminService();
  private nextcloudProvisioningService = new NextcloudProvisioningService();
  private openProjectMembersService = new OpenProjectMembersService();
  private projectCardsService = new ProjectCardsService();

  async provisionUser(input: ProvisionUserInput): Promise<ProvisionUserResult> {
    const email = input.email.trim().toLowerCase();
    const username = input.username.trim();
    const firstName = input.firstName.trim();
    const lastName = input.lastName.trim();
    const password = getRequiredProvisionPassword(input.password);

    const roleKey = normalizePortalRoleKey(input.roleKey || input.roleName || "");
    const mapping = PORTAL_ROLE_MAPPING[roleKey];

    const projectCode = input.projectCode?.trim().toUpperCase();
    const projectCard = projectCode
      ? await this.projectCardsService.requireByCode(projectCode)
      : null;

    const resolvedOpenProjectProjectId =
      input.openProjectProjectId ?? projectCard?.openProject.projectId;

    /**
     * Compatibilidad:
     * - Si viene groupName, se usa tal como hoy.
     * - Si ya viene projectCode, se construye grupo por proyecto + rol.
     */
    const projectGroupPrefix = projectCard?.keycloak.groupPrefix || projectCode;

    const primaryGroupName =
      input.groupName?.trim() ||
      (projectGroupPrefix
        ? buildProjectRoleGroupName(projectGroupPrefix, roleKey)
        : mapping.nextcloudGroupSuffix);
    const disciplineGroupName = projectGroupPrefix
      ? buildProjectDisciplineGroupName(projectGroupPrefix, input.disciplineKey)
      : null;

    const keycloakUser = await this.keycloakAdminService.ensureUser({
      email,
      username,
      firstName,
      lastName,
      password
    });

    const keycloakGroup = await this.keycloakAdminService.ensureGroup(primaryGroupName);

    await this.keycloakAdminService.addUserToGroup(keycloakUser.id, keycloakGroup.id);
    await this.keycloakAdminService.assignRealmRoleToUser(
      keycloakUser.id,
      mapping.keycloakRealmRole
    );

    const nextcloudPrimaryGroupSync =
      await this.nextcloudProvisioningService.ensureUserInGroup({
        username,
        password,
        email,
        displayName: buildDisplayName(firstName, lastName),
        groupName: primaryGroupName
      });

    if (disciplineGroupName) {
      await this.nextcloudProvisioningService.ensureUserInGroup({
        username,
        password,
        email,
        displayName: buildDisplayName(firstName, lastName),
        groupName: disciplineGroupName
      });
    }

    const openProjectSync = await this.openProjectMembersService.ensureProjectMember({
      email,
      firstName,
      lastName,
      login: email,
      password,
      roleName: mapping.openProjectRoleKey,
      projectId: resolvedOpenProjectProjectId
    });

    return {
      userId: keycloakUser.id,
      email: keycloakUser.email || email,
      username: keycloakUser.username || username,
      roleKey,
      keycloak: {
        userSynced: true,
        groupName: primaryGroupName,
        realmRole: mapping.keycloakRealmRole
      },
      nextcloud: {
        synced: nextcloudPrimaryGroupSync.synced,
        groupNames: disciplineGroupName
          ? [primaryGroupName, disciplineGroupName]
          : [primaryGroupName],
        reason: nextcloudPrimaryGroupSync.reason
      },
      openProject: {
        synced: openProjectSync.synced,
        projectId: resolvedOpenProjectProjectId,
        roleKey: mapping.openProjectRoleKey,
        createdUser: openProjectSync.createdUser,
        reason: openProjectSync.reason
      }
    };
  }
}