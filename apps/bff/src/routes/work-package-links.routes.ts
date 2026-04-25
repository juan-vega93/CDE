import { Router } from "express";
import {
  createWorkPackageLink,
  getWorkPackageLinks,
  getWorkPackageLinkByDocumentId
} from "../services/work-package-links.service";
import type { ApiResponse } from "../types/api.types";
import type {
  WorkPackageLink,
  CreateWorkPackageLinkInput
} from "../types/work-package-link.types";
import { syncWorkPackageStatusByDocumentId } from "../services/work-package-links.service";

const router = Router();

router.get("/", (_req, res) => {
  try {
    const links = getWorkPackageLinks();

    const response: ApiResponse<WorkPackageLink[]> = {
      success: true,
      data: links
    };

    res.json(response);
  } catch (error) {
    console.error("[work-package-links.routes] GET / error:", error);

    res.status(500).json({
      success: false,
      message: "Error al obtener vínculos de work package"
    });
  }
});

router.get("/document/:documentId", (req, res) => {
  try {
    const documentId = req.params.documentId;
    const link = getWorkPackageLinkByDocumentId(documentId);

    if (!link) {
      return res.status(404).json({
        success: false,
        message: "No se encontró vínculo para este documento"
      });
    }

    const response: ApiResponse<WorkPackageLink> = {
      success: true,
      data: link
    };

    res.json(response);
  } catch (error) {
    console.error("[work-package-links.routes] GET /document/:documentId error:", error);

    res.status(500).json({
      success: false,
      message: "Error al obtener vínculo del documento"
    });
  }
});

router.post("/", (req, res) => {
  try {
    const body = req.body as CreateWorkPackageLinkInput;

    if (
      !body.documentId ||
      !body.documentPath ||
      !body.documentName ||
      !body.workPackageId ||
      !body.projectId ||
      !body.typeId ||
      !body.linkType
    ) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos obligatorios para crear el vínculo"
      });
    }

    const newLink = createWorkPackageLink(body);

    const response: ApiResponse<WorkPackageLink> = {
      success: true,
      data: newLink
    };

    res.status(201).json(response);
  } catch (error) {
    console.error("[work-package-links.routes] POST / error:", error);

    res.status(500).json({
      success: false,
      message: "Error al crear vínculo de work package"
    });
  }
});

router.post("/document/:documentId/sync", async (req, res) => {
  try {
    const documentId = req.params.documentId;

    const link = await syncWorkPackageStatusByDocumentId(documentId);

    if (!link) {
      return res.status(404).json({
        success: false,
        message: "No se encontró vínculo para este documento"
      });
    }

    res.json({
      success: true,
      data: link
    });
  } catch (error) {
    console.error("[sync route] error:", error);

    res.status(500).json({
      success: false,
      message: "Error sincronizando estado del WorkPackage"
    });
  }
});
export default router;