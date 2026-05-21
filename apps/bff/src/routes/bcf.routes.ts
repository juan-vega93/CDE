import { Router } from "express";
import {
  getBcfTopics,
  saveBcfTopics,
  BcfTopic
} from "../services/bcf-topics.service";

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
router.put("/topics", async (req, res) => {
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
});

export default router;