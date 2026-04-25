import { Router } from "express";
import type { ApiResponse } from "../types/api.types";
import {
  getViewpoints,
  saveViewpoints,
  type StoredViewerViewpoint
} from "../services/viewpoints.service";

const router = Router();

router.get("/", async (req, res) => {
  try {
    const documentPath = (req.query.documentPath as string) || "";

    if (!documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "documentPath es obligatorio"
      });
    }

    const viewpoints = await getViewpoints(documentPath);

    const response: ApiResponse<StoredViewerViewpoint[]> = {
      success: true,
      data: viewpoints
    };

    return res.json(response);
  } catch (error) {
    console.error("[viewpoints.routes] GET / error:", error);

    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener los viewpoints"
    });
  }
});

router.put("/", async (req, res) => {
  try {
    const { documentPath, viewpoints } = req.body as {
      documentPath?: string;
      viewpoints?: StoredViewerViewpoint[];
    };

    if (!documentPath?.trim()) {
      return res.status(400).json({
        success: false,
        message: "documentPath es obligatorio"
      });
    }

    if (!Array.isArray(viewpoints)) {
      return res.status(400).json({
        success: false,
        message: "viewpoints debe ser un array"
      });
    }

    await saveViewpoints(documentPath, viewpoints);

    return res.json({
      success: true,
      data: {
        documentPath,
        count: viewpoints.length
      }
    });
  } catch (error) {
    console.error("[viewpoints.routes] PUT / error:", error);

    return res.status(500).json({
      success: false,
      message: "No se pudieron guardar los viewpoints"
    });
  }
});

export default router;