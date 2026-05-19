import fs from "node:fs/promises";
import path from "node:path";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";
import {
  NEXTCLOUD_PERMISSIONS,
  NextcloudProvisioningService
} from "./nextcloud-provisioning.service";
import { KeycloakAdminService } from "./keycloak-admin.service";
import {
  PORTAL_ROLE_MAPPING,
  buildProjectRoleGroupName
} from "../config/role-mapping.config";
import type {
  CreateProjectCardFromPortalInput,
  CreateProjectCardInput,
  DeleteProjectCardInput,
  ProjectCard,
  UpdateProjectCardInput
} from "../types/project-card.types";
import { OpenProjectProjectsService } from "./openproject-projects.service";

type NextcloudShareRule = {
  relativePath: string;
  roleSuffix: string;
  permissions: number;
};

const NEXTCLOUD_PROJECT_SHARE_RULES: NextcloudShareRule[] = [
  // Control total sobre raíz del proyecto
  {
    relativePath: "",
    roleSuffix: "BIM_MANAGER",
    permissions: NEXTCLOUD_PERMISSIONS.FULL
  },

  // Coordinación y control documental
  {
    relativePath: "",
    roleSuffix: "BIM_COORDINATOR",
    permissions: NEXTCLOUD_PERMISSIONS.READ_WRITE
  },
  {
    relativePath: "",
    roleSuffix: "DOC_CONTROLLER",
    permissions: NEXTCLOUD_PERMISSIONS.READ_WRITE
  },

  // Líder de disciplina: escritura en WIP y lectura en coordinación/publicación
  {
    relativePath: "03-WIP",
    roleSuffix: "DISCIPLINE_LEAD",
    permissions: NEXTCLOUD_PERMISSIONS.READ_WRITE
  },
  {
    relativePath: "04-SHARED",
    roleSuffix: "DISCIPLINE_LEAD",
    permissions: NEXTCLOUD_PERMISSIONS.READ
  },
  {
    relativePath: "05-PUBLISHED",
    roleSuffix: "DISCIPLINE_LEAD",
    permissions: NEXTCLOUD_PERMISSIONS.READ
  },

  // Viewer: solo lectura en información compartida/publicada
  {
    relativePath: "04-SHARED",
    roleSuffix: "VIEWER",
    permissions: NEXTCLOUD_PERMISSIONS.READ
  },
  {
    relativePath: "05-PUBLISHED",
    roleSuffix: "VIEWER",
    permissions: NEXTCLOUD_PERMISSIONS.READ
  }
];
const DATA_DIR = path.resolve(process.cwd(), "data");
const PROJECT_CARDS_FILE = path.join(DATA_DIR, "project-cards.json");

function normalizeProjectCode(code: string): string {
  const normalized = code.trim().toUpperCase();

  if (!normalized) {
    throw new Error("El código del proyecto es obligatorio");
  }

  return normalized;
}

function createId(): string {
  return `project_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

async function ensureDataFile(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(PROJECT_CARDS_FILE);
  } catch {
    await fs.writeFile(PROJECT_CARDS_FILE, "[]", "utf-8");
  }
}

export class ProjectCardsService {
    
  private nextcloudAdapter = new NextcloudAdapter();
  private nextcloudProvisioningService = new NextcloudProvisioningService();
  private keycloakAdminService = new KeycloakAdminService();
  private openProjectProjectsService = new OpenProjectProjectsService();

  async getAll(): Promise<ProjectCard[]> {
    await ensureDataFile();

    const raw = await fs.readFile(PROJECT_CARDS_FILE, "utf-8");
    return JSON.parse(raw) as ProjectCard[];
  }
  async archiveProjectCard(code: string): Promise<ProjectCard> {
    const normalizedCode = normalizeProjectCode(code);
    const projectCards = await this.getAll();

    const index = projectCards.findIndex(
      (projectCard) => projectCard.code.toUpperCase() === normalizedCode
    );

    if (index < 0) {
      throw new Error(`No existe Project Card para '${normalizedCode}'`);
    }

    const now = new Date().toISOString();

    const updatedProjectCard: ProjectCard = {
      ...projectCards[index],
      status: "closed",
      updatedAt: now
    };

    projectCards[index] = updatedProjectCard;

    await this.saveAll(projectCards);

    return updatedProjectCard;
  }

  async updateProjectCard(
    code: string,
    input: UpdateProjectCardInput
  ): Promise<ProjectCard> {
    const normalizedCode = normalizeProjectCode(code);
    const projectCards = await this.getAll();

    const index = projectCards.findIndex(
      (projectCard) => projectCard.code.toUpperCase() === normalizedCode
    );

    if (index < 0) {
      throw new Error(`No existe Project Card para '${normalizedCode}'`);
    }

    const existing = projectCards[index];
    const now = new Date().toISOString();

    const updatedProjectCard: ProjectCard = {
      ...existing,
      name: input.name?.trim() || existing.name,
      description:
        input.description !== undefined
          ? input.description.trim()
          : existing.description,
      status: input.status ?? existing.status,
      startDate:
        input.startDate !== undefined ? input.startDate : existing.startDate,
      endDate: input.endDate !== undefined ? input.endDate : existing.endDate,
      budget:
        input.budget !== undefined ? Number(input.budget) : existing.budget,
      currency: input.currency ?? existing.currency,
      coverImageUrl:
        input.coverImageUrl !== undefined
          ? input.coverImageUrl
          : existing.coverImageUrl,
      updatedAt: now
    };

    projectCards[index] = updatedProjectCard;

    await this.saveAll(projectCards);

    return updatedProjectCard;
  }

  async saveAll(projectCards: ProjectCard[]): Promise<void> {
    await ensureDataFile();

    await fs.writeFile(
      PROJECT_CARDS_FILE,
      JSON.stringify(projectCards, null, 2),
      "utf-8"
    );
  }

  async getByCode(code: string): Promise<ProjectCard | null> {
    const normalizedCode = normalizeProjectCode(code);
    const projectCards = await this.getAll();

    return (
      projectCards.find(
        (projectCard) => projectCard.code.toUpperCase() === normalizedCode
      ) ?? null
    );
  }

  async requireByCode(code: string): Promise<ProjectCard> {
    const projectCard = await this.getByCode(code);

    if (!projectCard) {
      throw new Error(
        `No existe Project Card para '${code}'. Crea primero la tarjeta del proyecto.`
      );
    }

    return projectCard;
  }

  async createOrUpdate(input: CreateProjectCardInput): Promise<ProjectCard> {
    const now = new Date().toISOString();
    const code = normalizeProjectCode(input.code);

    if (!input.name?.trim()) {
      throw new Error("El nombre del proyecto es obligatorio");
    }

    if (!Number.isFinite(input.openProject.projectId)) {
      throw new Error("openProject.projectId debe ser numérico");
    }

    const projectCards = await this.getAll();
    const existingIndex = projectCards.findIndex(
      (projectCard) => projectCard.code.toUpperCase() === code
    );

    const existing = existingIndex >= 0 ? projectCards[existingIndex] : null;

    const projectCard: ProjectCard = {
      id: existing?.id ?? createId(),
      code,
      name: input.name.trim(),
      description: input.description?.trim() || existing?.description,
      status: existing?.status ?? "planning",
      startDate: existing?.startDate,
      endDate: existing?.endDate,
      estimatedProgress: existing?.estimatedProgress ?? 0,
      budget: existing?.budget ?? 0,
      currency: existing?.currency ?? "PEN",
      coverImageUrl: existing?.coverImageUrl,

      keycloak: {
        groupPrefix: code
      },

      nextcloud: {
        status: "enabled",
        rootPath:
          input.nextcloud?.rootPath?.trim() ||
          existing?.nextcloud.rootPath ||
          "/",
        projectFolder:
          input.nextcloud?.projectFolder?.trim() ||
          existing?.nextcloud.projectFolder ||
          code
      },

      openProject: {
        status: "enabled",
        projectId: input.openProject.projectId,
        identifier:
          input.openProject.identifier?.trim() ||
          existing?.openProject.identifier,
        name:
          input.openProject.name?.trim() ||
          existing?.openProject.name ||
          input.name.trim(),
        defaultTypeId:
          input.openProject.defaultTypeId ??
          existing?.openProject.defaultTypeId
      },

      createdAt: existing?.createdAt ?? now,
      updatedAt: now
    };

    if (existingIndex >= 0) {
      projectCards[existingIndex] = projectCard;
    } else {
      projectCards.push(projectCard);
    }

    await this.saveAll(projectCards);

    return projectCard;
  }

  async createFromPortal(
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
    const code = input.code.trim().toUpperCase();

    if (!code) {
      throw new Error("El código del proyecto es obligatorio");
    }

    if (!input.name?.trim()) {
      throw new Error("El nombre del proyecto es obligatorio");
    }

    const openProjectResult =
      await this.openProjectProjectsService.createOrGetProject({
        code,
        name: input.name.trim(),
        description: input.description
      });

    const now = new Date().toISOString();

    const projectCard = await this.createOrUpdate({
      code,
      name: input.name.trim(),
      description: input.description,
      nextcloud: {
        rootPath: "/",
        projectFolder: code
      },
      openProject: {
        projectId: openProjectResult.project.id,
        identifier: openProjectResult.project.identifier,
        name: openProjectResult.project.name
      }
    });

    const projectCards = await this.getAll();
    const index = projectCards.findIndex(
      (item) => item.code.toUpperCase() === code
    );

    if (index >= 0) {
      projectCards[index] = {
        ...projectCards[index],
        status: input.status ?? projectCards[index].status ?? "planning",
        startDate: input.startDate,
        endDate: input.endDate,
        estimatedProgress: 0,
        budget: Number(input.budget ?? 0),
        currency: input.currency ?? "PEN",
        coverImageUrl: input.coverImageUrl,
        updatedAt: now
      };

      await this.saveAll(projectCards);
    }

    const updatedProjectCard = await this.requireByCode(code);

    void this.provisionProjectInfrastructure(code).catch((error) => {
      console.error(
        `[project-cards.service] Error provisionando proyecto ${code} en segundo plano:`,
        error
      );
    });

    return {
      projectCard: updatedProjectCard,
      openProject: {
        created: openProjectResult.created,
        projectId: openProjectResult.project.id,
        identifier: openProjectResult.project.identifier,
        name: openProjectResult.project.name
      }
    };
  }

  async provisionProjectInfrastructure(code: string): Promise<{
    projectCard: ProjectCard;
    keycloak: {
        synced: boolean;
        createdOrEnsuredGroups: string[];
        skipped: boolean;
        reason?: string;
    };
    nextcloud: {
        synced: boolean;
        createdOrEnsuredFolders: string[];
        createdOrEnsuredGroups: string[];
        createdOrEnsuredShares: Array<{
            path: string;
            groupName: string;
            permissions: number;
            created: boolean;
            updated: boolean;
        }>;
        skipped: boolean;
        reason?: string;
    };
    }> {
    const projectCard = await this.requireByCode(code);

    const createdOrEnsuredFolders: string[] = [];
    const nextcloudCreatedOrEnsuredGroups: string[] = [];
    const keycloakCreatedOrEnsuredGroups: string[] = [];

    if (projectCard.nextcloud.status !== "enabled") {
        return {
            projectCard,
            keycloak: {
            synced: false,
            createdOrEnsuredGroups: keycloakCreatedOrEnsuredGroups,
            skipped: true,
            reason: "Provisionamiento omitido porque Nextcloud está deshabilitado en esta Project Card"
            },
            nextcloud: {
            synced: false,
            createdOrEnsuredFolders,
            createdOrEnsuredGroups: nextcloudCreatedOrEnsuredGroups,
            createdOrEnsuredShares: [],
            skipped: true,
            reason: "Nextcloud está deshabilitado para esta Project Card"
            }
        };
    }

    const rootPath =
        projectCard.nextcloud.rootPath === "/"
        ? ""
        : projectCard.nextcloud.rootPath.replace(/\/$/, "");

    const projectFolder = projectCard.nextcloud.projectFolder.replace(/^\/|\/$/g, "");

    const projectRootPath = `${rootPath}/${projectFolder}` || `/${projectFolder}`;

    const foldersToEnsure = [
        projectRootPath,        
        `${projectRootPath}/01-DATA`,
        `${projectRootPath}/02-PLAN`,
        `${projectRootPath}/03-WIP`,
        `${projectRootPath}/04-SHARED`,
        `${projectRootPath}/05-PUBLISHED`,
        `${projectRootPath}/06-ARCHIVED`
    ].map((folderPath) => folderPath.replace(/\/+/g, "/"));

    for (const folderPath of foldersToEnsure) {
        await this.nextcloudAdapter.ensureFolderExists(folderPath);
        createdOrEnsuredFolders.push(folderPath);
    }
    for (const roleKey of Object.keys(PORTAL_ROLE_MAPPING)) {
        const groupName = buildProjectRoleGroupName(
            projectCard.keycloak.groupPrefix,
            roleKey as keyof typeof PORTAL_ROLE_MAPPING
        );

        await this.keycloakAdminService.ensureGroup(groupName);
        keycloakCreatedOrEnsuredGroups.push(groupName);

        await this.nextcloudProvisioningService.ensureGroup(groupName);
        nextcloudCreatedOrEnsuredGroups.push(groupName);
        }
        const createdOrEnsuredShares: Array<{
            path: string;
            groupName: string;
            permissions: number;
            created: boolean;
            updated: boolean;
            }> = [];

            for (const rule of NEXTCLOUD_PROJECT_SHARE_RULES) {
            const portalPath = rule.relativePath
                ? `${projectRootPath}/${rule.relativePath}`.replace(/\/+/g, "/")
                : projectRootPath;

            const groupName = `${projectCard.keycloak.groupPrefix}_${rule.roleSuffix}`;

            const shareResult = await this.nextcloudProvisioningService.shareFolderWithGroup({
                portalPath,
                groupName,
                permissions: rule.permissions
            });

            createdOrEnsuredShares.push({
                path: shareResult.path,
                groupName: shareResult.groupName,
                permissions: shareResult.permissions,
                created: shareResult.created,
                updated: shareResult.updated
            });
        }

        return {
            projectCard,
            keycloak: {
                synced: true,
                createdOrEnsuredGroups: keycloakCreatedOrEnsuredGroups,
                skipped: false
            },
            nextcloud: {
                synced: true,
                createdOrEnsuredFolders,
                createdOrEnsuredGroups: nextcloudCreatedOrEnsuredGroups,
                createdOrEnsuredShares,
                skipped: false
            }
        };
  }
  async hardDeleteProjectCard(
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
    if (process.env.ENABLE_PROJECT_HARD_DELETE !== "true") {
      throw new Error(
        "La eliminación definitiva está deshabilitada en la configuración del BFF"
      );
    }

    const normalizedCode = normalizeProjectCode(code);
    const projectCards = await this.getAll();

    const index = projectCards.findIndex(
      (projectCard) => projectCard.code.toUpperCase() === normalizedCode
    );

    if (index < 0) {
      throw new Error(`No existe Project Card para '${normalizedCode}'`);
    }

    const projectCard = projectCards[index];

    const expectedConfirmation = projectCard.name.trim();
    const receivedConfirmation = input.confirmationName?.trim();

    if (receivedConfirmation !== expectedConfirmation) {
      throw new Error(
        `Confirmación inválida. Debes escribir exactamente el nombre del proyecto: ${expectedConfirmation}`
      );
    }

    const deletedResources = {
      nextcloudFolder: undefined as string | undefined,
      openProjectProjectId: undefined as number | undefined,
      keycloakGroups: [] as string[],
      nextcloudGroups: [] as string[]
    };

    const rootPath =
      projectCard.nextcloud.rootPath === "/"
        ? ""
        : projectCard.nextcloud.rootPath.replace(/\/$/, "");

    const projectFolder = projectCard.nextcloud.projectFolder.replace(
      /^\/|\/$/g,
      ""
    );

    const projectRootPath = `${rootPath}/${projectFolder}`.replace(/\/+/g, "/");

    await this.nextcloudAdapter.deletePath(projectRootPath);
    deletedResources.nextcloudFolder = projectRootPath;

    if (projectCard.openProject?.projectId) {
      await this.openProjectProjectsService.deleteProject(
        projectCard.openProject.projectId
      );

      deletedResources.openProjectProjectId = projectCard.openProject.projectId;
    }

    const roleKeys = Object.keys(PORTAL_ROLE_MAPPING) as Array<
      keyof typeof PORTAL_ROLE_MAPPING
    >;

    for (const roleKey of roleKeys) {
      const groupName = buildProjectRoleGroupName(
        projectCard.keycloak.groupPrefix,
        roleKey
      );

      await this.keycloakAdminService.deleteGroupByName(groupName);
      deletedResources.keycloakGroups.push(groupName);

      await this.nextcloudProvisioningService.deleteGroup(groupName);
      deletedResources.nextcloudGroups.push(groupName);
    }

    projectCards.splice(index, 1);
    await this.saveAll(projectCards);

    return {
      deleted: true,
      projectCode: normalizedCode,
      deletedResources
    };
  }
}