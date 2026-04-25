import { Router } from "express";
import { createWorkPackage } from "../services/work-packages.service";
import { createWorkPackageLink } from "../services/work-package-links.service";
import type { ApiResponse } from "../types/api.types";
import type { WorkPackage } from "../types/work-package.types";
import type { WorkPackageLink } from "../types/work-package-link.types";

type SendToReviewInput = {
  documentId: string;
  documentPath: string;
  documentName: string;
  projectId: number;
  typeId: number;
  subject: string;
  description: string;
  assigneeId?: number;
  dueDate?: string;
};

type SendToReviewResponse = {
  workPackage: WorkPackage;
  link: WorkPackageLink;
};

const router = Router();

router.post("/send", async (req, res) => {
  try {
    const body = req.body as SendToReviewInput;

    if (
      !body.documentId ||
      !body.documentPath ||
      !body.documentName ||
      !body.projectId ||
      !body.typeId ||
      !body.subject ||
      !body.description
    ) {
      return res.status(400).json({
        success: false,
        message: "Faltan campos obligatorios para enviar a revisión"
      });
    }

    const workPackage = await createWorkPackage({
      subject: body.subject,
      description: body.description,
      assigneeId: body.assigneeId,
      dueDate: body.dueDate
    });

    const link = createWorkPackageLink({
      documentId: body.documentId,
      documentPath: body.documentPath,
      documentName: body.documentName,
      workPackageId: workPackage.id,
      projectId: body.projectId,
      typeId: body.typeId,
      linkType: "review"
    });

    const response: ApiResponse<SendToReviewResponse> = {
      success: true,
      data: {
        workPackage,
        link
      }
    };

    res.status(201).json(response);
  } catch (error) {
    console.error("[reviews.routes] POST /send error:", error);

    res.status(500).json({
      success: false,
      message: "Error al enviar documento a revisión"
    });
  }
});

export default router;