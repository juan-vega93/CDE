import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeIfcPropertySets } from "./bim-property-indexer.service";

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
