import type { AuthoringElementResolution, AuthoringEntityFact } from './bim-authoring-resolver';

/** Native references scoped to one parsed IFC revision. */
export type ExportStructure = Readonly<{
  typeLocalId: number;
  spatialLocalId: number;
  placementRelativeTo: number;
  relativePlacement: number;
  representationLocalId: number;
  objectType: string;
  predefinedType: string;
}>;
const signature = (s: ExportStructure) => JSON.stringify([
  s.typeLocalId, s.spatialLocalId, s.placementRelativeTo,
  s.relativePlacement, s.objectType, s.predefinedType
]);
const validReferences = (s: ExportStructure) => [
  s.typeLocalId, s.spatialLocalId, s.placementRelativeTo,
  s.relativePlacement, s.representationLocalId
].every(id => Number.isSafeInteger(id) && id > 0);

/** Conservative Revit floor multi-body export contract, corroborated on OCI.
 * Only relation-free standalone slabs qualify. Missing/contradictory evidence
 * preserves the singleton identities. Quantities never participate in identity.
 */
export function reconcileExportSplits(
  elements: AuthoringElementResolution[], facts: ReadonlyMap<number, AuthoringEntityFact>
): AuthoringElementResolution[] {
  const groups = new Map<string, AuthoringElementResolution[]>();
  for (const element of elements) {
    if (!element.authoringElementId || !element.sourceContainer) continue;
    const key = JSON.stringify([element.sourceContainer, element.authoringElementId]);
    const group = groups.get(key) ?? [];
    group.push(element);
    groups.set(key, group);
  }
  const replacements = new Map<AuthoringElementResolution, AuthoringElementResolution | null>();
  for (const group of groups.values()) {
    // A relation-based group or fallback sharing this ID blocks inference entirely.
    if (group.length < 2 || group.some(e => e.resolutionMethod !== 'standalone' || e.memberLocalIds.length !== 1)) continue;
    const members = group.map(e => facts.get(e.memberLocalIds[0])!);
    const id = group[0].authoringElementId!;
    if (members.some(e => e.ifcClass.toUpperCase() !== 'IFCSLAB' || e.tag !== id || !e.globalId ||
      !e.exportStructure || e.geometryStatus !== 'present')) continue;
    const structure = members[0].exportStructure!;
    if (structure.predefinedType !== 'FLOOR' || !structure.objectType.startsWith('Floor:')) continue;
    const baseName = `${structure.objectType}:${id}`;
    const ordinals = members.map(e => e.name === baseName ? 1 :
      e.name?.startsWith(baseName + ':') && /^[2-9][0-9]*$|^1[0-9]+$/.test(e.name.slice(baseName.length + 1))
        ? Number(e.name.slice(baseName.length + 1)) : NaN);
    if (ordinals.some(n => !Number.isSafeInteger(n) || n < 1) ||
      new Set(ordinals).size !== members.length || Math.max(...ordinals) !== members.length) continue;
    if (new Set(members.map(e => e.globalId)).size !== members.length ||
      new Set(members.map(e => e.exportStructure!.representationLocalId)).size !== members.length) continue;
    if (members.some(e => !validReferences(e.exportStructure!) || signature(e.exportStructure!) !== signature(structure))) continue;

    const anchor = members[ordinals.indexOf(1)];
    const ids = members.map(e => e.localId).sort((a, b) => a - b);
    // This is a representative, not an invented IfcRelAggregates root.
    const resolved: AuthoringElementResolution = {
      identityKey: `export-split:${anchor.localId}`, representativeLocalId: anchor.localId,
      memberLocalIds: ids, graphicalLocalIds: ids, geometryUnknownLocalIds: [],
      authoringElementId: id, sourceContainer: group[0].sourceContainer,
      resolutionMethod: 'corroborated_export_split', resolutionStatus: 'resolved', identityConfidence: 'high',
      compositionEvidence: {
        relations: [], affectedLocalIds: ids, missingLocalIds: [], issues: [],
        corroboration: { authoringElementId: id, tag: id, sourceContainer: group[0].sourceContainer },
        exportSplit: {
          representativeLocalId: anchor.localId,
          members: members.map(e => ({ localId: e.localId, structure: e.exportStructure! })).sort((a, b) => a.localId - b.localId)
        }
      }
    };
    group.forEach((element, index) => replacements.set(element, index === 0 ? resolved : null));
  }
  return elements.flatMap(element => {
    if (!replacements.has(element)) return [element];
    const replacement = replacements.get(element);
    return replacement ? [replacement] : [];
  });
}
