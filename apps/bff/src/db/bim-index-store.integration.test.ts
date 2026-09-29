import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import {
  bulkUpsertBimElements,
  getBimCost5DAggregation,
  getBimCost5DMeteringRows,
  getBimElementProperties,
  getBimIndexJob,
  getBimModelByDocument,
  getBimPropertyCatalog,
  getBimPropertyIndexSnapshot,
  queryBimPropertyAuditRecords,
  queryBimPropertyLocalIds,
  recoverInterruptedBimIndexJobs,
  upsertBimIndexJob,
  upsertBimModel,
  upsertBimPropertyIndexSnapshot
} from "./bim-index-store";
import { getDatabasePool } from "./client";

const databaseUrl = process.env.DATABASE_URL?.trim();
const runId = randomUUID();
const projectCode = `TEST-BIM-CONTRACT-${runId}`;
const isolatedProjectCode = `TEST-BIM-ISOLATED-${runId}`;
const modelKey = "frag:/test-bim-contract/test-model.ifc";
const ifcModelKey = "ifc:/test-bim-contract/test-model.ifc";
const federatedModelKey = "frag:/test-bim-contract/other-model.ifc";
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
            },
            {
              setName: "Pset_Cost",
              name: "ItemCode",
              value: "TEST-ITEM-101"
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

    const federatedModel = await upsertBimModel({
      projectCode,
      documentPath: "/TEST-BIM-CONTRACT/other-model.ifc",
      documentName: "other-model.ifc",
      sourceHash: `test-source-other-${runId}`,
      modelKey: federatedModelKey,
      status: "processing"
    });
    await bulkUpsertBimElements(
      federatedModel.id,
      [
        {
          localId: 101,
          globalId: "TEST-GLOBAL-OTHER-101",
          ifcClass: "IfcDoor",
          name: "Other Test Door",
          properties: [
            {
              setName: "Pset_DoorCommon",
              name: "FireRating",
              value: "TEST-OTHER-120"
            },
            {
              setName: "Pset_Cost",
              name: "ItemCode",
              value: "TEST-ITEM-101"
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
    assert.deepEqual(catalog.sets, [
      "Pset_Cost",
      "Pset_DoorCommon",
      "Pset_SlabCommon",
      "Pset_WallCommon"
    ]);
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

    const equalityAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [ifcModelKey],
      property: { setName: "Pset_WallCommon", propertyName: "Reference" },
      operator: "equals",
      value: "test-wall-101"
    });
    assert.deepEqual(
      equalityAudit.map((row) => ({ modelKey: row.modelKey, localId: row.localId, matches: row.matches })),
      [
        { modelKey: ifcModelKey, localId: 101, matches: true },
        { modelKey: ifcModelKey, localId: 102, matches: false },
        { modelKey: ifcModelKey, localId: 103, matches: false }
      ]
    );
    assert.equal(equalityAudit[0]?.globalId, "TEST-GLOBAL-WALL-101");
    assert.deepEqual(equalityAudit[0]?.values, ["TEST-WALL-101"]);

    const existenceAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "Reference" },
      operator: "exists",
      ifcClass: "Wall",
      levelName: "Level 01"
    });
    assert.deepEqual(
      existenceAudit.map((row) => ({ localId: row.localId, matches: row.matches })),
      [{ localId: 101, matches: true }]
    );

    const missingAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "Reference" },
      operator: "missing"
    });
    assert.deepEqual(
      missingAudit.map((row) => ({ localId: row.localId, matches: row.matches })),
      [
        { localId: 101, matches: false },
        { localId: 102, matches: true },
        { localId: 103, matches: true }
      ]
    );

    const containsAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "Reference" },
      operator: "contains",
      value: "wall"
    });
    assert.equal(containsAudit.find((row) => row.localId === 101)?.matches, true);

    const notEqualsAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "LoadBearing" },
      operator: "not_equals",
      value: "false"
    });
    assert.equal(notEqualsAudit.find((row) => row.localId === 101)?.matches, true);
    assert.equal(notEqualsAudit.find((row) => row.localId === 102)?.matches, false);

    const emptyAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "LoadBearing" },
      operator: "empty"
    });
    assert.equal(emptyAudit.find((row) => row.localId === 101)?.matches, false);
    assert.equal(emptyAudit.find((row) => row.localId === 102)?.matches, true);

    const notEmptyAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [modelKey],
      property: { setName: "Pset_WallCommon", propertyName: "LoadBearing" },
      operator: "not_empty"
    });
    assert.equal(notEmptyAudit.find((row) => row.localId === 101)?.matches, true);
    assert.equal(notEmptyAudit.find((row) => row.localId === 102)?.matches, false);

    const federatedCollisionAudit = await queryBimPropertyAuditRecords({
      projectCode,
      modelKeys: [modelKey, federatedModelKey],
      property: { setName: "Pset_DoorCommon", propertyName: "FireRating" },
      operator: "equals",
      value: "TEST-OTHER-120"
    });
    assert.deepEqual(
      federatedCollisionAudit
      .filter((row) => row.localId === 101)
      .map((row) => ({ modelKey: row.modelKey, matches: row.matches })),
      [
        { modelKey: federatedModelKey, matches: true },
        { modelKey, matches: false }
      ]
    );

    const costAggregation = await getBimCost5DAggregation({
      projectCode,
      modelKeys: [ifcModelKey, federatedModelKey],
      itemId: { setName: "Pset_Cost", propertyName: "ItemCode" }
    });
    const sharedCostRow = costAggregation.rows.find(
      (row) => row.itemId === "TEST-ITEM-101"
    );
    assert.ok(sharedCostRow);
    assert.equal(sharedCostRow.elementCount, 2);
    assert.equal(sharedCostRow.modelCount, 2);
    assert.deepEqual(sharedCostRow.localIdsByModelKey, {
      [ifcModelKey]: [101],
      [federatedModelKey]: [101]
    });

    const meteringRows = await getBimCost5DMeteringRows({
      projectCode,
      modelKeys: [ifcModelKey, federatedModelKey],
      columns: [
        {
          id: "item-code",
          label: "Item code",
          ref: { setName: "Pset_Cost", propertyName: "ItemCode" }
        }
      ],
      limit: 20,
      offset: 0
    });
    assert.deepEqual(
      meteringRows.rows
        .filter((row) => row.localId === 101 && row.values[0] === "TEST-ITEM-101")
        .map((row) => ({ modelKey: row.modelKey, localId: row.localId }))
        .sort((left, right) => left.modelKey.localeCompare(right.modelKey)),
      [
        { modelKey: federatedModelKey, localId: 101 },
        { modelKey: ifcModelKey, localId: 101 }
      ]
    );

    const wallProperties = await getBimElementProperties({
      projectCode,
      modelKey: ifcModelKey,
      localId: 101
    });
    assert.ok(wallProperties);
    assert.equal(wallProperties.model.id, model.id);
    assert.equal(wallProperties.globalId, "TEST-GLOBAL-WALL-101");
    assert.equal(wallProperties.ifcClass, "IfcWall");
    assert.deepEqual(wallProperties.propertySets, [
      {
        name: "Pset_Cost",
        properties: [
          {
            name: "ItemCode",
            value: "TEST-ITEM-101",
            valueType: "text",
            unit: null
          }
        ]
      },
      {
        name: "Pset_WallCommon",
        properties: [
          {
            name: "LoadBearing",
            value: true,
            valueType: "boolean",
            unit: null
          },
          {
            name: "Reference",
            value: "TEST-WALL-101",
            valueType: "text",
            unit: null
          }
        ]
      }
    ]);

    const federatedProperties = await getBimElementProperties({
      projectCode,
      modelKey: federatedModelKey,
      localId: 101
    });
    assert.ok(federatedProperties);
    assert.equal(federatedProperties.model.id, federatedModel.id);
    assert.equal(federatedProperties.globalId, "TEST-GLOBAL-OTHER-101");
    assert.equal(federatedProperties.ifcClass, "IfcDoor");

    assert.equal(
      await getBimElementProperties({ projectCode, modelKey: "ifc:/missing.ifc", localId: 101 }),
      null
    );
    assert.equal(
      await getBimElementProperties({ projectCode, modelKey: ifcModelKey, localId: 999999 }),
      null
    );

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

test(
  "BIM recovery marks only an orphaned synthetic processing run as failed",
  { skip: !databaseUrl },
  async () => {
    await cleanupTestData();
    const documentPath = "/TEST-BIM-ISOLATED/orphan.ifc";
    const sourceHash = `test-orphan-${runId}`;
    await upsertBimModel({
      projectCode: isolatedProjectCode,
      documentPath,
      documentName: "orphan.ifc",
      sourceHash,
      modelKey: "ifc:/test-bim-isolated/orphan.ifc",
      status: "processing"
    });
    await upsertBimIndexJob({
      projectCode: isolatedProjectCode,
      documentPath,
      sourceHash,
      status: "processing",
      stats: { stage: "server-web-ifc" }
    });
    await getDatabasePool().query(
      `
        update cde_bim_index_jobs
        set updated_at = now() - interval '10 minutes'
        where project_code = $1 and document_path = $2
      `,
      [isolatedProjectCode, documentPath]
    );

    const result = await recoverInterruptedBimIndexJobs({
      projectCode: isolatedProjectCode,
      staleAfterMs: 60_000
    });
    assert.equal(result.interruptedJobs, 1);
    assert.equal(result.reconciledModels, 1);

    const job = await getBimIndexJob({ projectCode: isolatedProjectCode, documentPath, sourceHash });
    assert.equal(job?.status, "failed");
    const model = await getBimModelByDocument({
      projectCode: isolatedProjectCode,
      documentPath,
      sourceHash
    });
    assert.equal(model?.status, "failed");
  }
);
