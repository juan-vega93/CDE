import * as WEBIFC from "web-ifc";
import path from "path";
import {
  bulkUpsertBimElements,
  upsertBimIndexJob,
  upsertBimModel,
  type BimElementInput,
  type BimElementPropertyInput
} from "../db/bim-index-store";

const BIM_INDEX_SCHEMA_VERSION = 5;
const SERVER_INDEX_BATCH_SIZE = 250;
const MAX_PROPERTY_SETS_PER_ELEMENT = 64;
const MAX_PROPERTIES_PER_SET = 120;
const PLACEHOLDER_VALUES = new Set(["", "-", "sin valor", "null", "undefined"]);

function resolveWebIfcWasmPath(): string {
  const wasmFile = require.resolve("web-ifc/web-ifc-node.wasm");
  return path.dirname(wasmFile) + path.sep;
}

type IndexBimPropertiesInput = {
  projectCode: string;
  documentPath: string;
  documentName: string;
  modelKey: string;
  sourceHash?: string;
  sourceVersion?: string;
  documentId?: string;
  ifcBuffer: Buffer | Uint8Array;
};

type IfcRecord = Record<string, unknown>;

function isObject(value: unknown): value is IfcRecord {
  return Boolean(value) && typeof value === "object";
}

function normalizeText(value: unknown): string | undefined {
  const text = renderIfcValue(value).trim();
  return text ? text : undefined;
}

function isRealValue(value: string | undefined): value is string {
  return Boolean(value && !PLACEHOLDER_VALUES.has(value.trim().toLowerCase()));
}

function renderIfcValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(renderIfcValue).filter(Boolean).join(", ");

  if (isObject(value)) {
    if ("value" in value && value.value != null) return renderIfcValue(value.value);
    if ("_representationValue" in value && value._representationValue != null) {
      return renderIfcValue(value._representationValue);
    }
    if ("_internalValue" in value && value._internalValue != null) {
      return renderIfcValue(value._internalValue);
    }
    if ("Name" in value && Object.keys(value).length <= 3) return renderIfcValue(value.Name);
    if ("expressID" in value && Object.keys(value).length <= 2) return "";
  }

  return "";
}

function readIfcName(record: IfcRecord, fallback: string): string {
  return (
    normalizeText(record.Name) ||
    normalizeText(record.LongName) ||
    normalizeText(record.Description) ||
    fallback
  );
}

function toCollectionArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isObject(value) && typeof value.size === "function" && typeof value.get === "function") {
    const result: unknown[] = [];
    const size = Number(value.size());
    for (let index = 0; index < size; index += 1) result.push(value.get(index));
    return result;
  }
  if (isObject(value)) return [value];
  return [];
}

function unwrapPropertySet(rawSet: IfcRecord): IfcRecord {
  return isObject(rawSet.RelatingPropertyDefinition)
    ? rawSet.RelatingPropertyDefinition
    : rawSet;
}

function getPropertyCandidates(pset: IfcRecord): unknown[] {
  return [
    ...toCollectionArray(pset.HasProperties),
    ...toCollectionArray(pset.HasQuantities),
    ...toCollectionArray(pset.Properties),
    ...toCollectionArray(pset.Quantities)
  ];
}

function hasPropertyCandidates(value: unknown): value is IfcRecord {
  return isObject(value) && getPropertyCandidates(value).length > 0;
}

function getRelationTarget(
  relation: IfcRecord,
  targetKeys: string[]
): IfcRecord {
  for (const key of targetKeys) {
    if (isObject(relation[key])) return relation[key] as IfcRecord;
  }

  return relation;
}

function extractPropertySetsFromExpandedLine(line: IfcRecord): IfcRecord[] {
  const sets: IfcRecord[] = [];
  const seen = new Set<number | string>();

  function pushSet(candidate: unknown) {
    if (!isObject(candidate)) return;
    const pset = unwrapPropertySet(candidate);
    if (!hasPropertyCandidates(pset)) return;

    const key =
      normalizeText(pset.GlobalId) ??
      normalizeText(pset.Name) ??
      String((pset as { expressID?: unknown }).expressID ?? sets.length);
    if (seen.has(key)) return;
    seen.add(key);
    sets.push(pset);
  }

  function pushRelationTargets(value: unknown, targetKeys: string[]) {
    for (const relationValue of toCollectionArray(value)) {
      if (!isObject(relationValue)) continue;
      const target = getRelationTarget(relationValue, targetKeys);
      pushSet(target);

      for (const nestedKey of [
        "HasPropertySets",
        "PropertySets",
        "HasProperties",
        "HasQuantities",
        "Properties",
        "Quantities"
      ]) {
        for (const nested of toCollectionArray(target[nestedKey])) {
          pushSet(nested);
        }
      }
    }
  }

  pushSet(line);
  pushRelationTargets(line.IsDefinedBy, ["RelatingPropertyDefinition"]);
  pushRelationTargets(line.IsTypedBy, ["RelatingType"]);
  pushRelationTargets(line.ObjectTypeOf, ["RelatingType", "RelatedObjects"]);

  for (const nestedKey of [
    "HasPropertySets",
    "PropertySets",
    "HasProperties",
    "HasQuantities",
    "Properties",
    "Quantities"
  ]) {
    for (const nested of toCollectionArray(line[nestedKey])) {
      pushSet(nested);
    }
  }

  return sets.slice(0, MAX_PROPERTY_SETS_PER_ELEMENT);
}

async function getElementPropertySets(
  ifcApi: WEBIFC.IfcAPI,
  modelId: number,
  localId: number
): Promise<IfcRecord[]> {
  const attempts: Array<[boolean, boolean]> = [
    [true, true],
    [true, false],
    [false, false]
  ];

  for (const [recursive, includeTypeProperties] of attempts) {
    try {
      const psets = await ifcApi.properties.getPropertySets(
        modelId,
        localId,
        recursive,
        includeTypeProperties
      );
      const normalized = toCollectionArray(psets)
        .filter(isObject)
        .map(unwrapPropertySet)
        .filter(hasPropertyCandidates);
      if (normalized.length > 0) return normalized;
    } catch {
      // Some authoring tools export type property references in a non-iterable
      // shape. Fall back to the expanded IFC line instead of failing the model.
    }
  }

  try {
    const expandedLine = ifcApi.GetLine(modelId, localId, true, true) as IfcRecord | null;
    return expandedLine ? extractPropertySetsFromExpandedLine(expandedLine) : [];
  } catch {
    return [];
  }
}

function getPropertyValue(property: IfcRecord): string | undefined {
  const valueKeys = [
    "NominalValue",
    "LengthValue",
    "AreaValue",
    "VolumeValue",
    "CountValue",
    "WeightValue",
    "TimeValue",
    "EnumerationValues",
    "ListValues",
    "LowerBoundValue",
    "UpperBoundValue"
  ];

  if ("LowerBoundValue" in property || "UpperBoundValue" in property) {
    const lower = renderIfcValue(property.LowerBoundValue);
    const upper = renderIfcValue(property.UpperBoundValue);
    const range = `${lower || "-"} - ${upper || "-"}`;
    return isRealValue(range) ? range : undefined;
  }

  for (const key of valueKeys) {
    if (!(key in property)) continue;
    const value = normalizeText(property[key]);
    if (isRealValue(value)) return value;
  }

  return undefined;
}

function addProperty(
  target: BimElementPropertyInput[],
  setName: string,
  name: string,
  value: unknown,
  valueType: BimElementPropertyInput["valueType"] = "text"
) {
  const normalizedSet = setName.trim();
  const normalizedName = name.trim();
  const normalizedValue = normalizeText(value);

  if (!normalizedSet || !normalizedName || !isRealValue(normalizedValue)) return;

  const duplicate = target.some(
    (item) =>
      item.setName.trim().toLowerCase() === normalizedSet.toLowerCase() &&
      item.name.trim().toLowerCase() === normalizedName.toLowerCase() &&
      String(item.value ?? "").trim().toLowerCase() === normalizedValue.toLowerCase()
  );

  if (!duplicate) {
    target.push({
      setName: normalizedSet,
      name: normalizedName,
      value: normalizedValue,
      valueType
    });
  }
}

function extractPropertiesFromSets(psets: unknown[]): BimElementPropertyInput[] {
  const properties: BimElementPropertyInput[] = [];

  for (const rawSet of psets.slice(0, MAX_PROPERTY_SETS_PER_ELEMENT)) {
    if (!isObject(rawSet)) continue;
    const pset = unwrapPropertySet(rawSet);
    const setName = readIfcName(pset, "Property Set");

    for (const rawProperty of getPropertyCandidates(pset).slice(0, MAX_PROPERTIES_PER_SET)) {
      if (!isObject(rawProperty)) continue;
      const name = normalizeText(rawProperty.Name);
      if (!name) continue;
      addProperty(properties, setName, name, getPropertyValue(rawProperty));
    }
  }

  return properties;
}

function vectorToNumberArray(vector: WEBIFC.Vector<number>): number[] {
  const result: number[] = [];
  for (let index = 0; index < vector.size(); index += 1) {
    const id = Number(vector.get(index));
    if (Number.isInteger(id) && id > 0) result.push(id);
  }
  return result;
}

function getIfcElementIds(ifcApi: WEBIFC.IfcAPI, modelId: number): number[] {
  const elementIds = new Set<number>();
  for (const typeCode of ifcApi.GetIfcEntityList(modelId)) {
    if (!ifcApi.IsIfcElement(typeCode)) continue;
    for (const id of vectorToNumberArray(ifcApi.GetLineIDsWithType(modelId, typeCode, false))) {
      elementIds.add(id);
    }
  }
  return [...elementIds].sort((a, b) => a - b);
}

async function buildElementPayload(
  ifcApi: WEBIFC.IfcAPI,
  modelId: number,
  localId: number
): Promise<BimElementInput | null> {
  const line = ifcApi.GetLine(modelId, localId, false, false) as IfcRecord | null;
  if (!line) return null;

  const typeCode = Number(ifcApi.GetLineType(modelId, localId));
  const ifcClass = Number.isFinite(typeCode) ? ifcApi.GetNameFromTypeCode(typeCode) : undefined;
  const psets = await getElementPropertySets(ifcApi, modelId, localId);
  const properties = extractPropertiesFromSets(psets);
  const typeName =
    properties.find(
      (item) =>
        item.setName.toLowerCase() === "descripcion del elemento" &&
        item.name.toLowerCase() === "tipo de elemento"
    )?.value ?? normalizeText(line.ObjectType) ?? normalizeText(line.PredefinedType);

  addProperty(properties, "Atributos IFC", "IFC Class", ifcClass);
  addProperty(properties, "Atributos IFC", "Express ID", localId, "number");

  return {
    localId,
    globalId: normalizeText(line.GlobalId),
    ifcClass,
    name: normalizeText(line.Name),
    typeName: normalizeText(typeName),
    elementIdentity: normalizeText(line.GlobalId) ?? String(localId),
    hasGeometry: true,
    metadata: {
      indexSource: "server-web-ifc",
      indexVersion: BIM_INDEX_SCHEMA_VERSION
    },
    properties
  };
}

export async function indexBimPropertiesFromBuffer(input: IndexBimPropertiesInput): Promise<{
  modelId: string;
  elementCount: number;
  propertyCount: number;
}> {
  await upsertBimIndexJob({
    projectCode: input.projectCode,
    documentPath: input.documentPath,
    sourceHash: input.sourceHash,
    status: "processing",
    stats: {
      stage: "server-web-ifc",
      modelKey: input.modelKey,
      indexVersion: BIM_INDEX_SCHEMA_VERSION
    }
  });

  const model = await upsertBimModel({
    projectCode: input.projectCode,
    documentId: input.documentId,
    documentPath: input.documentPath,
    documentName: input.documentName,
    sourceVersion: input.sourceVersion,
    sourceHash: input.sourceHash,
    modelKey: input.modelKey,
    status: "processing",
    metadata: {
      sourceKind: "nextcloud-ifc",
      indexSource: "server-web-ifc",
      indexVersion: BIM_INDEX_SCHEMA_VERSION
    }
  });

  const ifcApi = new WEBIFC.IfcAPI();
  let openedModelId = -1;
  let elementCount = 0;
  let propertyCount = 0;

  try {
    ifcApi.SetWasmPath(resolveWebIfcWasmPath(), true);
    await ifcApi.Init(undefined, true);
    openedModelId = ifcApi.OpenModel(new Uint8Array(input.ifcBuffer));
    if (openedModelId < 0) throw new Error("No se pudo abrir el IFC para indexar propiedades");

    const localIds = getIfcElementIds(ifcApi, openedModelId);

    for (let index = 0; index < localIds.length; index += SERVER_INDEX_BATCH_SIZE) {
      const batchIds = localIds.slice(index, index + SERVER_INDEX_BATCH_SIZE);
      const elements: BimElementInput[] = [];

      for (const localId of batchIds) {
        const element = await buildElementPayload(ifcApi, openedModelId, localId);
        if (!element) continue;
        elementCount += 1;
        propertyCount += element.properties?.length ?? 0;
        elements.push(element);
      }

      if (elements.length > 0) {
        await bulkUpsertBimElements(model.id, elements, {
          finalize: index + SERVER_INDEX_BATCH_SIZE >= localIds.length
        });
      }
    }

    if (localIds.length === 0) {
      await bulkUpsertBimElements(model.id, [], { finalize: true });
    }

    await upsertBimModel({
      projectCode: input.projectCode,
      documentId: input.documentId,
      documentPath: input.documentPath,
      documentName: input.documentName,
      sourceVersion: input.sourceVersion,
      sourceHash: input.sourceHash,
      modelKey: input.modelKey,
      status: "ready",
      elementCount,
      propertyCount,
      metadata: {
        sourceKind: "nextcloud-ifc",
        indexSource: "server-web-ifc",
        indexVersion: BIM_INDEX_SCHEMA_VERSION
      }
    });

    await upsertBimIndexJob({
      projectCode: input.projectCode,
      documentPath: input.documentPath,
      sourceHash: input.sourceHash,
      status: "ready",
      stats: {
        stage: "server-web-ifc",
        modelKey: input.modelKey,
        indexVersion: BIM_INDEX_SCHEMA_VERSION,
        elementCount,
        propertyCount
      }
    });

    return { modelId: model.id, elementCount, propertyCount };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await upsertBimModel({
      projectCode: input.projectCode,
      documentId: input.documentId,
      documentPath: input.documentPath,
      documentName: input.documentName,
      sourceVersion: input.sourceVersion,
      sourceHash: input.sourceHash,
      modelKey: input.modelKey,
      status: "failed",
      errorMessage,
      elementCount,
      propertyCount,
      metadata: {
        sourceKind: "nextcloud-ifc",
        indexSource: "server-web-ifc",
        indexVersion: BIM_INDEX_SCHEMA_VERSION
      }
    });
    await upsertBimIndexJob({
      projectCode: input.projectCode,
      documentPath: input.documentPath,
      sourceHash: input.sourceHash,
      status: "failed",
      errorMessage,
      stats: {
        stage: "server-web-ifc",
        modelKey: input.modelKey,
        indexVersion: BIM_INDEX_SCHEMA_VERSION,
        elementCount,
        propertyCount
      }
    });
    throw error;
  } finally {
    if (openedModelId >= 0) ifcApi.CloseModel(openedModelId);
    ifcApi.Dispose();
  }
}