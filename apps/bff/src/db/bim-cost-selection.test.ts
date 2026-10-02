import assert from "node:assert/strict";
import { test } from "node:test";
import { createCostSelectionResolver, type CostSelectionSource } from "./bim-cost-selection";
import { toCanonicalBimModelKey } from "../services/bim-model-identity";
import { toBimRevisionId } from "../services/bim-revision-identity";

const source = (key: string, ids: number[], graphical: number[]): CostSelectionSource => ({
  model_key: "legacy", project_code: "TEST", canonical_model_key: toCanonicalBimModelKey("/TEST/M.ifc"),
  revision_id: toBimRevisionId(Buffer.from("test identity")), element_key: key, member_ids: ids, graphical_ids: graphical
});
test("one picked child expands entire Authoring composition; multiple AEs remain distinct", () => {
  const resolve = createCostSelectionResolver([source("ae1",[1,2,3,4],[2,3]),source("ae2",[5],[5])]);
  const result=resolve({legacy:[2,3,5]});
  assert.equal(result.unresolvedEntityCount,0);assert.equal(result.groups.length,1);
  assert.deepEqual(result.groups[0].authoringElements,[{identityKey:"ae1",memberCount:4,graphicalLocalIds:[2,3]},
    {identityKey:"ae2",memberCount:1,graphicalLocalIds:[5]}]);
});
test("unknown membership and ambiguous legacy transport keys fail closed",()=>{
  const first=source("a",[1],[1]), other={...source("b",[1],[1]),canonical_model_key:toCanonicalBimModelKey("/TEST/other.ifc")};
  assert.equal(createCostSelectionResolver([first,other])({legacy:[1]}).unresolvedEntityCount,1);
  assert.equal(createCostSelectionResolver([first])({unloaded:[1]}).unresolvedEntityCount,1);
});
