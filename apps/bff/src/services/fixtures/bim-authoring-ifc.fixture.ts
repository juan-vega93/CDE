import { createOciAuthoringFixture } from "./bim-authoring-oci.fixture";

/** Synthetic IFC4, NOT the original OCI export or its digest. Reuses only its
 * audited composition topology/IDs; graphical pieces are simple unit prisms.
 * Changing height yields another valid IFC, not arbitrary corrupted bytes. */
export function createAuthoringIfcFixture(options: { height?: number; empty?: boolean; missingEvidence?: boolean } = {}): Buffer {
  const { entities, relations } = createOciAuthoringFixture();
  const height = options.height ?? 1;
  if (!Number.isFinite(height) || height <= 0) throw new Error("Invalid fixture height");
  const guid = (id: number) => id.toString(16).padStart(22, "0");
  const refs = (ids: readonly number[]) => ids.map((id) => `#${id}`).join(",");
  const data = [
    "#1=IFCCARTESIANPOINT((0.,0.,0.));",
    "#2=IFCAXIS2PLACEMENT3D(#1,$,$);",
    "#3=IFCDIRECTION((0.,0.,1.));",
    "#4=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);",
    "#5=IFCUNITASSIGNMENT((#4));",
    "#6=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,0.00001,#2,$);",
    `#7=IFCPROJECT('${guid(7)}',$,'Synthetic authoring integration',$,$,$,$,(#6),#5);`,
    "#8=IFCLOCALPLACEMENT($,#2);",
    "#9=IFCCARTESIANPOINT((0.,0.));",
    "#10=IFCAXIS2PLACEMENT2D(#9,$);",
    "#11=IFCRECTANGLEPROFILEDEF(.AREA.,$,#10,1.,1.);",
    `#12=IFCEXTRUDEDAREASOLID(#11,#2,#3,${height.toFixed(3)});`,
    "#13=IFCSHAPEREPRESENTATION(#6,'Body','SweptSolid',(#12));",
    "#14=IFCPRODUCTDEFINITIONSHAPE($,$,(#13));"
  ];
  if (!options.empty) {
    data.push(`#15=IFCBUILDINGSTOREY('${guid(15)}',$,'Synthetic storey',$,$,#8,$,$,.ELEMENT.,0.);`);
    data.push(`#16=IFCRELAGGREGATES('${guid(16)}',$,$,$,#7,(#15));`);
    for (const fact of entities) {
      data.push(`#${fact.localId}=IFCSLAB('${guid(fact.localId)}',$,'${fact.name}',$,$,#8,${fact.hasRepresentation ? "#14" : "$"},'${fact.tag}',.FLOOR.);`);
    }
    for (const relation of relations) {
      data.push(`#${relation.relationLocalId}=IFCRELAGGREGATES('${guid(relation.relationLocalId)}',$,$,$,#${relation.parentLocalId},(${refs(relation.childLocalIds)}));`);
    }
    const children = new Set(relations.flatMap((r) => [...r.childLocalIds]));
    data.push(`#17=IFCRELCONTAINEDINSPATIALSTRUCTURE('${guid(17)}',$,$,$,(${refs(entities.filter((e) => !children.has(e.localId)).map((e) => e.localId))}),#15);`);
    if (!options.missingEvidence) {
      let next = 1000000;
      const groups = new Map<string, number[]>();
      for (const entity of entities) {
        const members = groups.get(entity.tag!) ?? [];
        members.push(entity.localId);
        groups.set(entity.tag!, members);
      }
      for (const [tag, ids] of groups) {
        const id = next; next += 4;
        data.push(`#${id}=IFCPROPERTYSINGLEVALUE('ID elemento',$,IFCLABEL('${tag}'),$);`);
        data.push(`#${id + 1}=IFCPROPERTYSINGLEVALUE('Contenedor Origen',$,IFCLABEL('100021-JYS01-000-ZZZ-MBM-OCI-E3-000100'),$);`);
        data.push(`#${id + 2}=IFCPROPERTYSET('${guid(id + 2)}',$,'Descripcion del elemento',$,(#${id},#${id + 1}));`);
        data.push(`#${id + 3}=IFCRELDEFINESBYPROPERTIES('${guid(id + 3)}',$,$,$,(${refs(ids)}),#${id + 2});`);
      }
    }
  }
  return Buffer.from(`ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ViewDefinition [ReferenceView_V1.2]'),'2;1');
FILE_NAME('synthetic-authoring.ifc','2026-09-29T00:00:00',('Test'),('Test'),'BIM Core tests','BIM Core tests','');
FILE_SCHEMA(('IFC4'));
ENDSEC;
DATA;
${data.join("\n")}
ENDSEC;
END-ISO-10303-21;
`);
}
