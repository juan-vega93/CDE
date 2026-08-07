import "dotenv/config";
import express from "express";
import foldersRouter from "./routes/folders.routes";
import documentsRouter from "./routes/documents.routes";
import workPackageLinksRouter from "./routes/work-package-links.routes";
import reviewsRouter from "./routes/reviews.routes";
import workPackagesRouter from "./routes/work-packages.routes";
import integrationsRouter from "./routes/integrations.routes";
import openProjectDebugRouter from "./routes/openproject-debug.routes";
import adminUsersRouter from "./routes/admin-users.routes";
import openProjectAdminRouter from "./routes/openproject-admin.routes";
import viewpointsRoutes from "./routes/viewpoints.routes";
import bcfRoutes from "./routes/bcf.routes";
import openProjectBcfRoutes from "./routes/openproject-bcf.routes";
import projectCardsRoutes from "./routes/project-cards.routes";
import projectModulesRouter from "./routes/project-modules.routes";
import issuesRoutes from "./routes/issues.routes";
import bimIndexRoutes from "./routes/bim-index.routes";
import { loadBffEnv } from "./config/env";
import { corsAllowlist } from "./middleware/cors.middleware";
import { authenticateRequest } from "./middleware/authentication.middleware";
import { requestTimingMiddleware } from "./utils/request-timing";
import {
  projectAuthorizedRoute,
  projectCodeFromAny,
  systemAdminRoute
} from "./middleware/authorization.middleware";
import type { Permission } from "./security/policies";


const PORT = 4000;

function projectOrSystemAdminWorkflowRoute() {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const projectCode = projectCodeFromAny(
      req.query.projectCode,
      req.body?.projectCode,
      req.body?.documentPath
    );

    if (!projectCode) {
      return systemAdminRoute()(req, res, next);
    }

    const permission: Permission = req.method === "GET" ? "bcf:read" : "bcf:write";

    return projectAuthorizedRoute({
      permission,
      source: "query",
      projectCode: () => projectCode
    })(req, res, next);
  };
}

function projectIssueRoute() {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const projectCode = projectCodeFromAny(req.query.projectCode, req.body?.projectCode);

    if (!projectCode) {
      return systemAdminRoute()(req, res, next);
    }

    const permission: Permission = req.method === "GET" ? "bcf:read" : "bcf:write";

    return projectAuthorizedRoute({
      permission,
      source: "query",
      projectCode: () => projectCode
    })(req, res, next);
  };
}
function projectModulesRoute() {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const projectCode = projectCodeFromAny(req.query.projectCode, req.body?.projectCode);

    if (!projectCode) {
      return systemAdminRoute()(req, res, next);
    }

    const permission: Permission = req.method === "GET" ? "project:read" : "project:write";

    return projectAuthorizedRoute({
      permission,
      source: "query",
      projectCode: () => projectCode
    })(req, res, next);
  };
}
function projectBimIndexRoute() {
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const projectCode = projectCodeFromAny(
      req.query.projectCode,
      req.body?.projectCode,
      req.body?.documentPath
    );

    if (!projectCode) {
      return systemAdminRoute()(req, res, next);
    }

    const permission: Permission = req.method === "GET" ? "document:read" : "document:write";

    return projectAuthorizedRoute({
      permission,
      source: "query",
      projectCode: () => projectCode
    })(req, res, next);
  };
}
export function createApp() {
  loadBffEnv();

  const app = express();

  app.use(requestTimingMiddleware);
  app.use(corsAllowlist());
  app.use(express.json({ limit: "15mb" }));
  app.use(express.urlencoded({ extended: true, limit: "15mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      service: "bff",
      timestamp: new Date().toISOString()
    });
  });

  app.use(authenticateRequest);

  app.use(
    "/api/folders",
    projectAuthorizedRoute({
      permission: "document:read",
      source: "query",
      projectCode: (req) =>
        projectCodeFromAny(
          req.query.projectCode,
          req.query.path,
          req.body?.projectCode,
          req.body?.folderPath,
          req.body?.parentPath,
          req.body?.destinationFolderPath
        )
    }),
    foldersRouter
  );
  app.use("/api/documents", documentsRouter);
  app.use(
    "/api/bcf",
    projectAuthorizedRoute({
      permission: "bcf:read",
      source: "query",
      projectCode: (req) => projectCodeFromAny(req.query.projectCode, req.body?.projectCode)
    }),
    bcfRoutes
  );
  app.use("/api/work-package-links", projectOrSystemAdminWorkflowRoute(), workPackageLinksRouter);
  app.use(
    "/api/reviews",
    projectAuthorizedRoute({
      permission: "project:write",
      source: "body",
      projectCode: (req) => projectCodeFromAny(req.body?.projectCode, req.body?.documentPath)
    }),
    reviewsRouter
  );
  app.use("/api/work-packages", projectOrSystemAdminWorkflowRoute(), workPackagesRouter);
  app.use("/api/integrations", systemAdminRoute(), integrationsRouter);
  app.use("/api/openproject-debug", systemAdminRoute(), openProjectDebugRouter);
  app.use("/api/admin/users", systemAdminRoute(), adminUsersRouter);
  app.use("/api/openproject-admin", systemAdminRoute(), openProjectAdminRouter);
  app.use(
    "/api/viewpoints",
    projectAuthorizedRoute({
      permission: "bcf:read",
      source: "query",
      projectCode: (req) => projectCodeFromAny(req.query.documentPath, req.body?.documentPath)
    }),
    viewpointsRoutes
  );
  app.use("/api/openproject-bcf", systemAdminRoute(), openProjectBcfRoutes);
  app.use("/api/project-cards", projectCardsRoutes);
  app.use("/api/project-modules", projectModulesRoute(), projectModulesRouter);
  app.use("/api/issues", projectIssueRoute(), issuesRoutes);
  app.use("/api/bim-index", projectBimIndexRoute(), bimIndexRoutes);

  app.use((_req, res) => {
    res.status(403).json({
      success: false,
      message: "Forbidden"
    });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();

  app.listen(PORT, () => {
    console.log(`BFF running on http://localhost:${PORT}`);
  });
}



