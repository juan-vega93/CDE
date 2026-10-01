import assert from "node:assert/strict";
import crypto, { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import * as WEBIFC from "web-ifc";
import { getDatabasePool } from "../db/client";
import { getBimIndexJob, getBimModelByDocument } from "../db/bim-index-store";
import { resolveAuthoringElementByLocalId, getAuthoringElementMembers } from "../db/bim-authoring-store";
import { indexBimPropertiesFromBuffer } from "./bim-property-indexer.service";
import { prepareBimIfcInput } from "./bim-revision-identity";
import { createAuthoringIfcFixture } from "./fixtures/bim-authoring-ifc.fixture";
import { createQuantityIfcFixture } from "./fixtures/bim-quantity-ifc.fixture";

const enabled = Boolean(process.env.DATABASE_URL?.trim());
const projectCode = `TEST-AUTHORING-PIPELINE-${randomUUID()}`;
const input = {
  projectCode, documentPath: "/TEST/Model.ifc", documentName: "Model.ifc",
  modelKey: "frag:/test/model.ifc", sourceHash: "legacy-etag", sourceVersion: "current",
  ifcBuffer: createAuthoringIfcFixture()
};

after(async () => {
  if (!enabled) return;
  const pool = getDatabasePool();
  try {
    await pool.query("drop trigger if exists test_authoring_pipeline_failure on cde_bim_authoring_elements");
    await pool.query("drop function if exists test_authoring_pipeline_failure()");
    for (const table of ["cde_bim_authoring_contexts", "cde_bim_models", "cde_bim_index_jobs"]) {
      await pool.query(`delete from ${table} where project_code = $1`, [projectCode]);
    }
  } finally { await pool.end(); }
});

test("IFC pipeline feeds the strict authoring index", { skip: !enabled }, async (t) => {
  const pool = getDatabasePool();
  const expected = prepareBimIfcInput(input).context;
  const counts = async (revisionId = expected.revisionId, onlySlabs = false) => (await pool.query(`select
    count(distinct a.id)::int as elements,
    count(distinct a.id) filter (where a.resolution_method='corroborated_aggregate')::int as compositions,
    count(distinct a.id) filter (where a.resolution_method='standalone')::int as standalone,
    count(m.local_id)::int as members,
    count(m.local_id) filter (where m.geometry_status='present')::int as graphical
    from cde_bim_authoring_contexts c left join cde_bim_authoring_elements a on a.context_id=c.id
    left join cde_bim_authoring_members m on m.authoring_element_id=a.id
    where c.project_code=$1 and c.model_key=$2 and c.revision_id=$3
    and (not $4::boolean or m.local_id <> 15)`, [projectCode, expected.modelKey, revisionId, onlySlabs])).rows[0];
  // Existing web-ifc IsIfcElement also includes the fixture's spatial storey #15.
  // Preserve that universe; assert the audited slab subset separately below.
  const expectedCounts = { elements: 10, compositions: 8, standalone: 1, members: 188, graphical: 179 };

  await t.test("real web-ifc extraction persists 187 semantic and 179 graphical members with one open and hash", async (t) => {
    const open = t.mock.method(WEBIFC.IfcAPI.prototype, "OpenModel");
    const hash = t.mock.method(crypto, "createHash");
    const result = await indexBimPropertiesFromBuffer(input);
    assert.equal(open.mock.callCount(), 1);
    assert.equal(hash.mock.calls.filter((call) => call.arguments[0] === "sha256").length, 1);
    assert.deepEqual(result.context, expected);
    assert.equal(result.elementCount, 188);
    assert.deepEqual(await counts(), expectedCounts);
    assert.deepEqual(await counts(expected.revisionId, true), {
      elements: 9, compositions: 8, standalone: 1, members: 187, graphical: 179
    });
    const storey = await resolveAuthoringElementByLocalId(expected, 15);
    assert.equal(storey?.resolutionMethod, "singleton_fallback");
    assert.deepEqual(storey?.memberLocalIds, [15]);
    assert.deepEqual(storey?.graphicalLocalIds, []);
    assert.equal((await getBimModelByDocument(input))?.status, "ready");
    assert.equal((await getBimIndexJob(input))?.status, "ready");
  });

  await t.test("root, child and standalone are sourced from IFC observations", async () => {
    const root = await resolveAuthoringElementByLocalId(expected, 303839);
    assert.equal(root?.identityKey, "aggregate:303839");
    assert.equal(root?.authoringElementId, "1693104");
    assert.deepEqual(await resolveAuthoringElementByLocalId(expected, 303708), root);
    assert.deepEqual(await getAuthoringElementMembers(expected, root!.identityKey), [303708, 303729, 303750, 303771, 303792, 303813, 303834, 303839]);
    const standalone = await resolveAuthoringElementByLocalId(expected, 308027);
    assert.equal(standalone?.authoringElementId, "1698042");
    assert.equal(standalone?.resolutionMethod, "standalone");
    assert.deepEqual(standalone?.graphicalLocalIds, [308027]);
  });

  await t.test("same bytes retain context ID and replace idempotently despite legacy metadata changes", async () => {
    const contexts = async () => (await pool.query("select id, revision_id from cde_bim_authoring_contexts where project_code=$1 order by revision_id", [projectCode])).rows;
    const before = await contexts();
    const result = await indexBimPropertiesFromBuffer({ ...input, sourceHash: "another-etag", modelKey: "ifc:/test/model.ifc", sourceVersion: "another label" });
    assert.deepEqual(result.context, expected);
    assert.deepEqual(await contexts(), before);
    assert.deepEqual(await counts(), expectedCounts);
  });

  await t.test("a valid IFC with different prism height creates an independent revision", async () => {
    const result = await indexBimPropertiesFromBuffer({ ...input, ifcBuffer: createAuthoringIfcFixture({ height: 2 }) });
    assert.notEqual(result.context.revisionId, expected.revisionId);
    assert.equal(result.context.modelKey, expected.modelKey);
    assert.deepEqual(await counts(), expectedCounts);
    assert.deepEqual(await counts(result.context.revisionId), expectedCounts);
  });

  await t.test("authoring store failure rolls back replacement, propagates and prevents ready", async () => {
    // Test-only trigger in disposable PostgreSQL; no production injection hooks.
    await pool.query(`create function test_authoring_pipeline_failure() returns trigger language plpgsql as $$
      begin
        if new.element_key = 'entity:308027' and exists(select 1 from cde_bim_authoring_contexts where id=new.context_id and project_code='${projectCode}') then
          raise exception 'controlled authoring pipeline persistence failure';
        end if;
        return new;
      end $$;
      create trigger test_authoring_pipeline_failure before insert on cde_bim_authoring_elements
      for each row execute function test_authoring_pipeline_failure();`);
    try {
      await assert.rejects(indexBimPropertiesFromBuffer(input), /controlled authoring pipeline persistence failure/);
      assert.deepEqual(await counts(), expectedCounts);
      assert.equal((await getBimModelByDocument(input))?.status, "failed");
      assert.equal((await getBimIndexJob(input))?.status, "failed");
    } finally {
      await pool.query("drop trigger test_authoring_pipeline_failure on cde_bim_authoring_elements; drop function test_authoring_pipeline_failure()");
    }
  });

  await t.test("extraction errors propagate without replacing the previous authoring index", async (t) => {
    t.mock.method(WEBIFC.IfcAPI.prototype, "GetLine", () => { throw new Error("controlled extraction failure"); });
    await assert.rejects(indexBimPropertiesFromBuffer(input), /controlled extraction failure/);
    assert.deepEqual(await counts(), expectedCounts);
    assert.equal((await getBimIndexJob(input))?.status, "failed");
  });

  await t.test("no corroborating properties persists resolver fallbacks without guessing authorship", async () => {
    const result = await indexBimPropertiesFromBuffer({ ...input, ifcBuffer: createAuthoringIfcFixture({ missingEvidence: true }) });
    const element = await resolveAuthoringElementByLocalId(result.context, 303708);
    assert.equal(element?.resolutionMethod, "singleton_fallback");
    assert.equal(element?.identityKey, "entity:303708");
    assert.equal((await counts(result.context.revisionId)).members, 188);
  });

  await t.test("valid empty IFC persists an empty context before ready", async () => {
    const result = await indexBimPropertiesFromBuffer({ ...input, ifcBuffer: createAuthoringIfcFixture({ empty: true }) });
    assert.equal(result.elementCount, 0);
    assert.equal((await pool.query("select count(*)::int as n from cde_bim_authoring_contexts where project_code=$1 and revision_id=$2", [projectCode, result.context.revisionId])).rows[0].n, 1);
    assert.equal((await counts(result.context.revisionId)).members, 0);
    assert.equal((await getBimIndexJob(input))?.status, "ready");
  });
  await t.test("real quantity fixture returns observations while authoring persistence stays revision-scoped", async () => {
    const result = await indexBimPropertiesFromBuffer({ ...input, ifcBuffer: createQuantityIfcFixture() });
    const metrado = result.quantityObservations.filter((o) => o.origin.source === "stored_parameter" && o.origin.propertySet === "Datos_Partida");
    assert.equal(metrado.length, 9);
    assert.equal(metrado.find((o) => o.localId === 303708)?.authoring?.identityKey, "aggregate:303839");
    assert.equal((await resolveAuthoringElementByLocalId(result.context, 303708))?.identityKey, "aggregate:303839");
    assert.ok(result.quantityObservations.every((o) => o.context.revisionId === result.context.revisionId));
    assert.deepEqual(result.quantityExtractionDiagnostics, []);
    assert.equal((await getBimIndexJob(input))?.status, "ready");
  });
});
