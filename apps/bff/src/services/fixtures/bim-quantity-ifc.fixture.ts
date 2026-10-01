import { createAuthoringIfcFixture } from "./bim-authoring-ifc.fixture";

/** Valid synthetic assignments on the existing authoring fixture. Quantities
 * are invented test values, NOT measurements from the OCI export. */
export function createQuantityIfcFixture(schema: "IFC4" | "IFC4X3_ADD2" = "IFC4"): Buffer {
  const guid = (id: number) => id.toString(16).padStart(22, "0");
  const members = "#303839,#303708,#303729,#303750,#303771,#303792,#303813,#303834,#308027";
  const lines = [
    "#2000000=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);",
    "#2000001=IFCPROPERTYSINGLEVALUE('Metrado',$,IFCREAL(100.),#2000000);",
    `#2000002=IFCPROPERTYSET('${guid(2000002)}',$,'Datos_Partida',$,(#2000001));`,
    `#2000003=IFCRELDEFINESBYPROPERTIES('${guid(2000003)}',$,$,$,(${members}),#2000002);`,
    "#2000004=IFCQUANTITYVOLUME('NetVolume',$,#2000000,90.,$);",
    "#2000005=IFCQUANTITYAREA('NetArea',$,$,30.,$);",
    "#2000006=IFCQUANTITYLENGTH('Length',$,#4,3.,$);",
    "#2000007=IFCQUANTITYCOUNT('Count',$,$,2.,$);",
    "#2000008=IFCQUANTITYWEIGHT('Weight',$,$,40.,$);",
    "#2000009=IFCQUANTITYTIME('Time',$,$,5.,$);",
    `#2000010=IFCELEMENTQUANTITY('${guid(2000010)}',$,'Qto_SlabBaseQuantities',$,$,(#2000004,#2000005,#2000006,#2000007,#2000008,#2000009));`,
    `#2000011=IFCRELDEFINESBYPROPERTIES('${guid(2000011)}',$,$,$,(#303839),#2000010);`,
    "#2000012=IFCPROPERTYSINGLEVALUE('Raw',$,IFCLABEL(' 123,45 '),$);",
    `#2000013=IFCPROPERTYSET('${guid(2000013)}',$,'RawData',$,(#2000012));`,
    `#2000014=IFCRELDEFINESBYPROPERTIES('${guid(2000014)}',$,$,$,(#7),#2000013);`,
    "#2000050=IFCPROPERTYSINGLEVALUE('Zero',$,IFCREAL(0.),$);",
    "#2000051=IFCPROPERTYSINGLEVALUE('Empty',$,$,$);",
    "#2000052=IFCPROPERTYSINGLEVALUE('Flag',$,IFCBOOLEAN(.T.),$);",
    "#2000053=IFCCOMPLEXPROPERTY('Nested',$,'Test',(#2000050,#2000051,#2000052));",
    `#2000054=IFCPROPERTYSET('${guid(2000054)}',$,'TypeData',$,(#2000053));`,
    `#2000055=IFCSLABTYPE('${guid(2000055)}',$,'Test type',$,$,(#2000054),$,$,$,.FLOOR.);`,
    `#2000056=IFCRELDEFINESBYTYPE('${guid(2000056)}',$,$,$,(#308027),#2000055);`,
    "#2000060=IFCDERIVEDUNITELEMENT(#4,3);",
    "#2000061=IFCDERIVEDUNIT((#2000060),.USERDEFINED.,'test cubic length');",
    "#2000062=IFCPROPERTYSINGLEVALUE('ExplicitDerived',$,IFCREAL(5.),#2000061);",
    "#2000063=IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.);",
    "#2000064=IFCPROPERTYSINGLEVALUE('ExplicitPrefix',$,IFCREAL(5.),#2000063);",
    `#2000065=IFCPROPERTYSET('${guid(2000065)}',$,'UnitEvidence',$,(#2000062,#2000064));`,
    `#2000066=IFCRELDEFINESBYPROPERTIES('${guid(2000066)}',$,$,$,(#308027),#2000065);`
  ];
  // Same set/name/value, but different property AND set IDs; no duplicate
  // property names inside a single IfcPropertySet (UniquePropertyNames).
  for (const id of [2000020, 2000030]) lines.push(
    `#${id}=IFCPROPERTYSINGLEVALUE('Repeated',$,IFCREAL(12.),$);`,
    `#${id + 1}=IFCPROPERTYSET('${guid(id + 1)}',$,'DuplicateSet',$,(#${id}));`,
    `#${id + 2}=IFCRELDEFINESBYPROPERTIES('${guid(id + 2)}',$,$,$,(#303839),#${id + 1});`
  );
  if (schema === "IFC4X3_ADD2") lines.push(
    "#2000040=IFCQUANTITYNUMBER('Number',$,$,7.,$);",
    `#2000041=IFCELEMENTQUANTITY('${guid(2000041)}',$,'Numbers',$,$,(#2000040));`,
    `#2000042=IFCRELDEFINESBYPROPERTIES('${guid(2000042)}',$,$,$,(#303839),#2000041);`
  );
  return Buffer.from(createAuthoringIfcFixture().toString().replace("FILE_SCHEMA(('IFC4'));", `FILE_SCHEMA(('${schema}'));`)
    .replace("\nENDSEC;\nEND-ISO", `\n${lines.join("\n")}\nENDSEC;\nEND-ISO`));
}
