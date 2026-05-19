type OpenProjectText = {
  format: "markdown" | "plain";
  raw: string;
};

type OpenProjectProject = {
  _type?: string;
  id: number;
  identifier: string;
  name: string;
  active?: boolean;
  public?: boolean;
  description?: OpenProjectText;
  createdAt?: string;
  updatedAt?: string;
  _links?: {
    self?: {
      href: string;
      title?: string;
    };
  };
};

type OpenProjectCollection<T> = {
  _embedded?: {
    elements?: T[];
  };
  total?: number;
  count?: number;
};

type CreateOpenProjectProjectInput = {
  code: string;
  name: string;
  description?: string;
};

function normalizeProjectCode(code: string): string {
  const normalized = code.trim().toUpperCase();

  if (!normalized) {
    throw new Error("El código del proyecto es obligatorio");
  }

  return normalized;
}
function toOpenProjectIdentifier(code: string): string {
  const normalized = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (!normalized) {
    throw new Error("No se pudo generar un identifier válido para OpenProject");
  }

  return normalized;
}

export class OpenProjectProjectsService {
  private baseUrl = process.env.OPENPROJECT_BASE_URL || "";
  private apiKey = process.env.OPENPROJECT_API_KEY || "";

  private getHeaders(): HeadersInit {
    const token = Buffer.from(`apikey:${this.apiKey}`).toString("base64");

    return {
      Authorization: `Basic ${token}`,
      "Content-Type": "application/json",
      Accept: "application/hal+json"
    };
  }

  private ensureConfigured(): void {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error(
        "Faltan OPENPROJECT_BASE_URL u OPENPROJECT_API_KEY en el .env del BFF"
      );
    }
  }

  async findProjectByIdentifier(
    identifier: string
    ): Promise<OpenProjectProject | null> {
    this.ensureConfigured();

    const normalizedIdentifier = toOpenProjectIdentifier(identifier);
    

    const response = await fetch(
        `${this.baseUrl}/api/v3/projects/${encodeURIComponent(normalizedIdentifier)}`,
        {
        method: "GET",
        headers: this.getHeaders()
        }
    );

    const rawText = await response.text();

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new Error(
        `No se pudo buscar proyecto OpenProject por identifier '${normalizedIdentifier}': ${response.status} ${response.statusText} - ${rawText.slice(
            0,
            500
        )}`
        );
    }

    return JSON.parse(rawText) as OpenProjectProject;
    }
  

  async createProject(
    input: CreateOpenProjectProjectInput
  ): Promise<OpenProjectProject> {
    this.ensureConfigured();

    const code = normalizeProjectCode(input.code);
    const identifier = toOpenProjectIdentifier(input.code);

    const payload = {
      identifier,
      name: input.name.trim(),
      active: true,
      public: false,
      description: {
        format: "markdown",
        raw:
            input.description?.trim() ||
            `Proyecto ${code} creado desde CDE Portal`
      }
    };

    const response = await fetch(`${this.baseUrl}/api/v3/projects`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload)
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(
        `No se pudo crear proyecto OpenProject: ${response.status} ${response.statusText} - ${rawText.slice(
          0,
          800
        )}`
      );
    }

    return JSON.parse(rawText) as OpenProjectProject;
  }

  async createOrGetProject(
    input: CreateOpenProjectProjectInput
  ): Promise<{
    project: OpenProjectProject;
    created: boolean;
  }> {
    const existingProject = await this.findProjectByIdentifier(input.code);

    if (existingProject) {
      return {
        project: existingProject,
        created: false
      };
    }

    const project = await this.createProject(input);

    return {
      project,
      created: true
    };
  }
  async deleteProject(projectId: number): Promise<void> {
    this.ensureConfigured();

    if (!Number.isFinite(projectId)) {
      throw new Error("projectId inválido para eliminar proyecto OpenProject");
    }

    const response = await fetch(`${this.baseUrl}/api/v3/projects/${projectId}`, {
      method: "DELETE",
      headers: this.getHeaders()
    });

    const rawText = await response.text();

    if (response.status === 404) {
      return;
    }

    if (!response.ok && response.status !== 204) {
      throw new Error(
        `No se pudo eliminar proyecto OpenProject '${projectId}': ${response.status} ${response.statusText} - ${rawText.slice(
          0,
          800
        )}`
      );
    }
  }
}