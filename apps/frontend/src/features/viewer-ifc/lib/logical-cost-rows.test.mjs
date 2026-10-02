import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
const exports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL("./logical-cost-rows.ts",import.meta.url),"utf8"), {
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}
}).outputText,{exports});
const detail = { key:"key",context:{projectCode:"P",modelKey:"/P/M.ifc",revisionId:"sha256:test"},identityKey:"aggregate:209862",
  representativeLocalId:209862,memberLocalIds:[1,2,3],graphicalLocalIds:[2,3],quantity:156.616,status:"resolved",reason:null,replicaCount:2 };
test("logical table and CSV share one stored observation, membership and revision trace",()=>{
  const groups=[{itemId:"0.2.1.3",itemName:"Floor",itemUnit:"m3",logicalRows:[detail]}];
  assert.equal(exports.logicalCostTable(groups).length,1);
  const csv=exports.logicalCostCsv(groups);
  assert.equal(csv.split("\r\n").length,2);
  for(const expected of ["156.616","aggregate:209862","sha256:test","1|2|3","stored-authoring-replicas@1"]) assert.ok(csv.includes(expected));
});
test("ambiguity remains blank quantity with reason, never an implicit zero; errors exported",()=>{
  const groups=[{itemId:"P",itemName:'=unsafe"name',itemUnit:"m3",logicalRows:[{...detail,quantity:null,status:"ambiguous",reason:"conflicting_values"}]},
    {itemId:"missing",itemName:"Missing",itemUnit:"m3",consolidationError:"missing membership"}];
  assert.equal(exports.logicalCostTable(groups)[0].quantity,null);
  const csv=exports.logicalCostCsv(groups);
  assert.ok(csv.includes('"","ambiguous","conflicting_values"'));
  assert.ok(csv.includes("missing membership")); assert.ok(csv.includes("'=unsafe"));
});
