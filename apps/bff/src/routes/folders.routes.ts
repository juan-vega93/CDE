import { Router } from "express";
import {
  getFolders,
  getFolderTree,
  createFolder,
  deleteFolder,
  moveFolder,
  renameFolder
} from "../services/folders.service";
import type { ApiResponse } from "../types/api.types";
import type { FoldersResponse, FolderTreeResponse } from "../types/folder.types";
import {
  projectAuthorizedRoute,
  projectCodeFromAny
} from "../middleware/authorization.middleware";

const router = Router();

router.get(
  "/tree",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode, req.query.rootPath)
  }),
  async (req, res) => {
    try {
      const rootPath = (req.query.rootPath as string) || "/";
      const depth = Number(req.query.depth || 4);
      const focusPath =
        typeof req.query.focusPath === "string" ? req.query.focusPath : undefined;
      const tree = await getFolderTree(rootPath, depth, focusPath);

      const response: ApiResponse<FolderTreeResponse> = {
        success: true,
        data: {
          rootPath,
          depth: Math.min(Math.max(Number(depth) || 1, 1), 8),
          tree
        }
      };

      res.json(response);
    } catch (error) {
      console.error("[folders.routes] GET /tree error:", error);

      res.status(500).json({
        success: false,
        message: "No se pudo obtener el arbol de carpetas"
      });
    }
  }
);

router.get(
  "/",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode, req.query.path)
  }),
  async (req, res) => {
  const path = (req.query.path as string) || "/";
  const result: FoldersResponse = await getFolders(path);

  const response: ApiResponse<FoldersResponse> = {
    success: true,
    data: result
  };

  res.json(response);
  }
);

router.post(
  "/",
  projectAuthorizedRoute({
    permission: "document:write",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.projectCode, req.body?.parentPath)
  }),
  async (req, res) => {
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
  }
);

router.delete(
  "/",
  projectAuthorizedRoute({
    permission: "document:hard-delete",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.projectCode, req.body?.folderPath)
  }),
  async (req, res) => {
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
  }
);

router.put(
  "/move",
  projectAuthorizedRoute({
    permission: "document:write",
    source: "body",
    projectCode: (req) =>
      projectCodeFromAny(
        req.body?.projectCode,
        req.body?.folderPath,
        req.body?.destinationFolderPath
      )
  }),
  async (req, res) => {
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
  }
);
router.put(
  "/rename",
  projectAuthorizedRoute({
    permission: "document:write",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.projectCode, req.body?.folderPath)
  }),
  async (req, res) => {
  try {
    const { folderPath, newName } = req.body as {
      folderPath?: string;
      newName?: string;
    };

    if (!folderPath || !newName?.trim()) {
      return res.status(400).json({
        success: false,
        message: "folderPath y newName son obligatorios"
      });
    }

    await renameFolder(folderPath, newName.trim());

    return res.json({
      success: true,
      data: {
        folderPath,
        newName: newName.trim()
      }
    });
  } catch (error) {
    console.error("[folders.routes] PUT /rename error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "No se pudo renombrar la carpeta";

    return res.status(500).json({
      success: false,
      message
    });
  }
  }
);

export default router;
