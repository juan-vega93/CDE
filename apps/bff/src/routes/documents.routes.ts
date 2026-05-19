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
  generateAndStoreFrag
} from "../services/documents.service";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";
import type { ApiResponse } from "../types/api.types";
import type { DocumentsResponse, DocumentItem } from "../types/document.types";
import multer from "multer";


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

const upload = multer();
const router = Router();
const nextcloudAdapter = new NextcloudAdapter();

router.get("/viewer-source", async (req, res) => {
  try {
    const documentPath = req.query.documentPath;

    if (typeof documentPath !== "string" || !documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "documentPath es requerido"
      });
    }

    const data = await getViewerSource(documentPath);

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
});

router.post("/generate-frag", async (req, res) => {
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
});

router.get("/", async (req, res) => {
  const path = (req.query.path as string) || "/";
  const result: DocumentsResponse = await getDocuments(path);

  const response: ApiResponse<DocumentsResponse> = {
    success: true,
    data: result
  };

  res.json(response);
});

router.get("/content", async (req, res) => {
  try {
    const documentPath = (req.query.path as string) || "";

    if (!documentPath.trim()) {
      return res.status(400).json({
        success: false,
        message: "La ruta del documento es obligatoria"
      });
    }

    const { buffer, contentType, fileName, size } =
      await getDocumentContent(documentPath);

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
});

router.get("/:id", async (req, res) => {
  const id = req.params.id;
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
});

router.delete("/", async (req, res) => {
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
});

router.get("/debug/xml", async (req, res) => {
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

router.post("/upload", upload.single("file"), async (req, res) => {
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

    const targetPath = `${targetFolderPath}/${safeFileName}`;

    await uploadDocument(targetPath, file.buffer, file.mimetype);

    if (safeFileName.toLowerCase().endsWith(".ifc")) {
      void generateAndStoreFrag(targetPath).catch((fragError) => {
        console.error("[UPLOAD FRAG ERROR]", {
          targetPath,
          error: fragError
        });
      });
    }

    return res.status(201).json({
      success: true,
      data: {
        path: targetPath,
        name: safeFileName
      },
      message: "Archivo subido correctamente"
    });
  } catch (error) {
    console.error("[UPLOAD ERROR]", error);

    res.status(500).json({
      success: false,
      message: "Error subiendo archivo a Nextcloud"
    });
  }
});

router.put("/rename", async (req, res) => {
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
});

router.put("/move", async (req, res) => {
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
});

router.post("/bcf/:topicId/attachments", upload.single("file"), async (req, res) => {
  try {
    const { topicId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false });
    }

    const path = `/_bcf/topics/${topicId}/attachments/${file.originalname}`;

    const foldersToEnsure = [
      "/_bcf",
      `/_bcf/topics`,
      `/_bcf/topics/${topicId}`,
      `/_bcf/topics/${topicId}/attachments`
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
        name: file.originalname,
        path,
        url: `${publicBaseUrl}/api/documents/content?path=${encodeURIComponent(path)}`
      }
    });
  } catch (error) {
    console.error("BCF upload error:", error);
    res.status(500).json({ success: false });
  }
});

router.post("/bcf/:topicId/snapshot", upload.single("file"), async (req, res) => {
  try {
    const { topicId } = req.params;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ success: false });
    }

    const path = `/_bcf/topics/${topicId}/snapshot.png`;

    const foldersToEnsure = [
      "/_bcf",
      "/_bcf/topics",
      `/_bcf/topics/${topicId}`
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
        url: `${publicBaseUrl}/api/documents/content?path=${encodeURIComponent(path)}`
      }
    });
  } catch (error) {
    console.error("Snapshot upload error:", error);
    res.status(500).json({ success: false });
  }
});

export default router;