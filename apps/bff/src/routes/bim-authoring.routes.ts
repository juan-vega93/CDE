import { Router } from "express";
import { resolveAuthoringElementByLocalId } from "../db/bim-authoring-store";
import { isDatabaseEnabled } from "../db/client";
import { normalizeProjectCode } from "../security/project-access";
import { toCanonicalBimModelKey } from "../services/bim-model-identity";
import { isBimRevisionId, type BimProcessingContext } from "../services/bim-revision-identity";

const router = Router();

router.get("/resolve", async (req, res) => {
  let context: BimProcessingContext;
  let localId: number;
  try {
    const { projectCode, modelKey, revisionId, localId: rawLocalId } = req.query;
    const allowed = new Set(["projectCode", "modelKey", "revisionId", "localId"]);
    if (Object.keys(req.query).some((key) => !allowed.has(key)) ||
      typeof projectCode !== "string" || typeof modelKey !== "string" ||
      !isBimRevisionId(revisionId) || typeof rawLocalId !== "string" ||
      !/^[1-9][0-9]*$/.test(rawLocalId)) throw new Error("Invalid identity");
    const canonicalModelKey = toCanonicalBimModelKey(modelKey);
    if (canonicalModelKey !== modelKey) throw new Error("Noncanonical modelKey");
    localId = Number(rawLocalId);
    // Membership local_id is PostgreSQL integer, not a runtime ID or bigint.
    if (!Number.isSafeInteger(localId) || localId > 2147483647 || String(localId) !== rawLocalId) throw new Error("Invalid localId");
    context = { projectCode: normalizeProjectCode(projectCode), modelKey: canonicalModelKey, revisionId };
  } catch {
    return res.status(400).json({ success: false, message: "Se requieren projectCode, modelKey canonico, revisionId y localId validos" });
  }

  if (!isDatabaseEnabled()) {
    return res.status(503).json({ success: false, message: "Indice BIM no disponible: DATABASE_URL no esta configurado" });
  }
  try {
    const element = await resolveAuthoringElementByLocalId(context, localId);
    // Same not-found contract as existing BIM element resolution, including missing context.
    if (!element) return res.status(404).json({ success: false, message: "Elemento BIM no encontrado" });
    const { identityKey, resolutionMethod, rootLocalId, authoringElementId,
      identityConfidence, resolutionStatus, sourceContainer } = element;
    const present = new Set(element.graphicalLocalIds);
    const unknown = new Set(element.geometryUnknownLocalIds);
    return res.json({ success: true, data: {
      context,
      authoringElement: { identityKey, resolutionMethod, rootLocalId, authoringElementId,
        identityConfidence, resolutionStatus, sourceContainer },
      members: element.memberLocalIds.map((id) => ({ localId: id,
        geometryStatus: present.has(id) ? "present" : unknown.has(id) ? "unknown" : "absent" }))
    } });
  } catch (error) {
    console.error("[bim-authoring.routes] resolution failed", error);
    return res.status(500).json({ success: false, message: "No se pudo resolver el elemento de autoria" });
  }
});

export default router;
