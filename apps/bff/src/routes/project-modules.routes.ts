import { Router, type Response } from "express";
import {
  listPmaSources,
  listProjectModules,
  upsertPmaSource,
  upsertProjectModule
} from "../db/project-modules-store";

const router = Router();

function isDatabaseDisabled(error: unknown): boolean {
  return error instanceof Error && error.name === "DatabaseDisabledError";
}

function sendRouteError(res: Response, error: unknown) {
  if (isDatabaseDisabled(error)) {
    return res.status(503).json({
      success: false,
      message: "Modulos de proyecto no disponibles: DATABASE_URL no esta configurado"
    });
  }

  console.error("[project-modules.routes] error:", error);
  return res.status(500).json({
    success: false,
    message: "No se pudieron procesar los modulos del proyecto"
  });
}

function toProjectCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toConfig(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

router.get("/", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    if (!projectCode) {
      return res.status(400).json({ success: false, message: "projectCode es obligatorio" });
    }

    const data = await listProjectModules(projectCode);
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.put("/:moduleKey", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const projectCode = toProjectCode(body.projectCode);
    const moduleKey = toText(req.params.moduleKey).toLowerCase();
    if (!projectCode || !moduleKey) {
      return res.status(400).json({ success: false, message: "projectCode y moduleKey son obligatorios" });
    }

    const enabled = typeof body.enabled === "boolean" ? body.enabled : true;
    const data = await upsertProjectModule({
      projectCode,
      moduleKey,
      enabled,
      config: toConfig(body.config)
    });

    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.get("/pma/sources", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    if (!projectCode) {
      return res.status(400).json({ success: false, message: "projectCode es obligatorio" });
    }

    const data = await listPmaSources(projectCode);
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.put("/pma/sources", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const projectCode = toProjectCode(body.projectCode);
    const name = toText(body.name);
    if (!projectCode || !name) {
      return res.status(400).json({ success: false, message: "projectCode y name son obligatorios" });
    }

    const data = await upsertPmaSource({
      id: toText(body.id) || undefined,
      projectCode,
      name,
      sourceDocumentPath: toText(body.sourceDocumentPath) || undefined,
      sourceHash: toText(body.sourceHash) || undefined,
      status: toText(body.status) || undefined,
      importedBy: toText(body.importedBy) || undefined,
      config: toConfig(body.config)
    });

    await upsertProjectModule({
      projectCode,
      moduleKey: "pma",
      enabled: true,
      config: { lastSourceId: data.id }
    });

    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

export default router;
