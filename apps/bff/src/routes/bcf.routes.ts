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
    const topics = await getBcfTopics();

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
    const topics = req.body as BcfTopic[];

    if (!Array.isArray(topics)) {
      return res.status(400).json({ success: false });
    }

    await saveBcfTopics(topics);

    res.json({ success: true });
  } catch (error) {
    console.error("Error saving BCF topics:", error);
    res.status(500).json({ success: false });
  }
});

export default router;