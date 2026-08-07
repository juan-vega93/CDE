import type { RequestHandler } from "express";
import { loadBffEnv } from "../config/env";

const ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const ALLOWED_HEADERS = "Authorization,Content-Type,Accept";
const EXPOSED_HEADERS = "Server-Timing,X-Request-Id,X-Response-Time-Ms";

export function corsAllowlist(): RequestHandler {
  const { corsAllowedOrigins } = loadBffEnv();
  const allowedOrigins = new Set(corsAllowedOrigins);

  return (req, res, next) => {
    const origin = req.header("origin")?.replace(/\/$/, "");

    if (!origin) {
      return next();
    }

    if (!allowedOrigins.has(origin)) {
      return res.status(403).json({
        success: false,
        message: "CORS origin not allowed"
      });
    }

    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS);
    res.setHeader("Access-Control-Allow-Headers", ALLOWED_HEADERS);
    res.setHeader("Access-Control-Expose-Headers", EXPOSED_HEADERS);
    res.setHeader("Access-Control-Allow-Credentials", "true");

    if (req.method === "OPTIONS") {
      return res.status(204).send();
    }

    return next();
  };
}
