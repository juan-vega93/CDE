import { createBimIndexGeneration, failBimIndexGeneration, publishBimIndexGeneration } from "../db/bim-index-generations";
import { replaceGenerationQuantityObservations } from "../db/bim-quantity-store";
import * as WEBIFC from "web-ifc";
import path from "path";
import { toCanonicalBimModelKey } from "./bim-model-identity";
import { prepareBimIfcInput, type BimProcessingContext } from "./bim-revision-identity";
import { resolveAuthoringElements, type AuthoringEntityFact } from "./bim-authoring-resolver";
import { readAuthoringGeometry, readAuthoringRelations, readAuthoringExportStructure } from "./bim-authoring-extraction";
import { replaceAuthoringElementIndex } from "../db/bim-authoring-store";
import { extractIfcQuantityObservations } from "./bim-quantity-extraction";
import {
  bulkUpsertBimElements,
  getBimIndexJob,
  upsertBimIndexJob,
  upsertBimModel,
  type BimElementInput,
  type BimElementPropertyInput
} from "../db/bim-index-store";

const BIM_INDEX_SCHEMA_VERSION = 5;
const SERVER_INDEX_BATCH_SIZE = 250;
const PLACEHOLDER_VALUES = new Set(["", "-", "sin valor", "null", "undefined"]);

export type BimIndexProgress = {
  stage: "server-web-ifc";
  modelKey: string;
  indexVersion: number;
  processedElements: number;
  totalElements: number;
  propertyCount: number;
  progressPercent: number;
  currentBatch: number;
  totalBatches: number;
  progressUpdatedAt: string;
};

class BimIndexingCancelledError extends Error {
  constructor() {
    super("La indexación BIM fue cancelada antes de procesar el siguiente lote.");
    this.name = "BimIndexingCancelledError";
  }
}

class BimIndexingTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`La indexación BIM superó el tiempo máximo configurado (${timeoutMs} ms).`);
    this.name = "BimIndexingTimeoutError";
  }
}

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

export type IfcRecord = Record<string, unknown>;

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

function getIfcRecordExpressId(record: IfcRecord): number | undefined {
  const expressId = Number(record.expressID);
  return Number.isInteger(expressId) && expressId > 0 ? expressId : undefined;
}

function getPropertySetStableIdentity(pset: IfcRecord): string | undefined {
  const expressId = getIfcRecordExpressId(pset);
  if (expressId !== undefined) return `express:${expressId}`;

  const globalId = normalizeText(pset.GlobalId);
  return globalId ? `global:${globalId.toLowerCase()}` : undefined;
}

function getPropertySetFallbackIdentity(pset: IfcRecord, occurrence: number): string {
  const name = normalizeText(pset.Name)?.toLowerCase();
  if (!name) return `unidentified:${occurrence}`;

  const propertyIdentity = getPropertyCandidates(pset)
    .map((property) => {
      if (!isObject(property)) return "";
      const expressId = getIfcRecordExpressId(property);
      if (expressId !== undefined) return `express:${expressId}`;
      const globalId = normalizeText(property.GlobalId);
      if (globalId) return `global:${globalId.toLowerCase()}`;
      const name = normalizeText(property.Name)?.toLowerCase() ?? "";
      const value = [
        "NominalValue",
        "LengthValue",
        "AreaValue",
        "VolumeValue",
        "CountValue",
        "WeightValue",
        "TimeValue",
        "NumberValue",
        "EnumerationValues",
        "ListValues"
      ]
        .map((key) => normalizeText(property[key]))
        .find(Boolean)
        ?.toLowerCase() ?? "";
      return name || value ? `${name}:${value}` : "";
    })
    .filter(Boolean)
    .sort()
    .join("|");

  // A name alone is not sufficient: IFC files can contain distinct property
  // sets with the same display name. Keep unresolved same-name sets separate.
  return propertyIdentity ? `name:${name}:properties:${propertyIdentity}` : `name:${name}:${occurrence}`;
}

function getPropertySetCompleteness(pset: IfcRecord): number {
  let score = 0;
  for (const property of getPropertyCandidates(pset)) {
    score += 1;
    if (!isObject(property)) continue;
    if (normalizeText(property.Name)) score += 4;
    if (
      [
        "NominalValue",
        "LengthValue",
        "AreaValue",
        "VolumeValue",
        "CountValue",
        "WeightValue",
        "TimeValue",
        "NumberValue",
        "EnumerationValues",
        "ListValues"
      ].some((key) => normalizeText(property[key]))
    ) {
      score += 2;
    }
  }
  return score;
}

function getPropertySetCollectionSignature(collection: IfcRecord[]): string {
  return collection
    .map((pset, occurrence) => {
      const identity =
        getPropertySetStableIdentity(pset) ?? getPropertySetFallbackIdentity(pset, occurrence);
      return `${identity}:${getPropertySetCompleteness(pset)}`;
    })
    .sort()
    .join("|");
}

/**
 * Merges the partial shapes returned by web-ifc property helpers. Stable IFC
 * identity wins over display names; when no stable identity exists, a property
 * signature prevents distinct same-name sets from being collapsed.
 */
export function mergeIfcPropertySets(...collections: unknown[][]): IfcRecord[] {
  const merged = new Map<string, IfcRecord>();
  let occurrence = 0;

  for (const collection of collections) {
    for (const rawSet of collection) {
      if (!isObject(rawSet)) continue;
      const pset = unwrapPropertySet(rawSet);
      if (!hasPropertyCandidates(pset)) continue;

      const key =
        getPropertySetStableIdentity(pset) ?? getPropertySetFallbackIdentity(pset, occurrence++);
      const current = merged.get(key);
      if (!current || getPropertySetCompleteness(pset) > getPropertySetCompleteness(current)) {
        merged.set(key, pset);
      }
    }
  }

  return [...merged.values()];
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
  const candidates: unknown[] = [];

  function pushSet(candidate: unknown) {
    if (!isObject(candidate)) return;
    const pset = unwrapPropertySet(candidate);
    if (!hasPropertyCandidates(pset)) return;
    candidates.push(pset);
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

  return mergeIfcPropertySets(candidates);
}

export async function readAdaptiveIfcPropertySets(input: {
  readPropertySets: (recursive: boolean, includeTypeProperties: boolean) => Promise<unknown>;
  readExpandedLine?: () => IfcRecord | null;
}): Promise<IfcRecord[]> {
  let propertySetReadFailed = false;
  const collections: unknown[][] = [];

  // The first two variants are both required. The documented real-world case
  // has a partial (true, true) result and complete sets in (true, false).
  for (const [recursive, includeTypeProperties] of [
    [true, true],
    [true, false]
  ] as const) {
    try {
      collections.push(toCollectionArray(await input.readPropertySets(recursive, includeTypeProperties)));
    } catch {
      propertySetReadFailed = true;
    }
  }

  const firstTwoMerged = mergeIfcPropertySets(...collections);
  const firstSignature = getPropertySetCollectionSignature(mergeIfcPropertySets(collections[0] ?? []));
  const secondSignature = getPropertySetCollectionSignature(mergeIfcPropertySets(collections[1] ?? []));
  const variantsDisagree = firstSignature !== secondSignature;

  // Only pay for the third web-ifc traversal when the two principal variants
  // disagree (or one failed). That disagreement is evidence that the helper
  // is returning an incomplete shape; merge every available representation.
  if (propertySetReadFailed || variantsDisagree || firstTwoMerged.length === 0) {
    try {
      collections.push(toCollectionArray(await input.readPropertySets(false, false)));
    } catch {
      propertySetReadFailed = true;
    }
  }

  const mergedPropertySets = mergeIfcPropertySets(...collections);
  // A successful merged result is sufficient even if the variants differed:
  // that divergence already triggered the third helper variant above. The
  // expanded line remains a fallback only for an API failure or no usable set.
  if (!input.readExpandedLine || (!propertySetReadFailed && mergedPropertySets.length > 0)) {
    return mergedPropertySets;
  }

  try {
    const expandedLine = input.readExpandedLine();
    const expandedPropertySets = expandedLine ? extractPropertySetsFromExpandedLine(expandedLine) : [];
    return mergeIfcPropertySets(mergedPropertySets, expandedPropertySets);
  } catch {
    return mergedPropertySets;
  }
}

async function getElementPropertySets(
  ifcApi: WEBIFC.IfcAPI,
  modelId: number,
  localId: number
): Promise<IfcRecord[]> {
  return readAdaptiveIfcPropertySets({
    readPropertySets: (recursive, includeTypeProperties) =>
      ifcApi.properties.getPropertySets(modelId, localId, recursive, includeTypeProperties),
    readExpandedLine: () => ifcApi.GetLine(modelId, localId, true, true) as IfcRecord | null
  });
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
    "NumberValue",
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
  valueType: BimElementPropertyInput["valueType"] = "text",
  seen?: Set<string>
) {
  const normalizedSet = setName.trim();
  const normalizedName = name.trim();
  const normalizedValue = normalizeText(value);

  if (!normalizedSet || !normalizedName || !isRealValue(normalizedValue)) return;

  const key = JSON.stringify([normalizedSet.toLowerCase(), normalizedName.toLowerCase(), normalizedValue.toLowerCase()]);
  const duplicate = seen ? seen.has(key) : target.some(
    (item) =>
      item.setName.trim().toLowerCase() === normalizedSet.toLowerCase() &&
      item.name.trim().toLowerCase() === normalizedName.toLowerCase() &&
      String(item.value ?? "").trim().toLowerCase() === normalizedValue.toLowerCase()
  );

  if (!duplicate) {
    seen?.add(key);
    target.push({
      setName: normalizedSet,
      name: normalizedName,
      value: normalizedValue,
      valueType
    });
  }
}

export function extractPropertiesFromSets(psets: unknown[]): BimElementPropertyInput[] {
  const properties: BimElementPropertyInput[] = [];
  // Query-index uniqueness is unchanged; avoid a quadratic scan now that
  // presentation limits no longer truncate persistent data.
  const seen = new Set<string>();
  const ancestors = new WeakSet<IfcRecord>();
  function visit(rawProperty: unknown, setName: string) {
    if (!isObject(rawProperty)) return;
    if (ancestors.has(rawProperty)) throw new Error("Cyclic IFC property collection");
    const name = normalizeText(rawProperty.Name);
    if (name) addProperty(properties, setName, name, getPropertyValue(rawProperty), "text", seen);
    // Complex properties/quantities retain the owning set; only leaf values
    // become searchable rows. Never pass this deduplication to provenance.
    ancestors.add(rawProperty);
    for (const nested of getPropertyCandidates(rawProperty)) visit(nested, setName);
    ancestors.delete(rawProperty);
  }

  for (const rawSet of psets) {
    if (!isObject(rawSet)) continue;
    const pset = unwrapPropertySet(rawSet);
    const setName = readIfcName(pset, "Property Set");

    for (const rawProperty of getPropertyCandidates(pset)) visit(rawProperty, setName);
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

export function createBimIndexProgress(input: {
  modelKey: string;
  processedElements: number;
  totalElements: number;
  propertyCount: number;
  currentBatch: number;
  totalBatches: number;
  now?: Date;
}): BimIndexProgress {
  const totalElements = Math.max(0, input.totalElements);
  const processedElements = Math.max(0, Math.min(input.processedElements, totalElements));
  return {
    stage: "server-web-ifc",
    modelKey: input.modelKey,
    indexVersion: BIM_INDEX_SCHEMA_VERSION,
    processedElements,
    totalElements,
    propertyCount: Math.max(0, input.propertyCount),
    progressPercent: totalElements === 0 ? 100 : Math.round((processedElements / totalElements) * 10000) / 100,
    currentBatch: Math.max(0, input.currentBatch),
    totalBatches: Math.max(0, input.totalBatches),
    progressUpdatedAt: (input.now ?? new Date()).toISOString()
  };
}

function getConfiguredBimIndexTimeoutMs(): number | undefined {
  const value = Number(process.env.BFF_BIM_INDEX_MAX_DURATION_MS);
  return Number.isFinite(value) && value > 0 ? Math.max(60_000, Math.floor(value)) : undefined;
}

async function buildElementPayload(
  ifcApi: WEBIFC.IfcAPI,
  modelId: number,
  localId: number
): Promise<{ element: BimElementInput; authoring: AuthoringEntityFact }> {
  const line = ifcApi.GetLine(modelId, localId, false, false) as IfcRecord | null;
  if (!line) throw new Error(`Cannot read IFC element ${localId}`);

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

  // Read the two authoring properties from already expanded sets before legacy display caps.
  // Conflicting values cannot corroborate authorship; never pick an arbitrary winner.
  const ids = new Set<string>();
  const containers = new Set<string>();
  for (const pset of psets) {
    for (const property of getPropertyCandidates(pset)) {
      if (!isObject(property)) continue;
      const name = normalizeText(property.Name)?.toLowerCase();
      const target = name === "id elemento" ? ids : name === "contenedor origen" ? containers : undefined;
      if (!target) continue;
      const value = getPropertyValue(property);
      if (value) target.add(value);
    }
  }
  const hasRepresentation = line.Representation == null ? false : true;
  const authoring: AuthoringEntityFact = {
    localId, globalId: normalizeText(line.GlobalId), ifcClass: ifcClass ?? "",
    name: normalizeText(line.Name), tag: normalizeText(line.Tag),
    authoringElementId: ids.size === 1 ? [...ids][0] : undefined,
    sourceContainer: containers.size === 1 ? [...containers][0] : undefined,
    hasRepresentation, geometryStatus: hasRepresentation ? "unknown" : "absent"
  };
  const element: BimElementInput = {
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
  return { element, authoring };
}

export async function indexBimPropertiesFromBuffer(input: IndexBimPropertiesInput): Promise<{
  modelId: string;
  elementCount: number;
  propertyCount: number;
  context: BimProcessingContext;
  quantityObservations: ReturnType<typeof extractIfcQuantityObservations>["quantityObservations"];
  quantityExtractionDiagnostics: ReturnType<typeof extractIfcQuantityObservations>["quantityExtractionDiagnostics"];
}> {
  return indexPreparedBimProperties(input, prepareBimIfcInput(input));
}

/** Internal coordinated pipeline: prepared bytes must remain owned and unchanged by the caller. */
export async function indexPreparedBimProperties(
  input: Omit<IndexBimPropertiesInput, "ifcBuffer">,
  prepared: ReturnType<typeof prepareBimIfcInput>,
  onGenerationCreated?: (generationId: string) => void
): Promise<{ modelId: string; elementCount: number; propertyCount: number; context: BimProcessingContext } & ReturnType<typeof extractIfcQuantityObservations>> {
  const { ifcBytes, context } = prepared;
  if (context.projectCode !== input.projectCode || context.modelKey !== toCanonicalBimModelKey(input.documentPath)) {
    throw new Error("Prepared IFC context does not match indexing scope");
  }
  const timeoutMs = getConfiguredBimIndexTimeoutMs();
  const startedAt = Date.now();
  const model = await upsertBimModel({
    preserveExisting: true,
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

  const generationId = await createBimIndexGeneration(model.id, context, {
    sourceKind: "nextcloud-ifc", indexSource: "server-web-ifc", indexVersion: BIM_INDEX_SCHEMA_VERSION,
    quantityProvenanceRequired: true
  }, {
    documentId: input.documentId, documentName: input.documentName,
    sourceVersion: input.sourceVersion, modelKey: input.modelKey
  });
  onGenerationCreated?.(generationId);
  const ifcApi = new WEBIFC.IfcAPI();
  let openedModelId = -1;
  let elementCount = 0;
  let propertyCount = 0;

  try {
    await upsertBimIndexJob({
      generationId,
      projectCode: input.projectCode,
      documentPath: input.documentPath,
      sourceHash: input.sourceHash,
      status: "processing",
      stats: {
        stage: "server-web-ifc",
        modelKey: input.modelKey,
        indexVersion: BIM_INDEX_SCHEMA_VERSION,
        processedElements: 0,
        totalElements: 0,
        propertyCount: 0,
        progressPercent: 0,
        currentBatch: 0,
        totalBatches: 0,
        progressUpdatedAt: new Date().toISOString()
      }
    });

    ifcApi.SetWasmPath(resolveWebIfcWasmPath(), true);
    await ifcApi.Init(undefined, true);
    openedModelId = ifcApi.OpenModel(ifcBytes);
    if (openedModelId < 0) throw new Error("No se pudo abrir el IFC para indexar propiedades");

    const localIds = getIfcElementIds(ifcApi, openedModelId);
    const authoringRelations = readAuthoringRelations(ifcApi, openedModelId, new Set(localIds));
    const authoringEntities: AuthoringEntityFact[] = [];
    const totalBatches = Math.ceil(localIds.length / SERVER_INDEX_BATCH_SIZE);

    await upsertBimIndexJob({
      generationId,
      projectCode: input.projectCode,
      documentPath: input.documentPath,
      sourceHash: input.sourceHash,
      status: "processing",
      stats: createBimIndexProgress({
        modelKey: input.modelKey,
        processedElements: 0,
        totalElements: localIds.length,
        propertyCount: 0,
        currentBatch: 0,
        totalBatches
      })
    });

    for (let index = 0; index < localIds.length; index += SERVER_INDEX_BATCH_SIZE) {
      // This boundary is deliberately between batches: web-ifc and the DB
      // transaction for a batch are allowed to finish cleanly before a manual
      // cancellation or configured timeout stops later work.
      const activeJob = await getBimIndexJob({
        projectCode: input.projectCode,
        documentPath: input.documentPath,
        sourceHash: input.sourceHash
      });
      if (activeJob?.status === "cancelled") throw new BimIndexingCancelledError();
      if (activeJob && activeJob.status !== "processing") {
        throw new Error(`El job BIM dejó de estar activo (estado: ${activeJob.status}).`);
      }
      if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) {
        throw new BimIndexingTimeoutError(timeoutMs);
      }

      const batchIds = localIds.slice(index, index + SERVER_INDEX_BATCH_SIZE);
      const elements: BimElementInput[] = [];
      const authoringBatch: AuthoringEntityFact[] = [];

      for (const localId of batchIds) {
        const { element, authoring } = await buildElementPayload(ifcApi, openedModelId, localId);
        authoringBatch.push(authoring);
        elementCount += 1;
        propertyCount += element.properties?.length ?? 0;
        elements.push(element);
      }
      authoringEntities.push(...readAuthoringGeometry(ifcApi, openedModelId, authoringBatch));

      if (elements.length > 0) {
        await bulkUpsertBimElements(model.id, elements, {
          // Final status is committed explicitly below together with the
          // terminal job status, never as an incidental effect of a batch.
          finalize: false, generationId
        });
      }

      await upsertBimIndexJob({
        generationId,
        projectCode: input.projectCode,
        documentPath: input.documentPath,
        sourceHash: input.sourceHash,
        status: "processing",
        stats: createBimIndexProgress({
          modelKey: input.modelKey,
          processedElements: Math.min(index + batchIds.length, localIds.length),
          totalElements: localIds.length,
          propertyCount,
          currentBatch: Math.floor(index / SERVER_INDEX_BATCH_SIZE) + 1,
          totalBatches
        })
      });
    }

    if (localIds.length === 0) {
      await bulkUpsertBimElements(model.id, [], { finalize: false, generationId });
    }

    // Batches have committed, but neither model nor job is ready until authoring commits.
    const finalJob = await getBimIndexJob({ projectCode: input.projectCode, documentPath: input.documentPath, sourceHash: input.sourceHash });
    if (finalJob?.status === "cancelled") throw new BimIndexingCancelledError();
    if (finalJob && finalJob.status !== "processing") throw new Error(`El job BIM dejó de estar activo (estado: ${finalJob.status}).`);
    if (timeoutMs !== undefined && Date.now() - startedAt >= timeoutMs) throw new BimIndexingTimeoutError(timeoutMs);
    const authoringIndex = resolveAuthoringElements({ context, entities: readAuthoringExportStructure(ifcApi, openedModelId, authoringEntities), relations: authoringRelations });
    const quantities = extractIfcQuantityObservations(ifcApi, openedModelId, context, authoringIndex);
    await replaceAuthoringElementIndex(authoringIndex);
    await replaceGenerationQuantityObservations(generationId, context, quantities.quantityObservations);

    await publishBimIndexGeneration({ generationId, context, elementCount, propertyCount });

    await upsertBimIndexJob({
      generationId,
      projectCode: input.projectCode,
      documentPath: input.documentPath,
      sourceHash: input.sourceHash,
      status: "ready",
      stats: {
        ...createBimIndexProgress({
          modelKey: input.modelKey,
          processedElements: localIds.length,
          totalElements: localIds.length,
          propertyCount,
          currentBatch: totalBatches,
          totalBatches
        }),
        elementCount
      }
    });

    return { modelId: model.id, elementCount, propertyCount, context, ...quantities };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const cancelled = error instanceof BimIndexingCancelledError;
    await failBimIndexGeneration(generationId, errorMessage);
    await upsertBimIndexJob({
      generationId,
      projectCode: input.projectCode,
      documentPath: input.documentPath,
      sourceHash: input.sourceHash,
      status: cancelled ? "cancelled" : "failed",
      errorMessage,
      stats: {
        stage: "server-web-ifc",
        modelKey: input.modelKey,
        indexVersion: BIM_INDEX_SCHEMA_VERSION,
        processedElements: elementCount,
        propertyCount,
        progressUpdatedAt: new Date().toISOString(),
        elementCount,
        terminalStatus: cancelled ? "cancelled" : "failed"
      }
    });
    throw error;
  } finally {
    if (openedModelId >= 0) ifcApi.CloseModel(openedModelId);
    ifcApi.Dispose();
  }
}
