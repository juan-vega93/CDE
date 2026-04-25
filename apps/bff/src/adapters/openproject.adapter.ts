import type {
  CreateWorkPackageInput,
  WorkPackage
} from "../types/work-package.types";

type OpenProjectConfig = {
  baseUrl: string;
  apiKey: string;
  projectId: number;
  typeId: number;
};

type OpenProjectWorkPackageResponse = {
  id: number;
  subject: string;
  description?: {
    raw?: string;
  };
  dueDate?: string;
  createdAt?: string;
};

export class OpenProjectAdapter {
  private config: OpenProjectConfig;

  constructor() {
    this.config = {
      baseUrl: process.env.OPENPROJECT_BASE_URL || "",
      apiKey: process.env.OPENPROJECT_API_KEY || "",
      projectId: Number(process.env.OPENPROJECT_PROJECT_ID || 1),
      typeId: Number(process.env.OPENPROJECT_TYPE_ID || 1)
    };
  }

  private buildApiUrl(path: string): string {
    return `${this.config.baseUrl.replace(/\/$/, "")}${path}`;
  }

  private getAuthHeader(): string {
    return `Basic ${Buffer.from(`apikey:${this.config.apiKey}`).toString(
      "base64"
    )}`;
  }

  async testConnection() {
    const url = this.buildApiUrl("/api/v3/projects");

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `OpenProject testConnection failed: ${response.status} ${response.statusText} - ${text}`
      );
    }

    return {
      ok: true,
      status: response.status,
      preview: text.slice(0, 500)
    };
  }

  private resolveDisciplineOptionHref(description: string): string {
    const text = description.toLowerCase();

    if (text.includes("/shARED/str".toLowerCase()) || text.includes("estructura")) {
      return "/api/v3/custom_options/2"; // Estructura
    }

    if (text.includes("/shared/civ") || text.includes("civil")) {
      return "/api/v3/custom_options/7"; // Civil
    }

    if (
      text.includes("/shared/mep") ||
      text.includes("eléctr") ||
      text.includes("sanitaria") ||
      text.includes("mecánica")
    ) {
      return "/api/v3/custom_options/5"; // Instalaciones mecánicas (default MEP)
    }

    return "/api/v3/custom_options/1"; // Arquitectura
  }

  async createWorkPackage(input: CreateWorkPackageInput): Promise<WorkPackage> {
    const url = this.buildApiUrl("/api/v3/work_packages");

    const disciplineHref = this.resolveDisciplineOptionHref(
      `${input.subject} ${input.description}`
    );

    const body = {
      subject: input.subject,
      description: {
        raw: input.description
      },
      dueDate: input.dueDate,

      // Campos obligatorios detectados en el schema
      customField2: "N/A", // Nivel
      customField3: "N/A", // Zona

      _links: {
        project: {
          href: `/api/v3/projects/${this.config.projectId}`
        },
        type: {
          href: `/api/v3/types/${this.config.typeId}`
        },
        customField1: {
          href: disciplineHref
        },
        customField4: {
          href: "/api/v3/custom_options/15" // Coordination issue
        }
      }
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `OpenProject createWorkPackage failed: ${response.status} ${response.statusText} - ${text}`
      );
    }

    const data = JSON.parse(text) as OpenProjectWorkPackageResponse;

    return {
      id: data.id,
      subject: data.subject,
      description: data.description?.raw || input.description,
      status: "new",
      dueDate: data.dueDate,
      assigneeId: input.assigneeId,
      createdAt: data.createdAt || new Date().toISOString()
    };
  }

  async getWorkPackageById(id: number): Promise<WorkPackage> {
    const url = this.buildApiUrl(`/api/v3/work_packages/${id}`);

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json"
      }
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `OpenProject getWorkPackageById failed: ${response.status} ${response.statusText} - ${text}`
      );
    }

    const data = JSON.parse(text) as OpenProjectWorkPackageResponse;

    return {
      id: data.id,
      subject: data.subject,
      description: data.description?.raw || "",
      status: "new",
      dueDate: data.dueDate,
      createdAt: data.createdAt || new Date().toISOString()
    };
  }
}