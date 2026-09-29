import type {
  AuthoringEntityFact, AuthoringModelContext, CompositionRelationFact
} from "../bim-authoring-resolver";

/** Minimal facts from the read-only OCI audit; IDs are real, not generated ranges.
 * Property bags and quantities are deliberately excluded from identity fixtures.
 */
export const OCI_CONTEXT: AuthoringModelContext = {
  projectCode: "AR3173",
  modelKey: "frag:/ar3173/100021-jys01-000-zzz-ifc-oci-e4-070001.ifc",
  revisionId: "sha256:120e9127c5be1cb11541f458968448d7031fcd63b72709af3cf276d6c3b9733c"
};

export const OCI_COMPOSITIONS = [
  { tag: "1177591", root: 202224, relation: 202225, children: [
    200736, 200758, 200779, 200800, 200821, 200842, 200863, 200884,
    200905, 200926, 200947, 200968, 200989, 201010, 201031, 201052,
    201073, 201094, 201115, 201136, 201157, 201178, 201199, 201220,
    201241, 201262, 201283, 201304, 201325, 201346, 201367, 201388,
    201409, 201430, 201451, 201472, 201493, 201514, 201535, 201556,
    201577, 201598, 201619, 201640, 201661, 201682, 201703, 201724,
    201745, 201766, 201787, 201808, 201829, 201847, 201868, 201889,
    201910, 201931, 201952, 201973, 201994, 202015, 202036, 202057,
    202078, 202099, 202120, 202138, 202159, 202180, 202201, 202219
  ] },
  { tag: "1641726", root: 298252, relation: 298253, children: [
    297911, 297932, 297953, 297974, 297995, 298016, 298037, 298058,
    298079, 298100, 298121, 298142, 298163, 298184, 298205, 298226, 298247
  ] },
  { tag: "1685992", root: 300359, relation: 300360, children: [
    299829, 299850, 299871, 299892, 299913, 299934, 299955, 299976,
    299997, 300018, 300039, 300060, 300081, 300102, 300123, 300144,
    300165, 300186, 300207, 300228, 300249, 300270, 300291, 300312, 300333, 300354
  ] },
  { tag: "1693104", root: 303839, relation: 303840, children: [
    303708, 303729, 303750, 303771, 303792, 303813, 303834
  ] },
  { tag: "1693433", root: 304531, relation: 304532, children: [
    304234, 304255, 304276, 304297, 304318, 304339, 304360, 304381,
    304402, 304423, 304444, 304465, 304484, 304505, 304526
  ] },
  { tag: "1693619", root: 305685, relation: 305686, children: [
    305302, 305323, 305344, 305365, 305386, 305407, 305428, 305449,
    305470, 305491, 305512, 305533, 305554, 305575, 305596, 305617,
    305638, 305659, 305680
  ] },
  { tag: "1698443", root: 308382, relation: 308383, children: [
    308111, 308132, 308153, 308174, 308195, 308215, 308235,
    308256, 308274, 308293, 308314, 308335, 308356, 308377
  ] },
  { tag: "1698633", root: 309255, relation: 309256, children: [
    309106, 309127, 309148, 309169, 309190, 309211, 309229, 309250
  ] }
] as const;

export function createOciAuthoringFixture(): {
  context: AuthoringModelContext;
  entities: AuthoringEntityFact[];
  relations: CompositionRelationFact[];
} {
  const fact = (localId: number, tag: string, geometryStatus: "present" | "absent"): AuthoringEntityFact => ({
    localId,
    ifcClass: "IfcSlab",
    name: `Floor:AS01_Asfalto_General_e=30cm:${tag}`,
    tag,
    authoringElementId: tag,
    sourceContainer: "100021-JYS01-000-ZZZ-MBM-OCI-E3-000100",
    hasRepresentation: geometryStatus === "present",
    geometryStatus
  });
  return {
    context: { ...OCI_CONTEXT },
    entities: [
      ...OCI_COMPOSITIONS.flatMap((group) => [
        fact(group.root, group.tag, "absent"),
        ...group.children.map((id) => fact(id, group.tag, "present"))
      ]),
      fact(308027, "1698042", "present")
    ],
    relations: OCI_COMPOSITIONS.map((group) => ({
      relationLocalId: group.relation,
      relationType: "IfcRelAggregates",
      parentLocalId: group.root,
      childLocalIds: [...group.children]
    }))
  };
}
