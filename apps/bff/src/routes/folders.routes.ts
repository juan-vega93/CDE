import { Router } from "express";
import {
  getFolders,
  createFolder,
  deleteFolder,
  moveFolder
} from "../services/folders.service";
import type { ApiResponse } from "../types/api.types";
import type { FoldersResponse } from "../types/folder.types";

const router = Router();

router.get("/", async (req, res) => {
  const path = (req.query.path as string) || "/";
  const result: FoldersResponse = await getFolders(path);

  const response: ApiResponse<FoldersResponse> = {
    success: true,
    data: result
  };

  res.json(response);
});

router.post("/", async (req, res) => {
  try {
    const parentPath = (req.body.parentPath as string) || "/";
    const folderName = (req.body.folderName as string) || "";

    if (!folderName.trim()) {
      return res.status(400).json({
        success: false,
        message: "El nombre de la carpeta es obligatorio"
      });
    }

    const normalizedParentPath =
      parentPath === "/" ? "" : parentPath.replace(/\/$/, "");

    const folderPath =
      `${normalizedParentPath}/${folderName}` || `/${folderName}`;

    await createFolder(folderPath);

    res.status(201).json({
      success: true,
      data: {
        path: folderPath
      }
    });
  } catch (error) {
    console.error("[folders.routes] POST / error:", error);

    res.status(500).json({
      success: false,
      message: "No se pudo crear la carpeta"
    });
  }
});

router.delete("/", async (req, res) => {
  try {
    const folderPath = (req.body.folderPath as string) || "";

    if (!folderPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "La ruta de la carpeta es obligatoria"
      });
    }

    await deleteFolder(folderPath);

    res.json({
      success: true,
      data: {
        path: folderPath
      }
    });
  } catch (error) {
    console.error("[folders.routes] DELETE / error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "No se pudo eliminar la carpeta";

    res.status(400).json({
      success: false,
      message
    });
  }
});

router.put("/move", async (req, res) => {
  try {
    const { folderPath, destinationFolderPath } = req.body;

    if (!folderPath || !destinationFolderPath) {
      return res.status(400).json({
        success: false,
        message: "folderPath y destinationFolderPath son obligatorios"
      });
    }

    await moveFolder(folderPath, destinationFolderPath);

    res.json({
      success: true,
      data: {
        folderPath,
        destinationFolderPath
      }
    });
  } catch (error) {
    console.error("[folders.routes] PUT /move error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "No se pudo mover la carpeta";

    res.status(500).json({
      success: false,
      message
    });
  }
});

export default router;