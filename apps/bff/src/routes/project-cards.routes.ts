import { Router } from "express";
import { ProjectCardsService } from "../services/project-cards.service";
import type {
  CreateProjectCardInput,
  CreateProjectCardFromPortalInput,
  UpdateProjectCardInput,
  DeleteProjectCardInput
} from "../types/project-card.types";
import projectMembersRoutes from "./project-members.routes";

const router = Router();
const projectCardsService = new ProjectCardsService();
router.use("/:code/members", projectMembersRoutes);

router.get("/", async (_req, res) => {
  try {
    const projectCards = await projectCardsService.getAll();

    return res.json({
      success: true,
      data: projectCards
    });
  } catch (error) {
    console.error("[project-cards.routes] GET / error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudieron listar las Project Cards"
    });
  }
});

router.post("/", async (req, res) => {
  try {
    const input = req.body as CreateProjectCardInput;

    if (!input.code || !input.name || !input.openProject?.projectId) {
      return res.status(400).json({
        success: false,
        message: "code, name y openProject.projectId son obligatorios"
      });
    }

    const projectCard = await projectCardsService.createOrUpdate(input);

    return res.status(201).json({
      success: true,
      data: projectCard
    });
  } catch (error) {
    console.error("[project-cards.routes] POST / error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo crear o actualizar la Project Card"
      });
  }
});

router.post("/:code/provision", async (req, res) => {
  try {
    const result = await projectCardsService.provisionProjectInfrastructure(
      req.params.code
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("[project-cards.routes] POST /:code/provision error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo provisionar la infraestructura del proyecto"
    });
  }
});

router.post("/from-portal", async (req, res) => {
  try {
    const input = req.body as CreateProjectCardFromPortalInput;

    if (!input.code || !input.name) {
      return res.status(400).json({
        success: false,
        message: "code y name son obligatorios"
      });
    }

    const result = await projectCardsService.createFromPortal(input);

    return res.status(201).json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("[project-cards.routes] POST /from-portal error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo crear el proyecto desde el portal"
    });
  }
});

router.post("/:code/archive", async (req, res) => {
  try {
    const projectCard = await projectCardsService.archiveProjectCard(
      req.params.code
    );

    return res.json({
      success: true,
      data: projectCard
    });
  } catch (error) {
    console.error("[project-cards.routes] POST /:code/archive error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo archivar el proyecto"
    });
  }
});
router.put("/:code", async (req, res) => {
  try {
    const input = req.body as UpdateProjectCardInput;

    const projectCard = await projectCardsService.updateProjectCard(
      req.params.code,
      input
    );

    return res.json({
      success: true,
      data: projectCard
    });
  } catch (error) {
    console.error("[project-cards.routes] PUT /:code error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo actualizar el proyecto"
    });
  }
});
router.delete("/:code", async (req, res) => {
  try {
    const input = req.body as DeleteProjectCardInput;

    if (!input.confirmationName) {
      return res.status(400).json({
        success: false,
        message: "confirmationName es obligatorio"
      });
    }

    const result = await projectCardsService.hardDeleteProjectCard(
      req.params.code,
      input
    );

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error("[project-cards.routes] DELETE /:code error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo eliminar definitivamente el proyecto"
    });
  }
});

router.get("/:code", async (req, res) => {
  try {
    const projectCard = await projectCardsService.getByCode(req.params.code);

    if (!projectCard) {
      return res.status(404).json({
        success: false,
        message: `No existe Project Card para '${req.params.code}'`
      });
    }

    return res.json({
      success: true,
      data: projectCard
    });
  } catch (error) {
    console.error("[project-cards.routes] GET /:code error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo obtener la Project Card"
    });
  }
});

export default router;