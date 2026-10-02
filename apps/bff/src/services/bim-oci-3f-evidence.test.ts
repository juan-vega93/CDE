import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";
const evidence = JSON.parse(fs.readFileSync("src/services/fixtures/bim-oci-3f-evidence.json", "utf8")) as {
  allSectorA5: { identityKey: string; memberCount: number; partidas: string[]; unit: string[] }[];
  members: { localId: number; sector: string; authoringKey: string; sourceElementId: string; role: string; metradoNumeric: number; unit: string }[];
};
test("real A5 is one composition in the partida; other sector members belong to other partidas/units", () => {
  const relevant=evidence.allSectorA5.filter(a=>a.partidas.includes("0.2.1.3"));
  assert.equal(relevant.length,1);assert.equal(relevant[0].identityKey,"aggregate:209862");assert.equal(relevant[0].memberCount,73);
  const members=evidence.members.filter(m=>m.sector==="A5");
  assert.equal(members.filter(m=>m.role==="root").length,1);
  assert.equal(members.filter(m=>m.role==="child").length,72);
  assert.ok(members.every(m=>m.metradoNumeric===156.616 && m.unit==="m3" && m.sourceElementId==="1177591"));
  assert.equal(evidence.allSectorA5.filter(a=>a.unit.includes("und")).length,2);
});
test("real A2 has two standalone AuthoringElements; sector is not consolidation identity",()=>{
  const members=evidence.members.filter(m=>m.sector==="A2");
  assert.equal(members.length,2);assert.equal(new Set(members.map(m=>m.authoringKey)).size,2);
  assert.ok(members.every(m=>m.role==="standalone"));
  assert.deepEqual(members.map(m=>m.sourceElementId).sort(),["1685992","1693433"]);
  assert.equal(members.reduce((n,m)=>n+m.metradoNumeric,0),289.851);
});
