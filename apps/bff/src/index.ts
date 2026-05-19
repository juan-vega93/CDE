import "dotenv/config";
import express from "express";
import cors from "cors";
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



console.log("[OPENPROJECT ENV CHECK]", {
  baseUrl: process.env.OPENPROJECT_BASE_URL,
  apiKeyPreview: process.env.OPENPROJECT_API_KEY
    ? `${process.env.OPENPROJECT_API_KEY.slice(0, 6)}...`
    : "MISSING",
  useOpenProjectMock: process.env.USE_OPENPROJECT_MOCK
});

const app = express();
const PORT = 4000;

app.use(cors());
app.use(express.json({ limit: "15mb" }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));


app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "bff",
    timestamp: new Date().toISOString()
  });
});

app.use("/api/folders", foldersRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/bcf", bcfRoutes);
app.use("/api/work-package-links", workPackageLinksRouter);
app.use("/api/reviews", reviewsRouter);
app.use("/api/work-packages", workPackagesRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/openproject-debug", openProjectDebugRouter);
app.use("/api/admin/users", adminUsersRouter);
app.use("/api/openproject-admin", openProjectAdminRouter);
app.use("/api/viewpoints", viewpointsRoutes);
app.use("/api/openproject-bcf", openProjectBcfRoutes);
app.use("/api/project-cards", projectCardsRoutes);


app.listen(PORT, () => {
  console.log(`BFF running on http://localhost:${PORT}`);
});