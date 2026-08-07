import { Router } from "express";
import {
  getBcfTopics,
  saveBcfTopics,
  deleteBcfTopic,
  BcfTopic
} from "../services/bcf-topics.service";
import {
  projectAuthorizedRoute,
  projectCodeFromAny
} from "../middleware/authorization.middleware";

const router = Router();

// GET → obtener todos los topics
router.get("/topics", async (req, res) => {
  try {
    const projectCode =
      typeof req.query.projectCode === "string"
        ? req.query.projectCode.trim().toUpperCase()
        : "";

    const topics = await getBcfTopics(projectCode);

    res.json({
      success: true,
      data: topics
    });
  } catch (error) {
    console.error("Error getting BCF topics:", error);
    res.status(500).json({ success: false });
  }
});

// PUT → guardar todos los topics
router.put(
  "/topics",
  projectAuthorizedRoute({
    permission: "bcf:write",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode)
  }),
  async (req, res) => {
  try {
    const projectCode =
      typeof req.query.projectCode === "string"
        ? req.query.projectCode.trim().toUpperCase()
        : "";

    if (!projectCode) {
      return res.status(400).json({
        success: false,
        message: "projectCode es obligatorio para guardar topics BCF"
      });
    }

    const topics = req.body as BcfTopic[];

    if (!Array.isArray(topics)) {
      return res.status(400).json({ success: false });
    }

    await saveBcfTopics(topics, projectCode);

    res.json({ success: true });
  } catch (error) {
    console.error("Error saving BCF topics:", error);
    res.status(500).json({ success: false });
  }
  }
);

router.delete(
  "/topics/:id",
  projectAuthorizedRoute({
    permission: "bcf:write",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode)
  }),
  async (req, res) => {
    try {
      const projectCode =
        typeof req.query.projectCode === "string"
          ? req.query.projectCode.trim().toUpperCase()
          : "";

      if (!projectCode) {
        return res.status(400).json({
          success: false,
          message: "projectCode es obligatorio para eliminar topics BCF"
        });
      }

      const topicId = Array.isArray(req.params.id)
        ? req.params.id[0]
        : req.params.id;

      const deleted = await deleteBcfTopic(topicId, projectCode);

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Topic BCF no encontrado"
        });
      }

      res.json({ success: true, data: { deleted: true } });
    } catch (error) {
      console.error("Error deleting BCF topic:", error);
      res.status(500).json({
        success: false,
        message: "No se pudo eliminar el topic BCF"
      });
    }
  }
);

export default router;
