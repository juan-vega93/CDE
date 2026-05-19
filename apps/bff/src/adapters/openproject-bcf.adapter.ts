import crypto from "crypto";
import type {
  OpenProjectBcfProject,
  OpenProjectBcfTopic,
  OpenProjectBcfComment,
  OpenProjectBcfViewpoint,
  OpenProjectBcfViewpointInput
} from "../types/openproject-bcf.types";

type OpenProjectBcfConfig = {
  baseUrl: string;
  apiKey: string;
};

export class OpenProjectBcfAdapter {
  private config: OpenProjectBcfConfig;
  private bcfProjectUuidCache: Map<string, string> = new Map();

  constructor() {
    this.config = {
      baseUrl: (process.env.OPENPROJECT_BASE_URL || "").replace(/\/$/, ""),
      apiKey: process.env.OPENPROJECT_API_KEY || ""
    };
  }

  private getBasicAuthHeader(): string {
    return `Basic ${Buffer.from(`apikey:${this.config.apiKey}`).toString("base64")}`;
  }

  private getBcfBaseUrl(projectId: string): string {
    return `${this.config.baseUrl}/api/bcf/2.1/projects/${encodeURIComponent(projectId)}`;
  }

  private getHeaders(): Record<string, string> {
    return {
      Authorization: this.getBasicAuthHeader(),
      "Content-Type": "application/json",
      Accept: "application/json"
    };
  }

  private sanitizeError(error: unknown): string {
    if (error instanceof Error) {
      return `[OpenProject BCF] ${error.message.slice(0, 500)}`;
    }
    return `[OpenProject BCF] Unknown error`;
  }

  private logRequest(method: string, url: string, projectId?: string) {
    console.log(`[OpenProject BCF] request`, {
      method,
      url: url.replace(this.config.baseUrl, "<BASE>"),
      projectId: projectId ?? "N/A"
    });
  }

  private logResponse(method: string, url: string, status: number, ok: boolean) {
    console.log(`[OpenProject BCF] response`, {
      method,
      url: url.replace(this.config.baseUrl, "<BASE>"),
      status,
      ok
    });
  }

  private generateGuid(): string {
    return crypto.randomUUID();
  }

  /**
   * Resuelve un projectId (numerico o slug) al UUID interno que espera la BCF API.
   * OpenProject usa UUIDs internos para identificar proyectos en BCF, no IDs numericos.
   * 
   * Orden de resolucion:
   * 1. OPENPROJECT_BCF_PROJECT_UUID en env (configuracion explicita del usuario)
   * 2. Cache interno
   * 3. Si projectId ya parece UUID, usarlo directamente
   * 4. Obtener lista BCF projects y buscar coincidencia por identifier/name
   */
  async resolveBcfProjectUuid(projectId: string): Promise<string> {
    // 1) Env var explicita tiene maxima prioridad
    const envBcfUuid = process.env.OPENPROJECT_BCF_PROJECT_UUID?.trim();
    if (envBcfUuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(envBcfUuid)) {
      console.log("[OpenProject BCF] Using OPENPROJECT_BCF_PROJECT_UUID from env:", envBcfUuid);
      this.bcfProjectUuidCache.set(projectId, envBcfUuid);
      return envBcfUuid;
    }

    // 2) Cache
    const cached = this.bcfProjectUuidCache.get(projectId);
    if (cached) return cached;

    // 3) Si ya parece UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
      this.bcfProjectUuidCache.set(projectId, projectId);
      return projectId;
    }

    console.log("[OpenProject BCF] Resolving BCF project UUID for", projectId);

    // 4) Obtener lista BCF projects
    try {
      const projects = await this.listProjects();
      console.log("[OpenProject BCF] Available BCF projects:", projects);

      // Intentar resolver via API v3 para obtener identifier (slug)
      try {
        const v3Url = `${this.config.baseUrl}/api/v3/projects/${encodeURIComponent(projectId)}`;
        const v3Response = await fetch(v3Url, {
          method: "GET",
          headers: this.getHeaders()
        });

        if (v3Response.ok) {
          const v3Data = await v3Response.json() as Record<string, unknown>;
          const v3Identifier = v3Data.identifier as string | undefined;
          const v3Name = v3Data.name as string | undefined;
          console.log("[OpenProject BCF] v3 project info", { identifier: v3Identifier, name: v3Name, id: projectId });

          // Buscar en proyectos BCF por identifier (slug)
          if (v3Identifier) {
            const bcfMatch = projects.find(
              (p) => p.project_id === v3Identifier || p.name === v3Identifier || p.name === v3Name
            );
            if (bcfMatch) {
              this.bcfProjectUuidCache.set(projectId, bcfMatch.project_id);
              console.log("[OpenProject BCF] Resolved BCF UUID via v3 ->", bcfMatch.project_id);
              return bcfMatch.project_id;
            }
          }

          // Buscar por nombre
          if (v3Name) {
            const bcfMatch = projects.find((p) => p.name === v3Name);
            if (bcfMatch) {
              this.bcfProjectUuidCache.set(projectId, bcfMatch.project_id);
              return bcfMatch.project_id;
            }
          }
        }
      } catch {
        console.warn("[OpenProject BCF] v3 resolve failed");
      }

      // Si hay solo 1 BCF project, usarlo
      if (projects.length === 1) {
        console.log("[OpenProject BCF] Only one BCF project found, using UUID:", projects[0].project_id);
        this.bcfProjectUuidCache.set(projectId, projects[0].project_id);
        return projects[0].project_id;
      }

      // Buscar por coincidencia de nombre
      for (const p of projects) {
        if (p.name === projectId || p.name.startsWith(projectId) || p.name.endsWith(projectId)) {
          this.bcfProjectUuidCache.set(projectId, p.project_id);
          return p.project_id;
        }
      }

      console.warn("[OpenProject BCF] Could not resolve project UUID from BCF projects list.");
    } catch (listError) {
      console.warn("[OpenProject BCF] listProjects failed (BCF module may not be enabled).", (listError as Error).message);
    }

    // Fallback: usar projectId original
    console.log("[OpenProject BCF] Using projectId as-is (fallback):", projectId);
    this.bcfProjectUuidCache.set(projectId, projectId);
    return projectId;
  }

  /** Ejecuta un fetch contra BCF API resolviendo automaticamente el project UUID */
  private async bcfFetch(
    method: string,
    endpointTemplate: string,
    projectId?: string,
    body?: unknown
  ): Promise<Response> {
    let url: string;

    if (projectId) {
      const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
      url = `${this.config.baseUrl}${endpointTemplate.replace(":projectId", encodeURIComponent(resolvedUuid))}`;
    } else {
      url = `${this.config.baseUrl}${endpointTemplate}`;
    }

    this.logRequest(method, url, projectId);

    const options: RequestInit = {
      method,
      headers: this.getHeaders()
    };

    if (body !== undefined) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    this.logResponse(method, url, response.status, response.ok);

    return response;
  }

  private async handleResponse(
    response: Response,
    operationName: string
  ): Promise<string> {
    const text = await response.text();

    if (!response.ok) {
      console.error(`[OpenProject BCF] ${operationName} failed`, {
        status: response.status,
        statusText: response.statusText,
        body: text.slice(0, 500)
      });
      throw new Error(
        `OpenProject BCF ${operationName} failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    return text;
  }

  /** Verifica que la BCF API de OpenProject responde */
  async testConnection(): Promise<{ ok: boolean; status: number; preview: string }> {
    const url = `${this.config.baseUrl}/api/bcf/2.1/projects`;
    this.logRequest("GET", url);

    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders()
    });

    const text = await response.text();
    this.logResponse("GET", url, response.status, response.ok);

    if (!response.ok) {
      throw new Error(
        `OpenProject BCF testConnection failed: ${response.status} ${response.statusText} - ${text.slice(0, 500)}`
      );
    }

    return {
      ok: true,
      status: response.status,
      preview: text.slice(0, 500)
    };
  }

  /** Lista proyectos BIM disponibles en BCF API */
  async listProjects(): Promise<OpenProjectBcfProject[]> {
    const url = `${this.config.baseUrl}/api/bcf/2.1/projects`;
    this.logRequest("GET", url);

    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders()
    });

    const text = await response.text();
    this.logResponse("GET", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.error("[OpenProject BCF] error fetching projects", { status: response.status, text: sanitizedText });
      throw new Error(`OpenProject BCF listProjects failed: ${response.status} - ${sanitizedText}`);
    }

    try {
      const data = JSON.parse(text);
      return Array.isArray(data) ? data : [];
    } catch {
      console.warn("[OpenProject BCF] Could not parse projects response, returning empty", text.slice(0, 200));
      return [];
    }
  }

  /** Lista topics de un proyecto */
  async listTopics(projectId: string): Promise<OpenProjectBcfTopic[]> {
    const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
    const url = `${this.getBcfBaseUrl(resolvedUuid)}/topics`;
    this.logRequest("GET", url, projectId);

    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders()
    });

    const text = await response.text();
    this.logResponse("GET", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.error("[OpenProject BCF] error listing topics", {
        status: response.status,
        projectId,
        resolvedUuid,
        text: sanitizedText
      });
      throw new Error(`OpenProject BCF listTopics failed: ${response.status} - ${sanitizedText}`);
    }

    try {
      return JSON.parse(text) as OpenProjectBcfTopic[];
    } catch {
      console.warn("[OpenProject BCF] Could not parse topics response", text.slice(0, 200));
      return [];
    }
  }

  /** Obtiene un topic específico */
  async getTopic(projectId: string, topicGuid: string): Promise<OpenProjectBcfTopic> {
    const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
    const url = `${this.getBcfBaseUrl(resolvedUuid)}/topics/${topicGuid}`;
    this.logRequest("GET", url, projectId);

    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders()
    });

    const text = await response.text();
    this.logResponse("GET", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.error("[OpenProject BCF] error getting topic", {
        status: response.status,
        projectId,
        resolvedUuid,
        topicGuid,
        text: sanitizedText
      });
      throw new Error(
        `OpenProject BCF getTopic failed: ${response.status} - ${sanitizedText}`
      );
    }

    return JSON.parse(text) as OpenProjectBcfTopic;
  }

  /** Crea un topic nuevo - usando resolved UUID */
  async createTopic(projectId: string, topic: OpenProjectBcfTopic): Promise<OpenProjectBcfTopic> {
    const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
    const url = `${this.getBcfBaseUrl(resolvedUuid)}/topics`;
    this.logRequest("POST", url, projectId);

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(topic)
    });

    const text = await response.text();
    this.logResponse("POST", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.error("[OpenProject BCF] error creating topic", {
        status: response.status,
        projectId,
        resolvedUuid,
        text: sanitizedText,
        payloadPreview: JSON.stringify(topic).slice(0, 300)
      });
      throw new Error(
        `OpenProject BCF createTopic failed: ${response.status} - ${sanitizedText}`
      );
    }

    return JSON.parse(text) as OpenProjectBcfTopic;
  }

  /** Actualiza un topic existente (PUT) */
  async updateTopic(projectId: string, topicGuid: string, topic: Partial<OpenProjectBcfTopic>): Promise<OpenProjectBcfTopic> {
    const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
    const url = `${this.getBcfBaseUrl(resolvedUuid)}/topics/${topicGuid}`;
    this.logRequest("PUT", url, projectId);

    const response = await fetch(url, {
      method: "PUT",
      headers: this.getHeaders(),
      body: JSON.stringify(topic)
    });

    const text = await response.text();
    this.logResponse("PUT", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.error("[OpenProject BCF] error updating topic", {
        status: response.status,
        projectId,
        resolvedUuid,
        topicGuid,
        text: sanitizedText
      });
      throw new Error(
        `OpenProject BCF updateTopic failed: ${response.status} - ${sanitizedText}`
      );
    }

    return JSON.parse(text) as OpenProjectBcfTopic;
  }

  /** Lista comments de un topic */
  async listComments(projectId: string, topicGuid: string): Promise<OpenProjectBcfComment[]> {
    const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
    const url = `${this.getBcfBaseUrl(resolvedUuid)}/topics/${topicGuid}/comments`;
    this.logRequest("GET", url, projectId);

    const response = await fetch(url, {
      method: "GET",
      headers: this.getHeaders()
    });

    const text = await response.text();
    this.logResponse("GET", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.error("[OpenProject BCF] error listing comments", {
        status: response.status,
        projectId,
        resolvedUuid,
        topicGuid,
        text: sanitizedText
      });
      throw new Error(
        `OpenProject BCF listComments failed: ${response.status} - ${sanitizedText}`
      );
    }

    try {
      return JSON.parse(text) as OpenProjectBcfComment[];
    } catch {
      console.warn("[OpenProject BCF] Could not parse comments response", text.slice(0, 200));
      return [];
    }
  }

  /** Crea un comment en un topic */
  async createComment(
    projectId: string,
    topicGuid: string,
    comment: OpenProjectBcfComment
  ): Promise<OpenProjectBcfComment> {
    const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
    const url = `${this.getBcfBaseUrl(resolvedUuid)}/topics/${topicGuid}/comments`;
    this.logRequest("POST", url, projectId);

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(comment)
    });

    const text = await response.text();
    this.logResponse("POST", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.warn("[OpenProject BCF] warning creating comment", {
        status: response.status,
        projectId,
        resolvedUuid,
        topicGuid,
        text: sanitizedText
      });
      throw new Error(
        `OpenProject BCF createComment failed: ${response.status} - ${sanitizedText}`
      );
    }

    return JSON.parse(text) as OpenProjectBcfComment;
  }

  /** Crea un viewpoint asociado a un topic */
  async createViewpoint(
    projectId: string,
    topicGuid: string,
    viewpoint: OpenProjectBcfViewpointInput
  ): Promise<OpenProjectBcfViewpoint> {
    const resolvedUuid = await this.resolveBcfProjectUuid(projectId);
    const url = `${this.getBcfBaseUrl(resolvedUuid)}/topics/${topicGuid}/viewpoints`;
    this.logRequest("POST", url, projectId);

    const response = await fetch(url, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(viewpoint)
    });

    const text = await response.text();
    this.logResponse("POST", url, response.status, response.ok);

    if (!response.ok) {
      const sanitizedText = text.slice(0, 500);
      console.warn("[OpenProject BCF] warning creating viewpoint", {
        status: response.status,
        projectId,
        resolvedUuid,
        topicGuid,
        text: sanitizedText
      });
      throw new Error(
        `OpenProject BCF createViewpoint failed: ${response.status} - ${sanitizedText}`
      );
    }

    return JSON.parse(text) as OpenProjectBcfViewpoint;
  }
}