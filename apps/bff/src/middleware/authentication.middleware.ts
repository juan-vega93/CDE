import type { NextFunction, Request, Response } from "express";
import {
  AuthenticationError,
  verifyKeycloakJwt
} from "../security/keycloak-jwt";

function sendUnauthorized(res: Response) {
  return res.status(401).json({
    success: false,
    message: "Unauthorized"
  });
}

export async function authenticateRequest(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const authorization = req.header("authorization");

    if (!authorization) {
      return sendUnauthorized(res);
    }

    const [scheme, token, ...extra] = authorization.split(" ");

    if (scheme !== "Bearer" || !token || extra.length > 0) {
      return sendUnauthorized(res);
    }

    req.auth = await verifyKeycloakJwt(token);
    return next();
  } catch (error) {
    if (!(error instanceof AuthenticationError)) {
      console.error("[authentication] JWT validation failed");
    }

    return sendUnauthorized(res);
  }
}
