import { Router } from "express";
import {
  deleteIssue,
  listProjectIssues,
  updateIssue,
  upsertIssueFromBcfTopic,
  upsertIssueFromDocumentAnnotation
} from "../services/issues.service";
import {
  deleteBcfTopic,
  getBcfTopics,
  updateBcfTopicFromIssue
} from "../services/bcf-topics.service";
import {
  deleteDocumentAnnotation,
  listProjectDocumentAnnotations,
  updateDocumentAnnotation
} from "../services/document-annotations.service";
import type { CanonicalIssue } from "../types/issue.types";

const router = Router();

function toDocumentAnnotationStatus(status: string) {
  if (["closed", "resolved"].includes(status)) return "closed";
  return "open";
}

async function syncIssueOrigin(issue: CanonicalIssue): Promise<void> {
  if (issue.sourceSystem === "document_annotation") {
    const metadata = {
      ...(issue.metadata ?? {}),
      title: issue.title,
      description: issue.description,
      assignedTo: issue.assignedTo,
      dueDate: issue.dueDate,
      issueType: issue.issueType,
      priority: issue.priority,
      discipline: issue.discipline,
      snapshotDataUrl: issue.snapshotUrl
    };

    await updateDocumentAnnotation({
      id: issue.sourceId,
      projectCode: issue.projectCode,
      text: issue.description ?? issue.title,
      metadata,
      status: toDocumentAnnotationStatus(issue.status)
    });
    return;
  }

  if (issue.sourceSystem === "bcf_topic") {
    await updateBcfTopicFromIssue({
      topicId: issue.sourceId,
      projectCode: issue.projectCode,
      title: issue.title,
      description: issue.description,
      status: issue.status,
      priority: issue.priority,
      issueType: issue.issueType,
      discipline: issue.discipline,
      assignedTo: issue.assignedTo,
      dueDate: issue.dueDate
    });
  }
}

async function deleteIssueOrigin(issue: CanonicalIssue): Promise<void> {
  if (issue.sourceSystem === "document_annotation") {
    await deleteDocumentAnnotation({
      id: issue.sourceId,
      projectCode: issue.projectCode
    });
    return;
  }

  if (issue.sourceSystem === "bcf_topic") {
    await deleteBcfTopic(issue.sourceId, issue.projectCode);
  }
}

router.get("/", async (req, res) => {
  try {
    const projectCode =
      typeof req.query.projectCode === "string" ? req.query.projectCode : "";

    if (!projectCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "projectCode es obligatorio"
      });
    }

    const [bcfTopics, documentAnnotations] = await Promise.all([
      getBcfTopics(projectCode),
      listProjectDocumentAnnotations(projectCode)
    ]);

    await Promise.all([
      ...bcfTopics.map((topic) => upsertIssueFromBcfTopic(topic)),
      ...documentAnnotations.map((annotation) =>
        upsertIssueFromDocumentAnnotation(annotation)
      )
    ]);

    const data = await listProjectIssues(projectCode);
    return res.json({ success: true, data });
  } catch (error) {
    console.error("[issues.routes] GET / error:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudieron obtener las incidencias"
    });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const projectCode =
      typeof req.body?.projectCode === "string" ? req.body.projectCode : "";

    if (!projectCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "projectCode es obligatorio"
      });
    }

    const issueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const updateInput: Parameters<typeof updateIssue>[0] = {
      id: issueId,
      projectCode,
      title: req.body?.title,
      description: req.body?.description,
      status: req.body?.status,
      priority: req.body?.priority,
      issueType: req.body?.issueType,
      discipline: req.body?.discipline,
      assignedTo: req.body?.assignedTo,
      metadata: req.body?.metadata
    };

    if (Object.prototype.hasOwnProperty.call(req.body ?? {}, "dueDate")) {
      updateInput.dueDate = req.body?.dueDate;
    }

    const data = await updateIssue(updateInput);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Incidencia no encontrada"
      });
    }

    await syncIssueOrigin(data);

    return res.json({ success: true, data });
  } catch (error) {
    console.error("[issues.routes] PATCH /:id error:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo actualizar la incidencia"
    });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const projectCode =
      typeof req.query.projectCode === "string" ? req.query.projectCode : "";

    if (!projectCode.trim()) {
      return res.status(400).json({
        success: false,
        message: "projectCode es obligatorio"
      });
    }

    const issueId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const issues = await listProjectIssues(projectCode);
    const issue = issues.find((item) => item.id === issueId);
    const deleted = await deleteIssue({ id: issueId, projectCode });

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Incidencia no encontrada"
      });
    }

    if (issue) {
      await deleteIssueOrigin(issue);
    }

    return res.json({ success: true, data: { deleted: true } });
  } catch (error) {
    console.error("[issues.routes] DELETE /:id error:", error);
    return res.status(500).json({
      success: false,
      message: "No se pudo eliminar la incidencia"
    });
  }
});

export default router;
