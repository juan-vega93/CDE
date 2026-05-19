import { Router } from "express";
import {
  getWorkPackages,
  getWorkPackageById,
  createWorkPackageFromBcfTopic
} from "../services/work-packages.service";
import { getBcfTopics, saveBcfTopics } from "../services/bcf-topics.service";
import type { ApiResponse } from "../types/api.types";
import type { WorkPackage, CreateWorkPackageInput } from "../types/work-package.types";

const router = Router();

router.get("/", (_req, res) => {
  const workPackages = getWorkPackages();

  const response: ApiResponse<WorkPackage[]> = {
    success: true,
    data: workPackages
  };

  res.json(response);
});

router.post("/from-bcf-topic", async (req, res) => {
  try {
    const input = req.body as CreateWorkPackageInput;

    if (!input.subject?.trim()) {
      input.subject = "Incidencia desde CDE Portal";
    }

    if (!input.description?.trim()) {
      input.description = "Creado desde el visor BCF del CDE Portal";
    }

    const workPackage = await createWorkPackageFromBcfTopic(input);

    if (input.bcfTopicId && workPackage.openProjectId) {
      try {
        const allTopics = await getBcfTopics();
        const topicIndex = allTopics.findIndex((t) => t.id === input.bcfTopicId);

        if (topicIndex >= 0) {
          const openProjectId = String(workPackage.openProjectId);

          allTopics[topicIndex] = {
            ...allTopics[topicIndex],
            modifiedDate: new Date().toISOString(),
            openProject: {
              ...allTopics[topicIndex].openProject,
              projectId: String(process.env.OPENPROJECT_PROJECT_ID ?? "3"),
              workPackageId: openProjectId,
              href: `/work_packages/${openProjectId}`,
              lastSyncedAt: new Date().toISOString(),
              syncStatus: "synced"
            }
          };

          await saveBcfTopics(allTopics);
        }
      } catch (syncError) {
        console.warn("[work-packages] Error syncing BCF topic metadata:", syncError);
      }
    }

    const response: ApiResponse<WorkPackage> = {
      success: true,
      data: workPackage
    };

    res.status(201).json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    console.error("[work-packages] POST /from-bcf-topic error:", message);

    res.status(500).json({
      success: false,
      message: `Error creando WorkPackage desde BCF topic: ${message.slice(0, 300)}`
    });
  }
});

router.get("/:id", async (req, res) => {
  const id = Number(req.params.id);

  if (!Number.isFinite(id)) {
    return res.status(400).json({
      success: false,
      message: "ID inválido"
    });
  }

  const workPackage = await getWorkPackageById(id);

  if (!workPackage) {
    return res.status(404).json({
      success: false,
      message: "Work package no encontrado"
    });
  }

  const response: ApiResponse<WorkPackage> = {
    success: true,
    data: workPackage
  };

  res.json(response);
});

export default router;