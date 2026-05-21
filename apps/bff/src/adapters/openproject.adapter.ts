import type {
  CreateWorkPackageInput,
  WorkPackage,
  WorkPackageStatus
} from "../types/work-package.types";

type OpenProjectConfig = {
  baseUrl: string;
  apiKey: string;
  projectId: number;
  typeId: number;
};

type OpenProjectStatusElement = {
  id: number;
  name: string;
};

type OpenProjectWorkPackageResponse = {
  id: number;
  subject: string;
  description?: { raw?: string };
  dueDate?: string;
  createdAt?: string;
  lockVersion?: number;
  _embedded?: {
    status?: { id: number; name: string };
    priority?: { id: number; name: string };
  };
  _links?: {
    status?: { href: string; title?: string };
    priority?: { href: string; title?: string };
  };
};

type InternalStatus = WorkPackageStatus;

/**
 * Map from a status name (in any language) to our internal status.
 */
function statusNameToInternal(name: string): InternalStatus {
  const clean = name.trim().toLowerCase();

  // Spanish statuses (actual instance)
  const SPANISH_STATUS_MAP: Record<string, InternalStatus> = {
    "nuevo": "new",
    "asignado": "new",
    "en progreso": "in_progress",
    "en revisión": "in_review",
    "revisión": "in_review",
    "respondido": "in_review",
    "resuelto": "in_review",
    "aprobado": "approved",
    "rechazado": "rejected",
    "cerrado": "closed",
  };

  if (SPANISH_STATUS_MAP[clean]) return SPANISH_STATUS_MAP[clean];

  // English statuses (fallback)
  const ENGLISH_STATUS_MAP: Record<string, InternalStatus> = {
    "new": "new",
    "in progress": "in_progress",
    "in specification": "in_progress",
    "in review": "in_review",
    "review": "in_review",
    "resolved": "in_review",
    "approved": "approved",
    "rejected": "rejected",
    "closed": "closed",
  };

  if (ENGLISH_STATUS_MAP[clean]) return ENGLISH_STATUS_MAP[clean];

  return "new";
}

function parseStatusFromResponse(data: OpenProjectWorkPackageResponse): InternalStatus {
  // Try _embedded.status.name
  const embeddedName = data._embedded?.status?.name;
  if (embeddedName) return statusNameToInternal(embeddedName);

  // Try _links.status.title
  const linkTitle = data._links?.status?.title;
  if (linkTitle) return statusNameToInternal(linkTitle);

  // Try to extract from href
  const href = data._links?.status?.href;
  if (href) {
    const match = href.match(/\/statuses\/(\d+)/);
    if (match) {
      const statusId = parseInt(match[1], 10);
      // This OpenProject instance (Spanish, IDs 15-23)
      switch (statusId) {
        case 15: return "new";
        case 16: return "new";
        case 17: return "in_progress";
        case 18: return "in_review";
        case 19: return "in_review";
        case 20: return "in_review";
        case 21: return "approved";
        case 22: return "rejected";
        case 23: return "closed";
      }
    }
  }

  return "new";
}

export class OpenProjectAdapter {
  private config: OpenProjectConfig;
  private statusCache: Map<string, number> | null = null;

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
    return `Basic ${Buffer.from(`apikey:${this.config.apiKey}`).toString("base64")}`;
  }

  private async ensureStatusCache(): Promise<Map<string, number>> {
    if (this.statusCache) return this.statusCache;

    this.statusCache = new Map();
    try {
      const url = this.buildApiUrl("/api/v3/statuses");
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: this.getAuthHeader(),
          "Content-Type": "application/json"
        }
      });

      if (response.ok) {
        const body = await response.json() as {
          _embedded?: { elements?: OpenProjectStatusElement[] };
        };
        const elements = body._embedded?.elements ?? [];
        for (const st of elements) {
          this.statusCache.set(st.name.toLowerCase(), st.id);
        }
        console.log(`[OpenProjectAdapter] Cached ${elements.length} statuses`);
      }
    } catch (err) {
      console.error("[OpenProjectAdapter] Failed to fetch statuses:", err);
    }

    return this.statusCache;
  }

  private async resolveStatusId(internalStatus: InternalStatus): Promise<number> {
    const cache = await this.ensureStatusCache();

    const internalToOpName: Record<InternalStatus, string> = {
      new: "Nuevo",
      in_progress: "En progreso",
      in_review: "En revisión",
      approved: "Aprobado",
      rejected: "Rechazado",
      closed: "Cerrado",
    };

    const opName = internalToOpName[internalStatus] ?? "Nuevo";
    const cachedId = cache.get(opName.toLowerCase());
    if (cachedId) return cachedId;

    // Fallback: hardcoded IDs for this Spanish instance
    const fallbackIds: Record<InternalStatus, number> = {
      new: 15,
      in_progress: 17,
      in_review: 18,
      approved: 21,
      rejected: 22,
      closed: 23,
    };

    return fallbackIds[internalStatus] ?? 15;
  }

  async testConnection() {
    const url = this.buildApiUrl("/api/v3/projects");
    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: this.getAuthHeader(), "Content-Type": "application/json" }
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenProject testConnection failed: ${response.status} - ${text}`);
    }

    return { ok: true, status: response.status, preview: text.slice(0, 500) };
  }

  private resolveDisciplineOptionHref(description: string): string {
    const text = description.toLowerCase();
    if (text.includes("/shared/str") || text.includes("estructura")) return "/api/v3/custom_options/2";
    if (text.includes("/shared/civ") || text.includes("civil")) return "/api/v3/custom_options/7";
    if (text.includes("/shared/mep") || text.includes("eléctr") || text.includes("sanitaria") || text.includes("mecánica")) return "/api/v3/custom_options/5";
    return "/api/v3/custom_options/1";
  }

  async createWorkPackage(input: CreateWorkPackageInput): Promise<WorkPackage> {
    const url = this.buildApiUrl("/api/v3/work_packages");
    if (!input.openProjectProjectId) {
      throw new Error("openProjectProjectId es obligatorio para crear Work Package");
    }

    let descriptionRaw = input.description || "";
    const metaLines: string[] = [];
    if (input.status) metaLines.push(`Estado BCF: ${input.status}`);
    if (input.priority) metaLines.push(`Prioridad BCF: ${input.priority}`);
    if (input.author) metaLines.push(`Autor: ${input.author}`);
    if (input.assignedTo) metaLines.push(`Asignado a: ${input.assignedTo}`);
    if (input.bcfTopicId) metaLines.push(`ID Topic BCF: ${input.bcfTopicId}`);

    const attachmentLines: string[] = [];
    if (input.snapshotUrl) attachmentLines.push(`Snapshot: ${input.snapshotUrl}`);
    if (input.viewpointInfo) attachmentLines.push(`Viewpoint: ${input.viewpointInfo}`);
    for (const u of input.attachmentUrls ?? []) attachmentLines.push(`Adjunto: ${u}`);

    if (metaLines.length > 0) descriptionRaw += `\n\n--- Datos de la incidencia ---\n${metaLines.join("\n")}`;
    if (attachmentLines.length > 0) descriptionRaw += `\n\n--- Documentos vinculados ---\n${attachmentLines.join("\n")}`;

    const body: Record<string, unknown> = {
      subject: input.subject,
      description: { raw: descriptionRaw },
      dueDate: input.dueDate,
      customField2: "N/A",
      customField3: "N/A",
      _links: {
        project: { href: `/api/v3/projects/${input.openProjectProjectId}` },
        type: { href: `/api/v3/types/${this.config.typeId}` },
        customField1: { href: this.resolveDisciplineOptionHref(`${input.subject} ${input.description}`) },
        customField4: { href: "/api/v3/custom_options/15" }
      }
    };

    if (input.priority) body["customField5"] = input.priority;

    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: this.getAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenProject createWorkPackage failed: ${response.status} - ${text}`);
    }

    const data = JSON.parse(text) as OpenProjectWorkPackageResponse;

    return {
      id: data.id,
      subject: data.subject,
      description: data.description?.raw || input.description,
      status: parseStatusFromResponse(data),
      dueDate: data.dueDate,
      assigneeId: input.assigneeId,
      createdAt: data.createdAt || new Date().toISOString(),
      openProjectId: data.id,
      bcfTopicId: input.bcfTopicId,
      projectCode: input.projectCode,
      openProjectProjectId: input.openProjectProjectId
    };
  }

  /**
   * Updates the status of a work package in OpenProject.
   * OpenProject requires:
   * 1. `lockVersion` (optimistic locking) — fetched first via GET
   * 2. Valid workflow transition — the user/API key must have a role that allows it
   *
   * If OpenProject rejects the transition (422/409), we throw so the caller can fall back
   * to the local JSON store.
   */
  async updateWorkPackageStatus(id: number, newStatus: InternalStatus): Promise<WorkPackage> {
    // Step 1: GET the current WP to obtain lockVersion
    const getUrl = this.buildApiUrl(`/api/v3/work_packages/${id}`);
    const getResponse = await fetch(getUrl, {
      method: "GET",
      headers: { Authorization: this.getAuthHeader(), "Content-Type": "application/json" }
    });

    if (!getResponse.ok) {
      throw new Error(`OpenProject cannot fetch WP ${id}: ${getResponse.status}`);
    }

    const currentData = JSON.parse(await getResponse.text()) as OpenProjectWorkPackageResponse;
    const lockVersion = currentData.lockVersion ?? 0;

    // Step 2: PATCH with lockVersion and new status
    const statusId = await this.resolveStatusId(newStatus);
    const patchUrl = this.buildApiUrl(`/api/v3/work_packages/${id}`);

    const patchResponse = await fetch(patchUrl, {
      method: "PATCH",
      headers: { Authorization: this.getAuthHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        lockVersion,
        _links: {
          status: { href: `/api/v3/statuses/${statusId}` }
        }
      })
    });

    const text = await patchResponse.text();

    if (!patchResponse.ok) {
      // OpenProject rejected the transition. Throw a detailed error so the caller
      // can fall back to the local JSON store.
      const errorInfo = JSON.parse(text);
      const reason = errorInfo.message || "Unknown error";
      throw new Error(
        `OpenProject rejected status transition (${patchResponse.status}): ${reason}`
      );
    }

    const data = JSON.parse(text) as OpenProjectWorkPackageResponse;
    const actualStatus = parseStatusFromResponse(data);

    return {
      id: data.id,
      subject: data.subject,
      description: data.description?.raw || "",
      status: actualStatus,
      dueDate: data.dueDate,
      createdAt: data.createdAt || new Date().toISOString()
    };
  }

  async getWorkPackageById(id: number): Promise<WorkPackage> {
    const url = this.buildApiUrl(`/api/v3/work_packages/${id}`);

    const response = await fetch(url, {
      method: "GET",
      headers: { Authorization: this.getAuthHeader(), "Content-Type": "application/json" }
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`OpenProject getWorkPackageById failed: ${response.status} - ${text}`);
    }

    const data = JSON.parse(text) as OpenProjectWorkPackageResponse;
    const status = parseStatusFromResponse(data);

    return {
      id: data.id,
      subject: data.subject,
      description: data.description?.raw || "",
      status,
      dueDate: data.dueDate,
      createdAt: data.createdAt || new Date().toISOString()
    };
  }
}