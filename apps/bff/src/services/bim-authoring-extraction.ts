import * as WEBIFC from "web-ifc";
import type { AuthoringEntityFact, CompositionRelationFact } from "./bim-authoring-resolver";

/** Inspect only transient mesh metadata; never copy vertex/index buffers or retain meshes. */
export function readAuthoringGeometry(
  api: WEBIFC.IfcAPI, modelId: number, facts: AuthoringEntityFact[]
): AuthoringEntityFact[] {
  const candidates = facts.filter((fact) => fact.hasRepresentation !== false).map((fact) => fact.localId);
  const present = new Set<number>();
  if (candidates.length) {
    api.StreamMeshes(modelId, candidates, (mesh) => {
      if (mesh.geometries.size() > 0) present.add(mesh.expressID);
    });
  }
  return facts.map((fact) => present.has(fact.localId) ? { ...fact, geometryStatus: "present" } : fact);
}

/** One relation scan on the already open IFC, preserving the existing indexer's element universe. */
export function readAuthoringRelations(
  api: WEBIFC.IfcAPI, modelId: number, localIds: ReadonlySet<number>
): CompositionRelationFact[] {
  const relations: CompositionRelationFact[] = [];
  const reference = (value: unknown): number => Number((value as { value?: unknown } | null)?.value);
  for (const [type, relationType] of [
    [WEBIFC.IFCRELAGGREGATES, "IfcRelAggregates"],
    [WEBIFC.IFCRELNESTS, "IfcRelNests"]
  ] as const) {
    const ids = api.GetLineIDsWithType(modelId, type, false);
    for (let i = 0; i < ids.size(); i++) {
      const relationLocalId = ids.get(i);
      const line = api.GetLine(modelId, relationLocalId, false, false);
      if (!line) throw new Error(`Cannot read authoring relation ${relationLocalId}`);
      const parentLocalId = reference(line.RelatingObject);
      const childLocalIds = (line.RelatedObjects as unknown[] ?? []).map(reference);
      if (localIds.has(parentLocalId) || childLocalIds.some((id) => localIds.has(id))) {
        // Keep missing/outside references on relevant edges: the resolver decides fallback.
        relations.push({ relationLocalId, relationType, parentLocalId, childLocalIds });
      }
    }
  }
  return relations;
}
