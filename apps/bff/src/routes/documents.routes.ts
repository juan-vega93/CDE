import { Router } from "express";
import {
  getDocuments,
  getDocumentById,
  getDocumentContent,
  uploadDocument,
  deleteDocument,
  renameDocument,
  moveDocument,
  getViewerSource,
  generateAndStoreFrag,
  enqueueFragGeneration,
  queueFragGeneration,
  getFragGenerationQueueStatus,
  getDocumentExplorer,
  getDocumentVersions
} from "../services/documents.service";
import {
  createDocumentAnnotation,
  deleteDocumentAnnotation,
  listDocumentAnnotations,
  listProjectDocumentAnnotations,
  updateDocumentAnnotation
} from "../services/document-annotations.service";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";
import type { ApiResponse } from "../types/api.types";
import type { DocumentsResponse, DocumentItem } from "../types/document.types";
import type { FolderItem, FolderTreeNode } from "../types/folder.types";
import multer from "multer";
import {
  projectAuthorizedRoute,
  projectCodeFromAny,
  systemAdminRoute
} from "../middleware/authorization.middleware";


const BLOCKED_EXTENSIONS = [
  "exe",
  "msi",
  "bat",
  "cmd",
  "com",
  "ps1",
  "sh",
  "jar",
  "vbs",
  "dll",
  "apk",
  "reg",
  "iso"
];

const BLOCKED_FILENAMES = [
  ".ds_store",
  "thumbs.db"
];

function getFileExtension(fileName: string): string {
  const parts = fileName.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

function isBlockedFile(fileName: string): boolean {
  const lowerName = fileName.toLowerCase();

  // archivos temporales tipo ~$archivo.docx
  if (lowerName.startsWith("~$")) {
    return true;
  }

  // archivos basura conocidos
  if (BLOCKED_FILENAMES.includes(lowerName)) {
    return true;
  }

  // extensiones bloqueadas
  const ext = getFileExtension(lowerName);
  if (BLOCKED_EXTENSIONS.includes(ext)) {
    return true;
  }

  return false;
}

function normalizePortalPath(value: string): string {
  const clean = value.trim();

  if (!clean) return "/";
  return clean.startsWith("/")
    ? clean.replace(/\/$/, "") || "/"
    : `/${clean.replace(/\/$/, "")}`;
}

function getFolderName(portalPath: string): string {
  const normalizedPath = normalizePortalPath(portalPath);
  return normalizedPath === "/"
    ? "Repositorio"
    : normalizedPath.split("/").filter(Boolean).pop() || "Repositorio";
}

function buildExplorerTreeFromCurrentDirectory(
  rootPath: string,
  focusPath: string,
  folders: FolderItem[]
): FolderTreeNode {
  const normalizedRootPath = normalizePortalPath(rootPath);
  const normalizedFocusPath = normalizePortalPath(focusPath);
  const rootSegments = normalizedRootPath.split("/").filter(Boolean);
  const focusSegments = normalizedFocusPath.split("/").filter(Boolean);
  const branchSegments = focusSegments.slice(rootSegments.length);
  const currentChildren = folders.map((folder) => ({
    ...folder,
    path: normalizePortalPath(folder.path),
    children: []
  }));

  function buildNode(pathSegments: string[], depth: number): FolderTreeNode {
    const currentPath = pathSegments.length
      ? `/${pathSegments.join("/")}`
      : "/";
    const isFocusPath =
      normalizePortalPath(currentPath) === normalizedFocusPath;
    const nextSegment = branchSegments[depth];

    return {
      name: getFolderName(currentPath),
      path: normalizePortalPath(currentPath),
      type: "folder",
      children: isFocusPath
        ? currentChildren
        : nextSegment
          ? [buildNode([...pathSegments, nextSegment], depth + 1)]
          : []
    };
  }

  return buildNode(rootSegments, 0);
}

const upload = multer();
const router = Router();
const nextcloudAdapter = new NextcloudAdapter();

router.get(
  "/viewer-source",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.documentPath)
  }),
  async (req, res) => {
  try {
    const documentPath = req.query.documentPath;
    const documentVersionId =
      typeof req.query.documentVersionId === "string"
        ? req.query.documentVersionId
        : null;

    if (typeof documentPath !== "string" || !documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "documentPath es requerido"
      });
    }

    const data = await getViewerSource(documentPath, documentVersionId);

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error("[documents.routes] viewer-source error:", error);

    return res.status(500).json({
      success: false,
      message: "Error resolviendo fuente del visor"
    });
  }
  }
);

router.post(
  "/generate-frag",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.documentPath, req.query.documentPath)
  }),
  async (req, res) => {
  try {
    const documentPath =
      typeof req.body?.documentPath === "string"
        ? req.body.documentPath
        : typeof req.query.documentPath === "string"
        ? req.query.documentPath
        : "";

    if (!documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "documentPath es requerido"
      });
    }

    const data = await generateAndStoreFrag(documentPath);

    return res.json({
      success: true,
      data,
      message: "FRAG generado correctamente"
    });
  } catch (error) {
    console.error("[documents.routes] generate-frag error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error generando FRAG"
    });
  }
  }
);

router.post(
  "/queue-frag",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.documentPath, req.query.documentPath)
  }),
  async (req, res) => {
  try {
    const documentPath =
      typeof req.body?.documentPath === "string"
        ? req.body.documentPath
        : typeof req.query.documentPath === "string"
        ? req.query.documentPath
        : "";

    if (!documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "documentPath es requerido"
      });
    }

    const data = await queueFragGeneration(documentPath);

    return res.status(202).json({
      success: true,
      data,
      message: "FRAG encolado correctamente"
    });
  } catch (error) {
    console.error("[documents.routes] queue-frag error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : "Error encolando FRAG"
    });
  }
  }
);

router.get(
  "/frag-queue",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode)
  }),
  async (req, res) => {
    const projectCode =
      typeof req.query.projectCode === "string" ? req.query.projectCode : "";
    const projectPrefix = `/${projectCode}/`;
    const status = getFragGenerationQueueStatus();

    return res.json({
      success: true,
      data: {
        ...status,
        queuedPaths: status.queuedPaths.filter((path) => path.startsWith(projectPrefix)),
        activePaths: status.activePaths.filter((path) => path.startsWith(projectPrefix))
      }
    });
  }
);

router.get(
  "/explorer",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode, req.query.path)
  }),
  async (req, res) => {
  const path = (req.query.path as string) || "/";
  const includeTree = req.query.includeTree === "true";
  const treeRootPath =
    typeof req.query.treeRootPath === "string"
      ? req.query.treeRootPath
      : "";
  const treeFocusPath =
    typeof req.query.treeFocusPath === "string"
      ? req.query.treeFocusPath
      : path;
  const result = await getDocumentExplorer(path);
  const folderTree =
    includeTree && treeRootPath
      ? buildExplorerTreeFromCurrentDirectory(
          treeRootPath,
          treeFocusPath,
          result.folders
        )
      : undefined;

  return res.json({
    success: true,
    data: {
      ...result,
      ...(folderTree ? { folderTree } : {})
    }
  });
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
  const result: DocumentsResponse = await getDocuments(path);

  const response: ApiResponse<DocumentsResponse> = {
    success: true,
    data: result
  };

  res.json(response);
  }
);

router.get(
  "/content",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode, req.query.path)
  }),
  async (req, res) => {
  try {
    const documentPath = (req.query.path as string) || "";
    const documentVersionId =
      typeof req.query.documentVersionId === "string"
        ? req.query.documentVersionId
        : null;

    if (!documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "La ruta del documento es obligatoria"
      });
    }

    const { buffer, contentType, fileName, size } =
      await getDocumentContent(documentPath, documentVersionId);

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${fileName}"`);

    if (typeof size === "number" && !Number.isNaN(size)) {
      res.setHeader("Content-Length", size.toString());
    }

    return res.status(200).send(buffer);
  } catch (error) {
    console.error("[documents.routes] GET /content error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo descargar el documento"
    });
  }
  }
);

router.get(
  "/versions",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode, req.query.path)
  }),
  async (req, res) => {
    try {
      const documentPath = (req.query.path as string) || "";

      if (!documentPath.trim()) {
        return res.status(400).json({
          success: false,
          message: "La ruta del documento es obligatoria"
        });
      }

      const data = await getDocumentVersions(documentPath);

      return res.json({
        success: true,
        data
      });
    } catch (error) {
      console.error("[documents.routes] GET /versions error:", error);

      return res.status(500).json({
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "No se pudo obtener el historial de versiones"
      });
    }
  }
);

router.get(
  "/annotations/project",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode)
  }),
  async (req, res) => {
    try {
      const projectCode =
        typeof req.query.projectCode === "string" ? req.query.projectCode : "";

      if (!projectCode.trim()) {
        return res.status(400).json({
          success: false,
          message: "projectCode es obligatorio"
        });
      }

      const data = await listProjectDocumentAnnotations(projectCode);
      return res.json({ success: true, data });
    } catch (error) {
      console.error("[documents.routes] GET /annotations/project error:", error);
      return res.status(500).json({
        success: false,
        message: "No se pudieron obtener las incidencias documentales"
      });
    }
  }
);

router.get(
  "/annotations",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) =>
      projectCodeFromAny(req.query.projectCode, req.query.documentPath)
  }),
  async (req, res) => {
    try {
      const projectCode =
        typeof req.query.projectCode === "string" ? req.query.projectCode : "";
      const documentPath =
        typeof req.query.documentPath === "string"
          ? req.query.documentPath
          : "";
      const documentVersionId =
        typeof req.query.documentVersionId === "string"
          ? req.query.documentVersionId
          : null;

      if (!projectCode.trim() || !documentPath.trim()) {
        return res.status(400).json({
          success: false,
          message: "projectCode y documentPath son obligatorios"
        });
      }

      const data = await listDocumentAnnotations({
        projectCode,
        documentPath,
        documentVersionId
      });

      return res.json({ success: true, data });
    } catch (error) {
      console.error("[documents.routes] GET /annotations error:", error);
      return res.status(500).json({
        success: false,
        message: "No se pudieron obtener las anotaciones"
      });
    }
  }
);

router.post(
  "/annotations",
  projectAuthorizedRoute({
    permission: "document:write",
    source: "body",
    projectCode: (req) =>
      projectCodeFromAny(req.body?.projectCode, req.body?.documentPath)
  }),
  async (req, res) => {
    try {
      const {
        projectCode,
        documentPath,
        documentVersionId,
        pageNumber,
        kind,
        text,
        color,
        geometry,
        metadata,
        author
      } = req.body ?? {};

      if (!projectCode || !documentPath || !pageNumber || !kind || !geometry) {
        return res.status(400).json({
          success: false,
          message:
            "projectCode, documentPath, pageNumber, kind y geometry son obligatorios"
        });
      }

      const data = await createDocumentAnnotation({
        projectCode,
        documentPath,
        documentVersionId,
        pageNumber: Number(pageNumber),
        kind,
        text,
        color,
        geometry,
        metadata,
        author
      });

      return res.status(201).json({ success: true, data });
    } catch (error) {
      console.error("[documents.routes] POST /annotations error:", error);
      return res.status(500).json({
        success: false,
        message: "No se pudo crear la anotacion"
      });
    }
  }
);

router.patch(
  "/annotations/:annotationId",
  projectAuthorizedRoute({
    permission: "document:write",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.projectCode)
  }),
  async (req, res) => {
    try {
      const projectCode =
        typeof req.body?.projectCode === "string" ? req.body.projectCode : "";

      if (!projectCode.trim()) {
        return res.status(400).json({
          success: false,
          message: "projectCode es obligatorio"
        });
      }

      const annotationId = Array.isArray(req.params.annotationId)
        ? req.params.annotationId[0]
        : req.params.annotationId;

      const data = await updateDocumentAnnotation({
        id: annotationId,
        projectCode,
        text: req.body?.text,
        color: req.body?.color,
        metadata: req.body?.metadata,
        status: req.body?.status
      });

      if (!data) {
        return res.status(404).json({
          success: false,
          message: "Anotacion no encontrada"
        });
      }

      return res.json({ success: true, data });
    } catch (error) {
      console.error("[documents.routes] PATCH /annotations error:", error);
      return res.status(500).json({
        success: false,
        message: "No se pudo actualizar la anotacion"
      });
    }
  }
);

router.delete(
  "/annotations/:annotationId",
  projectAuthorizedRoute({
    permission: "document:write",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode)
  }),
  async (req, res) => {
    try {
      const projectCode =
        typeof req.query.projectCode === "string" ? req.query.projectCode : "";

      if (!projectCode.trim()) {
        return res.status(400).json({
          success: false,
          message: "projectCode es obligatorio"
        });
      }

      const annotationId = Array.isArray(req.params.annotationId)
        ? req.params.annotationId[0]
        : req.params.annotationId;

      const deleted = await deleteDocumentAnnotation({
        id: annotationId,
        projectCode
      });

      if (!deleted) {
        return res.status(404).json({
          success: false,
          message: "Anotacion no encontrada"
        });
      }

      return res.json({ success: true, data: { deleted: true } });
    } catch (error) {
      console.error("[documents.routes] DELETE /annotations error:", error);
      return res.status(500).json({
        success: false,
        message: "No se pudo eliminar la anotacion"
      });
    }
  }
);

router.get(
  "/:id",
  projectAuthorizedRoute({
    permission: "document:read",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode, req.query.path)
  }),
  async (req, res) => {
  const id = String(req.params.id);
  const path = (req.query.path as string) || "/";

  const document = await getDocumentById(id, path);

  if (!document) {
    return res.status(404).json({
      success: false,
      message: "Documento no encontrado"
    });
  }

  const response: ApiResponse<DocumentItem> = {
    success: true,
    data: document
  };

  res.json(response);
  }
);

router.delete(
  "/",
  projectAuthorizedRoute({
    permission: "document:hard-delete",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.projectCode, req.body?.documentPath)
  }),
  async (req, res) => {
  try {
    const documentPath = (req.body.documentPath as string) || "";

    if (!documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "La ruta del documento es obligatoria"
      });
    }

    await deleteDocument(documentPath);

    res.json({
      success: true,
      data: {
        path: documentPath
      }
    });
  } catch (error) {
    console.error("[documents.routes] DELETE / error:", error);

    res.status(500).json({
      success: false,
      message: "No se pudo eliminar el documento"
    });
  }
  }
);

router.get("/debug/xml", systemAdminRoute(), async (req, res) => {
  const path = (req.query.path as string) || "/";

  try {
    const result = await (nextcloudAdapter as any).propfind(path, "1");
    res.status(200).send(result.xml);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

router.post(
  "/upload",
  upload.single("file"),
  projectAuthorizedRoute({
    permission: "document:write",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.projectCode, req.body?.targetFolderPath)
  }),
  async (req, res) => {
  try {
    const file = req.file;
    const targetFolderPath = req.body.targetFolderPath;

    if (!file || !targetFolderPath) {
      return res.status(400).json({
        success: false,
        message: "Falta archivo o ruta destino"
      });
    }
    if (isBlockedFile(file.originalname)) {
      return res.status(400).json({
        success: false,
        message: "Tipo de archivo no permitido"
      });
    }
   const safeFileName = Buffer.from(file.originalname, "latin1")
  .toString("utf8")
  .normalize("NFC");

  const cleanTargetFolderPath = String(targetFolderPath).replace(/\/$/, "");
  const targetPath = `${cleanTargetFolderPath}/${safeFileName}`;

  await uploadDocument(targetPath, file.buffer, file.mimetype);

  let generatedFragPath: string | null = null;
  let fragStatus: "not_applicable" | "pending" | "generated" | "failed" =
    "not_applicable";

  if (safeFileName.toLowerCase().endsWith(".ifc")) {
    const generateAsync =
      process.env.BFF_GENERATE_FRAG_ON_UPLOAD_ASYNC !== "false";

    if (generateAsync) {
      fragStatus = "pending";
      enqueueFragGeneration(targetPath);
    } else {
      try {
        console.log("[UPLOAD FRAG START]", {
          targetPath
        });

        const fragResult = await generateAndStoreFrag(targetPath);
        generatedFragPath = fragResult.fragPath;
        fragStatus = "generated";

        console.log("[UPLOAD FRAG OK]", {
          targetPath,
          fragPath: generatedFragPath
        });
      } catch (fragError) {
        fragStatus = "failed";
        console.error("[UPLOAD FRAG ERROR]", {
          targetPath,
          error: fragError
        });
      }
    }
  }

  return res.status(201).json({
    success: true,
    data: {
      path: targetPath,
      name: safeFileName,
      fragPath: generatedFragPath,
      fragStatus
    },
    message: generatedFragPath
      ? "Archivo subido y FRAG generado correctamente"
      : fragStatus === "pending"
        ? "Archivo subido correctamente. FRAG en generacion."
      : "Archivo subido correctamente"
  });
  } catch (error) {
    console.error("[UPLOAD ERROR]", error);

    res.status(500).json({
      success: false,
      message: "Error subiendo archivo a Nextcloud"
    });
  }
  }
);

router.put(
  "/rename",
  projectAuthorizedRoute({
    permission: "document:write",
    source: "body",
    projectCode: (req) => projectCodeFromAny(req.body?.projectCode, req.body?.documentPath)
  }),
  async (req, res) => {
  try {
    const { documentPath, newName } = req.body;

    if (!documentPath || !newName) {
      return res.status(400).json({
        success: false,
        message: "documentPath y newName son obligatorios"
      });
    }

    await renameDocument(documentPath, newName);

    res.json({
      success: true
    });
  } catch (error) {
    console.error("[documents.routes] PUT /rename error:", error);

    res.status(500).json({
      success: false,
      message: "No se pudo renombrar el documento"
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
        req.body?.documentPath,
        req.body?.destinationFolderPath
      )
  }),
  async (req, res) => {
  try {
    const { documentPath, destinationFolderPath } = req.body;

    if (!documentPath || !destinationFolderPath) {
      return res.status(400).json({
        success: false,
        message: "documentPath y destinationFolderPath son obligatorios"
      });
    }

    await moveDocument(documentPath, destinationFolderPath);

    res.json({
      success: true,
      data: {
        path: documentPath,
        destinationFolderPath
      }
    });
  } catch (error) {
    console.error("[documents.routes] PUT /move error:", error);

    const message =
      error instanceof Error
        ? error.message
        : "No se pudo mover el documento";

    res.status(500).json({
      success: false,
      message
    });
  }
  }
);

router.post(
  "/bcf/:topicId/attachments",
  upload.single("file"),
  projectAuthorizedRoute({
    permission: "bcf:write",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode)
  }),
  async (req, res) => {
  try {
    const { topicId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false });
    }
    const projectCode =
      typeof req.query.projectCode === "string"
        ? req.query.projectCode.trim().toUpperCase()
        : "";

    if (!projectCode) {
      return res.status(400).json({
        success: false,
        message: "projectCode es obligatorio para guardar adjuntos BCF"
      });
    }

  const safeFileName = file.originalname.replace(/[\\/:*?"<>|]/g, "_");

    const path = `/${projectCode}/_bcf/topics/${topicId}/attachments/${safeFileName}`;

    const foldersToEnsure = [
      `/${projectCode}/_bcf`,
      `/${projectCode}/_bcf/topics`,
      `/${projectCode}/_bcf/topics/${topicId}`,
      `/${projectCode}/_bcf/topics/${topicId}/attachments`
    ];

    for (const folderPath of foldersToEnsure) {
      try {
        await nextcloudAdapter.createFolder(folderPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (
          message.includes("405") ||
          message.includes("Method Not Allowed") ||
          message.includes("409") ||
          message.includes("Conflict")
        ) {
          continue;
        }

        throw error;
      }
    }

    await nextcloudAdapter.uploadFile(
      path,
      file.buffer,
      file.mimetype
    );

    const publicBaseUrl = process.env.BFF_PUBLIC_URL?.replace(/\/$/, "") ?? "http://localhost:4000";
    return res.json({
      success: true,
      data: {
        name: safeFileName,
        url: `/api/documents/content?path=${encodeURIComponent(path)}`
      }
    });
  } catch (error) {
    console.error("[documents.routes] Error uploading BCF attachment:", error);

    return res.status(500).json({
      success: false,
      message: "No se pudo subir el adjunto BCF"
    });
  }
  }
);

router.post(
  "/bcf/:topicId/snapshot",
  upload.single("file"),
  projectAuthorizedRoute({
    permission: "bcf:write",
    source: "query",
    projectCode: (req) => projectCodeFromAny(req.query.projectCode)
  }),
  async (req, res) => {
  try {
    const { topicId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false });
    }

    const projectCode =
      typeof req.query.projectCode === "string"
        ? req.query.projectCode.trim().toUpperCase()
        : "";

    if (!projectCode) {
      return res.status(400).json({
        success: false,
        message: "projectCode es obligatorio"
      });
    }
    const path = `/${projectCode}/_bcf/topics/${topicId}/snapshot.png`;

    const foldersToEnsure = [
      `/${projectCode}/_bcf`,
      `/${projectCode}/_bcf/topics`,
      `/${projectCode}/_bcf/topics/${topicId}`
    ];
    for (const folderPath of foldersToEnsure) {
      try {
        await nextcloudAdapter.createFolder(folderPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (
          message.includes("405") ||
          message.includes("409")
        ) {
          continue;
        }

        throw error;
      }
    }

    await nextcloudAdapter.uploadFile(
      path,
      file.buffer,
      "image/png"
    );

    const publicBaseUrl = process.env.BFF_PUBLIC_URL?.replace(/\/$/, "") ?? "http://localhost:4000";
    return res.json({
      success: true,
      data: {
        url: `/api/documents/content?path=${encodeURIComponent(path)}`
      }
    });
  } catch (error) {
    console.error("Snapshot upload error:", error);
    res.status(500).json({ success: false });
  }
  }
);

export default router;
