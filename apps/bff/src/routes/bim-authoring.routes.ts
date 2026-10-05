import { Router } from "express";
import { resolveAuthoringElementByLocalId } from "../db/bim-authoring-store";
import { isDatabaseEnabled } from "../db/client";
import { normalizeProjectCode } from "../security/project-access";
import { toCanonicalBimModelKey } from "../services/bim-model-identity";
import { isBimRevisionId, type BimProcessingContext } from "../services/bim-revision-identity";
import { getBimReadDatabase, withBimPublishedRead } from "../db/bim-index-generations";

const router = Router();

// One batched composition projection per loaded revision. Individual member
// properties remain lazy through the existing Inspector endpoint.
router.get("/tree", async (req, res) => {
  const { projectCode, modelKey, revisionId } = req.query;
  if(typeof projectCode !== 'string' || typeof modelKey !== 'string' || !isBimRevisionId(revisionId) ||
    Object.keys(req.query).some(k=>!['projectCode','modelKey','revisionId'].includes(k)))
    return res.status(400).json({success:false,message:'Invalid revision context'});
  try {
    if(toCanonicalBimModelKey(modelKey)!==modelKey) return res.status(400).json({success:false,message:'Noncanonical model key'});
    const context={projectCode:normalizeProjectCode(projectCode),modelKey,revisionId};
    const data=await withBimPublishedRead(async()=> (await getBimReadDatabase().query(`
      select a.element_key "identityKey",a.root_local_id "rootLocalId",e.name,
        e.ifc_class "ifcClass",a.authoring_element_id "authoringElementId",
        array_agg(m.local_id order by m.local_id) "memberLocalIds",
        coalesce(array_agg(m.local_id order by m.local_id) filter(where m.geometry_status='present'),'{}') "graphicalLocalIds"
      from cde_bim_authoring_contexts c
      join cde_bim_index_generations g on g.id=cde_bim_published_generation(c.project_code,c.model_key) and g.revision_id=c.revision_id
      join cde_bim_authoring_elements a on a.context_id=c.id and a.resolution_method='corroborated_aggregate'
      join cde_bim_authoring_members m on m.authoring_element_id=a.id
      join cde_bim_elements e on e.generation_id=g.id and e.local_id=a.root_local_id
      where c.project_code=$1 and c.model_key=$2 and c.revision_id=$3
      group by a.id,e.id order by a.element_key`,[context.projectCode,modelKey,revisionId])).rows);
    return res.json({success:true,context,data});
  } catch(error) {console.error('[bim-authoring.routes] tree failed',error);return res.status(500).json({success:false,message:'No se pudo cargar el árbol lógico'});}
});

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
