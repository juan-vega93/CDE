type OpenProjectPrincipal = {
  id: number;
  name: string;
  email?: string;
  login?: string;
  firstName?: string;
  lastName?: string;
  status?: string;
  _type: string;
};

type OpenProjectMembershipElement = {
  id: number;
  _type: string;
  _links?: {
    principal?: {
      href?: string;
      title?: string;
    };
    roles?: Array<{
      href?: string;
      title?: string;
    }>;
  };
};

type OpenProjectRoleElement = {
  id: number;
  name: string;
  _type?: string;
};

type EnsureOpenProjectMemberInput = {
  email: string;
  firstName: string;
  lastName: string;
  login: string;
  password: string;
  roleName: string;
  projectId?: number;
};

type ResolvedOpenProjectRole = {
  id: number;
  name: string;
  fallbackUsed: boolean;
};

type OpenProjectMemberSyncResult = {
  synced: boolean;
  createdUser?: boolean;
  reason?: string;
  roleId?: number;
  roleName?: string;
  fallbackUsed?: boolean;
};

function getAuthHeader(apiKey: string) {
  return `Basic ${Buffer.from(`apikey:${apiKey}`).toString("base64")}`;
}

function normalizeRoleName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function getEnvNumber(name: string): number | null {
  const rawValue = process.env[name]?.trim();

  if (!rawValue) return null;

  const value = Number(rawValue);

  if (!Number.isFinite(value)) {
    throw new Error(`La variable de entorno ${name} debe ser numerica`);
  }

  return value;
}

function getRoleEnvKeys(roleName: string): { id: string; name: string } {
  const normalizedRoleName = roleName.trim().toLowerCase();

  const envKeyByRole: Record<string, { id: string; name: string }> = {
    viewer: {
      id: "OPENPROJECT_ROLE_VIEWER_ID",
      name: "OPENPROJECT_ROLE_VIEWER_NAME"
    },
    "doc-controller": {
      id: "OPENPROJECT_ROLE_DOC_CONTROLLER_ID",
      name: "OPENPROJECT_ROLE_DOC_CONTROLLER_NAME"
    },
    "discipline-lead": {
      id: "OPENPROJECT_ROLE_DISCIPLINE_LEAD_ID",
      name: "OPENPROJECT_ROLE_DISCIPLINE_LEAD_NAME"
    },
    "bim-coordinator": {
      id: "OPENPROJECT_ROLE_BIM_COORDINATOR_ID",
      name: "OPENPROJECT_ROLE_BIM_COORDINATOR_NAME"
    },
    "bim-manager": {
      id: "OPENPROJECT_ROLE_BIM_MANAGER_ID",
      name: "OPENPROJECT_ROLE_BIM_MANAGER_NAME"
    }
  };

  const envKeys = envKeyByRole[normalizedRoleName];

  if (!envKeys) {
    throw new Error(
      `No hay mapeo de rol OpenProject para '${roleName}'. Roles validos: ${Object.keys(
        envKeyByRole
      ).join(", ")}`
    );
  }

  return envKeys;
}

function getRoleErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isUnassignableRoleError(error: unknown): boolean {
  const message = getRoleErrorMessage(error).toLowerCase();

  return (
    message.includes("unassignable role") ||
    message.includes("roles has an unassignable role")
  );
}

export class OpenProjectMembersService {
  private baseUrl = process.env.OPENPROJECT_BASE_URL || "";
  private apiKey = process.env.OPENPROJECT_API_KEY || "";
  private defaultProjectId = Number(process.env.OPENPROJECT_DEFAULT_PROJECT_ID || "3");
  private rolesCache: OpenProjectRoleElement[] | null = null;

  private getHeaders(): HeadersInit {
    return {
      Authorization: getAuthHeader(this.apiKey),
      Accept: "application/json",
      "Content-Type": "application/json"
    };
  }

  private getProjectId(projectId?: number): number {
    return projectId || this.defaultProjectId;
  }

  private async listRoles(): Promise<OpenProjectRoleElement[]> {
    if (this.rolesCache) {
      return this.rolesCache;
    }

    const response = await fetch(`${this.baseUrl}/api/v3/roles?pageSize=200`, {
      method: "GET",
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo listar roles de OpenProject: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as {
      _embedded?: {
        elements?: OpenProjectRoleElement[];
      };
    };

    this.rolesCache = data._embedded?.elements ?? [];
    return this.rolesCache;
  }

  private async findRoleByName(roleName: string): Promise<OpenProjectRoleElement | null> {
    const normalizedTarget = normalizeRoleName(roleName);
    const roles = await this.listRoles();

    return (
      roles.find((role) => normalizeRoleName(role.name) === normalizedTarget) ??
      null
    );
  }

  private async resolveConfiguredRole(roleName: string): Promise<ResolvedOpenProjectRole> {
    const envKeys = getRoleEnvKeys(roleName);
    const configuredRoleName = process.env[envKeys.name]?.trim();

    if (configuredRoleName) {
      const role = await this.findRoleByName(configuredRoleName);

      if (!role) {
        throw new Error(
          `No existe rol OpenProject '${configuredRoleName}' configurado en ${envKeys.name}`
        );
      }

      return {
        id: role.id,
        name: role.name,
        fallbackUsed: false
      };
    }

    const configuredRoleId = getEnvNumber(envKeys.id);

    if (configuredRoleId) {
      return {
        id: configuredRoleId,
        name: roleName,
        fallbackUsed: false
      };
    }

    return this.resolveFallbackRole();
  }

  private async resolveFallbackRole(): Promise<ResolvedOpenProjectRole> {
    const fallbackRoleName =
      process.env.OPENPROJECT_FALLBACK_MEMBER_ROLE_NAME?.trim() || "Member";
    const fallbackRole = await this.findRoleByName(fallbackRoleName);

    if (!fallbackRole) {
      throw new Error(`No existe rol fallback OpenProject '${fallbackRoleName}'`);
    }

    return {
      id: fallbackRole.id,
      name: fallbackRole.name,
      fallbackUsed: true
    };
  }

  async findUserByEmail(email: string): Promise<OpenProjectPrincipal | null> {
    const normalizedEmail = email.trim().toLowerCase();

    const response = await fetch(`${this.baseUrl}/api/v3/users?pageSize=200`, {
      method: "GET",
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo listar usuarios de OpenProject: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as {
      _embedded?: {
        elements?: OpenProjectPrincipal[];
      };
    };

    const users = data._embedded?.elements ?? [];

    return (
      users.find((user) => {
        const userEmail = (user.email || "").trim().toLowerCase();
        const userLogin = (user.login || "").trim().toLowerCase();
        const userName = (user.name || "").trim().toLowerCase();

        return (
          userEmail === normalizedEmail ||
          userLogin === normalizedEmail ||
          userName.includes(normalizedEmail)
        );
      }) ?? null
    );
  }

  async createUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    login: string;
    password: string;
  }): Promise<OpenProjectPrincipal> {
    const response = await fetch(`${this.baseUrl}/api/v3/users`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        firstName: params.firstName,
        lastName: params.lastName,
        email: params.email,
        login: params.login,
        password: params.password,
        status: "active"
      })
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `No se pudo crear usuario en OpenProject: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    return JSON.parse(text) as OpenProjectPrincipal;
  }

  async ensureUser(params: {
    email: string;
    firstName: string;
    lastName: string;
    login: string;
    password: string;
  }): Promise<OpenProjectPrincipal> {
    const existingUser = await this.findUserByEmail(params.email);

    if (existingUser) {
      return existingUser;
    }

    return this.createUser(params);
  }

  async listProjectMemberships(projectId?: number): Promise<OpenProjectMembershipElement[]> {
    const resolvedProjectId = this.getProjectId(projectId);

    const filters = [
      {
        project: {
          operator: "=",
          values: [String(resolvedProjectId)]
        }
      }
    ];

    const response = await fetch(
      `${this.baseUrl}/api/v3/memberships?filters=${encodeURIComponent(
        JSON.stringify(filters)
      )}`,
      {
        method: "GET",
        headers: this.getHeaders()
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo listar memberships de OpenProject: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    const data = (await response.json()) as {
      _embedded?: {
        elements?: OpenProjectMembershipElement[];
      };
    };

    return data._embedded?.elements ?? [];
  }

  async findProjectMembershipByUserId(
    userId: number,
    projectId?: number
  ): Promise<OpenProjectMembershipElement | null> {
    const memberships = await this.listProjectMemberships(projectId);

    return (
      memberships.find((membership) => {
        const principalHref = membership._links?.principal?.href || "";
        return principalHref.endsWith(`/users/${userId}`);
      }) ?? null
    );
  }

  async createProjectMembership(
    userId: number,
    role: ResolvedOpenProjectRole,
    projectId?: number
  ): Promise<void> {
    const resolvedProjectId = this.getProjectId(projectId);

    const response = await fetch(`${this.baseUrl}/api/v3/memberships`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify({
        _links: {
          principal: {
            href: `/api/v3/users/${userId}`
          },
          project: {
            href: `/api/v3/projects/${resolvedProjectId}`
          },
          roles: [
            {
              href: `/api/v3/roles/${role.id}`
            }
          ]
        }
      })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo crear membership en OpenProject: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }
  }

  async updateProjectMembership(
    membershipId: number,
    userId: number,
    role: ResolvedOpenProjectRole
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v3/memberships/${membershipId}`,
      {
        method: "PATCH",
        headers: this.getHeaders(),
        body: JSON.stringify({
          _links: {
            principal: {
              href: `/api/v3/users/${userId}`
            },
            roles: [
              {
                href: `/api/v3/roles/${role.id}`
              }
            ]
          }
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo actualizar membership en OpenProject: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }
  }

  async deleteProjectMembership(membershipId: number): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v3/memberships/${membershipId}`,
      {
        method: "DELETE",
        headers: this.getHeaders()
      }
    );

    if (!response.ok && response.status !== 204) {
      const text = await response.text();
      throw new Error(
        `No se pudo eliminar membership en OpenProject: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }
  }

  async removeProjectMemberByEmail(params: {
    email: string;
    projectId?: number;
  }): Promise<{
    synced: boolean;
    removed: boolean;
    membershipId?: number;
    userId?: number;
    reason?: string;
  }> {
    const user = await this.findUserByEmail(params.email);

    if (!user) {
      return {
        synced: true,
        removed: false,
        reason: "El usuario no existe en OpenProject"
      };
    }

    const membership = await this.findProjectMembershipByUserId(
      user.id,
      params.projectId
    );

    if (!membership) {
      return {
        synced: true,
        removed: false,
        userId: user.id,
        reason: "El usuario no era miembro del proyecto en OpenProject"
      };
    }

    await this.deleteProjectMembership(membership.id);

    return {
      synced: true,
      removed: true,
      membershipId: membership.id,
      userId: user.id
    };
  }

  async ensureProjectMember(
    input: EnsureOpenProjectMemberInput
  ): Promise<OpenProjectMemberSyncResult> {
    const user = await this.ensureUser({
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      login: input.login,
      password: input.password
    });

    const preferredRole = await this.resolveConfiguredRole(input.roleName);
    const existingMembership = await this.findProjectMembershipByUserId(
      user.id,
      input.projectId
    );

    const applyRole = async (role: ResolvedOpenProjectRole) => {
      if (!existingMembership) {
        await this.createProjectMembership(user.id, role, input.projectId);
        return {
          synced: true,
          createdUser: true,
          roleId: role.id,
          roleName: role.name,
          fallbackUsed: role.fallbackUsed
        };
      }

      await this.updateProjectMembership(existingMembership.id, user.id, role);

      return {
        synced: true,
        createdUser: false,
        roleId: role.id,
        roleName: role.name,
        fallbackUsed: role.fallbackUsed
      };
    };

    try {
      return await applyRole(preferredRole);
    } catch (error) {
      if (preferredRole.fallbackUsed || !isUnassignableRoleError(error)) {
        throw error;
      }

      const fallbackRole = await this.resolveFallbackRole();

      console.warn("[OpenProjectMembersService] Using fallback role", {
        requestedRoleName: input.roleName,
        requestedOpenProjectRole: preferredRole.name,
        fallbackRoleName: fallbackRole.name,
        reason: getRoleErrorMessage(error)
      });

      return applyRole(fallbackRole);
    }
  }
}
