type NextcloudShareType = 0 | 1 | 3;

type NextcloudShareItem = {
  id: string | number;
  share_type?: number;
  share_with?: string;
  path?: string;
  permissions?: number;
};

type NextcloudSharesResponse = {
  ocs?: {
    meta?: {
      status?: string;
      statuscode?: number;
      message?: string;
    };
    data?: NextcloudShareItem[];
  };
};

export const NEXTCLOUD_PERMISSIONS = {
  READ: 1,
  UPDATE: 2,
  CREATE: 4,
  DELETE: 8,
  SHARE: 16,
  READ_WRITE: 1 + 2 + 4,
  FULL: 1 + 2 + 4 + 8 + 16
} as const;
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
  private rootPath = process.env.NEXTCLOUD_ROOT_PATH || "";

  private getNormalizedRootPath(): string {
    const root = this.rootPath.trim();

    if (!root || root === "/") {
      return "";
    }

    return root.startsWith("/")
      ? root.replace(/\/$/, "")
      : `/${root.replace(/\/$/, "")}`;
  }

  private buildSharePath(portalPath: string): string {
    const root = this.getNormalizedRootPath();

    const cleanPortalPath = portalPath.startsWith("/")
      ? portalPath
      : `/${portalPath}`;

    return `${root}${cleanPortalPath}`.replace(/\/+/g, "/");
  }

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

  async removeUserFromGroup(username: string, groupName: string): Promise<void> {
    const currentGroups = await this.listUserGroups(username);

    if (!currentGroups.includes(groupName)) {
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
        method: "DELETE",
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

    if (!groupsAfterAttempt.includes(groupName)) {
      return;
    }

    throw new Error(
      `No se pudo quitar usuario del grupo en Nextcloud: ${response.status} ${response.statusText} - ${rawText.slice(
        0,
        500
      )}`
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

  async listSharesForPath(portalPath: string): Promise<NextcloudShareItem[]> {
  const sharePath = this.buildSharePath(portalPath);

  const url = new URL(
    `${this.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares`
  );

  url.searchParams.set("format", "json");
  url.searchParams.set("path", sharePath);
  url.searchParams.set("reshares", "true");

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: this.getHeaders()
  });

  const rawText = await response.text();

  let data: NextcloudSharesResponse | null = null;

  try {
    data = JSON.parse(rawText) as NextcloudSharesResponse;
  } catch {
    data = null;
  }

  const success = data?.ocs?.meta?.status === "ok";

  if (!response.ok || !success) {
    throw new Error(
      `No se pudo listar shares de Nextcloud para ${sharePath}: ${response.status} ${response.statusText} - ${rawText.slice(
        0,
        500
      )}`
    );
  }

  return data?.ocs?.data ?? [];
}

async updateSharePermissions(shareId: string | number, permissions: number): Promise<void> {
  const body = new URLSearchParams({
    permissions: String(permissions)
  });

  const response = await fetch(
    `${this.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares/${encodeURIComponent(
      String(shareId)
    )}?format=json`,
    {
      method: "PUT",
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

  const success = data?.ocs?.meta?.status === "ok";

  if (!response.ok || !success) {
    throw new Error(
      `No se pudo actualizar permisos del share ${shareId}: ${response.status} ${response.statusText} - ${rawText.slice(
        0,
        500
      )}`
    );
  }
}

async shareFolderWithGroup(params: {
  portalPath: string;
  groupName: string;
  permissions: number;
}): Promise<{ synced: boolean; created: boolean; updated: boolean; path: string; groupName: string; permissions: number }> {
  await this.ensureGroup(params.groupName);

  const sharePath = this.buildSharePath(params.portalPath);

  const existingShares = await this.listSharesForPath(params.portalPath);

  const existingGroupShare = existingShares.find(
    (share) =>
      Number(share.share_type) === 1 &&
      share.share_with === params.groupName
  );

  if (existingGroupShare) {
    const currentPermissions = Number(existingGroupShare.permissions ?? 0);

    if (currentPermissions !== params.permissions) {
      await this.updateSharePermissions(existingGroupShare.id, params.permissions);

      return {
        synced: true,
        created: false,
        updated: true,
        path: sharePath,
        groupName: params.groupName,
        permissions: params.permissions
      };
    }

    return {
      synced: true,
      created: false,
      updated: false,
      path: sharePath,
      groupName: params.groupName,
      permissions: params.permissions
    };
  }

  const body = new URLSearchParams({
    path: sharePath,
    shareType: "1",
    shareWith: params.groupName,
    permissions: String(params.permissions)
  });

  const response = await fetch(
    `${this.baseUrl}/ocs/v2.php/apps/files_sharing/api/v1/shares?format=json`,
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

  const success = data?.ocs?.meta?.status === "ok";

  if (!response.ok || !success) {
    throw new Error(
      `No se pudo compartir carpeta ${sharePath} con grupo ${params.groupName}: ${response.status} ${response.statusText} - ${rawText.slice(
        0,
        500
      )}`
    );
  }

  return {
    synced: true,
    created: true,
    updated: false,
    path: sharePath,
    groupName: params.groupName,
    permissions: params.permissions
  };
}
async deleteGroup(groupName: string): Promise<void> {
  const response = await fetch(
    `${this.baseUrl}/ocs/v1.php/cloud/groups/${encodeURIComponent(
      groupName
    )}?format=json`,
    {
      method: "DELETE",
      headers: this.getHeaders()
    }
  );

  const rawText = await response.text();

  if (response.status === 404) {
    return;
  }

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

  const status = parsed?.ocs?.meta?.status;
  const statusCode = parsed?.ocs?.meta?.statuscode;

  if (response.ok && (status === "ok" || statusCode === 100)) {
    return;
  }

  /**
   * Nextcloud a veces responde failure si el grupo ya no existe.
   * Para borrado definitivo, eso no debe romper el proceso.
   */
  const message = parsed?.ocs?.meta?.message || "";

  if (
  response.ok &&
  status === "failure" &&
  (statusCode === 101 ||
    message.toLowerCase().includes("does not exist") ||
    message.toLowerCase().includes("not found") ||
    message.trim() === "")
) {
  console.warn(
    `[NextcloudProvisioningService] No se pudo eliminar el grupo '${groupName}' o ya no existe. Se continúa con el borrado definitivo.`,
    {
      status,
      statusCode,
      message
    }
  );

  return;
}

  throw new Error(
    `No se pudo eliminar grupo Nextcloud '${groupName}': ${response.status} ${response.statusText} - ${rawText.slice(
      0,
      500
    )}`
  );
}


}