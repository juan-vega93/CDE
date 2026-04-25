import { Router } from "express";
import { OpenProjectAdapter } from "../adapters/openproject.adapter";
import { NextcloudAdapter } from "../adapters/nextcloud.adapter";

const router = Router();
const openProjectAdapter = new OpenProjectAdapter();
const nextcloudAdapter = new NextcloudAdapter();

router.get("/openproject/test", async (_req, res) => {
  try {
    const result = await openProjectAdapter.testConnection();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});

router.get("/nextcloud/test", async (_req, res) => {
  try {
    const result = await nextcloudAdapter.testConnection();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
router.get("/nextcloud/probe", async (_req, res) => {
  const baseUrl = process.env.NEXTCLOUD_BASE_URL || "";
  const username = process.env.NEXTCLOUD_USERNAME || "";
  const password = process.env.NEXTCLOUD_PASSWORD || "";

  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const candidates = [
    `/remote.php/dav/files/${username}/AR3173/`,
    `/remote.php/dav/files/${username}/AR3173/03_WIP/`,
    `/remote.php/dav/files/${username}/AR3173/03_WIP/ARQ/`,
    `/remote.php/dav/files/${username}/AR3173/03_WIP/ARQ/02_WORK/`
  ];

  const results = [];

  for (const path of candidates) {
    const url = `${baseUrl.replace(/\/$/, "")}${path}`;

    try {
      const response = await fetch(url, {
        method: "PROPFIND",
        headers: {
          Authorization: auth,
          Depth: "0"
        }
      });

      const text = await response.text();

      results.push({
        url,
        status: response.status,
        ok: response.ok,
        preview: text.slice(0, 200)
      });
    } catch (error) {
      results.push({
        url,
        status: "NETWORK_ERROR",
        ok: false,
        preview: error instanceof Error ? error.message : "Unknown error"
      });
    }
  }

  res.json({
    success: true,
    data: results
  });
});

router.get("/nextcloud/root-children", async (req, res) => {
  const baseUrl = process.env.NEXTCLOUD_BASE_URL || "";
  const username = process.env.NEXTCLOUD_USERNAME || "";
  const password = process.env.NEXTCLOUD_PASSWORD || "";
  const rootPath = process.env.NEXTCLOUD_ROOT_PATH || "/";
  const path = (req.query.path as string) || "/";

  const auth = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;

  const normalizedRoot = rootPath.replace(/\/$/, "");
  const normalizedPath =
    path === "/" ? normalizedRoot : `${normalizedRoot}${path}`;

  const url = `${baseUrl.replace(/\/$/, "")}/remote.php/dav/files/${username}${normalizedPath}/`;

  try {
    const response = await fetch(url, {
      method: "PROPFIND",
      headers: {
        Authorization: auth,
        Depth: "1"
      }
    });

    const xml = await response.text();

    if (!response.ok) {
      return res.status(response.status).json({
        success: false,
        message: xml
      });
    }

    const hrefs = Array.from(xml.matchAll(/<d:href>(.*?)<\/d:href>/g)).map(
      (m) => decodeURIComponent(m[1])
    );

    res.json({
      success: true,
      data: {
        url,
        hrefs
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error"
    });
  }
});
export default router;