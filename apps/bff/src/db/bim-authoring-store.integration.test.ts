import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { getDatabasePool } from "./client";
import { replaceAuthoringElementIndex, resolveAuthoringElementByLocalId, getAuthoringElementMembers } from "./bim-authoring-store";
import { resolveAuthoringElements, type AuthoringResolution } from "../services/bim-authoring-resolver";
import { toCanonicalBimModelKey } from "../services/bim-model-identity";
import { toBimRevisionId, type BimProcessingContext, type BimRevisionId } from "../services/bim-revision-identity";
import { createOciAuthoringFixture } from "../services/fixtures/bim-authoring-oci.fixture";

const enabled = Boolean(process.env.DATABASE_URL?.trim());
const project = `TEST-AUTHORING-${randomUUID()}`;
const fixture = createOciAuthoringFixture();
const context: BimProcessingContext = {
  projectCode: project, modelKey: toCanonicalBimModelKey("/AR3173/Modelo.ifc"),
  revisionId: fixture.context.revisionId as BimRevisionId
};
const oci = resolveAuthoringElements({ ...fixture, context });
const otherRevision = { ...context, revisionId: toBimRevisionId(Buffer.from("another test revision")) };
function standalone(scope: BimProcessingContext, ids: number[]): AuthoringResolution {
  return resolveAuthoringElements({ context: scope, entities: ids.map((localId) => ({ localId, ifcClass: "IfcSlab", geometryStatus: "present" as const })), relations: [] });
}

after(async () => {
  if (!enabled) return;
  const pool = getDatabasePool();
  try {
    await pool.query("delete from cde_bim_authoring_contexts where project_code = any($1::text[])", [[project, `${project}-other`]]);
  } finally { await pool.end(); }
});

test("strict authoring PostgreSQL persistence", { skip: !enabled }, async (t) => {
  const pool = getDatabasePool();
  await t.test("OCI preserves nine groups, 187 semantic members and 179 graphical members", async () => {
    await replaceAuthoringElementIndex(oci);
    const result = await pool.query(`select count(distinct a.id)::int as elements,
      count(distinct a.id) filter (where a.resolution_method = 'corroborated_aggregate')::int as compositions,
      count(distinct a.id) filter (where a.resolution_method = 'standalone')::int as standalone,
      count(*)::int as members, count(*) filter (where m.geometry_status = 'present')::int as graphical
      from cde_bim_authoring_contexts c join cde_bim_authoring_elements a on a.context_id = c.id
      join cde_bim_authoring_members m on m.authoring_element_id = a.id where c.project_code = $1`, [project]);
    assert.deepEqual(result.rows[0], { elements: 9, compositions: 8, standalone: 1, members: 187, graphical: 179 });
    for (const element of oci.elements) {
      assert.deepEqual(await resolveAuthoringElementByLocalId(context, element.memberLocalIds[0]), element);
    }
  });
  await t.test("child resolves to its authoring element", async () => {
    assert.equal((await resolveAuthoringElementByLocalId(context, 303708))?.identityKey, "aggregate:303839");
  });
  await t.test("root resolves to the same element as child", async () => {
    assert.deepEqual(await resolveAuthoringElementByLocalId(context, 303839), await resolveAuthoringElementByLocalId(context, 303708));
  });
  await t.test("standalone and member retrieval match resolver semantics", async () => {
    assert.equal((await resolveAuthoringElementByLocalId(context, 308027))?.resolutionMethod, "standalone");
    const expected = oci.elements.find((e) => e.identityKey === "aggregate:303839")!;
    assert.deepEqual(await getAuthoringElementMembers(context, expected.identityKey), expected.memberLocalIds);
    assert.equal(await resolveAuthoringElementByLocalId(context, 1), null);
    assert.deepEqual(await getAuthoringElementMembers(context, "missing"), []);
  });
  for (const [name, scope] of [
    ["project", { ...context, projectCode: `${project}-other` }],
    ["model", { ...context, modelKey: toCanonicalBimModelKey("/AR3173/Other.ifc") }],
    ["case-sensitive model", { ...context, modelKey: toCanonicalBimModelKey("/AR3173/modelo.ifc") }],
    ["revision", otherRevision]
  ] as const) {
    await t.test(`${name} isolation with the same localId`, async () => {
      const index = standalone(scope, [303708]);
      await replaceAuthoringElementIndex(index);
      assert.equal((await resolveAuthoringElementByLocalId(scope, 303708))?.identityKey, "entity:303708");
      assert.equal((await resolveAuthoringElementByLocalId(context, 303708))?.identityKey, "aggregate:303839");
    });
  }
  await t.test("idempotent writes preserve counts and context identity", async () => {
    const count = async () => (await pool.query(`select c.id, count(distinct a.id)::int as elements, count(m.local_id)::int as members
      from cde_bim_authoring_contexts c join cde_bim_authoring_elements a on a.context_id = c.id
      join cde_bim_authoring_members m on m.authoring_element_id = a.id
      where c.project_code = $1 and c.model_key = $2 and c.revision_id = $3 group by c.id`, Object.values(context))).rows;
    const before = await count();
    await replaceAuthoringElementIndex(oci);
    assert.deepEqual(await count(), before);
  });
  await t.test("failed insert rolls back deletion and retains previous index", async () => {
    const malformed = { ...oci, elements: [oci.elements[0], oci.elements[0]] };
    await assert.rejects(replaceAuthoringElementIndex(malformed), { code: "23505" });
    for (const element of oci.elements) assert.deepEqual(await resolveAuthoringElementByLocalId(context, element.memberLocalIds[0]), element);
  });
  await t.test("SQL rejects orphan, duplicate and cross-context memberships", async () => {
    const a = (await pool.query(`select a.id, a.context_id, m.local_id from cde_bim_authoring_elements a
      join cde_bim_authoring_members m on m.authoring_element_id = a.id
      join cde_bim_authoring_contexts c on c.id = a.context_id where c.project_code = $1 limit 1`, [project])).rows[0];
    const insert = (contextId: string, elementId: string, localId: number) => pool.query(`insert into cde_bim_authoring_members
      (context_id, authoring_element_id, local_id, geometry_status) values ($1, $2, $3, 'present')`, [contextId, elementId, localId]);
    await assert.rejects(insert(a.context_id, randomUUID(), 1), { code: "23503" });
    await assert.rejects(insert(a.context_id, a.id, a.local_id), { code: "23505" });
    const other = (await pool.query("select id from cde_bim_authoring_contexts where project_code = $1", [`${project}-other`])).rows[0];
    await assert.rejects(insert(other.id, a.id, 1), { code: "23503" });
  });
  await t.test("replacement removes obsolete elements and members only in its exact revision", async () => {
    await replaceAuthoringElementIndex(standalone(context, [1, 2]));
    assert.equal(await resolveAuthoringElementByLocalId(context, 303839), null);
    assert.deepEqual(await getAuthoringElementMembers(context, "aggregate:303839"), []);
    assert.deepEqual(await getAuthoringElementMembers(context, "entity:1"), [1]);
    assert.equal((await resolveAuthoringElementByLocalId(otherRevision, 303708))?.identityKey, "entity:303708");
  });
  await t.test("same-context concurrent replacements cannot merge memberships", async () => {
    await Promise.all([replaceAuthoringElementIndex(standalone(context, [3])), replaceAuthoringElementIndex(standalone(context, [4]))]);
    const found = await Promise.all([3, 4].map((id) => resolveAuthoringElementByLocalId(context, id)));
    assert.equal(found.filter(Boolean).length, 1);
    assert.equal(await resolveAuthoringElementByLocalId(context, 1), null);
  });
  await t.test("empty replacement retains context and removes all memberships", async () => {
    await replaceAuthoringElementIndex(standalone(context, []));
    assert.equal(await resolveAuthoringElementByLocalId(context, 3), null);
    assert.equal(await resolveAuthoringElementByLocalId(context, 4), null);
    assert.equal((await pool.query("select count(*)::int as n from cde_bim_authoring_contexts where project_code=$1 and model_key=$2 and revision_id=$3", Object.values(context))).rows[0].n, 1);
  });
  await t.test("strict boundary rejects legacy aliases and invalid revision IDs", async () => {
    await assert.rejects(replaceAuthoringElementIndex({ ...oci, context: { ...context, modelKey: "frag:/AR3173/Modelo.ifc" } }));
    await assert.rejects(replaceAuthoringElementIndex({ ...oci, context: { ...context, revisionId: "current" } }));
  });
  await t.test("unknown geometry, fallback evidence and context diagnostics survive persistence", async () => {
    const index = resolveAuthoringElements({ context,
      entities: [
        { localId: 10, ifcClass: "IfcSlab", geometryStatus: "unknown" },
        { localId: 11, ifcClass: "IfcSlab", geometryStatus: "absent" }
      ],
      relations: [{ relationLocalId: 100, relationType: "IfcRelNests", parentLocalId: 10, childLocalIds: [11] }]
    });
    await replaceAuthoringElementIndex(index);
    for (const element of index.elements) assert.deepEqual(await resolveAuthoringElementByLocalId(context, element.memberLocalIds[0]), element);
    const row = (await pool.query(`select resolver_version, diagnostics from cde_bim_authoring_contexts
      where project_code=$1 and model_key=$2 and revision_id=$3`, Object.values(context))).rows[0];
    assert.equal(row.resolver_version, index.resolverVersion);
    assert.deepEqual(row.diagnostics, index.diagnostics);
  });
});
