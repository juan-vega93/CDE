type KeycloakTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
};

type KeycloakUser = {
  id: string;
  username: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

type KeycloakGroup = {
  id: string;
  name: string;
};

type CreateUserInput = {
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  enabled?: boolean;
  password?: string;
};

export class KeycloakAdminService {
  private baseUrl = process.env.KEYCLOAK_BASE_URL || "";
  private realm = process.env.KEYCLOAK_REALM || "";
  private adminRealm = process.env.KEYCLOAK_ADMIN_REALM || "master";
  private adminClientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID || "admin-cli";
  private adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME || "";
  private adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD || "";

  private async getAdminAccessToken(): Promise<string> {
    const url = `${this.baseUrl}/realms/${this.adminRealm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: "password",
      client_id: this.adminClientId,
      username: this.adminUsername,
      password: this.adminPassword
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const data = (await response.json()) as Partial<KeycloakTokenResponse>;

    if (!response.ok || !data.access_token) {
      throw new Error(
        `No se pudo obtener token admin de Keycloak: ${response.status} ${response.statusText}`
      );
    }

    return data.access_token;
  }

  private async getAuthHeaders(): Promise<HeadersInit> {
    const token = await this.getAdminAccessToken();

    return {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    };
  }

  async findUserByEmail(email: string): Promise<KeycloakUser | null> {
    const headers = await this.getAuthHeaders();
    const url = `${this.baseUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(
      email
    )}`;

    const response = await fetch(url, {
      method: "GET",
      headers
    });

    if (!response.ok) {
      throw new Error(`Error buscando usuario en Keycloak: ${response.status}`);
    }

    const users = (await response.json()) as KeycloakUser[];
    return users[0] ?? null;
  }

  async createUser(input: CreateUserInput): Promise<KeycloakUser> {
    const headers = await this.getAuthHeaders();

    const createResponse = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          username: input.username,
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          enabled: input.enabled ?? true,
          emailVerified: true
        })
      }
    );

    if (!createResponse.ok) {
      const text = await createResponse.text();
      throw new Error(
        `No se pudo crear usuario en Keycloak: ${createResponse.status} ${createResponse.statusText} - ${text.slice(0, 500)}`
      );
    }

    const createdUser = await this.findUserByEmail(input.email);

    if (!createdUser) {
      throw new Error("Usuario creado pero no se pudo recuperar desde Keycloak");
    }

    if (input.password) {
      await this.setUserPassword(createdUser.id, input.password);
    }

    return createdUser;
  }

  async ensureUser(input: CreateUserInput): Promise<KeycloakUser> {
    const existingUser = await this.findUserByEmail(input.email);

    if (existingUser) {
      return existingUser;
    }

    return this.createUser(input);
  }

  async setUserPassword(userId: string, password: string): Promise<void> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/reset-password`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          type: "password",
          value: password,
          temporary: false
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo asignar password en Keycloak: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }
  }

  async findGroupByName(groupName: string): Promise<KeycloakGroup | null> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/groups?search=${encodeURIComponent(
        groupName
      )}`,
      {
        method: "GET",
        headers
      }
    );

    if (!response.ok) {
      throw new Error(`Error buscando grupo en Keycloak: ${response.status}`);
    }

    const groups = (await response.json()) as KeycloakGroup[];
    return groups.find((group) => group.name === groupName) ?? null;
  }

  async createGroup(groupName: string): Promise<KeycloakGroup> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/groups`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: groupName
        })
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo crear grupo en Keycloak: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    const createdGroup = await this.findGroupByName(groupName);

    if (!createdGroup) {
      throw new Error("Grupo creado pero no se pudo recuperar desde Keycloak");
    }

    return createdGroup;
  }

  async ensureGroup(groupName: string): Promise<KeycloakGroup> {
    const existingGroup = await this.findGroupByName(groupName);

    if (existingGroup) {
      return existingGroup;
    }

    return this.createGroup(groupName);
  }

  async addUserToGroup(userId: string, groupId: string): Promise<void> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/groups/${groupId}`,
      {
        method: "PUT",
        headers
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo agregar usuario a grupo en Keycloak: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }
  }

  async findRealmRoleByName(roleName: string): Promise<{ id: string; name: string } | null> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/roles/${encodeURIComponent(roleName)}`,
      {
        method: "GET",
        headers
      }
    );

    if (response.status === 404) {
      return null;
    }

    if (!response.ok) {
      throw new Error(`Error buscando rol en Keycloak: ${response.status}`);
    }

    return (await response.json()) as { id: string; name: string };
  }

  async assignRealmRoleToUser(userId: string, roleName: string): Promise<void> {
    const headers = await this.getAuthHeaders();
    const role = await this.findRealmRoleByName(roleName);

    if (!role) {
      throw new Error(`No existe el rol '${roleName}' en Keycloak`);
    }

    const response = await fetch(
      `${this.baseUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/realm`,
      {
        method: "POST",
        headers,
        body: JSON.stringify([
          {
            id: role.id,
            name: role.name
          }
        ])
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo asignar rol al usuario en Keycloak: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }
  }
}