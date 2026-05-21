import { Router } from "express";
import { createWorkPackage } from "../services/work-packages.service";
import { createWorkPackageLink } from "../services/work-package-links.service";
import { OpenProjectProjectsService } from "../services/openproject-projects.service";
import type { ApiResponse } from "../types/api.types";
import type { WorkPackage } from "../types/work-package.types";
import type { WorkPackageLink } from "../types/work-package-link.types";

const router = Router();

const openProjectProjectsService = new OpenProjectProjectsService();

function getProjectCodeFromDocumentPath(documentPath: string): string {
  const projectCode = String(documentPath || "")
    .split("/")
    .filter(Boolean)[0]
    ?.trim()
    .toUpperCase();

  if (!projectCode) {
    throw new Error("No se pudo determinar el código del proyecto desde la ruta del documento");
  }

  return projectCode;
}

router.post("/send", async (req, res) => {
  try {
    const {
      documentId,
      documentPath,
      documentName,
      typeId,
      subject,
      description,
      assigneeId,
      dueDate
    } = req.body;

    if (!documentId || !documentPath || !documentName) {
      return res.status(400).json({
        success: false,
        message: "documentId, documentPath y documentName son obligatorios"
      });
    }

    const projectCode = getProjectCodeFromDocumentPath(documentPath);

    const openProjectResult =
      await openProjectProjectsService.createOrGetProject({
        code: projectCode,
        name: projectCode,
        description: `Proyecto ${projectCode} vinculado desde CDE Portal`
      });

    const openProjectProjectId = openProjectResult.project.id;

    const workPackage = await createWorkPackage({
      subject: subject || `Revisión de ${documentName}`,
      description:
        description ||
        `Enviar documento ${documentName} a revisión técnica.\n\nDocumento: ${documentPath}`,
      assigneeId,
      dueDate,
      projectCode,
      openProjectProjectId
    });

    const workPackageId = workPackage.openProjectId ?? workPackage.id;

    const link = createWorkPackageLink({
      documentId,
      documentPath,
      documentName,
      workPackageId,
      projectId: openProjectProjectId,
      typeId: Number(typeId || process.env.OPENPROJECT_TYPE_ID || 1),
      linkType: "review"
    });

    const response: ApiResponse<{
      workPackage: WorkPackage;
      link: WorkPackageLink;
    }> = {
      success: true,
      data: {
        workPackage,
        link
      }
    };

    return res.status(201).json(response);
  } catch (error) {
    console.error("[reviews.routes] POST /send error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "No se pudo enviar el documento a revisión";

    return res.status(500).json({
      success: false,
      message
    });
  }
});

export default router;