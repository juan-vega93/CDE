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
    if (!input.openProjectProjectId) {
      throw new Error(
        "openProjectProjectId es obligatorio para crear Work Package"
      );
    }

    const disciplineHref = this.resolveDisciplineOptionHref(
      `${input.subject} ${input.description}`
    );

    // Construir descripción enriquecida con toda la data
    let descriptionRaw = input.description || "";

    // Agregar metadata del BCF topic
    const metaLines: string[] = [];
    if (input.status) metaLines.push(`Estado BCF: ${input.status}`);
    if (input.priority) metaLines.push(`Prioridad BCF: ${input.priority}`);
    if (input.author) metaLines.push(`Autor: ${input.author}`);
    if (input.assignedTo) metaLines.push(`Asignado a: ${input.assignedTo}`);
    if (input.bcfTopicId) metaLines.push(`ID Topic BCF: ${input.bcfTopicId}`);

    // Agregar enlaces a documentos adjuntos
    const attachmentLines: string[] = [];
    if (input.snapshotUrl) attachmentLines.push(`Snapshot: ${input.snapshotUrl}`);
    if (input.viewpointInfo) attachmentLines.push(`Viewpoint: ${input.viewpointInfo}`);
    for (const url of input.attachmentUrls ?? []) {
      attachmentLines.push(`Adjunto: ${url}`);
    }

    if (metaLines.length > 0) {
      descriptionRaw += `\n\n--- Datos de la incidencia ---\n${metaLines.join("\n")}`;
    }
    if (attachmentLines.length > 0) {
      descriptionRaw += `\n\n--- Documentos vinculados ---\n${attachmentLines.join("\n")}`;
    }

    const body: Record<string, unknown> = {
      subject: input.subject,
      description: {
        raw: descriptionRaw
      },
      dueDate: input.dueDate,

      customField2: "N/A",
      customField3: "N/A",

      _links: {
        project: {
          href: `/api/v3/projects/${input.openProjectProjectId}`
        },
        type: {
          href: `/api/v3/types/${this.config.typeId}`
        },
        customField1: {
          href: disciplineHref
        },
        customField4: {
          href: "/api/v3/custom_options/15"
        }
      }
    };

    // Incluir info de prioridad como custom field si existe
    if (input.priority) {
      body["customField5"] = input.priority;
    }

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
      createdAt: data.createdAt || new Date().toISOString(),
      openProjectId: data.id,
      bcfTopicId: input.bcfTopicId,
      projectCode: input.projectCode,
      openProjectProjectId: input.openProjectProjectId
      
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