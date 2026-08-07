import type { NextFunction, Request, RequestHandler, Response } from "express";
import {
  AuthorizationError,
  authorizeProjectAccess,
  authorizeSystemAdmin,
  normalizeProjectCode
} from "../security/project-access";
import type { Permission, RouteClassification } from "../security/policies";

type ProjectCodeSource = "path" | "query" | "body";

type ProjectCodeResolver = (req: Request) => string | undefined;

type ProjectAuthorizationOptions = {
  permission: Permission;
  projectCode: ProjectCodeResolver;
  source: ProjectCodeSource;
};

function sendForbidden(res: Response) {
  return res.status(403).json({
    success: false,
    message: "Forbidden"
  });
}

function requireAuth(req: Request, res: Response): boolean {
  if (!req.auth) {
    res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
    return false;
  }

  return true;
}

function getString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function firstPathSegment(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return value
    .split("/")
    .filter(Boolean)[0]
    ?.trim();
}

export function projectCodeFromAny(...values: Array<unknown>): string | undefined {
  const candidates = values
    .map((value) => getString(value))
    .filter((value): value is string => Boolean(value));

  const normalized = new Set<string>();

  for (const candidate of candidates) {
    const direct = candidate.includes("/") ? firstPathSegment(candidate) : candidate;
    if (direct) {
      normalized.add(normalizeProjectCode(direct));
    }
  }

  if (normalized.size !== 1) {
    return undefined;
  }

  return [...normalized][0];
}

export function authenticatedRoute(): RequestHandler {
  return (req, res, next) => {
    if (!requireAuth(req, res)) return;
    next();
  };
}

export function systemAdminRoute(): RequestHandler {
  return (req, res, next) => {
    try {
      if (!requireAuth(req, res)) return;
      authorizeSystemAdmin(req.auth!);
      next();
    } catch (error) {
      if (!(error instanceof AuthorizationError)) {
        console.error("[authorization] system admin check failed");
      }
      sendForbidden(res);
    }
  };
}

export function projectAuthorizedRoute({
  permission,
  projectCode
}: ProjectAuthorizationOptions): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!requireAuth(req, res)) return;

      const resolvedProjectCode = projectCode(req);

      if (!resolvedProjectCode) {
        return sendForbidden(res);
      }

      const normalizedProjectCode = normalizeProjectCode(resolvedProjectCode);
      await authorizeProjectAccess(req.auth!, normalizedProjectCode, permission);
      req.authorizedProjectCode = normalizedProjectCode;
      return next();
    } catch (error) {
      if (!(error instanceof AuthorizationError)) {
        console.error("[authorization] project access check failed");
      }
      return sendForbidden(res);
    }
  };
}

export type RoutePolicySummary = {
  method: string;
  route: string;
  classification: RouteClassification;
  permission: Permission | "none";
  projectCodeSource: ProjectCodeSource | "none";
};
