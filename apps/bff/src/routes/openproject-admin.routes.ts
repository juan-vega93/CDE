import { Router } from "express";
import { OpenProjectProjectsService } from "../services/openproject-projects.service";

const router = Router();
const openProjectProjectsService = new OpenProjectProjectsService();

router.get("/roles", async (_req, res) => {
  try {
    const baseUrl = process.env.OPENPROJECT_BASE_URL;
    const apiKey = process.env.OPENPROJECT_API_KEY;

    if (!baseUrl || !apiKey) {
      return res.status(500).json({
        success: false,
        message: "Falta configuración de OpenProject"
      });
    }

    const response = await fetch(`${baseUrl}/api/v3/roles`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString("base64")}`,
        Accept: "application/json"
      }
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: "No se pudo listar roles de OpenProject",
        data
      });
    }

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error listando roles de OpenProject";

    return res.status(500).json({
      success: false,
      message
    });
  }
});
router.get("/users-test", async (req, res) => {
  try {
    const email = String(req.query.email || "").trim();

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "email es obligatorio"
      });
    }

    const baseUrl = process.env.OPENPROJECT_BASE_URL;
    const apiKey = process.env.OPENPROJECT_API_KEY;

    if (!baseUrl || !apiKey) {
      return res.status(500).json({
        success: false,
        message: "Falta configuración de OpenProject"
      });
    }

    const filters = [
      {
        name: {
          operator: "~",
          values: [email]
        }
      }
    ];

    const response = await fetch(
      `${baseUrl}/api/v3/users?filters=${encodeURIComponent(JSON.stringify(filters))}`,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString("base64")}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    return res.status(response.ok ? 200 : response.status).json({
      success: response.ok,
      filters,
      data
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error probando búsqueda de usuarios";

    return res.status(500).json({
      success: false,
      message
    });
  }
});
router.post("/projects", async (req, res) => {
  try {
    const { code, name, description } = req.body as {
      code?: string;
      name?: string;
      description?: string;
    };

    if (!code || !name) {
      return res.status(400).json({
        success: false,
        message: "code y name son obligatorios"
      });
    }

    const result = await openProjectProjectsService.createOrGetProject({
      code,
      name,
      description
    });

    return res.status(result.created ? 201 : 200).json({
      success: true,
      data: {
        created: result.created,
        project: result.project
      }
    });
  } catch (error) {
    console.error("[openproject-admin.routes] POST /projects error:", error);

    return res.status(500).json({
      success: false,
      message:
        error instanceof Error
          ? error.message
          : "No se pudo crear o recuperar el proyecto OpenProject"
    });
  }
});

export default router;