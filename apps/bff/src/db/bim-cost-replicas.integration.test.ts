import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import { test } from "node:test";
import { getDatabasePool } from "./client";
import { bulkUpsertBimElements, getBimCost5DAggregation, upsertBimModel } from "./bim-index-store";
import { createBimIndexGeneration, publishBimIndexGeneration } from "./bim-index-generations";
import { replaceAuthoringElementIndex } from "./bim-authoring-store";
import { resolveAuthoringElements, type CompositionRelationFact } from "../services/bim-authoring-resolver";
import type { BimProcessingContext } from "../services/bim-revision-identity";
import { STORED_REPLICA_POLICY } from "./bim-cost-replicas";

test("published PostgreSQL OCI observations: raw 115 / logical 7 / graphics 112 / stored 1842.105", {skip: !process.env.DATABASE_URL}, async () => {
  const fixture = JSON.parse(fs.readFileSync("src/services/fixtures/bim-oci-3f-evidence.json", "utf8")) as {
    context: BimProcessingContext;
    authoringElements: { composition_evidence: { relations: CompositionRelationFact[] } }[];
    members: {localId:number; globalId:string; ifcClass:string; sourceElementId:string; geometryStatus:"present"|"absent"; metradoNumeric:number; partida:string; unit:string}[];
  };
  const projectCode = `TEST-REPLICAS-${randomUUID().toUpperCase()}`;
  const context = {...fixture.context, projectCode};
  const pool = getDatabasePool();
  try {
    const model = await upsertBimModel({ projectCode, documentPath:context.modelKey, documentName:"OCI.ifc", modelKey:context.modelKey, status:"processing" });
    const generationId = await createBimIndexGeneration(model.id,context);
    await bulkUpsertBimElements(model.id,fixture.members.map(m=>({localId:m.localId, globalId:m.globalId, ifcClass:m.ifcClass,
      properties:[{setName:"Stored",name:"Partida",value:m.partida},{setName:"Stored",name:"Metrado",value:m.metradoNumeric},{setName:"Stored",name:"Unidad",value:m.unit}]
    })),{generationId});
    await replaceAuthoringElementIndex(resolveAuthoringElements({context,
      relations:fixture.authoringElements.flatMap(a=>a.composition_evidence.relations),
      entities:fixture.members.map(m=>({localId:m.localId,ifcClass:m.ifcClass,geometryStatus:m.geometryStatus,
        authoringElementId:m.sourceElementId,tag:m.sourceElementId,sourceContainer:"OCI fixture"}))}));
    await publishBimIndexGeneration({generationId,context,elementCount:115,propertyCount:345});
    const input={projectCode,modelKeys:[context.modelKey],itemId:{setName:"Stored",propertyName:"Partida"},
      itemUnit:{setName:"Stored",propertyName:"Unidad"},quantity:{setName:"Stored",propertyName:"Metrado"}};
    const raw=await getBimCost5DAggregation(input);
    assert.equal(raw.rows[0].elementCount,115); assert.equal(Number(raw.rows[0].quantity!.toFixed(3)),25305.046);
    const logical=await getBimCost5DAggregation({...input,quantitySource:"stored_parameter",quantityPolicy:STORED_REPLICA_POLICY});
    const row=logical.rows[0]; assert.equal(row.elementCount,7); assert.equal(Number(row.quantity!.toFixed(3)),1842.105);
    assert.equal(row.rawEntityCount,115); assert.equal(row.logicalRows!.length,7);
    assert.equal(row.logicalRows!.reduce((n,r)=>n+r.graphicalLocalIds.length,0),112);
    const a5=row.logicalRows!.find(r=>r.identityKey==="aggregate:209862")!;
    assert.equal(a5.quantity,156.616);assert.equal(a5.memberLocalIds.length,73);assert.equal(a5.graphicalLocalIds.length,72);
    await pool.query(`update cde_bim_property_values v set value_number=999 from cde_bim_elements e,cde_bim_properties p
      where e.id=v.bim_element_id and p.id=v.property_id and e.bim_model_id=$1 and e.local_id=208374 and p.name='Metrado'`,[model.id]);
    const conflict=await getBimCost5DAggregation({...input,quantitySource:"stored_parameter",quantityPolicy:STORED_REPLICA_POLICY});
    assert.equal(conflict.rows[0].quantity,null); assert.equal(conflict.totals.quantity,null);
    assert.equal(conflict.rows[0].logicalRows!.find(r=>r.identityKey==="aggregate:209862")!.reason,"conflicting_values");
    assert.equal(conflict.rows[0].logicalRows!.filter(r=>r.status==="resolved").length,6);
  } finally {
    await pool.query("delete from cde_bim_models where project_code=$1",[projectCode]);
    await pool.query("delete from cde_bim_index_scopes where project_code=$1",[projectCode]);
    await pool.query("delete from cde_bim_authoring_contexts where project_code=$1",[projectCode]);
    await pool.end();
  }
});
