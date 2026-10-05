import * as WEBIFC from "web-ifc";
import type { AuthoringEntityFact, CompositionRelationFact } from "./bim-authoring-resolver";

/** Same open model. Two batched relation scans; candidate placements read once. */
export function readAuthoringExportStructure(api:WEBIFC.IfcAPI,modelId:number,facts:AuthoringEntityFact[]):AuthoringEntityFact[] {
  const candidates=new Set(facts.filter(e=>e.ifcClass.toUpperCase()==='IFCSLAB'&&e.authoringElementId).map(e=>e.localId));
  const types=new Map<number,Set<number>>(),spatial=new Map<number,Set<number>>();
  const ref=(v:unknown)=>Number((v as {value?:unknown}|null)?.value);
  for(const [type,target,field] of [[WEBIFC.IFCRELDEFINESBYTYPE,types,'RelatingType'],[WEBIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE,spatial,'RelatingStructure']] as const){
    const ids=api.GetLineIDsWithType(modelId,type,false);
    for(let i=0;i<ids.size();i++){
      const line=api.GetLine(modelId,ids.get(i),false,false);
      for(const member of (line.RelatedObjects??line.RelatedElements??[]) as unknown[]){
        const id=ref(member);if(!candidates.has(id))continue;
        const values=target.get(id)??new Set();values.add(ref(line[field]));target.set(id,values);
      }
    }
  }
  return facts.map(e=>{
    if(!candidates.has(e.localId)||types.get(e.localId)?.size!==1||spatial.get(e.localId)?.size!==1)return e;
    const line=api.GetLine(modelId,e.localId,false,false);
    if(!line.ObjectPlacement||!line.Representation)return e;
    const placement=api.GetLine(modelId,ref(line.ObjectPlacement),false,false);
    return {...e,exportStructure:{typeLocalId:[...types.get(e.localId)!][0],spatialLocalId:[...spatial.get(e.localId)!][0],
      placementRelativeTo:ref(placement.PlacementRelTo),relativePlacement:ref(placement.RelativePlacement),
      representationLocalId:ref(line.Representation),objectType:String(line.ObjectType?.value??''),predefinedType:String(line.PredefinedType?.value??'')}};
  });
}

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
