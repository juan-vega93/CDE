type NextcloudUserElement = {
  id: string;
};

type NextcloudUsersResponse = {
  ocs?: {
    meta?: {
      status?: string;
      statuscode?: number;
      message?: string;
    };
    data?: {
      users?: string[];
    };
  };
};

type NextcloudGroupsResponse = {
  ocs?: {
    meta?: {
      status?: string;
      statuscode?: number;
      message?: string;
    };
    data?: {
      groups?: string[];
    };
  };
};

export class NextcloudProvisioningService {
  private baseUrl = process.env.NEXTCLOUD_BASE_URL || "";
  private adminUsername = process.env.NEXTCLOUD_ADMIN_USERNAME || "";
  private adminPassword = process.env.NEXTCLOUD_ADMIN_PASSWORD || "";

  private getHeaders(): HeadersInit {
    return {
      Authorization: `Basic ${Buffer.from(
        `${this.adminUsername}:${this.adminPassword}`
      ).toString("base64")}`,
      "OCS-APIRequest": "true",
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    };
  }

  private async parseJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T;
  }

  async findUser(username: string): Promise<boolean> {
    const response = await fetch(
        `${this.baseUrl}/ocs/v1.php/cloud/users/${encodeURIComponent(username)}?format=json`,
        {
        method: "GET",
        headers: this.getHeaders()
        }
    );

    const rawText = await response.text();

    let data:
        | {
            ocs?: {
            meta?: {
                status?: string;
                statuscode?: number;
                message?: string;
            };
            };
        }
        | null = null;

    try {
        data = JSON.parse(rawText) as {
        ocs?: {
            meta?: {
            status?: string;
            statuscode?: number;
            message?: string;
            };
        };
        };
    } catch {
        data = null;
    }

    const success = data?.ocs?.meta?.status === "ok";
    return response.ok && success;
  }

  async createUser(params: {
    username: string;
    password: string;
    email: string;
    displayName: string;
    }): Promise<void> {
    const body = new URLSearchParams({
        userid: params.username,
        password: params.password,
        email: params.email,
        displayName: params.displayName
    });

    const response = await fetch(
        `${this.baseUrl}/ocs/v1.php/cloud/users?format=json`,
        {
        method: "POST",
        headers: this.getHeaders(),
        body
        }
    );

    const rawText = await response.text();

    let data:
        | {
            ocs?: {
            meta?: {
                status?: string;
                statuscode?: number;
                message?: string;
            };
            };
        }
        | null = null;

    try {
        data = JSON.parse(rawText) as {
        ocs?: {
            meta?: {
            status?: string;
            statuscode?: number;
            message?: string;
            };
        };
        };
    } catch {
        data = null;
    }

    const statusCode = data?.ocs?.meta?.statuscode;
    const success = data?.ocs?.meta?.status === "ok";

    if (!response.ok || (!success && statusCode !== 102)) {
        throw new Error(
        `No se pudo crear usuario en Nextcloud: ${response.status} ${response.statusText} - ${rawText.slice(0, 500)}`
        );
    }
  }

  async ensureUser(params: {
    username: string;
    password: string;
    email: string;
    displayName: string;
    }): Promise<void> {
    const existsBefore = await this.findUser(params.username);

    if (!existsBefore) {
        await this.createUser(params);
    }

    const existsAfter = await this.findUser(params.username);

    if (!existsAfter) {
        throw new Error(
        `El usuario '${params.username}' no existe en Nextcloud después del intento de creación`
        );
    }
  }

  async listGroups(): Promise<string[]> {
    const response = await fetch(
      `${this.baseUrl}/ocs/v1.php/cloud/groups?format=json`,
      {
        method: "GET",
        headers: this.getHeaders()
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `No se pudo listar grupos en Nextcloud: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    const data = await this.parseJson<NextcloudGroupsResponse>(response);
    return data.ocs?.data?.groups ?? [];
  }

  async listUserGroups(username: string): Promise<string[]> {
    const response = await fetch(
        `${this.baseUrl}/ocs/v1.php/cloud/users/${encodeURIComponent(username)}/groups?format=json`,
        {
        method: "GET",
        headers: this.getHeaders()
        }
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(
        `No se pudo listar grupos del usuario en Nextcloud: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
        );
    }

    const data = await this.parseJson<{
        ocs?: {
        meta?: {
            status?: string;
            statuscode?: number;
            message?: string;
        };
        data?: {
            groups?: string[];
        };
        };
    }>(response);

    return data.ocs?.data?.groups ?? [];
  }  

  async ensureGroup(groupName: string): Promise<void> {
    const groups = await this.listGroups();

    if (groups.includes(groupName)) {
      return;
    }

    const body = new URLSearchParams({
      groupid: groupName
    });

    const response = await fetch(
      `${this.baseUrl}/ocs/v1.php/cloud/groups?format=json`,
      {
        method: "POST",
        headers: this.getHeaders(),
        body
      }
    );

    const data = await this.parseJson<any>(response);
    const success = data?.ocs?.meta?.status === "ok";

    if (!response.ok || !success) {
      throw new Error(
        `No se pudo crear grupo en Nextcloud: ${response.status} ${response.statusText} - ${JSON.stringify(
          data
        ).slice(0, 500)}`
      );
    }
  }

  async addUserToGroup(username: string, groupName: string): Promise<void> {
    const currentGroups = await this.listUserGroups(username);

    if (currentGroups.includes(groupName)) {
        return;
    }

    const body = new URLSearchParams({
        groupid: groupName
    });

    const response = await fetch(
        `${this.baseUrl}/ocs/v1.php/cloud/users/${encodeURIComponent(
        username
        )}/groups?format=json`,
        {
        method: "POST",
        headers: this.getHeaders(),
        body
        }
    );

    const rawText = await response.text();

    let parsed:
        | {
            ocs?: {
            meta?: {
                status?: string;
                statuscode?: number;
                message?: string;
            };
            };
        }
        | null = null;

    try {
        parsed = JSON.parse(rawText) as {
        ocs?: {
            meta?: {
            status?: string;
            statuscode?: number;
            message?: string;
            };
        };
        };
    } catch {
        parsed = null;
    }

    const groupsAfterAttempt = await this.listUserGroups(username);

    if (groupsAfterAttempt.includes(groupName)) {
        return;
    }

    throw new Error(
        `No se pudo agregar usuario a grupo en Nextcloud: ${response.status} ${response.statusText} - ${rawText.slice(0, 500)}`
    );
  }

  async ensureUserInGroup(params: {
    username: string;
    password: string;
    email: string;
    displayName: string;
    groupName: string;
  }): Promise<{ synced: boolean; reason?: string }> {
    await this.ensureGroup(params.groupName);
    await this.ensureUser({
      username: params.username,
      password: params.password,
      email: params.email,
      displayName: params.displayName
    });
    await this.addUserToGroup(params.username, params.groupName);

    return { synced: true };
  }
}