import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  bulkUpsertBimElements,
  getBimPropertyCatalog,
  getBimPropertyIndexSnapshot,
  queryBimPropertyLocalIds,
  upsertBimModel,
  upsertBimPropertyIndexSnapshot
} from "./bim-index-store";
import { getDatabasePool } from "./client";

const databaseUrl = process.env.DATABASE_URL?.trim();
const runId = randomUUID();
const projectCode = `TEST-BIM-CONTRACT-${runId}`;
const isolatedProjectCode = `TEST-BIM-ISOLATED-${runId}`;
const modelKey = "test-model";
const snapshotSignature = `test-snapshot-${runId}`;

async function cleanupTestData() {
  if (!databaseUrl) return;

  const pool = getDatabasePool();
  await pool.query(
    `delete from cde_bim_property_index_snapshots where project_code = any($1::text[]);`,
    [[projectCode, isolatedProjectCode]]
  );
  await pool.query(
    `delete from cde_bim_index_jobs where project_code = any($1::text[]);`,
    [[projectCode, isolatedProjectCode]]
  );
  await pool.query(
    `delete from cde_bim_models where project_code = any($1::text[]);`,
    [[projectCode, isolatedProjectCode]]
  );
}

after(async () => {
  if (!databaseUrl) return;

  try {
    await cleanupTestData();
  } finally {
    await getDatabasePool().end().catch(() => undefined);
  }
});

test(
  "BIM PostgreSQL contract persists and reads synthetic model metadata",
  { skip: !databaseUrl },
  async () => {
    await cleanupTestData();

    const model = await upsertBimModel({
      projectCode,
      documentPath: "/TEST-BIM-CONTRACT/test-model.ifc",
      documentName: "test-model.ifc",
      sourceHash: `test-source-${runId}`,
      modelKey,
      status: "processing"
    });

    await bulkUpsertBimElements(
      model.id,
      [
        {
          localId: 101,
          globalId: "TEST-GLOBAL-WALL-101",
          ifcClass: "IfcWall",
          name: "Test Wall",
          levelName: "Level 01",
          elementIdentity: "test-model:global:TEST-GLOBAL-WALL-101",
          properties: [
            {
              setName: "Pset_WallCommon",
              name: "LoadBearing",
              value: true,
              valueType: "boolean"
            },
            {
              setName: "Pset_WallCommon",
              name: "Reference",
              value: "TEST-WALL-101"
            }
          ]
        },
        {
          localId: 102,
          globalId: "TEST-GLOBAL-DOOR-102",
          ifcClass: "IfcDoor",
          name: "Test Door",
          levelName: "Level 01",
          elementIdentity: "test-model:global:TEST-GLOBAL-DOOR-102",
          properties: [
            {
              setName: "Pset_DoorCommon",
              name: "FireRating",
              value: "TEST-FIRE-60"
            }
          ]
        },
        {
          localId: 103,
          ifcClass: "IfcSlab",
          name: "Test Slab",
          levelName: "Level 02",
          elementIdentity: "test-model:local:103",
          properties: [
            {
              setName: "Pset_SlabCommon",
              name: "IsExternal",
              value: false,
              valueType: "boolean"
            }
          ]
        }
      ],
      { finalize: true }
    );

    const isolatedModel = await upsertBimModel({
      projectCode: isolatedProjectCode,
      documentPath: "/TEST-BIM-ISOLATED/test-model.ifc",
      documentName: "test-model.ifc",
      sourceHash: `test-source-${runId}`,
      modelKey,
      status: "processing"
    });
    await bulkUpsertBimElements(
      isolatedModel.id,
      [
        {
          localId: 101,
          ifcClass: "IfcWall",
          name: "Isolated Test Wall",
          properties: [
            {
              setName: "Pset_WallCommon",
              name: "LoadBearing",
              value: "TEST-ISOLATED"
            }
          ]
        }
      ],
      { finalize: true }
    );

    const persisted = await getDatabasePool().query<{
      local_id: number;
      global_id: string | null;
    }>(
      `select local_id, global_id
         from cde_bim_elements
        where bim_model_id = $1
        order by local_id`,
      [model.id]
    );
    assert.deepEqual(
      persisted.rows,
      [
        { local_id: 101, global_id: "TEST-GLOBAL-WALL-101" },
        { local_id: 102, global_id: "TEST-GLOBAL-DOOR-102" },
        { local_id: 103, global_id: null }
      ]
    );

    const uniqueness = await getDatabasePool().query<{ count: string }>(
      `select count(*)::text as count
         from cde_bim_elements
        where bim_model_id = $1 and local_id = $2`,
      [model.id, 101]
    );
    assert.equal(uniqueness.rows[0]?.count, "1");

    const catalog = await getBimPropertyCatalog({
      projectCode,
      modelKeys: [modelKey]
    });
    assert.deepEqual(catalog.sets, ["Pset_DoorCommon", "Pset_SlabCommon", "Pset_WallCommon"]);
    assert.deepEqual(catalog.propertiesBySet.Pset_WallCommon, ["LoadBearing", "Reference"]);
    assert.deepEqual(catalog.valuesBySetAndProperty.Pset_WallCommon.LoadBearing, [
      { value: "true", count: 1 }
    ]);

    const matchingIds = await queryBimPropertyLocalIds({
      projectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "LoadBearing" },
      propertyValue: "true"
    });
    assert.deepEqual(matchingIds, { [modelKey]: [101] });

    const isolatedIds = await queryBimPropertyLocalIds({
      projectCode: isolatedProjectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "LoadBearing" },
      propertyValue: "true"
    });
    assert.deepEqual(isolatedIds, {});

    const index = {
      sets: ["Pset_WallCommon"],
      propertiesBySet: { Pset_WallCommon: ["LoadBearing"] },
      valuesBySetAndProperty: { Pset_WallCommon: { LoadBearing: ["true"] } },
      localIdsBySetPropertyValue: {
        Pset_WallCommon: { LoadBearing: { true: { [modelKey]: [101] } } }
      },
      localIdsByModelKey: { [modelKey]: [101, 102, 103] },
      elementIdentityByKey: {
        [`${modelKey}:101`]: "test-model:global:TEST-GLOBAL-WALL-101"
      },
      levelLocalIdsByModelKey: { [modelKey]: { "Level 01": [101, 102] } }
    };
    await upsertBimPropertyIndexSnapshot({
      projectCode,
      signature: snapshotSignature,
      modelKeys: [modelKey],
      elementCount: 3,
      index
    });
    assert.deepEqual(
      await getBimPropertyIndexSnapshot({ projectCode, signature: snapshotSignature }),
      index
    );
    assert.equal(
      await getBimPropertyIndexSnapshot({
        projectCode: isolatedProjectCode,
        signature: snapshotSignature
      }),
      null
    );
  }
);

// localId is the current store contract. This test does not claim it is universally
// equivalent to an IFC Express ID outside the current server web-ifc indexer.
