import { Router } from "express";
import { OpenProjectBcfService } from "../services/openproject-bcf.service";
import { getBcfTopics, saveBcfTopics } from "../services/bcf-topics.service";
import type { BcfTopic } from "../services/bcf-topics.service";

const router = Router();
const openProjectBcfService = new OpenProjectBcfService();

// ---- Health / Conexión ----

router.get("/health", async (_req, res) => {
  try {
    const baseUrl = process.env.OPENPROJECT_BASE_URL || "";
    const connectionResult = await openProjectBcfService["adapter"]
      .testConnection()
      .catch(() => null);

    res.json({
      success: true,
      data: {
        baseUrl,
        mode: process.env.USE_OPENPROJECT_MOCK === "false" ? "real" : "mock",
        bcfApiReachable: connectionResult?.ok ?? false,
        bcfApiStatus: connectionResult?.status ?? null
      }
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    res.status(500).json({
      success: false,
      message: `OpenProject BCF health check failed: ${message.slice(0, 300)}`
    });
  }
});

// ---- Proyectos ----

router.get("/projects", async (_req, res) => {
  try {
    const projects = await openProjectBcfService.listProjects();
    res.json({ success: true, data: projects });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[OpenProject BCF] projects error", message.slice(0, 300));
    res.status(500).json({ success: false, message: `Error listing projects: ${message.slice(0, 300)}` });
  }
});

// ---- Topics de un proyecto ----

router.get("/projects/:projectId/topics", async (req, res) => {
  try {
    const { projectId } = req.params;
    const topics = await openProjectBcfService.listTopics(projectId);
    res.json({ success: true, data: topics });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[OpenProject BCF] topics error", message.slice(0, 300));
    res.status(500).json({ success: false, message: `Error listing topics: ${message.slice(0, 300)}` });
  }
});

// ---- Topic individual ----

router.get("/projects/:projectId/topics/:topicGuid", async (req, res) => {
  try {
    const { projectId, topicGuid } = req.params;
    const topic = await openProjectBcfService.getTopic(projectId, topicGuid);
    res.json({ success: true, data: topic });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[OpenProject BCF] getTopic error", message.slice(0, 300));
    res.status(500).json({ success: false, message: `Error getting topic: ${message.slice(0, 300)}` });
  }
});

// ---- PUSH topic (custom -> OpenProject) ----

router.post("/topics/push", async (req, res) => {
  try {
    const { projectId, topic } = req.body as {
      projectId: string;
      topic: BcfTopic;
    };

    if (!projectId || !topic?.id) {
      return res.status(400).json({
        success: false,
        message: "projectId y topic son obligatorios"
      });
    }

    console.log("[OpenProject BCF] POST /topics/push", {
      customId: topic.id,
      title: topic.title,
      projectId
    });

    const result = await openProjectBcfService.pushTopic(projectId, topic);

    // Si el push fue exitoso, persistir metadata en el topic custom
    if (result.ok && result.openProject) {
      const allTopics = await getBcfTopics();
      const topicIndex = allTopics.findIndex((t) => t.id === topic.id);

      if (topicIndex >= 0) {
        allTopics[topicIndex] = {
          ...allTopics[topicIndex],
          openProject: {
            ...allTopics[topicIndex].openProject,
            projectId: result.openProject.projectId ?? allTopics[topicIndex].openProject?.projectId,
            topicGuid: result.openProject.topicGuid ?? allTopics[topicIndex].openProject?.topicGuid,
            href: result.openProject.href ?? allTopics[topicIndex].openProject?.href,
            lastSyncedAt: result.openProject.lastSyncedAt,
            lastSyncedHash: result.openProject.lastSyncedHash,
            syncStatus: "synced",
            lastError: undefined
          }
        };

        await saveBcfTopics(allTopics);
        console.log("[OpenProject BCF] topic metadata persisted", {
          customId: topic.id,
          topicGuid: result.openProject.topicGuid
        });
      }
    }

    console.log("[OpenProject BCF] push result", {
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings
    });

    res.json({ success: true, data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[OpenProject BCF] push error", message.slice(0, 500));
    res.status(500).json({
      success: false,
      message: `Error pushing topic: ${message.slice(0, 300)}`
    });
  }
});

// ---- PULL topic (OpenProject -> custom) ----

router.post("/topics/pull", async (req, res) => {
  try {
    const { projectId, topicGuid } = req.body as {
      projectId: string;
      topicGuid: string;
    };

    if (!projectId || !topicGuid) {
      return res.status(400).json({
        success: false,
        message: "projectId y topicGuid son obligatorios"
      });
    }

    console.log("[OpenProject BCF] POST /topics/pull", { projectId, topicGuid });

    const result = await openProjectBcfService.pullTopic(projectId, topicGuid);

    console.log("[OpenProject BCF] pull result", {
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings
    });

    res.json({ success: true, data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[OpenProject BCF] pull error", message.slice(0, 500));
    res.status(500).json({
      success: false,
      message: `Error pulling topic: ${message.slice(0, 300)}`
    });
  }
});

// ---- SYNC topic (push inicialmente) ----

router.post("/topics/sync", async (req, res) => {
  try {
    const { projectId, topic, direction } = req.body as {
      projectId: string;
      topic: BcfTopic;
      direction: "push" | "pull" | "both";
    };

    if (!projectId || !topic?.id) {
      return res.status(400).json({
        success: false,
        message: "projectId y topic son obligatorios"
      });
    }

    const syncDirection = direction ?? "push";

    console.log("[OpenProject BCF] POST /topics/sync", {
      customId: topic.id,
      title: topic.title,
      projectId,
      direction: syncDirection
    });

    const result = await openProjectBcfService.syncTopic(
      projectId,
      topic,
      syncDirection
    );

    console.log("[OpenProject BCF] sync result", {
      ok: result.ok,
      errors: result.errors,
      warnings: result.warnings
    });

    res.json({ success: true, data: result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[OpenProject BCF] sync error", message.slice(0, 500));
    res.status(500).json({
      success: false,
      message: `Error syncing topic: ${message.slice(0, 300)}`
    });
  }
});

export default router;