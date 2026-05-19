import crypto from "crypto";
import { OpenProjectBcfAdapter } from "../adapters/openproject-bcf.adapter";
import type {
  OpenProjectBcfTopic,
  OpenProjectBcfViewpointInput
} from "../types/openproject-bcf.types";
import type {
  BcfTopic,
  BcfTopicOpenProjectInfo
} from "./bcf-topics.service";
import type { BcfSyncResult } from "../types/openproject-bcf.types";

function generateGuid(): string {
  return crypto.randomUUID();
}

/** Mappings configurables — validar con la instancia real de OpenProject */
const STATUS_MAP: Record<string, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed"
};

const PRIORITY_MAP: Record<string, string> = {
  low: "Low",
  medium: "Normal",
  high: "High",
  critical: "Urgent"
};

const REVERSE_STATUS_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(STATUS_MAP).map(([k, v]) => [v.toLowerCase(), k])
);

const REVERSE_PRIORITY_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(PRIORITY_MAP).map(([k, v]) => [v.toLowerCase(), k])
);

export class OpenProjectBcfService {
  private adapter: OpenProjectBcfAdapter;

  constructor() {
    this.adapter = new OpenProjectBcfAdapter();
  }

  private computeHash(topic: BcfTopic): string {
    const relevant = {
      title: topic.title,
      description: topic.description ?? "",
      status: topic.status,
      priority: topic.priority,
      assignedTo: topic.assignedTo ?? "",
      modifiedDate: topic.modifiedDate,
      commentsCount: topic.comments.length
    };
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(relevant))
      .digest("hex");
  }

  private mapStatusToOpenProject(status: string): string {
    return STATUS_MAP[status] ?? "Open";
  }

  private mapStatusFromOpenProject(openProjectStatus: string): string {
    const key = (openProjectStatus ?? "").toLowerCase();
    return REVERSE_STATUS_MAP[key] ?? "open";
  }

  private mapPriorityToOpenProject(priority: string): string {
    return PRIORITY_MAP[priority] ?? "Normal";
  }

  private mapPriorityFromOpenProject(openProjectPriority: string): string {
    const key = (openProjectPriority ?? "").toLowerCase();
    return REVERSE_PRIORITY_MAP[key] ?? "medium";
  }

  private replaceLocalhost(url: string): string {
    return url.replace(
      /http:\/\/localhost:\d+/i,
      process.env.BFF_PUBLIC_URL?.replace(/\/$/, "") || ""
    );
  }

  mapCustomTopicToOpenProjectBcfTopic(
    customTopic: BcfTopic,
    existingGuid?: string
  ): OpenProjectBcfTopic {
    const referenceLinks: string[] = [];

    // Incluir URL del snapshot como referencia si existe (reemplazando localhost)
    if (customTopic.snapshot && !customTopic.snapshot.startsWith("data:")) {
      const publicUrl = this.replaceLocalhost(customTopic.snapshot);
      if (publicUrl && !publicUrl.includes("localhost")) {
        referenceLinks.push(publicUrl);
      }
    }

    // Incluir URLs de adjuntos como referencias (reemplazando localhost)
    for (const attachment of customTopic.attachments) {
      if (attachment.dataUrl && !attachment.dataUrl.startsWith("data:")) {
        const publicUrl = this.replaceLocalhost(attachment.dataUrl);
        if (publicUrl && !publicUrl.includes("localhost")) {
          referenceLinks.push(publicUrl);
        }
      }
    }

    // Enriquecer descripción SIN emojis (pueden romper la codificacion)
    const cleanAnnotations = (customTopic.annotations ?? [])
      .map((a) => `[${a.type}] ${a.text} (${a.author ?? "desconocido"})`)
      .join("\n");
    const cleanMeasurements = (customTopic.measurements ?? [])
      .map((m) => `Distancia: ${m.value}${m.unit} (${m.author ?? "desconocido"})`)
      .join("\n");

    let enrichedDescription = customTopic.description ?? "";
    if (cleanAnnotations) enrichedDescription += `\n\n--- Anotaciones ---\n${cleanAnnotations}`;
    if (cleanMeasurements) enrichedDescription += `\n\n--- Mediciones ---\n${cleanMeasurements}`;

    return {
      guid: existingGuid ?? customTopic.openProject?.topicGuid ?? generateGuid(),
      topic_type: "Issue",
      topic_status: this.mapStatusToOpenProject(customTopic.status),
      priority: this.mapPriorityToOpenProject(customTopic.priority),
      title: customTopic.title,
      description: enrichedDescription || "Incidencia creada desde CDE Portal",
      creation_date: customTopic.creationDate || new Date().toISOString(),
      creation_author: customTopic.author || undefined,
      modified_date: customTopic.modifiedDate || new Date().toISOString(),
      modified_author: customTopic.author || undefined,
      assigned_to: customTopic.assignedTo || undefined,
      labels: [],
      reference_links: referenceLinks.length > 0 ? referenceLinks : undefined
    };
  }

  mapOpenProjectBcfTopicToCustomTopic(
    openProjectTopic: OpenProjectBcfTopic,
    existingCustomTopic?: Partial<BcfTopic>
  ): Partial<BcfTopic> {
    return {
      ...existingCustomTopic,
      title: openProjectTopic.title,
      description: openProjectTopic.description ?? "",
      status: (this.mapStatusFromOpenProject(openProjectTopic.topic_status ?? "Open") as BcfTopic["status"]),
      priority: (this.mapPriorityFromOpenProject(openProjectTopic.priority ?? "Normal") as BcfTopic["priority"]),
      assignedTo: openProjectTopic.assigned_to ?? "",
      creationDate: openProjectTopic.creation_date ?? new Date().toISOString(),
      modifiedDate: openProjectTopic.modified_date ?? new Date().toISOString(),
      author: openProjectTopic.creation_author ?? existingCustomTopic?.author ?? "",
      openProject: {
        ...existingCustomTopic?.openProject,
        topicGuid: openProjectTopic.guid,
        lastSyncedAt: new Date().toISOString()
      }
    };
  }

  async pushTopic(
    projectId: string,
    customTopic: BcfTopic
  ): Promise<BcfSyncResult> {
    const warnings: string[] = [];
    const errors: string[] = [];
    const openProjectInfo: BcfTopicOpenProjectInfo = customTopic.openProject ?? {};
    const now = new Date().toISOString();
    const currentHash = this.computeHash(customTopic);

    console.log("[OpenProject BCF] pushTopic", {
      customId: customTopic.id,
      title: customTopic.title,
      projectId,
      hasOpenProjectInfo: !!customTopic.openProject?.topicGuid
    });

    try {
      if (customTopic.openProject?.topicGuid) {
        // UPDATE existente
        console.log("[OpenProject BCF] updating existing topic", {
          topicGuid: customTopic.openProject.topicGuid
        });

        const bcfTopic = this.mapCustomTopicToOpenProjectBcfTopic(
          customTopic,
          customTopic.openProject.topicGuid
        );

        await this.adapter.updateTopic(
          projectId,
          customTopic.openProject.topicGuid,
          bcfTopic
        );

        // Sincronizar comments nuevos
        await this.syncCommentsToOpenProject(
          projectId,
          customTopic.openProject.topicGuid,
          customTopic
        );

        openProjectInfo.lastSyncedAt = now;
        openProjectInfo.lastSyncedHash = currentHash;
        openProjectInfo.syncStatus = "synced";
        openProjectInfo.lastError = undefined;
      } else {
        // CREATE nuevo
        console.log("[OpenProject BCF] creating new topic in OpenProject");

        const bcfTopic = this.mapCustomTopicToOpenProjectBcfTopic(customTopic);
        const created = await this.adapter.createTopic(projectId, bcfTopic);

        openProjectInfo.projectId = projectId;
        openProjectInfo.topicGuid = created.guid;
        openProjectInfo.href = `/api/bcf/2.1/projects/${projectId}/topics/${created.guid}`;
        openProjectInfo.lastSyncedAt = now;
        openProjectInfo.lastSyncedHash = currentHash;
        openProjectInfo.syncStatus = "synced";
        openProjectInfo.lastError = undefined;

        // Sincronizar comments iniciales
        if (customTopic.comments.length > 0) {
          await this.syncCommentsToOpenProject(
            projectId,
            created.guid,
            customTopic
          );
        }
      }

      // Intentar sincronizar snapshot/viewpoint si existe
      if (customTopic.snapshot && openProjectInfo.topicGuid) {
        try {
          await this.syncViewpointToOpenProject(
            projectId,
            openProjectInfo.topicGuid,
            customTopic
          );
        } catch (vpError) {
          warnings.push(
            "Viewpoint/snapshot no sincronizado porque la API actual no expone endpoint compatible o falló la subida."
          );
          console.warn("[OpenProject BCF] viewpoint sync warning", vpError);
        }
      }

      return {
        ok: true,
        openProject: {
          projectId: openProjectInfo.projectId,
          topicGuid: openProjectInfo.topicGuid,
          href: openProjectInfo.href,
          lastSyncedAt: openProjectInfo.lastSyncedAt,
          lastSyncedHash: openProjectInfo.lastSyncedHash
        },
        warnings,
        errors
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[OpenProject BCF] pushTopic error", errorMessage);

      openProjectInfo.syncStatus = "error";
      openProjectInfo.lastError = errorMessage.slice(0, 300);

      return {
        ok: false,
        openProject: {
          projectId: openProjectInfo.projectId,
          topicGuid: openProjectInfo.topicGuid,
          href: openProjectInfo.href,
          lastSyncedAt: openProjectInfo.lastSyncedAt,
          lastSyncedHash: openProjectInfo.lastSyncedHash
        },
        warnings,
        errors: [errorMessage]
      };
    }
  }

  async pullTopic(
    projectId: string,
    topicGuid: string
  ): Promise<BcfSyncResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    console.log("[OpenProject BCF] pullTopic", { projectId, topicGuid });

    try {
      const remoteTopic = await this.adapter.getTopic(projectId, topicGuid);
      const mappedFields = this.mapOpenProjectBcfTopicToCustomTopic(remoteTopic);

      console.log("[OpenProject BCF] pullTopic result", {
        guid: remoteTopic.guid,
        title: remoteTopic.title
      });

      return {
        ok: true,
        openProject: {
          projectId,
          topicGuid: remoteTopic.guid,
          href: `/api/bcf/2.1/projects/${projectId}/topics/${remoteTopic.guid}`,
          lastSyncedAt: new Date().toISOString()
        },
        warnings,
        errors
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      console.error("[OpenProject BCF] pullTopic error", errorMessage);

      return {
        ok: false,
        warnings,
        errors: [errorMessage]
      };
    }
  }

  async syncTopic(
    projectId: string,
    customTopic: BcfTopic,
    direction: "push" | "pull" | "both"
  ): Promise<BcfSyncResult> {
    // Por ahora solo push
    if (direction === "push" || direction === "both") {
      return this.pushTopic(projectId, customTopic);
    }

    if (direction === "pull" && customTopic.openProject?.topicGuid) {
      return this.pullTopic(projectId, customTopic.openProject.topicGuid);
    }

    return {
      ok: false,
      warnings: [],
      errors: [`Direction "${direction}" not supported or missing topicGuid for pull`]
    };
  }

  async listProjects() {
    return this.adapter.listProjects();
  }

  async listTopics(projectId: string) {
    return this.adapter.listTopics(projectId);
  }

  async getTopic(projectId: string, topicGuid: string) {
    return this.adapter.getTopic(projectId, topicGuid);
  }

  /** Sincroniza comments del customTopic a OpenProject (solo comments nuevos) */
  private async syncCommentsToOpenProject(
    projectId: string,
    openProjectTopicGuid: string,
    customTopic: BcfTopic
  ) {
    try {
      const existingComments = await this.adapter.listComments(projectId, openProjectTopicGuid);
      const existingCommentTexts = new Set(
        existingComments.map((c) => (c.comment ?? "").trim())
      );

      for (const comment of customTopic.comments) {
        const commentText = comment.comment.trim();
        if (existingCommentTexts.has(commentText)) continue;

        await this.adapter.createComment(projectId, openProjectTopicGuid, {
          guid: comment.id,
          comment: comment.comment,
          author: comment.author ?? customTopic.author ?? "",
          date: comment.date
        });

        console.log("[OpenProject BCF] comment synced", {
          topicGuid: openProjectTopicGuid,
          commentId: comment.id
        });
      }
    } catch (error) {
      console.warn("[OpenProject BCF] comment sync warning", error);
      throw error;
    }
  }

  /** Intenta sincronizar snapshot como viewpoint en OpenProject */
  private async syncViewpointToOpenProject(
    projectId: string,
    openProjectTopicGuid: string,
    customTopic: BcfTopic
  ) {
    if (!customTopic.snapshot) return;

    let base64Data: string;

    try {
      if (customTopic.snapshot.startsWith("data:")) {
        base64Data = customTopic.snapshot.split(",")[1] ?? customTopic.snapshot;
      } else {
        // Es una URL, intentar descargar
        const response = await fetch(customTopic.snapshot);
        if (!response.ok) {
          console.warn("[OpenProject BCF] Could not download snapshot from URL", customTopic.snapshot.slice(0, 80));
          return;
        }
        const buffer = await response.arrayBuffer();
        base64Data = Buffer.from(buffer).toString("base64");
      }
    } catch (fetchError) {
      console.warn("[OpenProject BCF] Failed to fetch snapshot data", fetchError);
      return;
    }

    const viewpoint: OpenProjectBcfViewpointInput = {
      snapshot: {
        snapshot_type: "png",
        snapshot_data: base64Data
      }
    };

    await this.adapter.createViewpoint(projectId, openProjectTopicGuid, viewpoint);
    console.log("[OpenProject BCF] viewpoint synced", { topicGuid: openProjectTopicGuid });
  }

  /** Detecta si hay conflicto comparando hash local vs último synced */
  detectConflict(customTopic: BcfTopic): boolean {
    const opInfo = customTopic.openProject;
    if (!opInfo?.lastSyncedHash) return false;

    const currentHash = this.computeHash(customTopic);
    return currentHash !== opInfo.lastSyncedHash;
  }
}