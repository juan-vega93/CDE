import { createAuthoringIfcFixture } from "./bim-authoring-ifc.fixture";

/** Synthetic IFC4: late custom sets and a large set exercise the old 64/120
 * truncation boundaries. No OCI quantities are asserted by this fixture. */
export function createPropertyCoverageIfcFixture(): Buffer {
  const lines: string[] = [];
  let next = 3000000;
  const guid = (id: number) => id.toString(16).padStart(22, "0");
  function pset(name: string, values: [string, string][], typed = false) {
    const properties = values.map(([key, value]) => {
      const id = next++;
      lines.push(`#${id}=IFCPROPERTYSINGLEVALUE('${key}',$,${value},$);`);
      return `#${id}`;
    });
    const set = next++;
    lines.push(`#${set}=IFCPROPERTYSET('${guid(set)}',$,'${name}',$,(${properties.join(",")}));`);
    const relation = next++;
    if (typed) {
      const type = next++;
      lines.push(`#${type}=IFCSLABTYPE('${guid(type)}',$,'Coverage type',$,$,(#${set}),$,$,$,.FLOOR.);`);
      lines.push(`#${relation}=IFCRELDEFINESBYTYPE('${guid(relation)}',$,$,$,(#303839),#${type});`);
    } else lines.push(`#${relation}=IFCRELDEFINESBYPROPERTIES('${guid(relation)}',$,$,$,(#303839),#${set});`);
  }
  pset("Datos_Partida", [
    ...Array.from({ length: 121 }, (_, i): [string, string] => [`Field${i}`, `IFCLABEL('value${i}')`]),
    ["Partida", "IFCLABEL('TEST-COVERAGE')"], ["Unidad Medida", "IFCLABEL('m3')"], ["Metrado", "IFCREAL(123.45)"]
  ]);
  for (let i = 0; i < 64; i++) pset(`CustomSet${i}`, [["Parameter", `IFCLABEL('value${i}')`]]);
  pset("MiPsetPersonalizado", [["MiParametro", "IFCLABEL('arbitrary-custom')"]]);
  pset("Pset_SlabCommon", [["IsExternal", "IFCBOOLEAN(.F.)"]]);
  pset("CustomTypePset", [["TypeParameter", "IFCLABEL('type-custom')"]], true);
  const volume = next++, area = next++, set = next++, relation = next++;
  lines.push(`#${volume}=IFCQUANTITYVOLUME('NetVolume',$,$,120.,$);`);
  lines.push(`#${area}=IFCQUANTITYAREA('NetArea',$,$,40.,$);`);
  lines.push(`#${set}=IFCELEMENTQUANTITY('${guid(set)}',$,'Qto_SlabBaseQuantities',$,$,(#${volume},#${area}));`);
  lines.push(`#${relation}=IFCRELDEFINESBYPROPERTIES('${guid(relation)}',$,$,$,(#303839),#${set});`);
  return Buffer.from(createAuthoringIfcFixture().toString().replace("\nENDSEC;\nEND-ISO", `\n${lines.join("\n")}\nENDSEC;\nEND-ISO`));
}
