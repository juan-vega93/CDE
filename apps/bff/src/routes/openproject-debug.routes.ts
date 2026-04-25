import { Router } from "express";

const router = Router();

router.get("/form", async (_req, res) => {
  const baseUrl = process.env.OPENPROJECT_BASE_URL;
  const apiKey = process.env.OPENPROJECT_API_KEY;
  const projectId = process.env.OPENPROJECT_PROJECT_ID;
  const typeId = process.env.OPENPROJECT_TYPE_ID;

  try {
    const response = await fetch(`${baseUrl}/api/v3/work_packages/form`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`apikey:${apiKey}`).toString("base64")}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        _links: {
          project: {
            href: `/api/v3/projects/${projectId}`
          },
          type: {
            href: `/api/v3/types/${typeId}`
          }
        }
      })
    });

    const text = await response.text();

    res.status(response.status).send(text);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

export default router;