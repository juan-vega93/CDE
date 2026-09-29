import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createBimIndexProgress,
  mergeIfcPropertySets,
  readAdaptiveIfcPropertySets
} from "./bim-property-indexer.service";
import { getBimModelTerminalStatus } from "../db/bim-index-store";

test("merges partial web-ifc property-set variants by stable IFC identity", () => {
  const partialTypeSet = {
    expressID: 100,
    Name: { value: "Pset_Common" },
    HasProperties: [{ expressID: 1001 }]
  };
  const expandedTypeSet = {
    expressID: 100,
    Name: { value: "Pset_Common" },
    HasProperties: [
      {
        expressID: 1001,
        Name: { value: "Reference" },
        NominalValue: { value: "TYPE-REFERENCE" }
      }
    ]
  };
  const occurrenceSet = {
    expressID: 200,
    Name: { value: "Pset_Custom" },
    HasProperties: [
      {
        expressID: 2001,
        Name: { value: "CustomValue" },
        NominalValue: { value: "OCCURRENCE-VALUE" }
      }
    ]
  };
  const partialGlobalSet = {
    GlobalId: { value: "global-set-id" },
    Name: { value: "Pset_Global" },
    HasProperties: [{ Name: { value: "GlobalReference" } }]
  };
  const expandedGlobalSet = {
    GlobalId: { value: "global-set-id" },
    Name: { value: "Pset_Global" },
    HasProperties: [
      {
        Name: { value: "GlobalReference" },
        NominalValue: { value: "GLOBAL-VALUE" }
      }
    ]
  };

  const merged = mergeIfcPropertySets(
    [partialTypeSet, partialGlobalSet],
    [expandedTypeSet, occurrenceSet, expandedGlobalSet],
    [occurrenceSet]
  );

  assert.equal(merged.length, 3);
  const expanded = merged.find((set) => set.expressID === 100);
  assert.ok(expanded);
  assert.equal((expanded.HasProperties as Array<{ Name?: { value?: string } }>)[0]?.Name?.value, "Reference");
  assert.equal(
    (merged.find((set) => set.expressID === 200)?.Name as { value?: string })?.value,
    "Pset_Custom"
  );
  const globalSet = merged.find(
    (set) => (set.GlobalId as { value?: string })?.value === "global-set-id"
  );
  assert.equal(
    (globalSet?.HasProperties as Array<{ NominalValue?: { value?: string } }>)[0]?.NominalValue?.value,
    "GLOBAL-VALUE"
  );
});

test("does not collapse distinct same-name property sets without stable IFC identity", () => {
  const first = {
    Name: { value: "Repeated display name" },
    HasProperties: [{ Name: { value: "FirstProperty" } }]
  };
  const second = {
    Name: { value: "Repeated display name" },
    HasProperties: [{ Name: { value: "SecondProperty" } }]
  };
  const third = {
    Name: { value: "Repeated display name" },
    HasProperties: [{ Name: { value: "SharedProperty" }, NominalValue: { value: "First" } }]
  };
  const fourth = {
    Name: { value: "Repeated display name" },
    HasProperties: [{ Name: { value: "SharedProperty" }, NominalValue: { value: "Second" } }]
  };

  const merged = mergeIfcPropertySets([first, second, third, fourth]);

  assert.equal(merged.length, 4);
  assert.deepEqual(
    merged.map((set) =>
      ((set.HasProperties as Array<{ Name?: { value?: string } }>)[0]?.Name?.value ?? "")
    ),
    ["FirstProperty", "SecondProperty", "SharedProperty", "SharedProperty"]
  );
});

test("keeps the complete second web-ifc variant and verifies divergence with the third traversal", async () => {
  const calls: Array<[boolean, boolean]> = [];
  const partial = {
    expressID: 10,
    Name: { value: "Pset_Common" },
    HasProperties: [{ expressID: 101, Name: { value: "Reference" } }]
  };
  const complete = {
    expressID: 10,
    Name: { value: "Pset_Common" },
    HasProperties: [
      { expressID: 101, Name: { value: "Reference" }, NominalValue: { value: "A-01" } },
      { expressID: 102, Name: { value: "Status" }, NominalValue: { value: "Approved" } }
    ]
  };

  const sets = await readAdaptiveIfcPropertySets({
    readPropertySets: async (recursive, includeTypeProperties) => {
      calls.push([recursive, includeTypeProperties]);
      if (recursive && includeTypeProperties) return [partial];
      if (recursive && !includeTypeProperties) return [complete];
      return [complete];
    }
  });

  assert.deepEqual(calls, [
    [true, true],
    [true, false],
    [false, false]
  ]);
  assert.equal(sets.length, 1);
  assert.equal((sets[0].HasProperties as unknown[]).length, 2);
});

test("skips the third property-set traversal when principal variants agree", async () => {
  const calls: Array<[boolean, boolean]> = [];
  const complete = {
    expressID: 20,
    Name: { value: "Pset_Stable" },
    HasProperties: [{ expressID: 201, Name: { value: "Code" }, NominalValue: { value: "X" } }]
  };

  const sets = await readAdaptiveIfcPropertySets({
    readPropertySets: async (recursive, includeTypeProperties) => {
      calls.push([recursive, includeTypeProperties]);
      return [complete];
    }
  });

  assert.deepEqual(calls, [
    [true, true],
    [true, false]
  ]);
  assert.equal(sets.length, 1);
});

test("reports durable batch progress and never reports partial index as ready", () => {
  const progress = createBimIndexProgress({
    modelKey: "ifc:/test/model.ifc",
    processedElements: 250,
    totalElements: 600,
    propertyCount: 1200,
    currentBatch: 1,
    totalBatches: 3,
    now: new Date("2026-01-02T03:04:05.000Z")
  });

  assert.equal(progress.progressPercent, 41.67);
  assert.equal(progress.processedElements, 250);
  assert.equal(progress.totalBatches, 3);
  assert.equal(progress.progressUpdatedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(getBimModelTerminalStatus("cancelled"), "failed");
  assert.notEqual(getBimModelTerminalStatus("processing"), "ready");
});
