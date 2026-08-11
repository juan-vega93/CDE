"use client";
import { useSession } from "next-auth/react";
import type { BcfTopic } from "@/features/viewer-ifc/types/bcf-topic";
import { captureViewerSnapshot } from "@/features/viewer-ifc/lib/viewpoint-snapshot";
import Link from "next/link";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from "react";
import * as THREE from "three";
import * as OBC from "@thatopen/components";
import * as FRAGS from "@thatopen/fragments";
import * as WEBIFC from "web-ifc";
import { createWorld } from "@/features/viewer-ifc/lib/create-world";
import { loadViewerModel } from "@/features/viewer-ifc/lib/load-ifc-model";
import {
  resolveViewerSource,
  type ViewerSource
} from "@/features/viewer-ifc/lib/resolve-viewer-source";
import { setupViewerModules } from "@/features/viewer-ifc/modules";
import {
  IfcViewerToolbar,
  type ViewerSnapConfig
} from "@/features/viewer-ifc/components/ifc-viewer-toolbar";
import type { ViewerMeasurementMode } from "@/features/viewer-ifc/modules/measurement.module";
import { IfcViewpointsPanel } from "@/features/viewer-ifc/components/ifc-viewpoints-panel";
import { IfcSelectedPropertiesPanel } from "@/features/viewer-ifc/components/ifc-selected-properties-panel";
import { IfcModelSelector } from "@/features/viewer-ifc/components/ifc-model-selector";
import {
  applyViewpoint,
  captureViewpoint,
  fitObjectInView,
  fitSelectionInView
} from "@/features/viewer-ifc/lib/viewpoints";
import {
  getViewpoints as fetchViewpoints,
  saveViewpoints as persistViewpoints
} from "@/services/viewpoints.service";
import type { ViewerViewpoint } from "@/features/viewer-ifc/types/viewpoint";
import {
  deleteBcfTopic as deletePersistedBcfTopic,
  getBcfTopics,
  saveBcfTopics
} from "@/services/bcf.service";
import { createWorkPackageFromBcfTopic } from "@/services/work-packages.service";
import {
  getProjectMembers,
  type ProjectMember
} from "@/services/project-cards.service";
import { bffAssetFetch, bffFetch } from "@/services/bff-client";


type IfcViewerCanvasProps = {
  sources: ViewerSource[];
  documentNames?: string[];
  documentPaths?: string[];
  projectCode?: string;
};

type ViewerRuntime = ReturnType<typeof createWorld>;
type LoadedViewerModelResult = Awaited<ReturnType<typeof loadViewerModel>>;
type RuntimeIfcModel = LoadedViewerModelResult["model"] & {
  getSpatialStructure?: () =>
    | Promise<ThatOpenSpatialTreeItem | null>
    | ThatOpenSpatialTreeItem
    | null;
  getItemsChildren?: (ids: number[]) => Promise<number[]> | number[];
  getItemsData?: (
    ids: number[],
    config?: Record<string, unknown>
  ) =>
    | Promise<Record<string, unknown>[]>
    | Record<string, unknown>[];
  getItemsIdsWithGeometry?: () => Promise<number[]> | number[];
  getItemsGeometry?: (
    ids: number[]
  ) => Promise<FRAGS.MeshData[][]> | FRAGS.MeshData[][];
  getItemsVolume?: (ids: number[]) => Promise<number> | number;
  getLocalIds?: () => Promise<number[]> | number[];
  setOpacity?: (localIds: number[] | undefined, opacity: number) => Promise<void> | void;
  resetOpacity?: (localIds: number[] | undefined) => Promise<void> | void;
};

type ThatOpenSpatialTreeItem = {
  category: string | null;
  localId: number | null;
  children?: ThatOpenSpatialTreeItem[];
};

type FederatedModelEntry = {
  key: string;
  name: string;
  source: ViewerSource;
  object: THREE.Object3D<THREE.Object3DEventMap>;
  runtimeModel: RuntimeIfcModel;
  visible: boolean;
  expanded: boolean;
  isolated?: boolean;
  isSelected?: boolean;
  modelId?: string;
  spatialTree?: ModelTreeNode[];
  spatialTreeLoading?: boolean;
  spatialTreeError?: string;
};

function getFederatedModelsAnalysisSignature(models: FederatedModelEntry[]) {
  return models
    .map(
      (model) =>
        `${model.key}:${model.modelId ?? ""}:${model.spatialTree?.length ?? 0}:${model.spatialTreeError ?? ""}`
    )
    .sort()
    .join("|");
}

function isUsableSmartViewPropertyIndex(value: unknown): value is SmartViewPropertyIndex {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SmartViewPropertyIndex>;
  return (
    Array.isArray(data.sets) &&
    Boolean(data.propertiesBySet) &&
    typeof data.propertiesBySet === "object" &&
    Boolean(data.valuesBySetAndProperty) &&
    typeof data.valuesBySetAndProperty === "object" &&
    Boolean(data.localIdsBySetPropertyValue) &&
    typeof data.localIdsBySetPropertyValue === "object"
  );
}

function isUsableSmartViewPropertyCatalog(value: unknown): value is SmartViewPropertyCatalog {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<SmartViewPropertyCatalog>;
  return (
    Array.isArray(data.sets) &&
    Boolean(data.propertiesBySet) &&
    typeof data.propertiesBySet === "object" &&
    Boolean(data.valuesBySetAndProperty) &&
    typeof data.valuesBySetAndProperty === "object"
  );
}

function getSmartViewSelectorSource(
  propertyIndex: SmartViewPropertyIndex,
  propertyCatalog: SmartViewPropertyCatalog | null
): SmartViewSelectorSource {
  if (propertyIndex.sets.length > 0) {
    return {
      sets: propertyIndex.sets,
      propertiesBySet: propertyIndex.propertiesBySet,
      valuesBySetAndProperty: propertyIndex.valuesBySetAndProperty,
      source: "index"
    };
  }

  if (propertyCatalog && propertyCatalog.sets.length > 0) {
    const valuesBySetAndProperty: Record<string, Record<string, string[]>> = {};

    for (const [setName, properties] of Object.entries(propertyCatalog.valuesBySetAndProperty)) {
      valuesBySetAndProperty[setName] = {};

      for (const [propertyName, values] of Object.entries(properties)) {
        valuesBySetAndProperty[setName][propertyName] = values
          .map((item) => item.value)
          .filter(Boolean);
      }
    }

    return {
      sets: propertyCatalog.sets,
      propertiesBySet: propertyCatalog.propertiesBySet,
      valuesBySetAndProperty,
      source: "catalog"
    };
  }

  return {
    sets: [],
    propertiesBySet: {},
    valuesBySetAndProperty: {},
    source: "empty"
  };
}

async function loadSmartViewPropertyIndexSnapshot(
  projectCode: string | undefined,
  signature: string
): Promise<SmartViewPropertyIndex | null> {
  const normalizedProjectCode = projectCode?.trim().toUpperCase();
  if (!normalizedProjectCode || !signature) return null;

  try {
    const params = new URLSearchParams({
      projectCode: normalizedProjectCode,
      signature
    });
    const response = await bffFetch(`/api/bim-index/properties/snapshot?${params.toString()}`);
    if (!response.ok) return null;

    const payload = (await response.json()) as { success?: boolean; data?: unknown };
    if (!payload.success || !isUsableSmartViewPropertyIndex(payload.data)) return null;

    return payload.data;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo leer snapshot BIM persistente:", error);
    return null;
  }
}

async function loadSmartViewPropertyCatalogFromDatabase(input: {
  projectCode?: string;
  modelKeys: string[];
}): Promise<SmartViewPropertyCatalog | null> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const modelKeys = input.modelKeys.map((key) => key.trim()).filter(Boolean);
  if (!normalizedProjectCode || modelKeys.length === 0) return null;

  try {
    const params = new URLSearchParams({
      projectCode: normalizedProjectCode,
      modelKeys: modelKeys.join(","),
      maxValuesPerProperty: String(MAX_INDEXED_VALUES_PER_PROPERTY),
      includeLocalIds: "false"
    });
    const response = await bffFetch(
      "/api/bim-index/properties/catalog?" + params.toString()
    );
    if (!response.ok) return null;

    const payload = (await response.json()) as { success?: boolean; data?: unknown };
    if (!payload.success || !isUsableSmartViewPropertyCatalog(payload.data)) return null;

    return payload.data.sets.length > 0 ? payload.data : null;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo leer catalogo BIM normalizado:", error);
    return null;
  }
}

type Cost5DServerAggregation = {
  rows: Array<{
    itemId: string;
    itemName: string;
    itemUnit: string;
    quantity: number;
    elementCount: number;
    modelCount: number;
    modelKeys: string[];
  }>;
  totals: {
    quantity: number;
    elementCount: number;
    rowCount: number;
  };
};

function toBimPropertyRefPayload(ref: Cost5DPropertyRef) {
  const setName = ref.set.trim();
  const propertyName = ref.property.trim();
  return setName && propertyName ? { setName, propertyName } : undefined;
}

async function loadCost5DAggregationFromDatabase(input: {
  projectCode?: string;
  modelKeys: string[];
  mapping: Cost5DMapping;
}): Promise<Cost5DServerAggregation | null> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const modelKeys = input.modelKeys.map((key) => key.trim()).filter(Boolean);
  const itemId = toBimPropertyRefPayload(input.mapping.itemId);
  if (!normalizedProjectCode || modelKeys.length === 0 || !itemId) return null;

  try {
    const response = await bffFetch("/api/bim-index/cost5d/aggregate", {
      method: "POST",
      body: JSON.stringify({
        projectCode: normalizedProjectCode,
        modelKeys,
        itemId,
        itemName: toBimPropertyRefPayload(input.mapping.itemName),
        itemUnit: toBimPropertyRefPayload(input.mapping.itemUnit),
        quantity: toBimPropertyRefPayload(input.mapping.quantity),
        limit: 1000
      })
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as { success?: boolean; data?: Cost5DServerAggregation };
    return payload.success && payload.data ? payload.data : null;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo leer agregado 5D normalizado:", error);
    return null;
  }
}

function serverCostRowsToCost5DRows(data: Cost5DServerAggregation | null): Cost5DRow[] | null {
  if (!data) return null;

  return data.rows.map((row) => ({
    key: `db:${row.itemId}:${row.itemName}:${row.itemUnit}`,
    itemId: row.itemId,
    itemName: row.itemName,
    itemUnit: row.itemUnit,
    quantity: row.quantity,
    elementCount: row.elementCount,
    geometryCount: 0,
    modelCount: row.modelCount,
    modelIdMap: {}
  }));
}

type Cost5DServerMeteringRows = {
  projectCode: string;
  total: number;
  limit: number;
  offset: number;
  rows: Array<{
    key: string;
    modelId: string;
    modelKey: string;
    modelName: string;
    className: string;
    elementName: string;
    localId: number;
    values: string[];
  }>;
};

async function loadCost5DMeteringRowsFromDatabase(input: {
  projectCode?: string;
  modelKeys: string[];
  columns: MeteringColumn[];
  search: string;
  limit: number;
  offset: number;
}): Promise<Cost5DServerMeteringRows | null> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const modelKeys = input.modelKeys.map((key) => key.trim()).filter(Boolean);
  const columns = input.columns
    .map((column) => ({
      id: column.id,
      label: column.label,
      ref: toBimPropertyRefPayload({ set: column.set, property: column.property })
    }))
    .filter(
      (column): column is {
        id: string;
        label: string;
        ref: { setName: string; propertyName: string };
      } => Boolean(column.ref)
    );

  if (!normalizedProjectCode || modelKeys.length === 0 || columns.length === 0) return null;

  try {
    const response = await bffFetch("/api/bim-index/cost5d/metering-rows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectCode: normalizedProjectCode,
        modelKeys,
        columns,
        search: input.search,
        limit: input.limit,
        offset: input.offset
      })
    });
    if (!response.ok) return null;

    const payload = (await response.json()) as {
      success?: boolean;
      data?: Cost5DServerMeteringRows;
    };
    return payload.success && payload.data ? payload.data : null;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo leer tabla 5D paginada:", error);
    return null;
  }
}
async function exportCost5DMeteringRowsFromDatabase(input: {
  projectCode?: string;
  modelKeys: string[];
  columns: MeteringColumn[];
  search: string;
}): Promise<boolean> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const modelKeys = input.modelKeys.map((key) => key.trim()).filter(Boolean);
  const columns = input.columns
    .map((column) => ({
      id: column.id,
      label: column.label,
      ref: toBimPropertyRefPayload({ set: column.set, property: column.property })
    }))
    .filter(
      (column): column is {
        id: string;
        label: string;
        ref: { setName: string; propertyName: string };
      } => Boolean(column.ref)
    );

  if (!normalizedProjectCode || modelKeys.length === 0 || columns.length === 0) return false;

  try {
    const response = await bffFetch("/api/bim-index/cost5d/metering-rows/export.csv", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectCode: normalizedProjectCode,
        modelKeys,
        columns,
        search: input.search
      })
    });
    if (!response.ok) return false;

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") ?? "";
    const filenameMatch = /filename="?([^";]+)"?/i.exec(disposition);
    const filename = filenameMatch?.[1] ?? `metrados-${normalizedProjectCode}-${Date.now()}.csv`;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    return true;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo exportar metrados desde DB:", error);
    return false;
  }
}
async function loadSmartViewPropertyIndexFromDatabase(input: {
  projectCode?: string;
  modelKeys: string[];
}): Promise<SmartViewPropertyIndex | null> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const modelKeys = input.modelKeys.map((key) => key.trim()).filter(Boolean);
  if (!normalizedProjectCode || modelKeys.length === 0) return null;

  try {
    const params = new URLSearchParams({
      projectCode: normalizedProjectCode,
      modelKeys: modelKeys.join(","),
      maxValuesPerProperty: String(MAX_INDEXED_VALUES_PER_PROPERTY),
      includeLocalIds: "false"
    });
    const response = await bffFetch(`/api/bim-index/properties?${params.toString()}`);
    if (!response.ok) return null;

    const payload = (await response.json()) as { success?: boolean; data?: unknown };
    if (!payload.success || !isUsableSmartViewPropertyIndex(payload.data)) return null;

    return payload.data.sets.length > 0 ? payload.data : null;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo leer indice BIM normalizado:", error);
    return null;
  }
}

async function loadSmartViewPropertyLocalIdsFromDatabase(input: {
  projectCode?: string;
  modelKeys: string[];
  propertySet: string;
  propertyName: string;
  propertyValue?: string;
}): Promise<Record<string, number[]> | null> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const modelKeys = input.modelKeys.map((key) => key.trim()).filter(Boolean);
  const propertySet = input.propertySet.trim();
  const propertyName = input.propertyName.trim();
  const propertyValue = input.propertyValue?.trim();

  if (!normalizedProjectCode || modelKeys.length === 0 || !propertySet || !propertyName) return null;

  try {
    const response = await bffFetch("/api/bim-index/properties/query", {
      method: "POST",
      body: JSON.stringify({
        projectCode: normalizedProjectCode,
        modelKeys,
        property: { setName: propertySet, propertyName },
        propertyValue: propertyValue || undefined,
        maxIdsPerModel: 250000
      })
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { success?: boolean; data?: unknown };
    if (!payload.success || !payload.data || typeof payload.data !== "object" || Array.isArray(payload.data)) {
      return null;
    }

    const result: Record<string, number[]> = {};
    for (const [key, ids] of Object.entries(payload.data as Record<string, unknown>)) {
      if (Array.isArray(ids)) {
        result[key] = ids.map(Number).filter(Number.isFinite);
      }
    }

    return result;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo consultar localIds BIM normalizados:", error);
    return null;
  }
}
async function loadParameterAnalysisSummaryFromDatabase(input: {
  projectCode?: string;
  modelKeys: string[];
  propertySet: string;
  propertyName: string;
}): Promise<BimPropertySummaryPayload | null> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const modelKeys = input.modelKeys.map((key) => key.trim()).filter(Boolean);
  const propertySetName = input.propertySet.trim();
  const propertyName = input.propertyName.trim();

  if (!normalizedProjectCode || modelKeys.length === 0 || !propertySetName || !propertyName) return null;

  try {
    const response = await bffFetch("/api/bim-index/properties/summary", {
      method: "POST",
      body: JSON.stringify({
        projectCode: normalizedProjectCode,
        modelKeys,
        propertySetName,
        propertyName,
        maxBuckets: 180,
        maxIdsPerBucket: MAX_LOCAL_IDS_PER_VALUE_BUCKET
      })
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as { success?: boolean; data?: BimPropertySummaryPayload };
    if (!payload.success || !payload.data || !Array.isArray(payload.data.buckets)) return null;

    return payload.data;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo leer resumen BIM normalizado:", error);
    return null;
  }
}
async function saveSmartViewPropertyIndexSnapshot(input: {
  projectCode?: string;
  signature: string;
  modelKeys: string[];
  elementCount: number;
  index: SmartViewPropertyIndex;
}) {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  if (!normalizedProjectCode || !input.signature || input.index.sets.length === 0) return;

  try {
    const body = JSON.stringify({
      projectCode: normalizedProjectCode,
      signature: input.signature,
      modelKeys: input.modelKeys,
      elementCount: input.elementCount,
      index: input.index
    });

    if (body.length > 12_000_000) {
      console.info("[viewer-ifc] Snapshot BIM omitido por tamano", { bytes: body.length });
      return;
    }

    const response = await bffFetch("/api/bim-index/properties/snapshot", {
      method: "PUT",
      body
    });

    if (!response.ok) {
      console.warn("[viewer-ifc] Snapshot BIM no persistido", response.status);
    }
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo guardar snapshot BIM persistente:", error);
  }
}


type BimIndexElementPayload = {
  localId: number;
  globalId?: string;
  ifcClass?: string;
  name?: string;
  typeName?: string;
  levelName?: string;
  elementIdentity?: string;
  hasGeometry?: boolean;
  metadata?: Record<string, unknown>;
  properties: Array<{
    setName: string;
    name: string;
    value: string;
    valueType: "text";
  }>;
};

async function upsertBimIndexModel(input: {
  projectCode?: string;
  model: FederatedModelEntry;
  signature: string;
  elementCount: number;
}): Promise<string | null> {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const documentPath =
    input.model.source.documentPath ?? input.model.source.modelUrl ?? input.model.key;
  const documentName = input.model.source.documentName ?? input.model.name;

  if (!normalizedProjectCode || !documentPath || !documentName) return null;

  try {
    const response = await bffFetch("/api/bim-index/models", {
      method: "PUT",
      body: JSON.stringify({
        projectCode: normalizedProjectCode,
        documentPath,
        documentName,
        modelKey: input.model.key,
        runtimeModelId: input.model.modelId,
        status: "processing",
        elementCount: input.elementCount,
        metadata: {
          sourceKind: input.model.source.kind,
          analysisSignature: input.signature
        }
      })
    });

    if (!response.ok) return null;
    const payload = (await response.json()) as { success?: boolean; data?: { id?: string } };
    return payload.success && payload.data?.id ? payload.data.id : null;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo registrar modelo BIM en BD:", error);
    return null;
  }
}

type BimIndexJobStatus = "pending" | "processing" | "ready" | "failed" | "cancelled";
type BimIndexedModelRecord = {
  id?: string;
  projectCode?: string;
  documentPath?: string;
  documentName?: string;
  modelKey?: string;
  runtimeModelId?: string | null;
  status?: string;
  elementCount?: number;
  propertyCount?: number;
  updatedAt?: string;
  lastIndexedAt?: string | null;
};

type BimIndexOverview = {
  projectCode: string;
  models: {
    total: number;
    ready: number;
    pending: number;
    processing: number;
    failed: number;
    stale: number;
    elements: number;
    properties: number;
    lastIndexedAt: string | null;
  };
  jobs: {
    total: number;
    pending: number;
    processing: number;
    ready: number;
    failed: number;
    cancelled: number;
    lastUpdatedAt: string | null;
  };
  snapshots: {
    total: number;
    lastUpdatedAt: string | null;
  };
};

function getIndexedModelRecordKey(record: BimIndexedModelRecord) {
  return typeof record.modelKey === "string" ? record.modelKey.trim() : "";
}

function isIndexedModelRecordReady(record: BimIndexedModelRecord) {
  const status = String(record.status ?? "").toLowerCase();
  return (
    getIndexedModelRecordKey(record).length > 0 &&
    status !== "failed" &&
    status !== "cancelled" &&
    Number(record.elementCount ?? 0) > 0
  );
}

async function loadIndexedBimModels(
  projectCode?: string
): Promise<BimIndexedModelRecord[]> {
  const normalizedProjectCode = projectCode?.trim().toUpperCase();
  if (!normalizedProjectCode) return [];

  try {
    const response = await bffFetch(
      `/api/bim-index/models?projectCode=${encodeURIComponent(normalizedProjectCode)}`
    );

    if (!response.ok) return [];

    const payload = (await response.json()) as {
      success?: boolean;
      data?: unknown;
    };

    if (!payload.success || !Array.isArray(payload.data)) return [];

    return payload.data.filter(
      (item): item is BimIndexedModelRecord =>
        Boolean(item) && typeof item === "object"
    );
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo leer catalogo BIM en BD:", error);
    return [];
  }
}
async function loadBimIndexOverview(
  projectCode?: string
): Promise<BimIndexOverview | null> {
  const normalizedProjectCode = projectCode?.trim().toUpperCase();
  if (!normalizedProjectCode) return null;

  try {
    const response = await bffFetch(
      `/api/bim-index/overview?projectCode=${encodeURIComponent(normalizedProjectCode)}`
    );

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      success?: boolean;
      data?: BimIndexOverview;
    };

    return payload.success && payload.data ? payload.data : null;
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo consultar overview BIM:", error);
    return null;
  }
}

async function upsertBimIndexJob(input: {
  projectCode?: string;
  model: FederatedModelEntry;
  sourceHash: string;
  status: BimIndexJobStatus;
  errorMessage?: string;
  stats?: Record<string, unknown>;
}) {
  const normalizedProjectCode = input.projectCode?.trim().toUpperCase();
  const documentPath =
    input.model.source.documentPath ?? input.model.source.modelUrl ?? input.model.key;

  if (!normalizedProjectCode || !documentPath) return;

  try {
    const response = await bffFetch("/api/bim-index/jobs", {
      method: "PUT",
      body: JSON.stringify({
        projectCode: normalizedProjectCode,
        documentPath,
        sourceHash: input.sourceHash,
        status: input.status,
        errorMessage: input.errorMessage,
        stats: {
          modelKey: input.model.key,
          modelName: input.model.name,
          ...input.stats
        }
      })
    });

    if (!response.ok) {
      console.warn("[viewer-ifc] Job BIM no persistido", response.status);
    }
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo registrar job BIM:", error);
  }
}
function createBimIndexElementPayload(input: {
  item: Record<string, unknown>;
  pairs: Map<string, Map<string, Set<string>>>;
  model: FederatedModelEntry;
  localId: number;
}) {
  const properties: BimIndexElementPayload["properties"] = [];

  for (const [setName, propertyMap] of input.pairs) {
    for (const [propertyName, values] of propertyMap) {
      if (isSmartViewInternalPropertyKey(propertyName)) continue;

      for (const value of values) {
        properties.push({
          setName,
          name: propertyName,
          value: value || "-",
          valueType: "text"
        });
      }
    }
  }

  const globalId =
    readItemAttributeValue(input.item.GlobalId) ||
    readItemAttributeValue(input.item.GlobalID) ||
    readItemAttributeValue(input.item._guid);
  const name =
    readItemAttributeValue(input.item.Name) ||
    readItemAttributeValue(input.item.LongName) ||
    readItemAttributeValue(input.item.ObjectType);
  const ifcClass =
    findSmartViewPropertyValueByNames(input.pairs, ["IFC Class", "Category", "Categoria"]) ||
    readItemAttributeValue(input.item._category) ||
    readIfcCategoryFromName(name) ||
    undefined;
  const typeName =
    findSmartViewPropertyValueByNames(input.pairs, [
      "Tipo de elemento",
      "Type Name",
      "Type",
      "ObjectType"
    ]) || undefined;
  const levelName = getNativeIfcLevelValue(input.item, input.pairs) || undefined;

  return {
    localId: input.localId,
    globalId: globalId || undefined,
    ifcClass,
    name: name || undefined,
    typeName,
    levelName,
    elementIdentity: getCost5DElementIdentity(
      input.item,
      input.pairs,
      input.model.key,
      input.localId
    ),
    hasGeometry: true,
    metadata: {
      modelKey: input.model.key
    },
    properties
  };
}

async function persistBimIndexElementBatch(
  modelId: string | undefined,
  elements: BimIndexElementPayload[]
) {
  if (!modelId || elements.length === 0) return;

  try {
    const response = await bffFetch(`/api/bim-index/models/${modelId}/elements/bulk`, {
      method: "POST",
      body: JSON.stringify({ elements })
    });

    if (!response.ok) {
      console.warn("[viewer-ifc] Lote BIM no persistido", response.status);
    }
  } catch (error) {
    console.warn("[viewer-ifc] No se pudo persistir lote BIM:", error);
  }
}

type RightPanelTab =
  | "properties"
  | "models"
  | "filters"
  | "parameters"
  | "cost5d"
  | "audit"
  | "viewpoints"
  | "topics";

const RIGHT_PANEL_GROUPS: Array<{
  key: string;
  label: string;
  tabs: Array<{ key: RightPanelTab; label: string }>;
}> = [
  {
    key: "model",
    label: "Modelo",
    tabs: [
      { key: "properties", label: "Propiedades" },
      { key: "models", label: "Modelos" },
      { key: "viewpoints", label: "Vistas" }
    ]
  },
  {
    key: "data",
    label: "Datos",
    tabs: [
      { key: "filters", label: "SmartView" },
      { key: "parameters", label: "Parametros" },
      { key: "cost5d", label: "5D" }
    ]
  },
  {
    key: "quality",
    label: "Calidad",
    tabs: [{ key: "audit", label: "Auditoria" }]
  },
  {
    key: "coordination",
    label: "Coord.",
    tabs: [{ key: "topics", label: "Incidencias" }]
  }
];

function getRightPanelGroup(tab: RightPanelTab) {
  return (
    RIGHT_PANEL_GROUPS.find((group) =>
      group.tabs.some((item) => item.key === tab)
    ) ?? RIGHT_PANEL_GROUPS[0]
  );
}
type ClipperPlaneEntry = [
  string,
  {
    normal?: {
      x: number;
      y: number;
      z: number;
    };
    origin?: {
      x: number;
      y: number;
      z: number;
    };
  }
];

type NativeViewpointLike = {
  guid: string;
  title?: string;
  snapshot?: string;
  set?: (data: Partial<OBC.BCFViewpoint>) => void;
  selectionComponents?: {
    clear: () => void;
    add: (value: string) => void;
  };
  updateCamera?: (takeSnapshot?: boolean) => Promise<boolean> | boolean;
  takeSnapshot?: () => Promise<boolean> | boolean;
  addComponentsFromMap?: (modelIdMap: OBC.ModelIdMap) => Promise<void> | void;
};

const ISSUE_TYPE_OPTIONS: Array<{
  value: NonNullable<BcfTopic["issueType"]>;
  label: string;
}> = [
  { value: "coordination", label: "Coordinacion" },
  { value: "clash", label: "Interferencia" },
  { value: "design", label: "Diseno" },
  { value: "parameter", label: "Parametros" },
  { value: "constructability", label: "Constructibilidad" },
  { value: "safety", label: "Seguridad" },
  { value: "other", label: "Otro" }
];

const TOPIC_STATUS_OPTIONS: Array<{
  value: BcfTopic["status"];
  label: string;
}> = [
  { value: "open", label: "Abierta" },
  { value: "in_progress", label: "En curso" },
  { value: "resolved", label: "Resuelta" },
  { value: "closed", label: "Cerrada" }
];

const TOPIC_PRIORITY_OPTIONS: Array<{
  value: BcfTopic["priority"];
  label: string;
}> = [
  { value: "low", label: "Baja" },
  { value: "medium", label: "Media" },
  { value: "high", label: "Alta" },
  { value: "critical", label: "Critica" }
];

const MAX_GEOMETRY_MEASUREMENT_TRIANGLES = 750_000;
const AREA_PROPERTY_PRIORITY = [
  "netarea",
  "grossarea",
  "area",
  "projectedarea",
  "sidearea",
  "outerarea",
  "crosssectionarea"
];
const AREA_VALUE_KEYS = [
  "AreaValue",
  "NominalValue",
  "NetArea",
  "GrossArea",
  "Area",
  "ProjectedArea",
  "SideArea",
  "OuterArea",
  "CrossSectionArea"
];

type SelectionAreaMetric = {
  value: number;
  source: "ifc-quantity" | "parameter" | "geometry" | "mixed";
  label: string;
  matchedItems: number;
};

function getMeshDataTriangleCount(meshData: FRAGS.MeshData) {
  if (meshData.indices) return Math.floor(meshData.indices.length / 3);
  if (meshData.positions) return Math.floor(meshData.positions.length / 9);
  return 0;
}

function getMeshDataSurfaceArea(meshData: FRAGS.MeshData) {
  if (!meshData.positions) return 0;

  const positions = meshData.positions;
  const indices = meshData.indices;
  const transform = meshData.transform ?? new THREE.Matrix4();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  let area = 0;

  const readVertex = (vertexIndex: number, target: THREE.Vector3) => {
    const offset = vertexIndex * 3;
    target
      .set(positions[offset] ?? 0, positions[offset + 1] ?? 0, positions[offset + 2] ?? 0)
      .applyMatrix4(transform);
  };

  if (indices) {
    for (let index = 0; index < indices.length; index += 3) {
      readVertex(indices[index] ?? 0, a);
      readVertex(indices[index + 1] ?? 0, b);
      readVertex(indices[index + 2] ?? 0, c);
      area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    }
  } else {
    for (let index = 0; index < positions.length / 3; index += 3) {
      readVertex(index, a);
      readVertex(index + 1, b);
      readVertex(index + 2, c);
      area += ab.subVectors(b, a).cross(ac.subVectors(c, a)).length() * 0.5;
    }
  }

  return area;
}

function getModelIdMapItemCount(modelIdMap: OBC.ModelIdMap) {
  return Object.values(modelIdMap).reduce((total, ids) => total + ids.size, 0);
}

function getIssueTypeLabel(value?: BcfTopic["issueType"]) {
  return ISSUE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "Coordinacion";
}

function getTopicStatusLabel(value: BcfTopic["status"]) {
  return TOPIC_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getTopicPriorityLabel(value: BcfTopic["priority"]) {
  return TOPIC_PRIORITY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function getTopicPriorityClass(value: BcfTopic["priority"]) {
  if (value === "critical") return "border-red-500/70 bg-red-950/60 text-red-100";
  if (value === "high") return "border-red-700/60 bg-red-950/30 text-red-200";
  if (value === "medium") return "border-amber-500/50 bg-amber-950/30 text-amber-100";
  return "border-zinc-700 bg-zinc-900 text-zinc-300";
}

function getTopicStatusClass(value: BcfTopic["status"]) {
  if (value === "closed") return "border-zinc-700 bg-zinc-900 text-zinc-400";
  if (value === "resolved") return "border-emerald-700/60 bg-emerald-950/40 text-emerald-200";
  if (value === "in_progress") return "border-sky-700/60 bg-sky-950/40 text-sky-200";
  return "border-red-700/60 bg-red-950/30 text-red-100";
}

function getTopicLinkedElementCount(topic: BcfTopic) {
  return topic.linkedSelection?.reduce(
    (total, selection) => total + selection.expressIds.length,
    0
  ) ?? 0;
}

function safelyDisposeComponents(components: OBC.Components) {
  try {
    const disposeResult = components.dispose();

    void Promise.resolve(disposeResult).catch((error) => {
      const message =
        error instanceof Error ? error.message : String(error);

      if (message.includes("FragmentsManager not initialized")) {
        console.warn(
          "[viewer-ifc] Dispose parcial omitido: FragmentsManager no inicializado."
        );
        return;
      }

      console.warn("[viewer-ifc] Error async disposing components:", error);
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error);

    if (message.includes("FragmentsManager not initialized")) {
      console.warn(
        "[viewer-ifc] Dispose parcial omitido: FragmentsManager no inicializado."
      );
      return;
    }

    console.warn("[viewer-ifc] Error disposing components:", error);
  }
}
function getBffAssetUrl(value?: string | null) {
  if (!value) return "";

  if (value.startsWith("http") || value.startsWith("data:")) {
    return value;
  }

  if (value.startsWith("/api/")) {
    return `/api/bff-asset?path=${encodeURIComponent(value)}`;
  }

  const normalizedValue = value.startsWith("/") ? value : `/${value}`;

  return `/api/bff-asset?path=${encodeURIComponent(normalizedValue)}`;
}
function getParentFolderPath(documentPath?: string, projectCode?: string) {
  const normalizedProjectCode = projectCode?.trim().toUpperCase();

  if (!documentPath) {
    return normalizedProjectCode
      ? `/documents?projectCode=${encodeURIComponent(normalizedProjectCode)}`
      : "/admin/project-cards";
  }

  const clean = documentPath.trim();
  const projectRootPath = normalizedProjectCode
    ? `/${normalizedProjectCode}`
    : "";

  const index = clean.lastIndexOf("/");

  if (index <= 0) {
    return normalizedProjectCode
      ? `/documents?projectCode=${encodeURIComponent(normalizedProjectCode)}`
      : "/documents";
  }

  const parent = clean.slice(0, index) || projectRootPath || "/";

  if (normalizedProjectCode) {
    return `/documents?projectCode=${encodeURIComponent(
      normalizedProjectCode
    )}&path=${encodeURIComponent(parent)}`;
  }

  return `/documents?path=${encodeURIComponent(parent)}`;
}

function cloneModelIdMap(modelIdMap: OBC.ModelIdMap): OBC.ModelIdMap {
  const clone: OBC.ModelIdMap = {};

  for (const [modelId, ids] of Object.entries(modelIdMap)) {
    clone[modelId] = new Set(ids);
  }

  return clone;
}

const MODEL_ID_MAP_CACHE_MAX_IDS = 25000;

function getSelectionCacheKey(modelIdMap: OBC.ModelIdMap) {
  return Object.entries(modelIdMap)
    .map(([modelId, ids]) => {
      let count = 0;
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      let hash = 2166136261;

      for (const id of ids) {
        count += 1;
        min = Math.min(min, id);
        max = Math.max(max, id);
        hash ^= id;
        hash = Math.imul(hash, 16777619);
      }

      if (count === 0) return `${modelId}:0`;
      return `${modelId}:${count}:${min}:${max}:${hash >>> 0}`;
    })
    .sort()
    .join("|");
}

function setBoundedModelIdMapCache(
  cache: Map<string, OBC.ModelIdMap>,
  key: string,
  modelIdMap: OBC.ModelIdMap,
  maxEntries = 24
) {
  let elementCount = 0;
  for (const ids of Object.values(modelIdMap)) elementCount += ids.size;

  if (elementCount > MODEL_ID_MAP_CACHE_MAX_IDS) {
    cache.delete(key);
    return;
  }

  cache.set(key, cloneModelIdMap(modelIdMap));

  while (cache.size > maxEntries) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}
function getDynamicPropertyIndexLimit(modelCount: number) {
  const perModelBudget = Math.floor(
    MAX_PROPERTY_INDEX_TOTAL_LOCAL_IDS / Math.max(modelCount, 1)
  );

  return Math.max(3000, Math.min(MAX_PROPERTY_INDEX_LOCAL_IDS, perModelBudget));
}

type BrowserPerformanceWithMemory = Performance & {
  memory?: {
    usedJSHeapSize?: number;
    jsHeapSizeLimit?: number;
  };
};

function getBrowserHeapUsageRatio() {
  if (typeof performance === "undefined") return null;

  const memory = (performance as BrowserPerformanceWithMemory).memory;
  const used = memory?.usedJSHeapSize;
  const limit = memory?.jsHeapSizeLimit;

  if (!used || !limit) return null;

  return used / limit;
}

function waitForNextFrame() {
  return new Promise<void>((resolve) => {
    if (typeof window === "undefined" || !window.requestAnimationFrame) {
      globalThis.setTimeout(resolve, 0);
      return;
    }

    window.requestAnimationFrame(() => resolve());
  });
}

function shouldYieldPropertyIndex(lastYieldAt: number) {
  if (typeof performance === "undefined") return false;
  return performance.now() - lastYieldAt > PROPERTY_INDEX_YIELD_MS;
}
function getDisplayNameFromSource(
  source: ViewerSource,
  fallback?: string,
  index?: number
) {
  if (fallback?.trim()) return fallback.trim();
  if (source.documentName?.trim()) return source.documentName.trim();

  const fromUrl = decodeURIComponent(source.modelUrl.split("/").pop() || "")
    .split("?")[0]
    .trim();

  if (fromUrl) return fromUrl;

  return `Modelo ${typeof index === "number" ? index + 1 : ""}`.trim();
}

function getSourceKey(source: ViewerSource) {
  return `${source.kind}:${source.documentPath ?? source.modelUrl}`.toLowerCase();
}

function ModelVisibilityButton({
  visible,
  onClick
}: {
  visible: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
      title={visible ? "V" : "-"}
      aria-label={visible ? "V" : "-"}
    >
      {visible ? "V" : "-"}
    </button>
  );
}

function ExpandButton({
  expanded,
  onClick
}: {
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
      title={expanded ? "v" : ">"}
      aria-label={expanded ? "v" : ">"}
    >
      {expanded ? "v" : ">"}
    </button>
  );
}

type ModelTreeNode = {
  id: string;
  name: string;
  type: string;
  depth: number;
  localId?: number;
  aggregateLocalIds?: number[];
  truncatedChildrenCount?: number;
  children: ModelTreeNode[];
};
type ModelTreeMode = "spatial" | "type" | "level";
type SmartViewCriteria = {
  text: string;
  modelKey: string;
  type: string;
  level: string;
  propertySet: string;
  propertyName: string;
  propertyValue: string;
  color: string;
};
type SavedSmartView = SmartViewCriteria & {
  id: string;
  name: string;
};
type Bim2DViewEntry = {
  id: string;
  name: string;
  kind: "plan" | "elevation" | "section" | "other";
};
type SmartViewPropertyIndex = {
  sets: string[];
  propertiesBySet: Record<string, string[]>;
  valuesBySetAndProperty: Record<string, Record<string, string[]>>;
  localIdsBySetPropertyValue: Record<string, Record<string, Record<string, Record<string, number[]>>>>;
  localIdsByModelKey?: Record<string, number[]>;
  elementIdentityByKey?: Record<string, string>;
  levelLocalIdsByModelKey?: Record<string, Record<string, number[]>>;
};
type SmartViewPropertyCatalog = {
  sets: string[];
  propertiesBySet: Record<string, string[]>;
  valuesBySetAndProperty: Record<
    string,
    Record<string, Array<{ value: string; count: number }>>
  >;
  elementCount?: number;
  propertyCount?: number;
  valueCount?: number;
};
type BimPropertySummaryPayload = {
  totalElements: number;
  missingValueCount: number;
  bucketCount: number;
  buckets: Array<{
    value: string;
    count: number;
    localIdsByModelKey: Record<string, number[]>;
    truncated?: boolean;
  }>;
};
type SmartViewSelectorSource = {
  sets: string[];
  propertiesBySet: Record<string, string[]>;
  valuesBySetAndProperty: Record<string, Record<string, string[]>>;
  source: "index" | "catalog" | "empty";
};
type ParameterValueBucket = {
  value: string;
  count: number;
  color: string;
  modelIdMap: OBC.ModelIdMap;
};
type Cost5DPropertyRef = {
  set: string;
  property: string;
};
type Cost5DMapping = {
  itemId: Cost5DPropertyRef;
  itemName: Cost5DPropertyRef;
  itemUnit: Cost5DPropertyRef;
  quantity: Cost5DPropertyRef;
};
type Cost5DRow = {
  key: string;
  itemId: string;
  itemName: string;
  itemUnit: string;
  quantity: number;
  elementCount: number;
  geometryCount: number;
  modelCount: number;
  modelIdMap: OBC.ModelIdMap;
};
type MeteringColumn = Cost5DPropertyRef & {
  id: string;
  label: string;
};
type MeteringRow = {
  key: string;
  modelId: string;
  modelName: string;
  localId: number;
  type: string;
  name: string;
  values: string[];
};
type AuditOperator =
  | "exists"
  | "missing"
  | "equals"
  | "not_equals"
  | "contains"
  | "empty"
  | "not_empty";
type AuditRule = {
  id: string;
  name: string;
  modelKey: string;
  type: string;
  level: string;
  propertySet: string;
  propertyName: string;
  operator: AuditOperator;
  value: string;
  severity: "low" | "medium" | "high";
};
type AuditElementRecord = {
  key: string;
  modelKey: string;
  modelId: string;
  modelName: string;
  localId: number;
  name: string;
  type: string;
  level: string;
  globalId: string;
  properties: Record<string, Record<string, string[]>>;
  searchableText: string;
};
type AuditResult = {
  id: string;
  ruleId: string;
  ruleName: string;
  status: "pass" | "fail";
  severity: AuditRule["severity"];
  message: string;
  actualValue: string;
  modelKey: string;
  modelId: string;
  modelName: string;
  localId: number;
  elementName: string;
  type: string;
  level: string;
  globalId: string;
  propertySet: string;
  propertyName: string;
};
type AuditSummary = {
  total: number;
  passed: number;
  failed: number;
  byRule: Array<{ name: string; pass: number; fail: number }>;
  byType: Array<{ name: string; pass: number; fail: number }>;
  byLevel: Array<{ name: string; pass: number; fail: number }>;
  byModel: Array<{ name: string; pass: number; fail: number }>;
};

type ViewerPerformanceStats = {
  fps: number;
  heapUsedMb: number | null;
  heapLimitMb: number | null;
  geometries: number | null;
  textures: number | null;
  triangles: number | null;
  calls: number | null;
  loadedModels: number;
  visibleModels: number;
  treeNodes: number;
  loadMs: number | null;
};

const MAX_TREE_ELEMENT_NODES = 25000;
const MAX_RENDERED_TREE_GROUP_CHILDREN = 350;
const MAX_PROPERTY_INDEX_LOCAL_IDS = 6500;
const MAX_PROPERTY_INDEX_TOTAL_LOCAL_IDS = 20000;
const PROPERTY_INDEX_BATCH_SIZE = 12;
const PROPERTY_INDEX_YIELD_MS = 24;
const PROPERTY_INDEX_HEAP_WARN_RATIO = 0.66;
const BIM_INDEX_PERSIST_BATCH_SIZE = 80;
const BIM_INDEX_PERSIST_MAX_CONCURRENT = 1;
const MAX_INDEXED_VALUES_PER_PROPERTY = 450;
const MAX_LOCAL_IDS_PER_VALUE_BUCKET = 8000;
const PARAMETER_ANALYSIS_LOCAL_BUCKET_MAX_IDS = 25000;
const MAX_MODEL_ID_MAP_EXPANSION_IDS = 1500;
const MAX_NATIVE_LEVEL_INDEX_LOCAL_IDS = 80000;
const NATIVE_LEVEL_INDEX_BATCH_SIZE = 80;
const TREE_ACTION_HIGHLIGHT_LIMIT = 1200;
const CONTEXT_GHOST_MAX_DIM_IDS = 12000;
const MAX_SMART_VIEW_PROPERTY_SETS_PER_ITEM = 48;
const MAX_SMART_VIEW_PROPERTIES_PER_SET = 140;
const MAX_SMART_VIEW_NESTED_ARRAY_SCAN = 160;
const MAX_METERING_ROWS = 5000;
const METERING_RENDER_ROW_LIMIT = 150;
const IFC_DATA_BATCH_SIZE = 80;
const SMART_VIEW_INTERNAL_PROPERTY_KEYS = new Set([
  "type",
  "_type",
  "_category",
  "category",
  "_guid",
  "guid",
  "globalid",
  "_localid",
  "localid",
  "local_id",
  "_local_id",
  "expressid",
  "_expressid",
  "express_id",
  "_express_id",
  "ownerhistory"
]);
function normalizeSmartViewPropertyKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-.]/g, "");
}

function isSmartViewInternalPropertyKey(value: string) {
  const normalized = normalizeSmartViewPropertyKey(value);
  return (
    SMART_VIEW_INTERNAL_PROPERTY_KEYS.has(value.trim().toLowerCase()) ||
    ["type", "category", "guid", "globalid", "localid", "expressid", "ownerhistory"].includes(
      normalized
    )
  );
}
const SMART_VIEW_LEVEL_PROPERTY_KEYS = new Set([
  "level",
  "floor",
  "storey",
  "buildingstorey",
  "buildingstory"
]);
const SMART_VIEW_NATIVE_LEVEL_SETS = new Set([
  "location",
  "partof",
  "attributesifc",
  "atributosifc"
]);
function isSmartViewNativeIfcLevelProperty(setName: string, propertyName: string) {
  const normalizedSet = normalizeSmartViewPropertyKey(setName);
  const normalizedProperty = normalizeSmartViewPropertyKey(propertyName);

  if (!SMART_VIEW_NATIVE_LEVEL_SETS.has(normalizedSet)) return false;
  return SMART_VIEW_LEVEL_PROPERTY_KEYS.has(normalizedProperty);
}

function findRelatedBuildingStoreyName(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): string {
  if (depth > 9) return "";

  if (Array.isArray(value)) {
    for (const itemValue of value.slice(0, MAX_SMART_VIEW_NESTED_ARRAY_SCAN)) {
      const found = findRelatedBuildingStoreyName(itemValue, depth + 1, seen);
      if (found) return found;
    }

    return "";
  }

  if (!isPlainRecord(value)) return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const category = getIfcItemCategory(value, null, "").toUpperCase();
  if (category === "IFCBUILDINGSTOREY") {
    const name =
      readItemAttributeValue(value.Name) ||
      readItemAttributeValue(value.LongName) ||
      readItemAttributeValue(value.ObjectType);
    if (name.trim()) return name.trim();
  }

  for (const nestedValue of Object.values(value)) {
    const found = findRelatedBuildingStoreyName(nestedValue, depth + 1, seen);
    if (found) return found;
  }

  return "";
}

function getNativeIfcLevelValue(
  item: Record<string, unknown>,
  pairs?: Map<string, Map<string, Set<string>>>
) {
  const relatedStoreyName = findRelatedBuildingStoreyName(item);
  if (relatedStoreyName) return relatedStoreyName;

  if (pairs) {
    for (const [setName, properties] of pairs) {
      for (const [propertyName, values] of properties) {
        if (!isSmartViewNativeIfcLevelProperty(setName, propertyName)) continue;

        const value = Array.from(values).find(
          (itemValue) => itemValue.trim() && itemValue.trim() !== "-"
        );
        if (value) return value.trim();
      }
    }
  }

  const seen = new WeakSet<object>();

  function scan(value: unknown, insideLocation = false, depth = 0): string {
    if (depth > 7) return "";
    if (Array.isArray(value)) {
      for (const itemValue of value.slice(0, MAX_SMART_VIEW_NESTED_ARRAY_SCAN)) {
        const found = scan(itemValue, insideLocation, depth + 1);
        if (found) return found;
      }

      return "";
    }

    if (!isPlainRecord(value)) return "";
    if (seen.has(value)) return "";
    seen.add(value);

    for (const [key, nestedValue] of Object.entries(value)) {
      const normalizedKey = normalizeSmartViewPropertyKey(key);
      const nextInsideLocation =
        insideLocation ||
        normalizedKey === "location" ||
        normalizedKey === "partof" ||
        normalizedKey === "containedinstructure" ||
        normalizedKey === "relatingstructure";

      if (
        nextInsideLocation &&
        SMART_VIEW_LEVEL_PROPERTY_KEYS.has(normalizedKey)
      ) {
        const directValue = readItemAttributeValue(nestedValue).trim();
        if (directValue && directValue !== "-") return directValue;
      }

      if (nextInsideLocation && isPlainRecord(nestedValue)) {
        const nameValue =
          readItemAttributeValue(nestedValue.Name) ||
          readItemAttributeValue(nestedValue.LongName);
        const typeValue = getIfcItemCategory(nestedValue, null, "").toUpperCase();

        if (typeValue === "IFCBUILDINGSTOREY" && nameValue) {
          return nameValue.trim();
        }
      }

      const found = scan(nestedValue, nextInsideLocation, depth + 1);
      if (found) return found;
    }

    return "";
  }

  return scan(item);
}
const AUTO_EXPAND_IFC_CATEGORIES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPATIALZONE"
]);
const IFC_SPATIAL_CATEGORIES = new Set([
  "IFCPROJECT",
  "IFCSITE",
  "IFCBUILDING",
  "IFCBUILDINGSTOREY",
  "IFCSPACE",
  "IFCSPATIALZONE",
  "IFCEXTERNALSPATIALELEMENT"
]);
const IFC_TYPE_GROUP_LABELS: Record<string, string> = {
  IFCBEAM: "Beams",
  IFCBUILDINGELEMENTPROXY: "Proxies",
  IFCCOLUMN: "Columns",
  IFCCOVERING: "Coverings",
  IFCDOOR: "Doors",
  IFCFOOTING: "Footings",
  IFCMEMBER: "Members",
  IFCPLATE: "Plates",
  IFCRAILING: "Railings",
  IFCRAMP: "Ramps",
  IFCRAMPFLIGHT: "Ramp Flights",
  IFCROOF: "Roofs",
  IFCSLAB: "Slabs",
  IFCSPACE: "Rooms",
  IFCSTAIR: "Stairs",
  IFCSTAIRFLIGHT: "Stairs",
  IFCWALL: "Walls",
  IFCWALLSTANDARDCASE: "Walls",
  IFCWINDOW: "Windows",
  IFCFLOWSEGMENT: "MEP Segments",
  IFCFLOWTERMINAL: "MEP Terminals",
  IFCFLOWFITTING: "MEP Fittings"
};
const IFC_TYPE_BY_WEBIFC_CODE = Object.entries(WEBIFC).reduce<Record<number, string>>(
  (result, [key, value]) => {
    if (key.startsWith("IFC") && typeof value === "number") {
      result[value] = key;
    }

    return result;
  },
  {}
);

function prettyIfcCategory(category?: string | null) {
  if (!category) return "IFC";

  return category
    .replace(/^IFC/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isSpatialIfcCategory(category?: string | null) {
  return IFC_SPATIAL_CATEGORIES.has((category ?? "").toUpperCase());
}

function isModelTreeElement(node: ModelTreeNode) {
  const normalizedType = node.type.toUpperCase();

  return (
    typeof node.localId === "number" &&
    normalizedType !== "IFC" &&
    (normalizedType === "IFCSPACE" || !isSpatialIfcCategory(normalizedType))
  );
}

function getCanonicalLevelName(value: string) {
  return value
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/^building\s*storey\s+/i, "")
    .replace(/^buildingstorey\s+/i, "")
    .replace(/^ifc\s*building\s*storey\s+/i, "")
    .trim()
    .toUpperCase();
}
function getIfcTypeGroupLabel(category?: string | null) {
  const normalizedCategory = (category ?? "IFC").toUpperCase();
  const mappedLabel = IFC_TYPE_GROUP_LABELS[normalizedCategory];

  if (mappedLabel) return mappedLabel;

  const prettyCategory = prettyIfcCategory(normalizedCategory);
  return prettyCategory.endsWith("s") ? prettyCategory : `${prettyCategory}s`;
}

function readItemAttributeValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): string {
  if (depth > 8) return "";

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 20)
      .map((item) => readItemAttributeValue(item, depth + 1, seen))
      .filter(Boolean)
      .join(", ");
  }

  if (value && typeof value === "object" && "value" in value) {
    if (seen.has(value)) return "";
    seen.add(value);
    const nestedValue = (value as { value?: unknown }).value;
    return readItemAttributeValue(nestedValue, depth + 1, seen);
  }

  return "";
}

function readItemAttributeNumber(value: unknown): number | null {
  if (typeof value === "number") return value;

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (value && typeof value === "object" && "value" in value) {
    return readItemAttributeNumber((value as { value?: unknown }).value);
  }

  return null;
}

function readIfcCategoryFromName(name: string) {
  const match = name.match(/\bIFC[A-Z0-9_]+\b/i);

  if (!match) return null;

  return match[0].replace(/_/g, "").toUpperCase();
}

function getIfcItemCategory(
  itemData: Record<string, unknown> | undefined,
  category: string | null,
  fallbackName: string
) {
  const dataCategory =
    readItemAttributeValue(itemData?._category) ||
    readItemAttributeValue(itemData?.Category) ||
    readItemAttributeValue(itemData?.type);
  const normalizedDataCategory = dataCategory.toUpperCase();

  if (normalizedDataCategory.startsWith("IFC")) {
    return normalizedDataCategory;
  }

  const typeCode =
    readItemAttributeNumber(itemData?.type) ??
    readItemAttributeNumber(itemData?.Type) ??
    readItemAttributeNumber(itemData?._type);
  const categoryFromCode =
    typeof typeCode === "number" ? IFC_TYPE_BY_WEBIFC_CODE[typeCode] : undefined;

  if (categoryFromCode) {
    return categoryFromCode;
  }

  const normalizedCategory = (category ?? "").toUpperCase();

  if (normalizedCategory && normalizedCategory !== "IFC") {
    return normalizedCategory;
  }

  return readIfcCategoryFromName(fallbackName) ?? "IFC";
}

function getIfcItemName(
  itemData: Record<string, unknown> | undefined,
  category: string | null,
  localId: number | null,
  fallbackName: string
) {
  const categoryLabel = prettyIfcCategory(category);
  const name =
    readItemAttributeValue(itemData?.Name) ||
    readItemAttributeValue(itemData?.LongName) ||
    readItemAttributeValue(itemData?.ObjectType);

  if (!name) {
    return localId === null
      ? fallbackName
      : `${categoryLabel} #${localId}`;
  }

  if (name.toLowerCase().includes(categoryLabel.toLowerCase())) {
    return name;
  }

  return `${categoryLabel} ${name}`;
}

async function getIfcItemDataMap(
  runtimeModel: RuntimeIfcModel,
  localIds: number[]
) {
  const itemDataMap = new Map<number, Record<string, unknown>>();

  if (!runtimeModel.getItemsData || localIds.length === 0) {
    return itemDataMap;
  }

  for (let index = 0; index < localIds.length; index += IFC_DATA_BATCH_SIZE) {
    const batch = localIds.slice(index, index + IFC_DATA_BATCH_SIZE);
    const itemData = await Promise.resolve(
      runtimeModel.getItemsData(batch, { attributesDefault: true })
    );

    itemData.forEach((item, itemIndex) => {
      itemDataMap.set(batch[itemIndex], item);
    });
  }

  return itemDataMap;
}

function collectIfcItemDataLocalIds(
  node: ThatOpenSpatialTreeItem,
  result: { spatial: number[]; elements: number[] } = { spatial: [], elements: [] }
) {
  if (typeof node.localId === "number") {
    if (isSpatialIfcCategory(node.category)) {
      result.spatial.push(node.localId);
    } else {
      result.elements.push(node.localId);
    }
  }

  for (const child of node.children ?? []) {
    collectIfcItemDataLocalIds(child, result);
  }

  return result;
}

function spatialTreeToModelNode(
  node: ThatOpenSpatialTreeItem,
  itemDataMap: Map<number, Record<string, unknown>>,
  fallbackName: string,
  depth = 0,
  counter: { count: number } = { count: 0 }
): ModelTreeNode | null {
  const isSpatialNode =
    node.localId === null ||
    typeof node.localId !== "number" ||
    isSpatialIfcCategory(node.category);

  if (!isSpatialNode) {
    if (counter.count >= MAX_TREE_ELEMENT_NODES) return null;
    counter.count += 1;
  }

  const localId = typeof node.localId === "number" ? node.localId : undefined;
  const itemData =
    typeof node.localId === "number" ? itemDataMap.get(node.localId) : undefined;
  const nodeType = getIfcItemCategory(itemData, node.category, fallbackName);
  const children: ModelTreeNode[] = [];

  for (const child of node.children ?? []) {
    const childNode = spatialTreeToModelNode(
      child,
      itemDataMap,
      fallbackName,
      depth + 1,
      counter
    );

    if (childNode) children.push(childNode);
  }

  return {
    id: `${node.category ?? "IFC"}:${node.localId ?? depth}:${depth}:${counter.count}`,
    name: getIfcItemName(
      itemData,
      nodeType,
      node.localId,
      depth === 0 ? fallbackName : prettyIfcCategory(node.category)
    ),
    type: nodeType,
    depth,
    localId,
    children
  };
}

async function buildIfcSpatialTree(
  runtimeModel: RuntimeIfcModel,
  fallbackName: string
) {
  if (!runtimeModel.getSpatialStructure) {
    throw new Error("El modelo no expone getSpatialStructure().");
  }

  const spatialRoot = await Promise.resolve(runtimeModel.getSpatialStructure());

  if (!spatialRoot) {
    throw new Error("El modelo no contiene SpatialTreeItem.");
  }

  const localIdGroups = collectIfcItemDataLocalIds(spatialRoot);
  const localIds = Array.from(
    new Set([
      ...localIdGroups.spatial,
      ...localIdGroups.elements.slice(0, MAX_TREE_ELEMENT_NODES)
    ])
  );
  const itemDataMap = await getIfcItemDataMap(runtimeModel, localIds);
  const rootNode = spatialTreeToModelNode(spatialRoot, itemDataMap, fallbackName);

  return rootNode ? [rootNode] : [];
}

function countModelTreeNodes(nodes: ModelTreeNode[]): number {
  return nodes.reduce(
    (total, node) => total + 1 + countModelTreeNodes(node.children),
    0
  );
}

function collectModelTreeLocalIds(node: ModelTreeNode, result = new Set<number>()) {
  if (typeof node.localId === "number") {
    result.add(node.localId);
  }

  for (const localId of node.aggregateLocalIds ?? []) {
    result.add(localId);
  }

  for (const child of node.children) {
    collectModelTreeLocalIds(child, result);
  }

  return result;
}

function createTreeGroupChildren(children: ModelTreeNode[]) {
  const aggregateLocalIds = children
    .map((child) => child.localId)
    .filter((localId): localId is number => typeof localId === "number");
  const visibleChildren = children.slice(0, MAX_RENDERED_TREE_GROUP_CHILDREN);

  return {
    aggregateLocalIds,
    children: visibleChildren,
    truncatedChildrenCount: Math.max(0, children.length - visibleChildren.length)
  };
}

function flattenModelTreeNodes(nodes: ModelTreeNode[], result: ModelTreeNode[] = []) {
  for (const node of nodes) {
    result.push(node);
    flattenModelTreeNodes(node.children, result);
  }

  return result;
}

function cloneTreeNodeWithDepth(node: ModelTreeNode, depth: number): ModelTreeNode {
  return {
    ...node,
    depth,
    children: node.children.map((child) => cloneTreeNodeWithDepth(child, depth + 1))
  };
}

function groupTreeByType(nodes: ModelTreeNode[]): ModelTreeNode[] {
  const groups = new Map<string, ModelTreeNode[]>();

  for (const node of flattenModelTreeNodes(nodes)) {
    if (!isModelTreeElement(node)) continue;

    const type = (node.type || "IFC").toUpperCase();
    const label = getIfcTypeGroupLabel(type);
    const group = groups.get(label) ?? [];
    group.push({ ...node, depth: 1, children: [] });
    groups.set(label, group);
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, children], index) => {
      const groupChildren = createTreeGroupChildren(children.filter(Boolean) as ModelTreeNode[]);

      return {
        id: `type:${label}:${index}`,
        name: `${label} (${children.length})`,
        type: "IFCTYPEGROUP",
        depth: 0,
        ...groupChildren
      } satisfies ModelTreeNode;
    });
}

function groupTreeByPropertyLevels(
  nodes: ModelTreeNode[],
  propertyLevels: Record<string, number[]> = {}
) {
  const nodeByLocalId = new Map<number, ModelTreeNode>();
  const knownLocalIds = new Set<number>();

  for (const node of flattenModelTreeNodes(nodes)) {
    if (typeof node.localId !== "number") continue;
    knownLocalIds.add(node.localId);

    if (isModelTreeElement(node)) {
      nodeByLocalId.set(node.localId, node);
    }
  }

  return Object.entries(propertyLevels)
    .map(([levelName, localIds], index) => {
      const uniqueLocalIds = Array.from(new Set(localIds));
      const children = uniqueLocalIds.map((localId) => {
        const sourceNode = nodeByLocalId.get(localId);

        if (sourceNode) return { ...sourceNode, depth: 1, children: [] };
        if (knownLocalIds.has(localId)) return null;

        return {
          id: `level-property:${levelName}:${localId}`,
          name: `Elemento ${localId}`,
          type: "IFCSPACE",
          depth: 1,
          localId,
          children: []
        };
      });

      const groupChildren = createTreeGroupChildren(children.filter(Boolean) as ModelTreeNode[]);

      return {
        id: `level-property:${levelName}:${index}`,
        name: `${levelName} (${children.length})`,
        type: "IFCBUILDINGSTOREY",
        depth: 0,
        ...groupChildren
      } satisfies ModelTreeNode;
    })
    .filter((level) => level.children.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}

function groupTreeByLevel(
  nodes: ModelTreeNode[],
  propertyLevels: Record<string, number[]> = {}
) {
  const propertyLevelGroups = groupTreeByPropertyLevels(nodes, propertyLevels);
  const levels: ModelTreeNode[] = [];

  function isBuildingStoreyNode(node: ModelTreeNode) {
    return node.type.toUpperCase() === "IFCBUILDINGSTOREY";
  }

  function collectLevelElements(node: ModelTreeNode, result: ModelTreeNode[] = []) {
    for (const child of node.children) {
      if (isBuildingStoreyNode(child)) continue;

      if (isModelTreeElement(child)) {
        result.push({ ...child, depth: 1, children: [] });
      }

      collectLevelElements(child, result);
    }

    return result;
  }

  function visit(node: ModelTreeNode) {
    if (isBuildingStoreyNode(node)) {
      const children = collectLevelElements(node);

      if (children.length > 0) {
        const groupChildren = createTreeGroupChildren(children.filter(Boolean) as ModelTreeNode[]);

        levels.push({
          ...node,
          id: `level:${node.id}`,
          name: `${node.name} (${children.length})`,
          depth: 0,
          ...groupChildren
        });
      }
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  for (const node of nodes) {
    visit(node);
  }

  const existingNames = new Set(
    levels.map((level) => getCanonicalLevelName(level.name))
  );
  const propertyOnlyLevels = propertyLevelGroups.filter((level) => {
    const cleanName = getCanonicalLevelName(level.name);
    return cleanName && !existingNames.has(cleanName);
  });

  return [...levels, ...propertyOnlyLevels].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

function collectLeafLevelNodes(nodes: ModelTreeNode[]) {
  const levels: ModelTreeNode[] = [];

  function isBuildingStoreyNode(node: ModelTreeNode) {
    return node.type.toUpperCase() === "IFCBUILDINGSTOREY";
  }

  function visit(node: ModelTreeNode) {
    if (isBuildingStoreyNode(node)) {
      levels.push(node);
    }

    for (const child of node.children) {
      visit(child);
    }
  }

  for (const node of nodes) {
    visit(node);
  }

  return levels;
}

function getElementLevelName(nodes: ModelTreeNode[], localId: number) {
  let levelName = "";

  function visit(node: ModelTreeNode, currentLevel: string) {
    const nextLevel =
      node.type.toUpperCase() === "IFCBUILDINGSTOREY" ? node.name : currentLevel;

    if (node.localId === localId) {
      levelName = nextLevel;
      return;
    }

    for (const child of node.children) {
      if (levelName) return;
      visit(child, nextLevel);
    }
  }

  for (const node of nodes) {
    if (levelName) break;
    visit(node, "");
  }

  return levelName;
}

function normalizeViewMatchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findStoreyNodeByViewName(
  models: FederatedModelEntry[],
  viewName: string
) {
  const normalizedViewName = normalizeViewMatchText(viewName);

  for (const model of models) {
    for (const level of collectLeafLevelNodes(model.spatialTree ?? [])) {
      const normalizedLevelName = normalizeViewMatchText(level.name);
      const matches =
        normalizedViewName.includes(normalizedLevelName) ||
        normalizedLevelName.includes(normalizedViewName);

      if (matches) {
        return { model, node: level };
      }
    }
  }

  return null;
}

function buildElementLevelMap(nodes: ModelTreeNode[]) {
  const result = new Map<number, string>();

  function visit(node: ModelTreeNode, currentLevel: string) {
    const nextLevel =
      node.type.toUpperCase() === "IFCBUILDINGSTOREY" ? node.name : currentLevel;

    if (isModelTreeElement(node) && typeof node.localId === "number") {
      result.set(node.localId, nextLevel);
    }

    for (const child of node.children) {
      visit(child, nextLevel);
    }
  }

  for (const node of nodes) {
    visit(node, "");
  }

  return result;
}

function readSearchableText(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>()
): string {
  if (value === null || value === undefined) return "";
  if (depth > 4) return "";

  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, 80)
      .map((item) => readSearchableText(item, depth + 1, seen))
      .filter(Boolean)
      .join(" ");
  }

  if (typeof value === "object") {
    if (seen.has(value)) return "";
    seen.add(value);

    return Object.entries(value as Record<string, unknown>)
      .slice(0, 120)
      .map(
        ([key, nestedValue]) =>
          `${key} ${readSearchableText(nestedValue, depth + 1, seen)}`
      )
      .filter(Boolean)
      .join(" ");
  }

  return "";
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getSmartViewRelationTarget(
  relation: Record<string, unknown>,
  targetKeys: string[]
) {
  for (const key of targetKeys) {
    if (isPlainRecord(relation[key])) {
      return relation[key] as Record<string, unknown>;
    }
  }

  return relation;
}

function getSmartViewSectionTitle(
  value: Record<string, unknown>,
  fallback: string
) {
  return (
    readItemAttributeValue(value.Name) ||
    readItemAttributeValue(value.LongName) ||
    readItemAttributeValue(value._category) ||
    fallback
  );
}

function extractSmartViewPropertySets(item: Record<string, unknown>) {
  const sets: Record<string, unknown>[] = [];
  const seenSets = new WeakSet<object>();

  function addSet(candidate: unknown) {
    if (!isPlainRecord(candidate)) return;
    if (seenSets.has(candidate)) return;
    if (sets.length >= MAX_SMART_VIEW_PROPERTY_SETS_PER_ITEM) return;

    if (
      Array.isArray(candidate.HasProperties) ||
      Array.isArray(candidate.HasQuantities) ||
      Array.isArray(candidate.Properties) ||
      Array.isArray(candidate.Quantities)
    ) {
      seenSets.add(candidate);
      sets.push(candidate);
    }
  }

  function addDirectSetsFromRecord(candidate: unknown) {
    if (!isPlainRecord(candidate)) return;

    addSet(candidate);

    for (const key of [
      "HasPropertySets",
      "PropertySets",
      "HasPropertySet",
      "RelatingPropertyDefinition"
    ]) {
      const nested = candidate[key];

      if (Array.isArray(nested)) {
        for (const item of nested.slice(0, MAX_SMART_VIEW_PROPERTY_SETS_PER_ITEM)) {
          addSet(item);
        }
      } else {
        addSet(nested);
      }
    }
  }

  for (const relation of Array.isArray(item.IsDefinedBy)
    ? item.IsDefinedBy.filter(isPlainRecord)
    : []) {
    addDirectSetsFromRecord(
      getSmartViewRelationTarget(relation, ["RelatingPropertyDefinition"])
    );
  }

  for (const relation of Array.isArray(item.IsTypedBy)
    ? item.IsTypedBy.filter(isPlainRecord)
    : []) {
    addDirectSetsFromRecord(getSmartViewRelationTarget(relation, ["RelatingType"]));
  }

  return sets;
}
function getSmartViewPropertyCandidates(pset: Record<string, unknown>) {
  const candidates: unknown[] = [];

  for (const key of [
    "HasProperties",
    "HasQuantities",
    "Properties",
    "Quantities"
  ]) {
    if (Array.isArray(pset[key])) {
      candidates.push(
        ...(pset[key] as unknown[]).slice(0, MAX_SMART_VIEW_PROPERTIES_PER_SET)
      );
    }
  }

  return candidates.slice(0, MAX_SMART_VIEW_PROPERTIES_PER_SET);
}

function getSmartViewPropertyValue(prop: Record<string, unknown>) {
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

  const lower =
    "LowerBoundValue" in prop ? readItemAttributeValue(prop.LowerBoundValue) : "";
  const upper =
    "UpperBoundValue" in prop ? readItemAttributeValue(prop.UpperBoundValue) : "";
  if (lower || upper) return `${lower || "-"} - ${upper || "-"}`;

  for (const key of valueKeys) {
    if (key in prop) return readItemAttributeValue(prop[key]);
  }

  return "";
}

function normalizeIfcPropertyName(value: string) {
  return value.trim().toLowerCase().replace(/[\s_\-./]/g, "");
}

function parseIfcMetricNumber(value: unknown): number | null {
  const direct = readItemAttributeNumber(value);
  if (direct !== null && Number.isFinite(direct)) return direct;

  const text = readItemAttributeValue(value).trim();
  if (!text) return null;

  const match = text.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) return null;

  const parsed = Number(match[0].replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function getAreaPropertyScore(
  setName: string,
  propertyName: string,
  prop: Record<string, unknown>
) {
  const normalizedSet = normalizeIfcPropertyName(setName);
  const normalizedName = normalizeIfcPropertyName(propertyName);
  const isQuantity =
    Array.isArray(prop.HasQuantities) ||
    "AreaValue" in prop ||
    normalizedSet.startsWith("qto") ||
    normalizedSet.includes("quantity");
  const priorityIndex = AREA_PROPERTY_PRIORITY.findIndex(
    (name) => normalizedName === name || normalizedName.endsWith(name)
  );

  if (priorityIndex < 0) return null;

  return (isQuantity ? 0 : 100) + priorityIndex;
}

function readAreaPropertyCandidate(prop: Record<string, unknown>) {
  for (const key of AREA_VALUE_KEYS) {
    if (key in prop) {
      const value = parseIfcMetricNumber(prop[key]);
      if (value !== null && value > 0) return value;
    }
  }

  return null;
}

function getIfcAreaMetricFromItem(item: Record<string, unknown>) {
  let best:
    | {
        value: number;
        source: SelectionAreaMetric["source"];
        label: string;
        score: number;
      }
    | null = null;

  for (const pset of extractSmartViewPropertySets(item)) {
    const setName = getSmartViewSectionTitle(pset, "Property Set");

    for (const candidate of getSmartViewPropertyCandidates(pset)) {
      if (!isPlainRecord(candidate)) continue;

      const propertyName = readItemAttributeValue(candidate.Name);
      if (!propertyName) continue;

      const score = getAreaPropertyScore(setName, propertyName, candidate);
      if (score === null) continue;

      const value = readAreaPropertyCandidate(candidate);
      if (value === null) continue;

      const source: SelectionAreaMetric["source"] =
        score < 100 ? "ifc-quantity" : "parameter";

      if (!best || score < best.score) {
        best = {
          value,
          source,
          label: `${setName}.${propertyName}`,
          score
        };
      }
    }
  }

  return best;
}

async function getIfcItemsDataForMeasurement(
  runtimeModel: RuntimeIfcModel,
  localIds: number[]
) {
  if (!runtimeModel.getItemsData || localIds.length === 0) return [];

  try {
    return (await Promise.resolve(
      runtimeModel.getItemsData(localIds, {
        attributesDefault: true,
        relations: {
          IsDefinedBy: {
            attributes: true,
            relations: true
          },
          IsTypedBy: {
            attributes: true,
            relations: true
          }
        }
      })
    )) as Record<string, unknown>[];
  } catch {
    return (await Promise.resolve(
      runtimeModel.getItemsData(localIds, { attributesDefault: true })
    )) as Record<string, unknown>[];
  }
}

function collectSmartViewPropertyPairs(
  value: unknown,
  result = new Map<string, Map<string, Set<string>>>()
) {
  if (!isPlainRecord(value) && !Array.isArray(value)) return result;

  if (Array.isArray(value)) {
    for (const item of value.slice(0, MAX_SMART_VIEW_NESTED_ARRAY_SCAN)) {
      collectSmartViewPropertyPairs(item, result);
    }

    return result;
  }

  const record = value as Record<string, unknown>;
  const psets = extractSmartViewPropertySets(record);

  for (const pset of psets.slice(0, MAX_SMART_VIEW_PROPERTY_SETS_PER_ITEM)) {
    const setName = getSmartViewSectionTitle(pset, "Property Set");
    const properties = result.get(setName) ?? new Map<string, Set<string>>();

    for (const candidate of getSmartViewPropertyCandidates(pset).slice(
      0,
      MAX_SMART_VIEW_PROPERTIES_PER_SET
    )) {
      if (!isPlainRecord(candidate)) continue;

      const propertyName = readItemAttributeValue(candidate.Name);
      const propertyValue = getSmartViewPropertyValue(candidate);

      if (!propertyName || isSmartViewInternalPropertyKey(propertyName)) continue;

      const values = properties.get(propertyName) ?? new Set<string>();
      values.add(propertyValue || "-");
      properties.set(propertyName, values);
    }

    for (const [key, nestedValue] of Object.entries(pset).slice(
      0,
      MAX_SMART_VIEW_PROPERTIES_PER_SET
    )) {
      if (
        key.startsWith("__") ||
        isSmartViewInternalPropertyKey(key) ||
        [
          "Name",
          "LongName",
          "HasProperties",
          "HasQuantities",
          "Properties",
          "Quantities",
          "OwnerHistory"
        ].includes(key)
      ) {
        continue;
      }

      const primitiveValue =
        typeof nestedValue === "string" ||
        typeof nestedValue === "number" ||
        typeof nestedValue === "boolean"
          ? String(nestedValue)
          : readItemAttributeValue(nestedValue);

      if (!primitiveValue) continue;

      const values = properties.get(key) ?? new Set<string>();
      values.add(primitiveValue);
      properties.set(key, values);
    }

    if (properties.size > 0) {
      result.set(setName, properties);
    }
  }

  const attributesSetName = "Atributos IFC";
  const attributes = result.get(attributesSetName) ?? new Map<string, Set<string>>();

  for (const [key, nestedValue] of Object.entries(record)) {
    if (key.startsWith("__")) continue;

    const primitiveValue =
      typeof nestedValue === "string" ||
      typeof nestedValue === "number" ||
      typeof nestedValue === "boolean"
        ? String(nestedValue)
        : "";

    if (
      primitiveValue &&
      !isSmartViewInternalPropertyKey(key)
    ) {
      const values = attributes.get(key) ?? new Set<string>();
      values.add(primitiveValue);
      attributes.set(key, values);
    }
  }

  if (attributes.size > 0) {
    result.set(attributesSetName, attributes);
  }

  return result;
}

function itemMatchesSmartViewProperty(
  item: Record<string, unknown> | undefined,
  propertySet: string,
  propertyName: string,
  propertyValue: string
) {
  if (!item || !propertySet || !propertyName) return true;

  const index = collectSmartViewPropertyPairs(item);
  const properties = index.get(propertySet);
  const values = properties?.get(propertyName);
  if (!values) return false;
  if (!propertyValue) return true;

  return Array.from(values).some(
    (value) => value.toLowerCase() === propertyValue.toLowerCase()
  );
}

function smartViewPropertyPairsToRecord(
  pairs: Map<string, Map<string, Set<string>>>
) {
  const result: Record<string, Record<string, string[]>> = {};

  for (const [setName, properties] of pairs) {
    result[setName] = {};

    for (const [propertyName, values] of properties) {
      result[setName][propertyName] = Array.from(values).filter(Boolean);
    }
  }

  return result;
}

function findSmartViewPropertyValueByNames(
  pairs: Map<string, Map<string, Set<string>>>,
  propertyNames: string[]
) {
  const targets = new Set(propertyNames.map(normalizeSmartViewPropertyKey));

  for (const properties of pairs.values()) {
    for (const [propertyName, values] of properties) {
      if (!targets.has(normalizeSmartViewPropertyKey(propertyName))) continue;

      const value = Array.from(values).find(
        (item) => item.trim() && item.trim() !== "-"
      );
      if (value) return value.trim();
    }
  }

  return "";
}

function getCost5DElementIdentity(
  item: Record<string, unknown>,
  pairs: Map<string, Map<string, Set<string>>>,
  modelKey: string,
  localId: number
) {
  const elementId = findSmartViewPropertyValueByNames(pairs, [
    "ID elemento",
    "ID Elemento",
    "ID de elemento",
    "Id de elemento",
    "ID Element",
    "Element ID",
    "ElementId",
    "Revit ID",
    "RevitId",
    "Tag",
    "Marca"
  ]);

  if (elementId) return `${modelKey}:element:${elementId}`;

  const directTag =
    readItemAttributeValue(item.Tag) ||
    readItemAttributeValue(item.TagValue) ||
    readItemAttributeValue(item.ObjectType);

  if (directTag) return `${modelKey}:tag:${directTag}`;

  const globalId =
    readItemAttributeValue(item.GlobalId) ||
    readItemAttributeValue(item.GlobalID) ||
    readItemAttributeValue(item.globalId) ||
    readItemAttributeValue(item._guid);

  if (globalId) return `${modelKey}:global:${globalId}`;

  return `${modelKey}:local:${localId}`;
}

function getAuditPropertyValues(
  record: AuditElementRecord,
  propertySet: string,
  propertyName: string
) {
  return record.properties[propertySet]?.[propertyName] ?? [];
}

function isAuditEmptyValue(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "-" || normalized === "--" || normalized === "n/a";
}

function evaluateAuditRuleForRecord(rule: AuditRule, record: AuditElementRecord) {
  const values =
    rule.propertySet && rule.propertyName
      ? getAuditPropertyValues(record, rule.propertySet, rule.propertyName)
      : [];
  const normalizedExpected = rule.value.trim().toLowerCase();
  const normalizedValues = values.map((value) => value.trim().toLowerCase());
  const hasProperty = values.length > 0;
  const hasNonEmptyValue = values.some((value) => !isAuditEmptyValue(value));
  let passes = true;

  switch (rule.operator) {
    case "exists":
      passes = hasProperty;
      break;
    case "missing":
      passes = !hasProperty;
      break;
    case "equals":
      passes =
        hasProperty &&
        normalizedValues.some((value) => value === normalizedExpected);
      break;
    case "not_equals":
      passes =
        hasProperty &&
        normalizedValues.every((value) => value !== normalizedExpected);
      break;
    case "contains":
      passes =
        hasProperty &&
        normalizedValues.some((value) => value.includes(normalizedExpected));
      break;
    case "empty":
      passes = !hasNonEmptyValue;
      break;
    case "not_empty":
      passes = hasNonEmptyValue;
      break;
    default:
      passes = true;
  }

  return {
    passes,
    actualValue: values.length > 0 ? values.join(" | ") : "-"
  };
}

function getAuditSummary(results: AuditResult[]): AuditSummary {
  const summary: AuditSummary = {
    total: results.length,
    passed: results.filter((result) => result.status === "pass").length,
    failed: results.filter((result) => result.status === "fail").length,
    byRule: [],
    byType: [],
    byLevel: [],
    byModel: []
  };

  function addToBucket(
    bucket: Map<string, { name: string; pass: number; fail: number }>,
    name: string,
    status: AuditResult["status"]
  ) {
    const key = name || "-";
    const entry = bucket.get(key) ?? { name: key, pass: 0, fail: 0 };

    if (status === "pass") entry.pass += 1;
    else entry.fail += 1;

    bucket.set(key, entry);
  }

  const byRule = new Map<string, { name: string; pass: number; fail: number }>();
  const byType = new Map<string, { name: string; pass: number; fail: number }>();
  const byLevel = new Map<string, { name: string; pass: number; fail: number }>();
  const byModel = new Map<string, { name: string; pass: number; fail: number }>();

  for (const result of results) {
    addToBucket(byRule, result.ruleName, result.status);
    addToBucket(byType, prettyIfcCategory(result.type), result.status);
    addToBucket(byLevel, result.level, result.status);
    addToBucket(byModel, result.modelName, result.status);
  }

  const sortByFail = (a: { fail: number }, b: { fail: number }) => b.fail - a.fail;
  summary.byRule = Array.from(byRule.values()).sort(sortByFail);
  summary.byType = Array.from(byType.values()).sort(sortByFail).slice(0, 12);
  summary.byLevel = Array.from(byLevel.values()).sort(sortByFail).slice(0, 12);
  summary.byModel = Array.from(byModel.values()).sort(sortByFail).slice(0, 12);

  return summary;
}

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadTextFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildAuditCsv(results: AuditResult[]) {
  const headers = [
    "Estado",
    "Regla",
    "Severidad",
    "Modelo",
    "Nivel",
    "Clase IFC",
    "Elemento",
    "LocalId",
    "GlobalId",
    "Conjunto",
    "Propiedad",
    "Valor actual",
    "Mensaje"
  ];
  const rows = results.map((result) => [
    result.status === "pass" ? "Cumple" : "Falla",
    result.ruleName,
    result.severity,
    result.modelName,
    result.level,
    result.type,
    result.elementName,
    result.localId,
    result.globalId,
    result.propertySet,
    result.propertyName,
    result.actualValue,
    result.message
  ]);

  return [headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\\n");
}

function buildAuditHtmlReport({
  title,
  results,
  generatedAt
}: {
  title: string;
  results: AuditResult[];
  generatedAt: string;
}) {
  const summary = getAuditSummary(results);
  const failRate = summary.total > 0 ? Math.round((summary.failed / summary.total) * 100) : 0;
  const rows = results
    .slice(0, 1000)
    .map(
      (result) => `
        <tr>
          <td>${result.status === "pass" ? "Cumple" : "Falla"}</td>
          <td>${result.ruleName}</td>
          <td>${result.modelName}</td>
          <td>${result.level || "-"}</td>
          <td>${prettyIfcCategory(result.type)}</td>
          <td>${result.elementName}</td>
          <td>${result.localId}</td>
          <td>${result.propertySet} / ${result.propertyName}</td>
          <td>${result.actualValue}</td>
        </tr>`
    )
    .join("");
  const chartRows = summary.byRule
    .map((item) => {
      const total = Math.max(item.pass + item.fail, 1);
      const width = Math.round((item.fail / total) * 100);
      return `<div class="bar-row"><span>${item.name}</span><div><i style="width:${width}%"></i></div><strong>${item.fail}</strong></div>`;
    })
    .join("");

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <title>${title}</title>
  <style>
    body{font-family:Arial,sans-serif;margin:32px;color:#172033;background:#f6f7f9}
    h1{margin:0 0 6px;font-size:24px} .muted{color:#667085;font-size:12px}
    .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}
    .kpi{background:white;border:1px solid #d7dce3;padding:14px}
    .kpi b{display:block;font-size:26px;margin-top:8px}.bad{color:#e30613}.good{color:#1f9d55}
    .panel{background:white;border:1px solid #d7dce3;padding:16px;margin:16px 0}
    .bar-row{display:grid;grid-template-columns:220px 1fr 50px;gap:10px;align-items:center;margin:8px 0;font-size:12px}
    .bar-row div{height:12px;background:#eceff3}.bar-row i{display:block;height:12px;background:#e30613}
    table{width:100%;border-collapse:collapse;background:white;font-size:11px}
    th,td{border:1px solid #d7dce3;padding:6px;text-align:left;vertical-align:top} th{background:#eef1f5}
    @media print{body{background:white;margin:18mm}.panel,.kpi,table{break-inside:avoid}}
  </style>
</head>
<body>
  <h1>${title}</h1>
  <div class="muted">Generado: ${generatedAt}</div>
  <section class="kpis">
    <div class="kpi">Elementos evaluados<b>${summary.total}</b></div>
    <div class="kpi">Cumplen<b class="good">${summary.passed}</b></div>
    <div class="kpi">Fallan<b class="bad">${summary.failed}</b></div>
    <div class="kpi">Falla %<b class="bad">${failRate}%</b></div>
  </section>
  <section class="panel"><h2>Fallas por requisito</h2>${chartRows || "<p>Sin datos.</p>"}</section>
  <section class="panel"><h2>Resultados</h2><table><thead><tr><th>Estado</th><th>Regla</th><th>Modelo</th><th>Nivel</th><th>Clase</th><th>Elemento</th><th>LocalId</th><th>Propiedad</th><th>Valor</th></tr></thead><tbody>${rows}</tbody></table></section>
</body>
</html>`;
}

function getTreeNodesForMode(
  nodes: ModelTreeNode[],
  mode: ModelTreeMode,
  propertyLevels: Record<string, number[]> = {}
) {
  if (mode === "type") return groupTreeByType(nodes);
  if (mode === "level") return groupTreeByLevel(nodes, propertyLevels);
  return nodes.map((node) => cloneTreeNodeWithDepth(node, 0));
}

function collectDefaultExpandedTreeNodeIds(
  nodes: ModelTreeNode[],
  result = new Set<string>()
) {
  for (const node of nodes) {
    const normalizedType = node.type.toUpperCase();
    const shouldExpand =
      node.children.length > 0 &&
      (node.depth < 2 || AUTO_EXPAND_IFC_CATEGORIES.has(normalizedType));

    if (shouldExpand) {
      result.add(node.id);
      collectDefaultExpandedTreeNodeIds(node.children, result);
    }
  }

  return result;
}

function PanelIcon({
  name,
  className = "h-4 w-4"
}: {
  name:
    | "eye"
    | "eyeOff"
    | "trash"
    | "focus"
    | "isolate"
    | "filter"
    | "plus";
  className?: string;
}) {
  const commonProps = {
    className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "eye") {
    return (
      <svg {...commonProps}>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (name === "eyeOff") {
    return (
      <svg {...commonProps}>
        <path d="m3 3 18 18" />
        <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
        <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-3.1 4.4" />
        <path d="M6.6 6.6C3.6 8.7 2 12 2 12s3.5 8 10 8a10.7 10.7 0 0 0 4.1-.8" />
      </svg>
    );
  }

  if (name === "trash") {
    return (
      <svg {...commonProps}>
        <path d="M3 6h18" />
        <path d="M8 6V4h8v2" />
        <path d="M19 6 18 20H6L5 6" />
        <path d="M10 11v5" />
        <path d="M14 11v5" />
      </svg>
    );
  }

  if (name === "focus") {
    return (
      <svg {...commonProps}>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    );
  }

  if (name === "isolate") {
    return (
      <svg {...commonProps}>
        <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
        <path d="M12 11 4.5 7.2" />
        <path d="M12 11v10" />
        <path d="m12 11 7.5-3.8" />
      </svg>
    );
  }

  if (name === "filter") {
    return (
      <svg {...commonProps}>
        <path d="M4 5h16l-6 7v5l-4 2v-7L4 5Z" />
      </svg>
    );
  }

  return (
    <svg {...commonProps}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}

function ModelTreeRows({
  nodes,
  expandedNodes,
  selectedNodeId,
  hiddenNodeIds,
  onToggleNode,
  onSelectNode,
  onIsolateNode,
  onToggleNodeVisibility
}: {
  nodes: ModelTreeNode[];
  expandedNodes: Set<string>;
  selectedNodeId?: string;
  hiddenNodeIds: Set<string>;
  onToggleNode: (id: string) => void;
  onSelectNode: (node: ModelTreeNode) => void;
  onIsolateNode: (node: ModelTreeNode) => void;
  onToggleNodeVisibility: (node: ModelTreeNode) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const hasChildren = node.children.length > 0;
        const isExpanded = expandedNodes.has(node.id);
        const isSelected = selectedNodeId === node.id;
        const isHidden = hiddenNodeIds.has(node.id);

        return (
          <div key={node.id}>
            <div
              className={`grid grid-cols-[20px_1fr_22px_22px] items-center gap-1 py-1 text-xs ${
                isSelected
                  ? "bg-red-950/70 text-white"
                  : "text-zinc-300 hover:bg-zinc-800"
              }`}
              style={{ paddingLeft: `${8 + node.depth * 14}px` }}
            >
              <button
                type="button"
                onClick={() => hasChildren && onToggleNode(node.id)}
                className="flex h-5 w-5 items-center justify-center text-zinc-400 hover:text-white disabled:opacity-30"
                disabled={!hasChildren}
                aria-label={isExpanded ? "Colapsar" : "Expandir"}
              >
                {hasChildren ? (isExpanded ? "v" : ">") : ""}
              </button>

              <button
                type="button"
                onClick={() => onSelectNode(node)}
                className="min-w-0 text-left"
                disabled={typeof node.localId !== "number"}
                title={
                  typeof node.localId === "number"
                    ? "Seleccionar en el visor"
                    : "Nodo sin geometria seleccionable"
                }
              >
                <div className="truncate text-zinc-200">{node.name}</div>
                <div className="truncate text-[10px] text-zinc-500">
                  {node.type}
                </div>
              </button>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onIsolateNode(node);
                }}
                className="flex h-5 w-5 items-center justify-center text-zinc-500 hover:text-sky-300"
                title="Aislar rama"
              >
                <PanelIcon name="filter" />
              </button>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleNodeVisibility(node);
                }}
                className={`flex h-5 w-5 items-center justify-center hover:text-white ${
                  isHidden ? "text-zinc-600" : "text-zinc-500"
                }`}
                title={isHidden ? "Mostrar rama" : "Ocultar rama"}
              >
                <PanelIcon name={isHidden ? "eyeOff" : "eye"} />
              </button>
            </div>

            {hasChildren && isExpanded ? (
              <>
                <ModelTreeRows
                  nodes={node.children}
                  expandedNodes={expandedNodes}
                  selectedNodeId={selectedNodeId}
                  hiddenNodeIds={hiddenNodeIds}
                  onToggleNode={onToggleNode}
                  onSelectNode={onSelectNode}
                  onIsolateNode={onIsolateNode}
                  onToggleNodeVisibility={onToggleNodeVisibility}
                />
                {node.truncatedChildrenCount ? (
                  <div
                    className="px-3 py-1 text-[10px] text-zinc-500"
                    style={{ paddingLeft: `${28 + node.depth * 14}px` }}
                  >
                    Mostrando {node.children.length} de{" "}
                    {node.children.length + node.truncatedChildrenCount}. Las
                    acciones se aplican a toda la rama.
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        );
      })}
    </>
  );
}

function ViewerStatsOverlay({ stats }: { stats: ViewerPerformanceStats }) {
  const heapRatio =
    stats.heapUsedMb !== null && stats.heapLimitMb
      ? stats.heapUsedMb / stats.heapLimitMb
      : null;
  const heapPressure =
    heapRatio !== null && heapRatio >= 0.8
      ? "Alta"
      : heapRatio !== null && heapRatio >= 0.6
      ? "Media"
      : "Normal";
  const heapText =
    stats.heapUsedMb === null
      ? "n/d"
      : `${stats.heapUsedMb} / ${stats.heapLimitMb ?? "?"} MB`;
  const loadText = stats.loadMs === null ? "n/d" : `${stats.loadMs} ms`;

  return (
    <div className="pointer-events-none absolute left-3 top-14 z-30 min-w-[210px] rounded border border-zinc-700/80 bg-zinc-950/90 px-3 py-2 text-[11px] text-zinc-300 shadow-xl backdrop-blur">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-semibold uppercase tracking-wide text-zinc-100">
          Stats
        </span>
        <span
          className={
            stats.fps >= 45
              ? "text-emerald-300"
              : stats.fps >= 25
              ? "text-amber-300"
              : "text-red-300"
          }
        >
          {stats.fps} FPS
        </span>
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        <span className="text-zinc-500">Heap</span>
        <span
          className={`text-right tabular-nums ${
            heapPressure === "Alta"
              ? "text-red-300"
              : heapPressure === "Media"
              ? "text-amber-300"
              : ""
          }`}
        >
          {heapText}
        </span>
        <span className="text-zinc-500">Memoria</span>
        <span
          className={`text-right ${
            heapPressure === "Alta"
              ? "text-red-300"
              : heapPressure === "Media"
              ? "text-amber-300"
              : "text-emerald-300"
          }`}
        >
          {heapPressure}
        </span>
        <span className="text-zinc-500">Carga</span>
        <span className="text-right tabular-nums">{loadText}</span>
        <span className="text-zinc-500">Modelos</span>
        <span className="text-right tabular-nums">
          {stats.visibleModels}/{stats.loadedModels}
        </span>
        <span className="text-zinc-500">Arbol</span>
        <span className="text-right tabular-nums">{stats.treeNodes}</span>
        <span className="text-zinc-500">Geometrias</span>
        <span className="text-right tabular-nums">
          {stats.geometries ?? "n/d"}
        </span>
        <span className="text-zinc-500">Texturas</span>
        <span className="text-right tabular-nums">{stats.textures ?? "n/d"}</span>
        <span className="text-zinc-500">Triangulos</span>
        <span className="text-right tabular-nums">
          {stats.triangles ?? "n/d"}
        </span>
        <span className="text-zinc-500">Draw calls</span>
        <span className="text-right tabular-nums">{stats.calls ?? "n/d"}</span>
      </div>
    </div>
  );
}

function IfcModelsPanel({
  models,
  onToggleModelVisibility,
  onToggleModelExpanded,
  onRemoveModel,
  onFocusModel,
  onIsolateModel
}: {
  models: FederatedModelEntry[];
  onToggleModelVisibility: (key: string) => void;
  onToggleModelExpanded: (key: string) => void;
  onRemoveModel: (key: string) => void;
  onFocusModel: (key: string) => void;
  onIsolateModel: (key: string) => void;
}) {
  return (
    <section className="border-b border-zinc-300 bg-zinc-100">
      <div className="flex items-center justify-between border-b border-zinc-300 bg-zinc-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-zinc-800">Modelos</h3>
        <span className="text-xs text-zinc-500">{models.length}</span>
      </div>

      <div className="max-h-64 overflow-y-auto">
        {models.length === 0 ? (
          <div className="px-3 py-3 text-sm text-zinc-500">
            Aun no hay modelos cargados.
          </div>
        ) : (
          <div className="divide-y divide-zinc-200">
            {models.map((model) => (
              <div key={model.key} className="bg-white">
                <div
                  className={`flex items-center gap-2 px-3 py-2 ${
                    model.isSelected ? "bg-amber-50" : ""
                  }`}
                >
                  <ExpandButton
                    expanded={model.expanded}
                    onClick={() => onToggleModelExpanded(model.key)}
                  />

                  <ModelVisibilityButton
                    visible={model.visible}
                    onClick={() => onToggleModelVisibility(model.key)}
                  />

                  <button
                    type="button"
                    onClick={() => onFocusModel(model.key)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
                    title="Enfocar modelo"
                    aria-label="Enfocar modelo"
                  >F</button>

                  <button
                    type="button"
                    onClick={() => onIsolateModel(model.key)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
                    title="Aislar modelo"
                    aria-label="Aislar modelo"
                  >I</button>

                  <button
                    type="button"
                    onClick={() => onRemoveModel(model.key)}
                    className="inline-flex h-8 w-8 items-center justify-center border border-zinc-300 bg-white text-sm text-zinc-700 hover:bg-zinc-50"
                    title="Quitar modelo"
                    aria-label="Quitar modelo"
                  >X</button>

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-zinc-800">
                      {model.name}
                    </div>
                    <div className="text-xs text-zinc-500">
                      {model.source.kind.toUpperCase()}
                    </div>
                  </div>
                </div>

                {model.expanded ? (
                  <div className="border-t border-zinc-200 bg-zinc-50 px-4 py-3">
                    <div className="space-y-2 pl-2">
                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">-</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Archivo</div>
                          <div className="break-all text-zinc-500">
                            {model.name}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">-</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Formato</div>
                          <div className="text-zinc-500">
                            {model.source.kind === "frag" ? "FRAG" : "IFC"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">-</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Ruta</div>
                          <div className="break-all text-zinc-500">
                            {model.source.documentPath ?? "-"}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="shrink-0 text-zinc-400">-</span>
                        <div className="min-w-0">
                          <div className="font-medium text-zinc-700">Visibilidad</div>
                          <div className="text-zinc-500">
                            {model.visible ? "Visible" : "Oculto"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function Ifc2DViewsPanel({
  views,
  activeViewId,
  loading,
  onGenerateViews,
  onOpenView,
  onCloseView
}: {
  views: Bim2DViewEntry[];
  activeViewId: string | null;
  loading: boolean;
  onGenerateViews: () => void;
  onOpenView: (viewId: string) => void;
  onCloseView: () => void;
}) {
  const plans = views.filter((view) => view.kind === "plan");
  const elevations = views.filter((view) => view.kind === "elevation");
  const otherViews = views.filter(
    (view) => view.kind !== "plan" && view.kind !== "elevation"
  );

  function ViewList({
    title,
    entries
  }: {
    title: string;
    entries: Bim2DViewEntry[];
  }) {
    if (entries.length === 0) return null;

    return (
      <div className="space-y-1">
        <div className="text-[11px] font-semibold uppercase text-zinc-500">
          {title}
        </div>
        {entries.map((view) => {
          const active = activeViewId === view.id;

          return (
            <button
              key={view.id}
              type="button"
              onClick={() => onOpenView(view.id)}
              className={`flex min-h-9 w-full items-center justify-between rounded border px-3 py-2 text-left text-sm ${
                active
                  ? "border-red-600 bg-red-950/30 text-white"
                  : "border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
              }`}
              title={view.name}
            >
              <span className="min-w-0 truncate">{view.name}</span>
              <span className="ml-2 shrink-0 text-[10px] uppercase text-zinc-500">
                {view.kind}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <section className="flex min-h-0 flex-col border-b border-zinc-800 bg-zinc-950 p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-red-400">Vistas 2D</h3>
        <span className="text-xs text-zinc-500">{views.length}</span>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={onGenerateViews}
          disabled={loading}
          className="min-h-9 rounded bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {loading ? "Generando..." : "Generar 2D"}
        </button>
        <button
          type="button"
          onClick={onCloseView}
          disabled={!activeViewId}
          className="min-h-9 rounded bg-zinc-800 px-3 text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Volver 3D
        </button>
      </div>

      {views.length === 0 ? (
        <p className="rounded border border-zinc-800 bg-zinc-900 p-3 text-sm text-zinc-500">
          Genera plantas y elevaciones desde los modelos cargados.
        </p>
      ) : (
        <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
          <ViewList title="Plantas" entries={plans} />
          <ViewList title="Elevaciones" entries={elevations} />
          <ViewList title="Otras" entries={otherViews} />
        </div>
      )}
    </section>
  );
}

const EMPTY_SMART_VIEW_CRITERIA: SmartViewCriteria = {
  text: "",
  modelKey: "",
  type: "",
  level: "",
  propertySet: "",
  propertyName: "",
  propertyValue: "",
  color: "#e30613"
};

function SmartViewPanel({
  models,
  savedSmartViews,
  propertyIndex,
  propertyCatalog,
  propertyCatalogLoading,
  propertiesIndexLoading,
  onApply,
  onClear,
  onSave,
  onApplySaved,
  onDeleteSaved,
  onBuildPropertyIndex
}: {
  models: FederatedModelEntry[];
  savedSmartViews: SavedSmartView[];
  propertyIndex: SmartViewPropertyIndex;
  propertyCatalog: SmartViewPropertyCatalog | null;
  propertyCatalogLoading: boolean;
  propertiesIndexLoading: boolean;
  onApply: (criteria: SmartViewCriteria) => void;
  onClear: () => void;
  onSave: (criteria: SmartViewCriteria, name: string) => void;
  onApplySaved: (view: SavedSmartView) => void;
  onDeleteSaved: (id: string) => void;
  onBuildPropertyIndex: () => void;
}) {
  const [criteria, setCriteria] = useState<SmartViewCriteria>(
    EMPTY_SMART_VIEW_CRITERIA
  );
  const [viewName, setViewName] = useState("");
  const typeOptions = useMemo(() => {
    const types = new Set<string>();

    for (const model of models) {
      for (const node of flattenModelTreeNodes(model.spatialTree ?? [])) {
        if (isModelTreeElement(node)) types.add(node.type.toUpperCase());
      }
    }

    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [models]);
  const levelOptions = useMemo(() => {
    const levels = new Set<string>();

    for (const model of models) {
      for (const level of collectLeafLevelNodes(model.spatialTree ?? [])) {
        levels.add(level.name);
      }
    }

    return Array.from(levels).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [models]);
  const selectorSource = useMemo(
    () => getSmartViewSelectorSource(propertyIndex, propertyCatalog),
    [propertyCatalog, propertyIndex]
  );
  const propertyValueOptions = criteria.propertyName
    ? selectorSource.valuesBySetAndProperty[criteria.propertySet]?.[
        criteria.propertyName
      ] ?? []
    : [];
  const propertyNameOptions = criteria.propertySet
    ? selectorSource.propertiesBySet[criteria.propertySet] ?? []
    : [];

  function updateCriteria(patch: Partial<SmartViewCriteria>) {
    setCriteria((current) => ({ ...current, ...patch }));
  }

  function applySavedSmartView(view: SavedSmartView) {
    const nextCriteria: SmartViewCriteria = {
      text: view.text,
      modelKey: view.modelKey,
      type: view.type,
      level: view.level,
      propertySet: view.propertySet ?? "",
      propertyName: view.propertyName,
      propertyValue: view.propertyValue,
      color: view.color
    };

    setCriteria(nextCriteria);
    onApplySaved(view);
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-950 px-4 py-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-red-400">SmartView</h3>
        <span className="text-xs text-zinc-500">Filtro</span>
      </div>

      <div className="space-y-2">
        <input
          value={criteria.text}
          onChange={(event) => updateCriteria({ text: event.target.value })}
          placeholder="Buscar texto en nombre, clase o parametros..."
          className="min-h-8 w-full rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-red-600"
        />

        <select
          value={criteria.modelKey}
          onChange={(event) => updateCriteria({ modelKey: event.target.value })}
          className="min-h-8 w-full rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
        >
          <option value="">Todos los modelos</option>
          {models.map((model) => (
            <option key={model.key} value={model.key}>
              {model.name}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-2 gap-2">
          <select
            value={criteria.type}
            onChange={(event) => updateCriteria({ type: event.target.value })}
            className="min-h-8 min-w-0 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
          >
            <option value="">Todas las clases</option>
            {typeOptions.map((type) => (
              <option key={type} value={type}>
                {prettyIfcCategory(type)}
              </option>
            ))}
          </select>

          <select
            value={criteria.level}
            onChange={(event) => updateCriteria({ level: event.target.value })}
            className="min-h-8 min-w-0 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
          >
            <option value="">Todos los niveles</option>
            {levelOptions.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          onClick={onBuildPropertyIndex}
          disabled={
            (propertiesIndexLoading && selectorSource.sets.length === 0) ||
            models.length === 0
          }
          className="min-h-8 w-full rounded bg-zinc-800 px-3 text-left text-sm text-zinc-200 hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {propertiesIndexLoading
            ? "Indexando propiedades..."
            : propertyIndex.sets.length > 0
              ? `${propertyIndex.sets.length} conjuntos indexados`
              : propertyCatalogLoading
                ? "Consultando catalogo..."
                : selectorSource.sets.length > 0
                  ? `${selectorSource.sets.length} conjuntos en catalogo`
                  : "Cargar conjuntos de propiedades"}
        </button>

        <select
          value={criteria.propertySet}
          onChange={(event) =>
            updateCriteria({
              propertySet: event.target.value,
              propertyName: "",
              propertyValue: ""
            })
          }
          disabled={selectorSource.sets.length === 0}
          className="min-h-8 w-full rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-60"
        >
          <option value="">Seleccionar conjunto de propiedades</option>
          {selectorSource.sets.map((setName) => (
            <option key={setName} value={setName}>
              {setName}
            </option>
          ))}
        </select>

        <div className="grid grid-cols-[1fr_1fr_42px] gap-2">
          <select
            value={criteria.propertyName}
            onChange={(event) =>
              updateCriteria({
                propertyName: event.target.value,
                propertyValue: ""
              })
            }
            disabled={!criteria.propertySet || propertyNameOptions.length === 0}
            className="min-h-8 min-w-0 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-60"
          >
            <option value="">Seleccionar propiedad</option>
            {propertyNameOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <select
            value={criteria.propertyValue}
            onChange={(event) =>
              updateCriteria({ propertyValue: event.target.value })
            }
            disabled={!criteria.propertyName || propertyValueOptions.length === 0}
            className="min-h-8 min-w-0 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-60"
          >
            <option value="">Seleccionar valor</option>
            {propertyValueOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <input
            type="color"
            value={criteria.color}
            onChange={(event) => updateCriteria({ color: event.target.value })}
            className="h-8 w-full rounded border border-zinc-700 bg-zinc-800 p-1"
            title="Color de SmartView"
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => onApply(criteria)}
            className="min-h-8 rounded bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-600"
          >
            Aplicar
          </button>
          <button
            type="button"
            onClick={() => {
              setCriteria(EMPTY_SMART_VIEW_CRITERIA);
              onClear();
            }}
            className="min-h-8 rounded bg-zinc-800 px-3 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            Limpiar
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmedName = viewName.trim();
              if (!trimmedName) return;
              onSave(criteria, trimmedName);
              setViewName("");
            }}
            className="min-h-8 rounded bg-zinc-800 px-3 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            Guardar
          </button>
        </div>

        <input
          value={viewName}
          onChange={(event) => setViewName(event.target.value)}
          placeholder="Nombre de vista guardada"
          className="min-h-8 w-full rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-red-600"
        />

        {savedSmartViews.length > 0 && (
          <div className="space-y-1 pt-1">
            {savedSmartViews.map((view) => (
              <div
                key={view.id}
                className="grid grid-cols-[1fr_28px_28px] items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1"
              >
                <button
                  type="button"
                  onClick={() => applySavedSmartView(view)}
                  className="min-w-0 truncate text-left text-xs text-zinc-200 hover:text-white"
                  title={view.name}
                >
                  {view.name}
                </button>
                <span
                  className="h-4 w-4 rounded-sm border border-zinc-700"
                  style={{ backgroundColor: view.color }}
                />
                <button
                  type="button"
                  onClick={() => onDeleteSaved(view.id)}
                  className="h-7 w-7 text-zinc-500 hover:text-red-300"
                  title="Eliminar SmartView"
                >
                  x
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const PARAMETER_ANALYSIS_COLORS = [
  "#e30613",
  "#2563eb",
  "#059669",
  "#f59e0b",
  "#7c3aed",
  "#0891b2",
  "#db2777",
  "#84cc16",
  "#f97316",
  "#06b6d4"
];
const PARAMETER_ANALYSIS_MISSING_COLOR = "#facc15";

function hslToHex(hue: number, saturation: number, lightness: number) {
  const normalizedSaturation = saturation / 100;
  const normalizedLightness = lightness / 100;
  const chroma =
    (1 - Math.abs(2 * normalizedLightness - 1)) * normalizedSaturation;
  const huePrime = hue / 60;
  const x = chroma * (1 - Math.abs((huePrime % 2) - 1));
  let red = 0;
  let green = 0;
  let blue = 0;

  if (huePrime >= 0 && huePrime < 1) {
    red = chroma;
    green = x;
  } else if (huePrime >= 1 && huePrime < 2) {
    red = x;
    green = chroma;
  } else if (huePrime >= 2 && huePrime < 3) {
    green = chroma;
    blue = x;
  } else if (huePrime >= 3 && huePrime < 4) {
    green = x;
    blue = chroma;
  } else if (huePrime >= 4 && huePrime < 5) {
    red = x;
    blue = chroma;
  } else if (huePrime >= 5 && huePrime < 6) {
    red = chroma;
    blue = x;
  }

  const match = normalizedLightness - chroma / 2;
  const toHex = (value: number) =>
    Math.round((value + match) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(red)}${toHex(green)}${toHex(blue)}`;
}

function getParameterAnalysisColor(index: number) {
  if (index < PARAMETER_ANALYSIS_COLORS.length) {
    return PARAMETER_ANALYSIS_COLORS[index];
  }

  return hslToHex((index * 137.508) % 360, 78, 50);
}

function normalizeParameterBucketValue(value: string) {
  const trimmed = value.trim();
  if (!trimmed || trimmed === "-") return "Sin valor";
  return trimmed;
}

function addIdsToModelIdMap(
  target: OBC.ModelIdMap,
  modelId: string,
  localIds: Iterable<number>
) {
  const targetIds = target[modelId] ?? new Set<number>();

  for (const localId of localIds) {
    targetIds.add(localId);
  }

  target[modelId] = targetIds;
}

function countModelIdMapElements(modelIdMap: OBC.ModelIdMap) {
  return Object.values(modelIdMap).reduce((total, ids) => total + ids.size, 0);
}

function mergeModelIdMap(target: OBC.ModelIdMap, source: OBC.ModelIdMap) {
  for (const [modelId, ids] of Object.entries(source)) {
    addIdsToModelIdMap(target, modelId, ids);
  }
}

const MODEL_ID_MAP_RENDER_CHUNK_SIZE = 450;
const MODEL_ID_MAP_COLOR_CHUNK_SIZE = 350;


function splitModelIdMap(
  modelIdMap: OBC.ModelIdMap,
  chunkSize = MODEL_ID_MAP_RENDER_CHUNK_SIZE
) {
  const chunks: OBC.ModelIdMap[] = [];
  let current: OBC.ModelIdMap = {};
  let currentCount = 0;

  const flush = () => {
    if (currentCount === 0) return;
    chunks.push(current);
    current = {};
    currentCount = 0;
  };

  for (const [modelId, ids] of Object.entries(modelIdMap)) {
    for (const localId of ids) {
      if (currentCount >= chunkSize) flush();

      const targetIds = current[modelId] ?? new Set<number>();
      targetIds.add(localId);
      current[modelId] = targetIds;
      currentCount += 1;
    }
  }

  flush();
  return chunks;
}

async function forEachModelIdMapChunk(
  modelIdMap: OBC.ModelIdMap,
  callback: (chunk: OBC.ModelIdMap) => Promise<void> | void,
  chunkSize = MODEL_ID_MAP_RENDER_CHUNK_SIZE,
  shouldContinue: () => boolean = () => true
) {
  const chunks = splitModelIdMap(modelIdMap, chunkSize);

  for (const chunk of chunks) {
    if (!shouldContinue()) return false;
    await callback(chunk);
    await waitForNextFrame();
  }

  return true;
}

function buildParameterAnalysisBucketsFromSummary({
  models,
  summary
}: {
  models: FederatedModelEntry[];
  summary: BimPropertySummaryPayload;
}) {
  const modelIdByKey = new Map(
    models
      .filter((model) => Boolean(model.modelId))
      .map((model) => [model.key, model.modelId as string])
  );

  return summary.buckets
    .map((bucket) => {
      const value = normalizeParameterBucketValue(bucket.value);
      const modelIdMap: OBC.ModelIdMap = {};

      for (const [modelKey, localIds] of Object.entries(bucket.localIdsByModelKey ?? {})) {
        const modelId = modelIdByKey.get(modelKey);
        if (!modelId) continue;
        addIdsToModelIdMap(
          modelIdMap,
          modelId,
          localIds.map(Number).filter(Number.isFinite)
        );
      }

      return {
        value,
        count: Number(bucket.count) || countModelIdMapElements(modelIdMap),
        color: PARAMETER_ANALYSIS_MISSING_COLOR,
        modelIdMap
      };
    })
    .filter((bucket) => bucket.count > 0 && countModelIdMapElements(bucket.modelIdMap) > 0)
    .sort((a, b) => {
      if (a.value === "Sin valor") return 1;
      if (b.value === "Sin valor") return -1;
      return b.count - a.count || a.value.localeCompare(b.value);
    })
    .map((bucket, index) => ({
      ...bucket,
      color:
        bucket.value === "Sin valor"
          ? PARAMETER_ANALYSIS_MISSING_COLOR
          : getParameterAnalysisColor(index)
    }));
}
function buildParameterAnalysisBuckets({
  models,
  propertyIndex,
  propertySet,
  propertyName
}: {
  models: FederatedModelEntry[];
  projectCode?: string;
  propertyIndex: SmartViewPropertyIndex;
  propertySet: string;
  propertyName: string;
}) {
  if (!propertySet || !propertyName) return [];

  const valueBuckets =
    propertyIndex.localIdsBySetPropertyValue[propertySet]?.[propertyName] ?? {};
  const modelIdByKey = new Map(
    models
      .filter((model) => Boolean(model.modelId))
      .map((model) => [model.key, model.modelId as string])
  );
  const aggregated = new Map<string, OBC.ModelIdMap>();
  const assignedIdsByModelKey = new Map<string, Set<number>>();
  const rawValueEntries = Object.entries(valueBuckets).sort(([a], [b]) => {
    const aIsMissing = normalizeParameterBucketValue(a) === "Sin valor";
    const bIsMissing = normalizeParameterBucketValue(b) === "Sin valor";
    if (aIsMissing !== bIsMissing) return aIsMissing ? 1 : -1;
    return a.localeCompare(b, undefined, { numeric: true });
  });

  for (const [rawValue, modelBuckets] of rawValueEntries) {
    const value = normalizeParameterBucketValue(rawValue);
    const target = aggregated.get(value) ?? {};

    for (const [modelKey, localIds] of Object.entries(modelBuckets)) {
      const modelId = modelIdByKey.get(modelKey);
      if (!modelId) continue;
      const assignedIds = assignedIdsByModelKey.get(modelKey) ?? new Set<number>();
      const unassignedLocalIds = localIds.filter((localId) => !assignedIds.has(localId));
      if (unassignedLocalIds.length === 0) continue;

      addIdsToModelIdMap(target, modelId, unassignedLocalIds);

      for (const localId of unassignedLocalIds) {
        assignedIds.add(localId);
      }
      assignedIdsByModelKey.set(modelKey, assignedIds);
    }

    aggregated.set(value, target);
  }

  const missingMap: OBC.ModelIdMap = {};

  for (const model of models) {
    if (!model.modelId) continue;

    const assignedIds = assignedIdsByModelKey.get(model.key) ?? new Set<number>();
    const modelUniverseIds =
      propertyIndex.localIdsByModelKey?.[model.key] ??
      flattenModelTreeNodes(model.spatialTree ?? [])
        .filter(
          (node) =>
            isModelTreeElement(node) &&
            typeof node.localId === "number"
        )
        .map((node) => node.localId as number);
    const missingIds = Array.from(new Set(modelUniverseIds)).filter(
      (localId) => !assignedIds.has(localId)
    );

    if (missingIds.length > 0) {
      addIdsToModelIdMap(missingMap, model.modelId, missingIds);
    }
  }

  if (countModelIdMapElements(missingMap) > 0) {
    const existingMissing = aggregated.get("Sin valor") ?? {};
    mergeModelIdMap(existingMissing, missingMap);
    aggregated.set("Sin valor", existingMissing);
  }

  return Array.from(aggregated.entries())
    .map(([value, modelIdMap]) => ({
      value,
      count: countModelIdMapElements(modelIdMap),
      color: PARAMETER_ANALYSIS_MISSING_COLOR,
      modelIdMap
    }))
    .filter((bucket) => bucket.count > 0)
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
    .map((bucket, index) => ({
      ...bucket,
      color:
        bucket.value === "Sin valor"
          ? PARAMETER_ANALYSIS_MISSING_COLOR
          : getParameterAnalysisColor(index)
    }));
}

function buildParameterDonutGradient(buckets: ParameterValueBucket[]) {
  if (buckets.length === 0) return "#27272a 0% 100%";

  const total = Math.max(
    buckets.reduce((sum, bucket) => sum + bucket.count, 0),
    1
  );
  let start = 0;

  return buckets
    .map((bucket) => {
      const width = (bucket.count / total) * 100;
      const segment = `${bucket.color} ${start}% ${start + width}%`;
      start += width;
      return segment;
    })
    .join(", ");
}

const EMPTY_COST_5D_REF: Cost5DPropertyRef = { set: "", property: "" };

function buildCost5DValueLookup(
  propertyIndex: SmartViewPropertyIndex,
  ref: Cost5DPropertyRef
) {
  const lookup = new Map<string, string>();
  if (!ref.set || !ref.property) return lookup;

  const valueBuckets =
    propertyIndex.localIdsBySetPropertyValue[ref.set]?.[ref.property] ?? {};

  for (const [value, modelBuckets] of Object.entries(valueBuckets)) {
    for (const [modelKey, ids] of Object.entries(modelBuckets)) {
      for (const localId of ids) {
        lookup.set(`${modelKey}:${localId}`, value);
      }
    }
  }

  return lookup;
}

function parseCost5DQuantity(value: string) {
  const raw = value.trim().replace(/\s/g, "").replace(/[^0-9.,+-]/g, "");
  const lastComma = raw.lastIndexOf(",");
  const lastDot = raw.lastIndexOf(".");
  let normalized = raw;

  if (lastComma >= 0 && lastDot >= 0) {
    const decimalSeparator = lastComma > lastDot ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = raw
      .replace(new RegExp(`\\${thousandsSeparator}`, "g"), "")
      .replace(decimalSeparator, ".");
  } else if (lastComma >= 0) {
    normalized = raw.replace(",", ".");
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildCost5DRows({
  models,
  propertyIndex,
  mapping
}: {
  models: FederatedModelEntry[];
  projectCode?: string;
  propertyIndex: SmartViewPropertyIndex;
  mapping: Cost5DMapping;
}) {
  const rows = new Map<string, Cost5DRow>();
  const modelByKey = new Map(models.map((model) => [model.key, model]));
  const universeByModelKey = propertyIndex.localIdsByModelKey ?? {};
  const elementIdentityByKey = propertyIndex.elementIdentityByKey ?? {};
  const countedIdentities = new Set<string>();
  const itemIdLookup = buildCost5DValueLookup(propertyIndex, mapping.itemId);
  const itemNameLookup = buildCost5DValueLookup(propertyIndex, mapping.itemName);
  const itemUnitLookup = buildCost5DValueLookup(propertyIndex, mapping.itemUnit);
  const quantityLookup = buildCost5DValueLookup(propertyIndex, mapping.quantity);
  const hasQuantityMapping =
    Boolean(mapping.quantity.set.trim()) && Boolean(mapping.quantity.property.trim());

  for (const [modelKey, localIds] of Object.entries(universeByModelKey)) {
    const model = modelByKey.get(modelKey);
    if (!model?.modelId) continue;

    for (const localId of localIds) {
      const elementKey = `${modelKey}:${localId}`;
      const itemId = itemIdLookup.get(elementKey) || "Sin partida";
      const itemName = itemNameLookup.get(elementKey) || "Sin nombre";
      const itemUnit = itemUnitLookup.get(elementKey) || "-";
      const quantityValue = quantityLookup.get(elementKey) || "";
      const parsedQuantity = parseCost5DQuantity(quantityValue);
      const quantity = parsedQuantity ?? (hasQuantityMapping ? 0 : 1);
      const key = `${itemId}::${itemName}::${itemUnit}`;
      const identityKey = `${key}::${
        elementIdentityByKey[elementKey] ?? `${modelKey}:local:${localId}`
      }`;
      const row =
        rows.get(key) ??
        ({
          key,
          itemId,
          itemName,
          itemUnit,
          quantity: 0,
          elementCount: 0,
          geometryCount: 0,
          modelCount: 0,
          modelIdMap: {}
        } satisfies Cost5DRow);

      if (!countedIdentities.has(identityKey)) {
        row.quantity += quantity;
        row.elementCount += 1;
        countedIdentities.add(identityKey);
      }

      const currentIds = row.modelIdMap[model.modelId] ?? new Set<number>();
      currentIds.add(localId);
      row.modelIdMap[model.modelId] = currentIds;
      row.geometryCount = countModelIdMapElements(row.modelIdMap);
      rows.set(key, row);
    }
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      modelCount: Object.keys(row.modelIdMap).length,
      geometryCount: countModelIdMapElements(row.modelIdMap),
      quantity: Number(row.quantity.toFixed(3))
    }))
    .sort(
      (a, b) =>
        b.quantity - a.quantity ||
        a.itemId.localeCompare(b.itemId, undefined, { numeric: true }) ||
        a.itemName.localeCompare(b.itemName)
    );
}

function buildMeteringRows({
  models,
  propertyIndex,
  columns
}: {
  models: FederatedModelEntry[];
  projectCode?: string;
  propertyIndex: SmartViewPropertyIndex;
  columns: MeteringColumn[];
}) {
  const rows: MeteringRow[] = [];
  const lookups = columns.map((column) =>
    buildCost5DValueLookup(propertyIndex, column)
  );
  const universeByModelKey = propertyIndex.localIdsByModelKey ?? {};

  outer: for (const model of models) {
    if (!model.modelId) continue;

    const nodeByLocalId = new Map<number, ModelTreeNode>();
    for (const node of flattenModelTreeNodes(model.spatialTree ?? [])) {
      if (isModelTreeElement(node) && typeof node.localId === "number") {
        nodeByLocalId.set(node.localId, node);
      }
    }

    const localIds = universeByModelKey[model.key] ?? [];
    for (const localId of localIds) {
      if (rows.length >= MAX_METERING_ROWS) break outer;

      const elementKey = `${model.key}:${localId}`;
      const node = nodeByLocalId.get(localId);
      const values = lookups.map((lookup) => lookup.get(elementKey) ?? "-");

      rows.push({
        key: elementKey,
        modelId: model.modelId,
        modelName: model.name,
        localId,
        type: node?.type || "-",
        name: node?.name || `Elemento ${localId}`,
        values
      });
    }
  }

  return rows;
}

function buildMeteringCsv(rows: MeteringRow[], columns: MeteringColumn[]) {
  const headers = [
    "Modelo",
    "LocalId",
    "Clase IFC",
    "Nombre",
    ...columns.map((column) => column.label || column.property || column.set)
  ];
  const body = rows.map((row) => [
    row.modelName,
    row.localId,
    row.type,
    row.name,
    ...row.values
  ]);

  return [headers, ...body].map((row) => row.map(csvEscape).join(",")).join("\\n");
}

function getCost5DRefProperties(
  propertySource: Pick<SmartViewSelectorSource, "propertiesBySet">,
  ref: Cost5DPropertyRef
) {
  return ref.set
    ? (propertySource.propertiesBySet[ref.set] ?? []).filter(
        (propertyName) => !isSmartViewInternalPropertyKey(propertyName)
      )
    : [];
}

function BimIndexStatusCard({
  overview,
  loading
}: {
  overview: BimIndexOverview | null;
  loading: boolean;
}) {
  if (!overview && !loading) {
    return (
      <div className="rounded border border-zinc-800 bg-zinc-900/70 px-3 py-2 text-xs text-zinc-500">
        Indice BIM no consultado para este proyecto.
      </div>
    );
  }

  const models = overview?.models;
  const jobs = overview?.jobs;
  const issueCount = (models?.failed ?? 0) + (jobs?.failed ?? 0);
  const isWorking =
    loading || (jobs?.processing ?? 0) > 0 || (jobs?.pending ?? 0) > 0;

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900/80 p-3 text-xs text-zinc-300">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold uppercase text-zinc-400">Indice BIM</span>
        <span
          className={`rounded px-2 py-0.5 text-[10px] font-semibold uppercase ${
            issueCount > 0
              ? "bg-red-950 text-red-200"
              : isWorking
                ? "bg-amber-950 text-amber-200"
                : "bg-emerald-950 text-emerald-200"
          }`}
        >
          {issueCount > 0 ? "Con errores" : isWorking ? "Procesando" : "Listo"}
        </span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Modelos</div>
          <div className="font-semibold text-white">
            {models?.ready ?? 0}/{models?.total ?? 0}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Elementos</div>
          <div className="font-semibold text-white">
            {(models?.elements ?? 0).toLocaleString()}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Jobs</div>
          <div className="font-semibold text-white">{jobs?.processing ?? 0} proc.</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-zinc-500">Fallos</div>
          <div className="font-semibold text-red-300">{issueCount}</div>
        </div>
      </div>
    </div>
  );
}

function ParameterAnalysisPanel({
  models,
  projectCode,
  propertyIndex,
  propertyCatalog,
  propertyCatalogLoading,
  propertiesIndexLoading,
  bimIndexOverview,
  bimIndexOverviewLoading,
  onBuildPropertyIndex,
  onApplyColors,
  onSelectBucket,
  onSetBucketVisibility,
  onRestoreVisibility,
  onClear
}: {
  models: FederatedModelEntry[];
  projectCode?: string;
  propertyIndex: SmartViewPropertyIndex;
  propertyCatalog: SmartViewPropertyCatalog | null;
  propertyCatalogLoading: boolean;
  propertiesIndexLoading: boolean;
  bimIndexOverview: BimIndexOverview | null;
  bimIndexOverviewLoading: boolean;
  onBuildPropertyIndex: () => void;
  onApplyColors: (
    propertySet: string,
    propertyName: string,
    buckets: ParameterValueBucket[]
  ) => Promise<void>;
  onSelectBucket: (bucket: ParameterValueBucket) => void;
  onSetBucketVisibility: (
    bucket: ParameterValueBucket,
    visible: boolean
  ) => Promise<void>;
  onRestoreVisibility: () => Promise<void>;
  onClear: () => void;
}) {
  const [propertySet, setPropertySet] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [chartMode, setChartMode] = useState<"bars" | "donut">("bars");
  const [hiddenBucketValues, setHiddenBucketValues] = useState<Set<string>>(
    () => new Set()
  );
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>(
    {}
  );

  const selectorSource = useMemo(
    () => getSmartViewSelectorSource(propertyIndex, propertyCatalog),
    [propertyCatalog, propertyIndex]
  );
  const availableProperties = propertySet
    ? selectorSource.propertiesBySet[propertySet] ?? []
    : [];
  const [databaseBuckets, setDatabaseBuckets] = useState<
    ParameterValueBucket[] | null
  >(null);
  const [databaseBucketsLoading, setDatabaseBucketsLoading] = useState(false);
  const modelKeySignature = useMemo(
    () =>
      models
        .map((model) => model.key)
        .filter(Boolean)
        .sort()
        .join("|"),
    [models]
  );
  const databaseBucketsRequestKey = useMemo(() => {
    const normalizedProjectCode = projectCode?.trim().toUpperCase();
    if (!normalizedProjectCode || !propertySet || !propertyName || !modelKeySignature) {
      return "";
    }

    return JSON.stringify({
      projectCode: normalizedProjectCode,
      modelKeySignature,
      propertySet,
      propertyName
    });
  }, [modelKeySignature, projectCode, propertyName, propertySet]);
  const [databaseBucketsResolvedKey, setDatabaseBucketsResolvedKey] = useState("");
  const parameterAnalysisLocalIdCount = useMemo(
    () =>
      Object.values(propertyIndex.localIdsByModelKey ?? {}).reduce(
        (sum, ids) => sum + ids.length,
        0
      ),
    [propertyIndex.localIdsByModelKey]
  );
  const localBucketsWouldBeHeavy =
    parameterAnalysisLocalIdCount > PARAMETER_ANALYSIS_LOCAL_BUCKET_MAX_IDS;
  const shouldBuildLocalBuckets = Boolean(
    propertySet &&
      propertyName &&
      propertyIndex.sets.length > 0 &&
      !localBucketsWouldBeHeavy &&
      (!databaseBucketsRequestKey ||
        (!databaseBucketsLoading &&
          databaseBucketsResolvedKey === databaseBucketsRequestKey &&
          databaseBuckets === null))
  );
  const localBucketsSkippedForPerformance = Boolean(
    propertySet &&
      propertyName &&
      propertyIndex.sets.length > 0 &&
      localBucketsWouldBeHeavy &&
      !databaseBucketsLoading &&
      databaseBucketsResolvedKey === databaseBucketsRequestKey &&
      databaseBuckets === null
  );
  const localBuckets = useMemo(
    () =>
      shouldBuildLocalBuckets
        ? buildParameterAnalysisBuckets({
            models,
            propertyIndex,
            propertySet,
            propertyName
          })
        : [],
    [models, propertyIndex, propertySet, propertyName, shouldBuildLocalBuckets]
  );
  const buckets = databaseBuckets ?? localBuckets;
  const displayBuckets = useMemo(
    () =>
      buckets.map((bucket) => ({
        ...bucket,
        color: colorOverrides[bucket.value] ?? bucket.color
      })),
    [buckets, colorOverrides]
  );
  const total = displayBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
  const missingCount =
    displayBuckets.find((bucket) => bucket.value === "Sin valor")?.count ?? 0;
  const maxCount = Math.max(...displayBuckets.map((bucket) => bucket.count), 1);
  const visibleBuckets = displayBuckets.filter(
    (bucket) => !hiddenBucketValues.has(bucket.value)
  );

  useEffect(() => {
    let active = true;
    setDatabaseBuckets(null);
    setDatabaseBucketsResolvedKey("");

    const modelKeys = models.map((model) => model.key).filter(Boolean);
    if (
      !projectCode?.trim() ||
      modelKeys.length === 0 ||
      !propertySet ||
      !propertyName ||
      !databaseBucketsRequestKey
    ) {
      setDatabaseBucketsLoading(false);
      return () => {
        active = false;
      };
    }

    setDatabaseBucketsLoading(true);
    void loadParameterAnalysisSummaryFromDatabase({
      projectCode,
      modelKeys,
      propertySet,
      propertyName
    })
      .then((summary) => {
        if (!active) return;
        setDatabaseBuckets(
          summary
            ? buildParameterAnalysisBucketsFromSummary({ models, summary })
            : null
        );
        setDatabaseBucketsResolvedKey(databaseBucketsRequestKey);
      })
      .finally(() => {
        if (active) setDatabaseBucketsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [databaseBucketsRequestKey, models, projectCode, propertyName, propertySet]);
  useEffect(() => {
    if (!propertySet && selectorSource.sets.length > 0) {
      setPropertySet(selectorSource.sets[0]);
    }
  }, [propertySet, selectorSource.sets]);

  useEffect(() => {
    if (!propertySet) {
      setPropertyName("");
      return;
    }

    const properties = selectorSource.propertiesBySet[propertySet] ?? [];
    if (!properties.includes(propertyName)) {
      setPropertyName(properties[0] ?? "");
    }
  }, [propertyName, propertySet, selectorSource.propertiesBySet]);

  useEffect(() => {
    setHiddenBucketValues(new Set());
    setColorOverrides({});
  }, [propertyName, propertySet]);

  async function handleApplyColors() {
    await onApplyColors(propertySet, propertyName, displayBuckets);

    for (const bucket of displayBuckets) {
      if (hiddenBucketValues.has(bucket.value)) {
        await onSetBucketVisibility(bucket, false);
      }
    }
  }

  async function handleChangeBucketColor(bucket: ParameterValueBucket, color: string) {
    const nextOverrides = {
      ...colorOverrides,
      [bucket.value]: color
    };

    setColorOverrides(nextOverrides);
    await onApplyColors(
      propertySet,
      propertyName,
      displayBuckets.map((item) =>
        item.value === bucket.value ? { ...item, color } : item
      )
    );
  }

  async function handleToggleBucket(bucket: ParameterValueBucket) {
    const nextHiddenValues = new Set(hiddenBucketValues);
    const willBeVisible = hiddenBucketValues.has(bucket.value);

    if (willBeVisible) {
      nextHiddenValues.delete(bucket.value);
    } else {
      nextHiddenValues.add(bucket.value);
    }

    setHiddenBucketValues(nextHiddenValues);
    await onSetBucketVisibility(bucket, willBeVisible);
  }

  async function handleRestoreVisibility() {
    setHiddenBucketValues(new Set());
    await onRestoreVisibility();
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <div className="border-b border-zinc-800 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-red-500">
              Analisis de parametros
            </h3>
            <p className="text-xs text-zinc-400">
              Colorea modelos federados por valores de propiedades.
            </p>
          </div>
          <button
            type="button"
            onClick={onBuildPropertyIndex}
            disabled={propertiesIndexLoading || databaseBucketsLoading}
            className="min-h-8 shrink-0 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {databaseBucketsLoading
              ? "Consultando"
              : propertiesIndexLoading
                ? "Indexando"
                : "Cargar parametros"}
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <BimIndexStatusCard
          overview={bimIndexOverview}
          loading={
            bimIndexOverviewLoading ||
            propertiesIndexLoading ||
            propertyCatalogLoading
          }
        />
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs text-zinc-400">
            Conjunto
            <select
              value={propertySet}
              onChange={(event) => setPropertySet(event.target.value)}
              className="min-h-9 w-full rounded bg-zinc-800 px-2 text-sm text-white outline-none focus:ring-1 focus:ring-red-600"
            >
              {selectorSource.sets.length === 0 ? (
                <option value="">Sin catalogo</option>
              ) : (
                selectorSource.sets.map((setName) => (
                  <option key={setName} value={setName}>
                    {setName}
                  </option>
                ))
              )}
            </select>
          </label>
          <label className="space-y-1 text-xs text-zinc-400">
            Parametro
            <select
              value={propertyName}
              onChange={(event) => setPropertyName(event.target.value)}
              className="min-h-9 w-full rounded bg-zinc-800 px-2 text-sm text-white outline-none focus:ring-1 focus:ring-red-600"
            >
              {availableProperties.length === 0 ? (
                <option value="">Sin parametros</option>
              ) : (
                availableProperties.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))
              )}
            </select>
          </label>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Elementos</div>
            <div className="text-lg font-semibold text-white">{total}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Valores</div>
            <div className="text-lg font-semibold text-emerald-300">
              {buckets.length}
            </div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Sin valor</div>
            <div className="text-lg font-semibold text-red-300">
              {missingCount}
            </div>
          </div>
        </div>

        {localBucketsSkippedForPerformance ? (
          <div className="rounded border border-amber-800/70 bg-amber-950/40 p-3 text-xs text-amber-100">
            El indice local tiene {parameterAnalysisLocalIdCount.toLocaleString()} elementos.
            Para evitar pausas del navegador, este analisis se debe resolver desde PostgreSQL.
            Pulsa Cargar parametros y vuelve a aplicar el analisis cuando el indice quede listo.
          </div>
        ) : null}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleApplyColors}
            disabled={!propertySet || !propertyName || displayBuckets.length === 0}
            className="min-h-9 flex-1 rounded bg-red-700 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Colorear
          </button>
          <button
            type="button"
            onClick={handleRestoreVisibility}
            className="min-h-9 flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            Restablecer
          </button>
          <button
            type="button"
            onClick={onClear}
            className="min-h-9 flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-700"
          >
            Limpiar
          </button>
          <select
            value={chartMode}
            onChange={(event) =>
              setChartMode(event.target.value === "donut" ? "donut" : "bars")
            }
            className="min-h-9 rounded bg-zinc-800 px-2 text-sm text-white outline-none focus:ring-1 focus:ring-red-600"
          >
            <option value="bars">Barras</option>
            <option value="donut">Circular</option>
          </select>
        </div>

        {displayBuckets.length === 0 ? (
          <div className="rounded border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-400">
            Carga parametros y selecciona un conjunto/parametro para analizar.
          </div>
        ) : chartMode === "donut" ? (
          <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
            <div className="mx-auto h-36 w-36 rounded-full border border-zinc-700"
              style={{
                background: `conic-gradient(${buildParameterDonutGradient(
                  visibleBuckets.length > 0 ? visibleBuckets : []
                )})`
              }}
            />
            <div className="mt-4 space-y-1">
              {displayBuckets.map((bucket) => {
                const percent = Math.round((bucket.count / Math.max(total, 1)) * 100);
                const isHidden = hiddenBucketValues.has(bucket.value);
                return (
                  <div
                    key={bucket.value}
                    className={`grid w-full grid-cols-[24px_12px_1fr_auto] items-center gap-2 rounded px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800 ${
                      isHidden ? "opacity-45" : ""
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleToggleBucket(bucket)}
                      className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-700 hover:text-white"
                      title={isHidden ? "Mostrar grupo" : "Ocultar grupo"}
                    >
                      {isHidden ? "+" : "-"}
                    </button>
                    <input
                      type="color"
                      value={bucket.color}
                      onChange={(event) =>
                        handleChangeBucketColor(bucket, event.target.value)
                      }
                      className="h-5 w-5 cursor-pointer rounded border border-zinc-700 bg-transparent p-0"
                      title="Cambiar color"
                    />
                    <button
                      type="button"
                      onClick={() => onSelectBucket(bucket)}
                      className="min-w-0 truncate text-left hover:text-white"
                      title={bucket.value}
                    >
                      {bucket.value}
                    </button>
                    <span className="text-zinc-400">
                      {bucket.count} / {percent}%
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {displayBuckets.map((bucket) => {
              const width = Math.max(4, Math.round((bucket.count / maxCount) * 100));
              const percent = Math.round((bucket.count / Math.max(total, 1)) * 100);
              const isHidden = hiddenBucketValues.has(bucket.value);
              return (
                <div
                  key={bucket.value}
                  className={`w-full rounded border border-zinc-800 bg-zinc-900 p-3 text-left hover:border-red-700 ${
                    isHidden ? "opacity-45" : ""
                  }`}
                >
                  <div className="mb-2 grid grid-cols-[24px_12px_1fr_auto] items-center gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => handleToggleBucket(bucket)}
                      className="h-6 w-6 rounded text-zinc-400 hover:bg-zinc-700 hover:text-white"
                      title={isHidden ? "Mostrar grupo" : "Ocultar grupo"}
                    >
                      {isHidden ? "+" : "-"}
                    </button>
                    <input
                      type="color"
                      value={bucket.color}
                      onChange={(event) =>
                        handleChangeBucketColor(bucket, event.target.value)
                      }
                      className="h-5 w-5 cursor-pointer rounded border border-zinc-700 bg-transparent p-0"
                      title="Cambiar color"
                    />
                    <button
                      type="button"
                      onClick={() => onSelectBucket(bucket)}
                      className="min-w-0 truncate text-left font-semibold text-zinc-100 hover:text-white"
                      title={bucket.value}
                    >
                      {bucket.value}
                    </button>
                    <span className="text-zinc-400">
                      {bucket.count} ({percent}%)
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded bg-zinc-800">
                    <div
                      className="h-full rounded"
                      style={{ width: `${width}%`, backgroundColor: bucket.color }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

function Cost5DPropertySelector({
  label,
  value,
  selectorSource,
  onChange
}: {
  label: string;
  value: Cost5DPropertyRef;
  selectorSource: SmartViewSelectorSource;
  onChange: (value: Cost5DPropertyRef) => void;
}) {
  const properties = getCost5DRefProperties(selectorSource, value);

  return (
    <div className="grid grid-cols-2 gap-2">
      <Cost5DFloatingSelect
        label={label}
        placeholder="Conjunto"
        value={value.set}
        options={selectorSource.sets.map((setName) => ({
          value: setName,
          label: setName
        }))}
        onChange={(nextSet) =>
          onChange({
            set: nextSet,
            property: selectorSource.propertiesBySet[nextSet]?.[0] ?? ""
          })
        }
      />
      <Cost5DFloatingSelect
        label="Parametro"
        placeholder="Parametro"
        value={value.property}
        options={properties.map((propertyName) => ({
          value: propertyName,
          label: propertyName
        }))}
        disabled={!value.set}
        onChange={(property) =>
          onChange({
            ...value,
            property
          })
        }
      />
    </div>
  );
}

function Cost5DFloatingSelect({
  label,
  placeholder,
  value,
  options,
  disabled,
  onChange
}: {
  label: string;
  placeholder: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({
    left: 0,
    top: 0,
    width: 0,
    maxHeight: 240
  });
  const selectedLabel =
    options.find((option) => option.value === value)?.label ?? "";
  const filteredOptions = options.filter((option) =>
    option.label.toLowerCase().includes(search.trim().toLowerCase())
  );

  function updateMenuPosition() {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const lowerSpace = window.innerHeight - rect.bottom;
    const upperSpace = rect.top;
    const preferredHeight = Math.min(260, Math.max(140, options.length * 34 + 52));
    const openUp = lowerSpace < 180 && upperSpace > lowerSpace;
    const availableHeight = Math.max(
      140,
      openUp ? upperSpace - 12 : lowerSpace - 12
    );
    const maxHeight = Math.min(preferredHeight, availableHeight);
    const top = openUp
      ? Math.max(8, rect.top - maxHeight - 4)
      : Math.min(rect.bottom + 4, window.innerHeight - maxHeight - 8);

    setMenuStyle({
      position: "fixed",
      left: rect.left,
      top,
      width: rect.width,
      maxHeight,
      zIndex: 80
    });
  }

  useEffect(() => {
    if (!isOpen) return;

    updateMenuPosition();

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }

      setIsOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setIsOpen(false);
    }

    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, options.length]);

  return (
    <label className="space-y-1 text-xs text-zinc-400">
      {label}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => {
          setSearch("");
          setIsOpen((current) => !current);
        }}
        className="flex min-h-9 w-full items-center justify-between gap-2 rounded bg-zinc-800 px-2 text-left text-sm text-white outline-none focus:ring-1 focus:ring-red-600 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="min-w-0 truncate">
          {selectedLabel || placeholder}
        </span>
        <span className="shrink-0 text-zinc-400">v</span>
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          style={menuStyle}
          className="overflow-hidden rounded border border-zinc-700 bg-zinc-950 text-sm text-zinc-100 shadow-2xl"
        >
          <div className="border-b border-zinc-800 p-2">
            <input
              autoFocus
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar..."
              className="min-h-8 w-full rounded bg-zinc-900 px-2 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-red-600"
            />
          </div>
          <div
            className="overflow-y-auto py-1"
            style={{
              maxHeight:
                typeof menuStyle.maxHeight === "number"
                  ? Math.max(96, menuStyle.maxHeight - 49)
                  : 190
            }}
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setIsOpen(false);
              }}
              className="block min-h-8 w-full px-3 py-1.5 text-left text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
            >
              {placeholder}
            </button>
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-3 text-xs text-zinc-500">
                Sin resultados.
              </div>
            ) : (
              filteredOptions.map((option, optionIndex) => (
                <button
                  key={`${option.value}-${optionIndex}`}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`block min-h-8 w-full px-3 py-1.5 text-left hover:bg-zinc-800 ${
                    option.value === value
                      ? "bg-red-950/50 text-white"
                      : "text-zinc-200"
                  }`}
                  title={option.label}
                >
                  <span className="block truncate">{option.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </label>
  );
}

function Cost5DPanel({
  models,
  projectCode,
  propertyIndex,
  propertyCatalog,
  propertyCatalogLoading,
  propertiesIndexLoading,
  bimIndexOverview,
  bimIndexOverviewLoading,
  onBuildPropertyIndex,
  onSelectRow,
  onSelectModelIdMap
}: {
  models: FederatedModelEntry[];
  projectCode?: string;
  propertyIndex: SmartViewPropertyIndex;
  propertyCatalog: SmartViewPropertyCatalog | null;
  propertyCatalogLoading: boolean;
  propertiesIndexLoading: boolean;
  bimIndexOverview: BimIndexOverview | null;
  bimIndexOverviewLoading: boolean;
  onBuildPropertyIndex: () => void;
  onSelectRow: (row: Cost5DRow) => void;
  onSelectModelIdMap: (
    modelIdMap: OBC.ModelIdMap,
    successStatus: string,
    errorStatus: string
  ) => void;
}) {
  const [mode, setMode] = useState<"partidas" | "metrados">("partidas");
  const [mapping, setMapping] = useState<Cost5DMapping>({
    itemId: EMPTY_COST_5D_REF,
    itemName: EMPTY_COST_5D_REF,
    itemUnit: EMPTY_COST_5D_REF,
    quantity: EMPTY_COST_5D_REF
  });
  const [meteringColumns, setMeteringColumns] = useState<MeteringColumn[]>([
    { id: "class", label: "Tipo de elemento", set: "", property: "" },
    { id: "level", label: "Nivel", set: "", property: "" },
    { id: "quantity", label: "Cantidad / metrado", set: "", property: "" }
  ]);
  const [search, setSearch] = useState("");
  const [chartMode, setChartMode] = useState<"bars" | "donut">("bars");
  const [chartLimit, setChartLimit] = useState<"10" | "15" | "25" | "all">(
    "15"
  );
  const [meteringPage, setMeteringPage] = useState(0);
  const [meteringPageSize, setMeteringPageSize] = useState(
    METERING_RENDER_ROW_LIMIT
  );
  const [serverAggregation, setServerAggregation] =
    useState<Cost5DServerAggregation | null>(null);
  const [serverAggregationLoading, setServerAggregationLoading] = useState(false);
  const [serverMeteringRows, setServerMeteringRows] =
    useState<Cost5DServerMeteringRows | null>(null);
  const [serverMeteringLoading, setServerMeteringLoading] = useState(false);
  const [meteringExporting, setMeteringExporting] = useState(false);
  const deferredSearch = useDeferredValue(search);
  const loadedModelKeys = useMemo(
    () =>
      models
        .map((model) => model.key)
        .filter((key): key is string => Boolean(key)),
    [models]
  );
  const runtimeModelIdByKey = useMemo(
    () => new Map(models.map((model) => [model.key, model.modelId])),
    [models]
  );
  const selectorSource = useMemo(
    () => getSmartViewSelectorSource(propertyIndex, propertyCatalog),
    [propertyCatalog, propertyIndex]
  );

  useEffect(() => {
    let cancelled = false;

    async function refreshServerAggregation() {
      if (
        !projectCode ||
        loadedModelKeys.length === 0 ||
        !mapping.itemId.set ||
        !mapping.itemId.property ||
        propertyIndex.sets.length > 0
      ) {
        setServerAggregation(null);
        return;
      }

      setServerAggregationLoading(true);
      const data = await loadCost5DAggregationFromDatabase({
        projectCode,
        modelKeys: loadedModelKeys,
        mapping
      });
      if (!cancelled) {
        setServerAggregation(data);
        setServerAggregationLoading(false);
      }
    }

    void refreshServerAggregation();
    return () => {
      cancelled = true;
    };
  }, [loadedModelKeys, mapping, projectCode, propertyIndex.sets.length]);

  const localRows = useMemo(
    () => buildCost5DRows({ models, propertyIndex, mapping }),
    [models, propertyIndex, mapping]
  );
  const serverRows = useMemo(
    () => serverCostRowsToCost5DRows(serverAggregation),
    [serverAggregation]
  );
  const rows = serverRows ?? localRows;
  const filteredRows = useMemo(() => {
    const normalized = deferredSearch.trim().toLowerCase();
    if (!normalized) return rows;

    return rows.filter((row) =>
      [row.itemId, row.itemName, row.itemUnit]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [rows, deferredSearch]);
  const totalQuantity = filteredRows.reduce((sum, row) => sum + row.quantity, 0);
  const totalElements = filteredRows.reduce((sum, row) => sum + row.elementCount, 0);
  const maxQuantity = Math.max(...filteredRows.map((row) => row.quantity), 1);
  const chartLimitCount =
    chartLimit === "all" ? filteredRows.length : Number(chartLimit);
  const chartRows = filteredRows.slice(0, chartLimitCount);
  const costChartBuckets = chartRows.map((row, index) => ({
    value: `${row.itemId} - ${row.itemName}`,
    count: Math.max(row.quantity, 0),
    color: getParameterAnalysisColor(index),
    modelIdMap: row.modelIdMap
  }));
  const activeMeteringColumns = useMemo(
    () => meteringColumns.filter((column) => column.set && column.property),
    [meteringColumns]
  );
  const shouldUseServerMetering =
    mode === "metrados" &&
    Boolean(projectCode) &&
    loadedModelKeys.length > 0 &&
    activeMeteringColumns.length > 0;
  const serverVisibleMeteringRows = useMemo<MeteringRow[]>(
    () =>
      serverMeteringRows?.rows.map((row) => ({
        key: row.key,
        modelId: runtimeModelIdByKey.get(row.modelKey) ?? row.modelKey,
        modelName: row.modelName,
        localId: row.localId,
        type: row.className,
        name: row.elementName,
        values: row.values
      })) ?? [],
    [runtimeModelIdByKey, serverMeteringRows]
  );
  const meteringRows = useMemo(
    () =>
      mode === "metrados" && !shouldUseServerMetering
        ? buildMeteringRows({
            models,
            propertyIndex,
            columns: activeMeteringColumns
          })
        : [],
    [activeMeteringColumns, mode, models, propertyIndex, shouldUseServerMetering]
  );
  const filteredMeteringRows = useMemo(() => {
    if (shouldUseServerMetering) return serverVisibleMeteringRows;

    const normalized = deferredSearch.trim().toLowerCase();
    if (!normalized) return meteringRows;

    return meteringRows.filter((row) =>
      [row.modelName, row.type, row.name, row.localId, ...row.values]
        .join(" ")
        .toLowerCase()
        .includes(normalized)
    );
  }, [deferredSearch, meteringRows, serverVisibleMeteringRows, shouldUseServerMetering]);
  const meteringTotalCount = shouldUseServerMetering
    ? serverMeteringRows?.total ?? 0
    : filteredMeteringRows.length;
  const meteringTotalPages = Math.max(
    1,
    Math.ceil(meteringTotalCount / meteringPageSize)
  );
  const safeMeteringPage = Math.min(meteringPage, meteringTotalPages - 1);
  const meteringPageStart = shouldUseServerMetering
    ? serverMeteringRows?.offset ?? safeMeteringPage * meteringPageSize
    : safeMeteringPage * meteringPageSize;
  const visibleMeteringRows = shouldUseServerMetering
    ? serverVisibleMeteringRows
    : filteredMeteringRows.slice(
        meteringPageStart,
        meteringPageStart + meteringPageSize
      );
  useEffect(() => {
    setMeteringPage(0);
  }, [activeMeteringColumns, deferredSearch, meteringPageSize, mode]);

  useEffect(() => {
    setMeteringPage((current) =>
      Math.min(current, Math.max(0, meteringTotalPages - 1))
    );
  }, [meteringTotalPages]);

  useEffect(() => {
    let cancelled = false;

    async function refreshServerMeteringRows() {
      if (!shouldUseServerMetering || !projectCode) {
        setServerMeteringRows(null);
        return;
      }

      setServerMeteringLoading(true);
      const data = await loadCost5DMeteringRowsFromDatabase({
        projectCode,
        modelKeys: loadedModelKeys,
        columns: activeMeteringColumns,
        search: deferredSearch,
        limit: meteringPageSize,
        offset: safeMeteringPage * meteringPageSize
      });
      if (!cancelled) {
        setServerMeteringRows(data);
        setServerMeteringLoading(false);
      }
    }

    void refreshServerMeteringRows();
    return () => {
      cancelled = true;
    };
  }, [
    activeMeteringColumns,
    deferredSearch,
    loadedModelKeys,
    meteringPageSize,
    projectCode,
    safeMeteringPage,
    shouldUseServerMetering
  ]);

  async function handleExportMeteringCsv() {
    if (shouldUseServerMetering) {
      setMeteringExporting(true);
      try {
        const exported = await exportCost5DMeteringRowsFromDatabase({
          projectCode,
          modelKeys: loadedModelKeys,
          columns: activeMeteringColumns,
          search: deferredSearch
        });
        if (exported) return;
      } finally {
        setMeteringExporting(false);
      }
    }

    if (visibleMeteringRows.length === 0) return;

    downloadTextFile(
      `metrados-${Date.now()}.csv`,
      buildMeteringCsv(visibleMeteringRows, activeMeteringColumns),
      "text/csv;charset=utf-8"
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
      <div className="border-b border-zinc-800 px-3 py-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-red-500">5D metrados</h3>
            <p className="text-xs text-zinc-400">
              Agrupa elementos federados por partida y cantidad.
            </p>
          </div>
          <button
            type="button"
            onClick={onBuildPropertyIndex}
            disabled={propertiesIndexLoading}
            className="min-h-8 shrink-0 rounded bg-red-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {propertiesIndexLoading ? "Indexando" : "Cargar parametros"}
          </button>
        </div>
        <div className="mt-3 flex gap-2">
          {(["partidas", "metrados"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setMode(item)}
              className={`min-h-8 rounded px-3 text-xs font-semibold ${
                mode === item
                  ? "bg-red-700 text-white"
                  : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {item === "partidas" ? "Partidas 5D" : "Metrados"}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        <BimIndexStatusCard
          overview={bimIndexOverview}
          loading={
            bimIndexOverviewLoading ||
            propertiesIndexLoading ||
            propertyCatalogLoading ||
            serverAggregationLoading ||
            serverMeteringLoading
          }
        />
        {serverRows && propertyIndex.sets.length === 0 ? (
          <div className="rounded border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs text-emerald-200">
            Partidas cargadas desde base de datos. Carga parametros solo si necesitas seleccionar elementos exactos en el visor.
          </div>
        ) : null}
        {mode === "metrados" ? (
          <>
            <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-semibold uppercase text-zinc-300">
                    Columnas de metrado
                  </div>
                  <p className="text-[11px] text-zinc-500">
                    Selecciona parametros libres mientras se completa el codigo de partida.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleExportMeteringCsv}
                  disabled={meteringExporting || activeMeteringColumns.length === 0 || (!shouldUseServerMetering && visibleMeteringRows.length === 0)}
                  className="min-h-8 rounded bg-zinc-800 px-3 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
                >{meteringExporting ? "Exportando" : "CSV"}</button>
              </div>
              <div className="space-y-2">
                {meteringColumns.map((column, index) => (
                  <div key={column.id} className="grid grid-cols-[1fr_80px] gap-2">
                    <Cost5DPropertySelector
                      label={column.label}
                      value={column}
                      selectorSource={selectorSource}
                      onChange={(nextColumn) =>
                        setMeteringColumns((current) =>
                          current.map((item) =>
                            item.id === column.id ? { ...item, ...nextColumn } : item
                          )
                        )
                      }
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setMeteringColumns((current) =>
                          current.filter((item) => item.id !== column.id)
                        )
                      }
                      disabled={meteringColumns.length <= 1}
                      className="mt-5 min-h-9 rounded bg-zinc-800 text-xs text-zinc-300 hover:bg-zinc-700 disabled:opacity-40"
                    >
                      Quitar
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={() =>
                  setMeteringColumns((current) => [
                    ...current,
                    {
                      id: `col-${Date.now()}`,
                      label: `Parametro ${current.length + 1}`,
                      set: "",
                      property: ""
                    }
                  ])
                }
                className="mt-2 min-h-8 rounded border border-zinc-700 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
              >
                Agregar columna
              </button>
            </div>

            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar elemento, clase, modelo o valor..."
              className="min-h-9 w-full rounded bg-zinc-900 px-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-red-600"
            />

            <div className="overflow-hidden rounded border border-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
                <span className="font-semibold uppercase text-zinc-300">
                  Tabla de metrados
                </span>
                <div className="flex flex-wrap items-center justify-end gap-2 text-zinc-500">
                  <span>
                    {serverMeteringLoading
                      ? "Cargando pagina..."
                      : meteringTotalCount === 0
                        ? "Sin filas"
                        : `${meteringPageStart + 1}-${Math.min(
                            meteringPageStart + visibleMeteringRows.length,
                            meteringTotalCount
                          )} de ${meteringTotalCount}`}
                  </span>
                  <select
                    value={meteringPageSize}
                    onChange={(event) =>
                      setMeteringPageSize(Number(event.target.value))
                    }
                    className="min-h-7 rounded bg-zinc-800 px-2 text-xs text-zinc-200 outline-none ring-1 ring-zinc-700"
                  >
                    <option value={100}>100</option>
                    <option value={150}>150</option>
                    <option value={300}>300</option>
                    <option value={500}>500</option>
                  </select>
                  <button
                    type="button"
                    onClick={() =>
                      setMeteringPage((current) => Math.max(0, current - 1))
                    }
                    disabled={safeMeteringPage === 0}
                    className="min-h-7 rounded bg-zinc-800 px-2 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span className="min-w-12 text-center text-[11px] text-zinc-500">
                    {safeMeteringPage + 1}/{meteringTotalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setMeteringPage((current) =>
                        Math.min(meteringTotalPages - 1, current + 1)
                      )
                    }
                    disabled={safeMeteringPage >= meteringTotalPages - 1}
                    className="min-h-7 rounded bg-zinc-800 px-2 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
                  >
                    Siguiente
                  </button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-xs">
                  <thead className="bg-zinc-900 text-zinc-400">
                    <tr>
                      <th className="px-2 py-2">Modelo</th>
                      <th className="px-2 py-2">Clase</th>
                      <th className="px-2 py-2">Elemento</th>
                      {activeMeteringColumns.map((column) => (
                        <th key={column.id} className="px-2 py-2">
                          {column.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleMeteringRows.map((row) => (
                      <tr
                        key={row.key}
                        className="border-t border-zinc-800 hover:bg-zinc-900"
                      >
                        <td className="max-w-[180px] truncate px-2 py-2 text-zinc-300">
                          {row.modelName}
                        </td>
                        <td className="px-2 py-2 text-zinc-300">{row.type}</td>
                        <td className="max-w-[220px] truncate px-2 py-2 text-zinc-100">
                          <button
                            type="button"
                            onClick={() =>
                              onSelectModelIdMap(
                                { [row.modelId]: new Set([row.localId]) },
                                `Elemento seleccionado: ${row.name}.`,
                                "No se pudo seleccionar el elemento."
                              )
                            }
                            title={row.name}
                            className="max-w-full truncate text-left hover:text-white"
                          >
                            {row.name}
                          </button>
                          <div className="text-[10px] text-zinc-500">
                            LocalId {row.localId}
                          </div>
                        </td>
                        {row.values.map((value, index) => (
                          <td
                            key={`${row.key}-${activeMeteringColumns[index]?.id ?? index}`}
                            className="max-w-[180px] truncate px-2 py-2 text-zinc-300"
                            title={value}
                          >
                            {value}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        ) : (
          <>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
          <div className="mb-2 text-xs font-semibold uppercase text-zinc-300">
            Mapeo de partida
          </div>
          <div className="space-y-2">
            <Cost5DPropertySelector
              label="ID partida"
              value={mapping.itemId}
              selectorSource={selectorSource}
              onChange={(itemId) => setMapping((current) => ({ ...current, itemId }))}
            />
            <Cost5DPropertySelector
              label="Nombre partida"
              value={mapping.itemName}
              selectorSource={selectorSource}
              onChange={(itemName) =>
                setMapping((current) => ({ ...current, itemName }))
              }
            />
            <Cost5DPropertySelector
              label="Unidad"
              value={mapping.itemUnit}
              selectorSource={selectorSource}
              onChange={(itemUnit) =>
                setMapping((current) => ({ ...current, itemUnit }))
              }
            />
            <Cost5DPropertySelector
              label="Cantidad"
              value={mapping.quantity}
              selectorSource={selectorSource}
              onChange={(quantity) =>
                setMapping((current) => ({ ...current, quantity }))
              }
            />
          </div>
          <p className="mt-2 text-[11px] text-zinc-500">
            Si cantidad no tiene valor numerico, se usa conteo de elementos.
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Partidas</div>
            <div className="text-lg font-semibold text-white">{filteredRows.length}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Elementos</div>
            <div className="text-lg font-semibold text-white">{totalElements}</div>
          </div>
          <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
            <div className="text-[10px] uppercase text-zinc-500">Cantidad</div>
            <div className="text-lg font-semibold text-emerald-300">
              {totalQuantity.toLocaleString("es-PE", {
                maximumFractionDigits: 2
              })}
            </div>
          </div>
        </div>

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar partida, nombre o unidad..."
          className="min-h-9 w-full rounded bg-zinc-900 px-3 text-sm text-white outline-none ring-1 ring-zinc-800 focus:ring-red-600"
        />

        <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
          <div className="mb-3 flex items-center justify-between text-xs">
            <span className="font-semibold uppercase text-zinc-300">
              Cantidades por partida
            </span>
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">
                {chartLimit === "all"
                  ? `${chartRows.length} partidas`
                  : `Top ${chartRows.length}`}
              </span>
              <select
                value={chartLimit}
                onChange={(event) =>
                  setChartLimit(
                    event.target.value === "all"
                      ? "all"
                      : event.target.value === "25"
                        ? "25"
                        : event.target.value === "10"
                          ? "10"
                          : "15"
                  )
                }
                className="min-h-8 rounded bg-zinc-800 px-2 text-xs text-white outline-none focus:ring-1 focus:ring-red-600"
              >
                <option value="10">Top 10</option>
                <option value="15">Top 15</option>
                <option value="25">Top 25</option>
                <option value="all">Todas</option>
              </select>
              <select
                value={chartMode}
                onChange={(event) =>
                  setChartMode(event.target.value === "donut" ? "donut" : "bars")
                }
                className="min-h-8 rounded bg-zinc-800 px-2 text-xs text-white outline-none focus:ring-1 focus:ring-red-600"
              >
                <option value="bars">Barras</option>
                <option value="donut">Circular</option>
              </select>
            </div>
          </div>
          {chartRows.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Carga parametros y selecciona al menos ID o nombre de partida.
            </p>
          ) : chartMode === "donut" ? (
            <div>
              <div
                className="mx-auto h-36 w-36 rounded-full border border-zinc-700"
                style={{
                  background: `conic-gradient(${buildParameterDonutGradient(
                    costChartBuckets
                  )})`
                }}
              />
              <div className="mt-4 space-y-1">
                {chartRows.map((row, index) => {
                  const percent = Math.round(
                    (row.quantity / Math.max(totalQuantity, 1)) * 100
                  );
                  const color = getParameterAnalysisColor(index);

                  return (
                    <button
                      key={row.key}
                      type="button"
                      onClick={() => onSelectRow(row)}
                      className="grid w-full grid-cols-[12px_1fr_auto] items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-zinc-800"
                    >
                      <span
                        className="h-3 w-3 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                      <span className="min-w-0 truncate text-zinc-200">
                        {row.itemId} - {row.itemName}
                      </span>
                      <span className="text-zinc-400">{percent}%</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {chartRows.map((row, index) => {
                const width = Math.max(
                  4,
                  Math.round((row.quantity / maxQuantity) * 100)
                );
                const color = getParameterAnalysisColor(index);

                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => onSelectRow(row)}
                    className="block w-full rounded border border-zinc-800 bg-zinc-950 p-2 text-left hover:border-red-700"
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0">
                        <span className="block truncate font-semibold text-zinc-100">
                          {row.itemId} - {row.itemName}
                        </span>
                        <span className="block text-[10px] text-zinc-500">
                          {row.elementCount} elem. / {row.geometryCount} geom.
                        </span>
                      </span>
                      <span className="shrink-0 text-zinc-400">
                        {row.quantity.toLocaleString("es-PE", {
                          maximumFractionDigits: 2
                        })}{" "}
                        {row.itemUnit}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded bg-zinc-800">
                      <div
                        className="h-full rounded"
                        style={{ width: `${width}%`, backgroundColor: color }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="overflow-hidden rounded border border-zinc-800">
          <div className="flex items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-xs">
            <span className="font-semibold uppercase text-zinc-300">
              Detalle de partidas
            </span>
            <span className="text-zinc-500">
              {filteredRows.length > 80
                ? `Primeras 80 de ${filteredRows.length}`
                : `${filteredRows.length} filas`}
            </span>
          </div>
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Partida</th>
                <th className="px-2 py-2 text-right">Cant.</th>
                <th className="px-2 py-2">Und.</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.slice(0, 80).map((row) => (
                <tr
                  key={row.key}
                  className="border-t border-zinc-800 hover:bg-zinc-900"
                >
                  <td className="px-2 py-2 font-semibold text-zinc-100">
                    <button type="button" onClick={() => onSelectRow(row)}>
                      {row.itemId}
                    </button>
                  </td>
                  <td className="max-w-[180px] truncate px-2 py-2 text-zinc-300">
                    <button
                      type="button"
                      onClick={() => onSelectRow(row)}
                      title={row.itemName}
                      className="max-w-full truncate text-left hover:text-white"
                    >
                      {row.itemName}
                    </button>
                    <div className="text-[10px] text-zinc-500">
                      {row.elementCount} elem. / {row.geometryCount} geom. -{" "}
                      {row.modelCount} modelo(s)
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right text-zinc-100">
                    {row.quantity.toLocaleString("es-PE", {
                      maximumFractionDigits: 2
                    })}
                  </td>
                  <td className="px-2 py-2 text-zinc-400">{row.itemUnit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
          </>
        )}
      </div>
    </section>
  );
}

const AUDIT_OPERATOR_LABELS: Record<AuditOperator, string> = {
  exists: "Existe",
  missing: "No existe",
  equals: "Igual a",
  not_equals: "Distinto de",
  contains: "Contiene",
  empty: "Vacio",
  not_empty: "No vacio"
};

function AuditBarList({
  title,
  items
}: {
  title: string;
  items: Array<{ name: string; pass: number; fail: number }>;
}) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 p-3">
      <h4 className="mb-2 text-xs font-semibold uppercase text-zinc-400">
        {title}
      </h4>
      <div className="space-y-2">
        {items.length === 0 ? (
          <div className="text-xs text-zinc-500">Sin datos.</div>
        ) : (
          items.map((item) => {
            const total = Math.max(item.pass + item.fail, 1);
            const failWidth = Math.round((item.fail / total) * 100);

            return (
              <div key={item.name} className="grid grid-cols-[90px_1fr_38px] items-center gap-2 text-xs">
                <span className="truncate text-zinc-300" title={item.name}>
                  {item.name}
                </span>
                <div className="h-2 overflow-hidden rounded bg-zinc-800">
                  <div
                    className="h-full rounded bg-red-600"
                    style={{ width: `${failWidth}%` }}
                  />
                </div>
                <span className="text-right tabular-nums text-red-300">
                  {item.fail}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function AuditPanel({
  models,
  rules,
  results,
  summary,
  message,
  propertyIndex,
  propertiesIndexLoading,
  auditLoading,
  activeResultId,
  onBuildPropertyIndex,
  onAddRule,
  onUpdateRule,
  onDeleteRule,
  onRunAudit,
  onSelectResult,
  onExportCsv,
  onExportHtml,
  onPrintReport
}: {
  models: FederatedModelEntry[];
  rules: AuditRule[];
  results: AuditResult[];
  summary: AuditSummary;
  message: string;
  propertyIndex: SmartViewPropertyIndex;
  propertiesIndexLoading: boolean;
  auditLoading: boolean;
  activeResultId: string | null;
  onBuildPropertyIndex: () => void;
  onAddRule: () => void;
  onUpdateRule: (id: string, patch: Partial<AuditRule>) => void;
  onDeleteRule: (id: string) => void;
  onRunAudit: () => void;
  onSelectResult: (result: AuditResult) => void;
  onExportCsv: () => void;
  onExportHtml: () => void;
  onPrintReport: () => void;
}) {
  const [resultFilter, setResultFilter] = useState<"all" | "fail" | "pass">("fail");
  const [query, setQuery] = useState("");
  const typeOptions = useMemo(() => {
    const types = new Set<string>();
    for (const model of models) {
      for (const node of flattenModelTreeNodes(model.spatialTree ?? [])) {
        if (isModelTreeElement(node)) types.add(node.type.toUpperCase());
      }
    }
    return Array.from(types).sort((a, b) => a.localeCompare(b));
  }, [models]);
  const levelOptions = useMemo(() => {
    const levels = new Set<string>();
    for (const model of models) {
      for (const level of collectLeafLevelNodes(model.spatialTree ?? [])) {
        levels.add(level.name);
      }
    }
    return Array.from(levels).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
  }, [models]);
  const filteredResults = results.filter((result) => {
    if (resultFilter !== "all" && result.status !== resultFilter) return false;
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    return [
      result.ruleName,
      result.modelName,
      result.level,
      result.type,
      result.elementName,
      result.globalId,
      result.actualValue
    ]
      .join(" ")
      .toLowerCase()
      .includes(normalizedQuery);
  });
  const failRate =
    summary.total > 0 ? Math.round((summary.failed / summary.total) * 100) : 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-zinc-950 px-4 py-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-red-400">Auditoria</h3>
          <p className="truncate text-xs text-zinc-500">
            Requisitos, inspeccion federada y reportes
          </p>
        </div>
        <button
          type="button"
          onClick={onAddRule}
          className="min-h-8 shrink-0 rounded bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-600"
        >
          Nueva regla
        </button>
      </div>

      <div className="mb-3 grid grid-cols-4 gap-2">
        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
          <div className="text-[10px] uppercase text-zinc-500">Evaluados</div>
          <div className="text-lg font-semibold text-zinc-100">{summary.total}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
          <div className="text-[10px] uppercase text-zinc-500">Cumplen</div>
          <div className="text-lg font-semibold text-emerald-300">{summary.passed}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
          <div className="text-[10px] uppercase text-zinc-500">Fallan</div>
          <div className="text-lg font-semibold text-red-300">{summary.failed}</div>
        </div>
        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
          <div className="text-[10px] uppercase text-zinc-500">Falla %</div>
          <div className="text-lg font-semibold text-red-300">{failRate}%</div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-2">
        <AuditBarList title="Por requisito" items={summary.byRule.slice(0, 5)} />
        <AuditBarList title="Por clase" items={summary.byType.slice(0, 5)} />
      </div>

      <div className="mb-3 space-y-2 rounded border border-zinc-800 bg-zinc-900 p-3">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-xs font-semibold uppercase text-zinc-400">
            Requisitos
          </h4>
          <button
            type="button"
            onClick={onBuildPropertyIndex}
            disabled={propertiesIndexLoading || models.length === 0}
            className="min-h-7 rounded bg-zinc-800 px-2 text-xs text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          >
            {propertiesIndexLoading
              ? "Indexando..."
              : propertyIndex.sets.length > 0
                ? `${propertyIndex.sets.length} Psets`
                : "Cargar Psets"}
          </button>
        </div>

        {message ? (
          <div className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-zinc-300">
            {message}
          </div>
        ) : null}

        {rules.length === 0 ? (
          <div className="rounded border border-dashed border-zinc-700 p-3 text-sm text-zinc-500">
            Crea una regla para auditar propiedades IFC.
          </div>
        ) : (
          <div className="space-y-3">
            {rules.map((rule) => {
              const propertyNameOptions = rule.propertySet
                ? propertyIndex.propertiesBySet[rule.propertySet] ?? []
                : [];
              const propertyValueOptions = rule.propertyName
                ? propertyIndex.valuesBySetAndProperty[rule.propertySet]?.[
                    rule.propertyName
                  ] ?? []
                : [];

              return (
                <div key={rule.id} className="space-y-2 rounded border border-zinc-800 bg-zinc-950 p-2">
                  <div className="grid grid-cols-[1fr_84px_28px] gap-2">
                    <input
                      value={rule.name}
                      onChange={(event) => onUpdateRule(rule.id, { name: event.target.value })}
                      className="min-h-8 rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
                      placeholder="Nombre del requisito"
                    />
                    <select
                      value={rule.severity}
                      onChange={(event) =>
                        onUpdateRule(rule.id, {
                          severity: event.target.value as AuditRule["severity"]
                        })
                      }
                      className="min-h-8 rounded bg-zinc-800 px-2 text-xs text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
                    >
                      <option value="low">Baja</option>
                      <option value="medium">Media</option>
                      <option value="high">Alta</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => onDeleteRule(rule.id)}
                      className="h-8 rounded bg-zinc-800 text-zinc-400 hover:text-red-300"
                      title="Eliminar requisito"
                    >
                      x
                    </button>
                  </div>

                  <select
                    value={rule.modelKey}
                    onChange={(event) => onUpdateRule(rule.id, { modelKey: event.target.value })}
                    className="min-h-8 w-full rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
                  >
                    <option value="">Todos los modelos</option>
                    {models.map((model) => (
                      <option key={model.key} value={model.key}>{model.name}</option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={rule.type}
                      onChange={(event) => onUpdateRule(rule.id, { type: event.target.value })}
                      className="min-h-8 min-w-0 rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
                    >
                      <option value="">Todas las clases</option>
                      {typeOptions.map((type) => (
                        <option key={type} value={type}>{prettyIfcCategory(type)}</option>
                      ))}
                    </select>
                    <select
                      value={rule.level}
                      onChange={(event) => onUpdateRule(rule.id, { level: event.target.value })}
                      className="min-h-8 min-w-0 rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
                    >
                      <option value="">Todos los niveles</option>
                      {levelOptions.map((level) => (
                        <option key={level} value={level}>{level}</option>
                      ))}
                    </select>
                  </div>

                  <select
                    value={rule.propertySet}
                    onChange={(event) =>
                      onUpdateRule(rule.id, {
                        propertySet: event.target.value,
                        propertyName: "",
                        value: ""
                      })
                    }
                    disabled={propertyIndex.sets.length === 0}
                    className="min-h-8 w-full rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-60"
                  >
                    <option value="">Seleccionar conjunto</option>
                    {propertyIndex.sets.map((setName) => (
                      <option key={setName} value={setName}>{setName}</option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={rule.propertyName}
                      onChange={(event) =>
                        onUpdateRule(rule.id, {
                          propertyName: event.target.value,
                          value: ""
                        })
                      }
                      disabled={!rule.propertySet}
                      className="min-h-8 min-w-0 rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-60"
                    >
                      <option value="">Seleccionar propiedad</option>
                      {propertyNameOptions.map((name) => (
                        <option key={name} value={name}>{name}</option>
                      ))}
                    </select>
                    <select
                      value={rule.operator}
                      onChange={(event) =>
                        onUpdateRule(rule.id, {
                          operator: event.target.value as AuditOperator
                        })
                      }
                      className="min-h-8 min-w-0 rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
                    >
                      {Object.entries(AUDIT_OPERATOR_LABELS).map(([operator, label]) => (
                        <option key={operator} value={operator}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <select
                    value={rule.value}
                    onChange={(event) => onUpdateRule(rule.id, { value: event.target.value })}
                    disabled={!["equals", "not_equals", "contains"].includes(rule.operator)}
                    className="min-h-8 w-full rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600 disabled:opacity-60"
                  >
                    <option value="">
                      {["equals", "not_equals", "contains"].includes(rule.operator)
                        ? "Seleccionar valor"
                        : "Valor no requerido"}
                    </option>
                    {propertyValueOptions.map((value) => (
                      <option key={value} value={value}>{value}</option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 pt-1">
          <button
            type="button"
            onClick={onRunAudit}
            disabled={auditLoading || rules.length === 0 || models.length === 0}
            className="min-h-8 rounded bg-red-700 px-3 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-50"
          >
            {auditLoading ? "Auditando..." : "Ejecutar"}
          </button>
          <button
            type="button"
            onClick={onExportCsv}
            disabled={results.length === 0}
            className="min-h-8 rounded bg-zinc-800 px-3 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          >{"CSV"}</button>
          <button
            type="button"
            onClick={onPrintReport}
            disabled={results.length === 0}
            className="min-h-8 rounded bg-zinc-800 px-3 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
          >
            PDF
          </button>
        </div>
        <button
          type="button"
          onClick={onExportHtml}
          disabled={results.length === 0}
          className="min-h-8 w-full rounded bg-zinc-800 px-3 text-sm text-zinc-200 hover:bg-zinc-700 disabled:opacity-50"
        >
          Exportar reporte HTML
        </button>
      </div>

      <div className="mb-2 grid grid-cols-[1fr_120px] gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar resultados..."
          className="min-h-8 rounded bg-zinc-800 px-3 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-red-600"
        />
        <select
          value={resultFilter}
          onChange={(event) => setResultFilter(event.target.value as typeof resultFilter)}
          className="min-h-8 rounded bg-zinc-800 px-2 text-sm text-zinc-100 outline-none focus:ring-1 focus:ring-red-600"
        >
          <option value="fail">Fallas</option>
          <option value="all">Todos</option>
          <option value="pass">Cumplen</option>
        </select>
      </div>

      <div className="min-h-64 overflow-auto rounded border border-zinc-800">
        <table className="min-w-[980px] w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 bg-zinc-900 text-zinc-400">
            <tr>
              <th className="border-b border-zinc-800 px-2 py-2">Estado</th>
              <th className="border-b border-zinc-800 px-2 py-2">Regla</th>
              <th className="border-b border-zinc-800 px-2 py-2">Modelo</th>
              <th className="border-b border-zinc-800 px-2 py-2">Nivel</th>
              <th className="border-b border-zinc-800 px-2 py-2">Clase</th>
              <th className="border-b border-zinc-800 px-2 py-2">Elemento</th>
              <th className="border-b border-zinc-800 px-2 py-2">Valor</th>
            </tr>
          </thead>
          <tbody>
            {filteredResults.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  Sin resultados para mostrar.
                </td>
              </tr>
            ) : (
              filteredResults.slice(0, 500).map((result) => (
                <tr
                  key={result.id}
                  onClick={() => onSelectResult(result)}
                  className={`cursor-pointer border-b border-zinc-900 hover:bg-zinc-900 ${
                    activeResultId === result.id ? "bg-red-950/25" : ""
                  }`}
                >
                  <td className="px-2 py-2">
                    <span className={result.status === "pass" ? "text-emerald-300" : "text-red-300"}>
                      {result.status === "pass" ? "Cumple" : "Falla"}
                    </span>
                  </td>
                  <td className="max-w-40 truncate px-2 py-2 text-zinc-200" title={result.ruleName}>{result.ruleName}</td>
                  <td className="max-w-44 truncate px-2 py-2 text-zinc-400" title={result.modelName}>{result.modelName}</td>
                  <td className="px-2 py-2 text-zinc-400">{result.level || "-"}</td>
                  <td className="px-2 py-2 text-zinc-300">{prettyIfcCategory(result.type)}</td>
                  <td className="max-w-56 truncate px-2 py-2 text-zinc-200" title={result.elementName}>{result.elementName}</td>
                  <td className="max-w-56 truncate px-2 py-2 text-zinc-400" title={result.actualValue}>{result.actualValue}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function IfcModelsPanelV2({
  models,
  propertyIndex,
  propertiesIndexLoading,
  onBuildLevelIndex,
  onAddModel,
  onToggleModelVisibility,
  onToggleModelExpanded,
  onRemoveModel,
  onFocusModel,
  onIsolateModel,
  onSelectTreeNode,
  onIsolateTreeNode,
  onToggleTreeNodeVisibility
}: {
  models: FederatedModelEntry[];
  projectCode?: string;
  propertyIndex: SmartViewPropertyIndex;
  propertiesIndexLoading: boolean;
  onBuildLevelIndex: () => void;
  onAddModel: () => void;
  onToggleModelVisibility: (key: string) => void;
  onToggleModelExpanded: (key: string) => void;
  onRemoveModel: (key: string) => void;
  onFocusModel: (key: string) => void;
  onIsolateModel: (key: string) => void;
  onSelectTreeNode: (modelKey: string, node: ModelTreeNode) => void;
  onIsolateTreeNode: (modelKey: string, node: ModelTreeNode) => void;
  onToggleTreeNodeVisibility: (
    modelKey: string,
    node: ModelTreeNode,
    hidden: boolean
  ) => void;
}) {
  const [query, setQuery] = useState("");
  const [treeMode, setTreeMode] = useState<ModelTreeMode>("spatial");
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | undefined>();
  const [hiddenNodeIds, setHiddenNodeIds] = useState<Set<string>>(new Set());
  const levelIndexRequestedRef = useRef(false);
  const modelKeysSignature = models.map((model) => model.key).join("|");
  const normalizedQuery = query.trim().toLowerCase();

  const visibleModels = normalizedQuery
    ? models.filter((model) => model.name.toLowerCase().includes(normalizedQuery))
    : models;

  useEffect(() => {
    levelIndexRequestedRef.current = false;
  }, [modelKeysSignature]);

  useEffect(() => {
    if (
      treeMode === "level" &&
      models.length > 0 &&
      !propertiesIndexLoading &&
      !levelIndexRequestedRef.current
    ) {
      levelIndexRequestedRef.current = true;
      onBuildLevelIndex();
    }
  }, [
    modelKeysSignature,
    models.length,
    onBuildLevelIndex,
    propertiesIndexLoading,
    treeMode
  ]);

  useEffect(() => {
    setExpandedNodes((current) => {
      const next = new Set(current);

      for (const model of models) {
        if (!model.expanded || !model.spatialTree?.length) continue;

        for (const id of collectDefaultExpandedTreeNodeIds(model.spatialTree)) {
          next.add(id);
        }
      }

      return next;
    });
  }, [models]);

  function toggleNode(id: string) {
    setExpandedNodes((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-zinc-950">
      <div className="border-b border-zinc-800 px-4 py-3">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-red-400">Models</h3>
          <span className="text-xs text-zinc-500">{models.length}</span>
        </div>

        <div className="mb-3 grid grid-cols-3 gap-1 rounded bg-zinc-900 p-1">
          {[
            ["spatial", "Estructura", "filter"],
            ["level", "Nivel", "isolate"],
            ["type", "Tipo", "box"]
          ].map(([mode, label, icon]) => {
            const active = treeMode === mode;

            return (
              <button
                key={mode}
                type="button"
                onClick={() => setTreeMode(mode as ModelTreeMode)}
                className={`flex min-h-8 items-center justify-center gap-1 rounded text-xs ${
                  active
                    ? "bg-zinc-800 text-white"
                    : "text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                }`}
                title={`Organizar por ${label}`}
              >
                <PanelIcon name={icon as "filter" | "isolate" | "plus"} />
                <span className="hidden text-[11px] xl:inline">{label}</span>
              </button>
            );
          })}
        </div>

        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search..."
            className="min-h-8 min-w-0 flex-1 rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-red-600"
          />
          <button
            type="button"
            onClick={onAddModel}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-zinc-800 text-lg text-zinc-200 hover:bg-zinc-700"
            title="Agregar modelos"
          >
            +
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {models.length === 0 ? (
          <div className="rounded border border-zinc-800 px-3 py-4 text-sm text-zinc-400">
            No hay modelos cargados.
          </div>
        ) : visibleModels.length === 0 ? (
          <div className="rounded border border-zinc-800 px-3 py-4 text-sm text-zinc-400">
            No hay modelos para esta busqueda.
          </div>
        ) : (
          <div className="space-y-1">
            {visibleModels.map((model) => {
              const sourceTreeNodes = model.spatialTree ?? [];
              const treeNodes = getTreeNodesForMode(
                sourceTreeNodes,
                treeMode,
                propertyIndex.levelLocalIdsByModelKey?.[model.key]
              );
              const nodeCount = countModelTreeNodes(sourceTreeNodes);

              return (
                <div
                  key={model.key}
                  className={`overflow-hidden rounded border ${
                    model.isSelected
                      ? "border-red-600 bg-red-950/25"
                      : "border-zinc-800 bg-zinc-900"
                  }`}
                >
                  <div className="grid grid-cols-[22px_1fr_26px_26px_26px_26px] items-center gap-1 px-2 py-2">
                    <button
                      type="button"
                      onClick={() => onToggleModelExpanded(model.key)}
                      className="flex h-6 w-6 items-center justify-center text-zinc-400 hover:text-white"
                      title={model.expanded ? "Colapsar" : "Expandir"}
                    >
                      {model.expanded ? "v" : ">"}
                    </button>

                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-zinc-100">
                        {model.name}
                      </div>
                      <div className="truncate text-[10px] uppercase text-zinc-500">
                        {model.source.kind} - {nodeCount || 1} elements
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={() => onToggleModelVisibility(model.key)}
                      className={`flex h-6 w-6 items-center justify-center rounded text-xs ${
                        model.visible
                          ? "text-zinc-200 hover:bg-zinc-800"
                          : "bg-zinc-800 text-zinc-500"
                      }`}
                      title={model.visible ? "Ocultar modelo" : "Mostrar modelo"}
                    >
                      <PanelIcon name={model.visible ? "eye" : "eyeOff"} />
                    </button>

                    <button
                      type="button"
                      onClick={() => onFocusModel(model.key)}
                      className="flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-300 hover:bg-zinc-800"
                      title="Enfocar modelo"
                    >
                      <PanelIcon name="focus" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onIsolateModel(model.key)}
                      className="flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-300 hover:bg-zinc-800"
                      title="Aislar modelo"
                    >
                      <PanelIcon name="isolate" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onRemoveModel(model.key)}
                      className="flex h-6 w-6 items-center justify-center rounded text-xs text-zinc-400 hover:bg-red-950 hover:text-red-300"
                      title="Quitar modelo"
                    >
                      <PanelIcon name="trash" />
                    </button>
                  </div>

                  {model.expanded ? (
                    <div className="border-t border-zinc-800 bg-zinc-950 py-1">
                      {model.spatialTreeLoading ? (
                        <div className="px-4 py-3 text-xs text-zinc-500">
                          Leyendo jerarquia IFC...
                        </div>
                      ) : model.spatialTreeError ? (
                        <div className="px-4 py-3 text-xs text-amber-300">
                          {model.spatialTreeError}
                        </div>
                      ) : treeNodes.length ? (
                        <ModelTreeRows
                          nodes={treeNodes}
                          expandedNodes={expandedNodes}
                          selectedNodeId={selectedNodeId}
                          hiddenNodeIds={hiddenNodeIds}
                          onToggleNode={toggleNode}
                          onSelectNode={(node) => {
                            setSelectedNodeId(node.id);
                            onSelectTreeNode(model.key, node);
                          }}
                          onIsolateNode={(node) => {
                            setSelectedNodeId(node.id);
                            onIsolateTreeNode(model.key, node);
                          }}
                          onToggleNodeVisibility={(node) => {
                            const nextHidden = !hiddenNodeIds.has(node.id);

                            setHiddenNodeIds((current) => {
                              const next = new Set(current);

                              if (nextHidden) {
                                next.add(node.id);
                              } else {
                                next.delete(node.id);
                              }

                              return next;
                            });

                            onToggleTreeNodeVisibility(model.key, node, nextHidden);
                          }}
                        />
                      ) : (
                        <div className="px-4 py-3 text-xs text-zinc-500">
                          Este modelo no expone jerarquia IFC.
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}

export function IfcViewerCanvas({
  sources,
  documentNames = [],
  documentPaths = [],
  projectCode = ""
}: IfcViewerCanvasProps) {
  const { data: session } = useSession();

  const currentAuthor =
    session?.user?.name ||
    session?.user?.email ||
    "Usuario";   
  
  const [newComment, setNewComment] = useState("");
  const [pendingTopicCommentText, setPendingTopicCommentText] = useState("");
  const [pendingTopicDraft, setPendingTopicDraft] = useState<{
    topic: BcfTopic;
    viewpoint: ViewerViewpoint;
  } | null>(null);
  const [projectMembers, setProjectMembers] = useState<ProjectMember[]>([]);
  const [projectMembersLoading, setProjectMembersLoading] = useState(false);
  const [topicSearch, setTopicSearch] = useState("");
  const [topicStatusFilter, setTopicStatusFilter] = useState<"all" | BcfTopic["status"]>("all");
  const [topicPriorityFilter, setTopicPriorityFilter] = useState<"all" | BcfTopic["priority"]>("all");
  const [pendingAnnotationText, setPendingAnnotationText] = useState<string | null>(null);
  const [annotationInput, setAnnotationInput] = useState<{
    visible: boolean;
    x: number;
    y: number;
    text: string;
    position: THREE.Vector3 | null;
  }>({
    visible: false,
    x: 0,
    y: 0,
    text: "",
    position: null
  });
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [topics, setTopics] = useState<BcfTopic[]>([]);
  const [viewerAnnotations, setViewerAnnotations] = useState<BcfTopic["annotations"]>([]);
  const [viewerMeasurements, setViewerMeasurements] = useState<BcfTopic["measurements"]>([]);
  const [isTopicDetailOpen, setIsTopicDetailOpen] = useState(false);
  const rendererRef = useRef<unknown>(null);
  const initialSourcesRef = useRef(sources);
  const initialDocumentNamesRef = useRef(documentNames);
  const loadedSourceKeysRef = useRef<Set<string>>(new Set());
  const hasLoadedAnyModelRef = useRef(false);
  const annotationModeRef = useRef(false);
  const measurementModeRef = useRef<ViewerMeasurementMode | null>(null);
  const measurementSnapConfigRef = useRef<ViewerSnapConfig>({
    point: true,
    edge: true,
    face: true
  });
  const pendingAnnotationTextRef = useRef<string | null>(null);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewerFrameRef = useRef<HTMLDivElement | null>(null);
  const modulesRef = useRef<ReturnType<typeof setupViewerModules> | null>(null);
  const viewerRef = useRef<ViewerRuntime | null>(null);
  const modelsGroupRef = useRef<THREE.Group | null>(null);
  const selectionDataTimeoutRef = useRef<number | null>(null);
  const propertiesCacheRef = useRef<Map<string, Record<string, unknown>[]>>(
    new Map()
  );
  /** Indice estable customTopic.id <-> nativeTopic.guid */
  const customToNativeTopicMapRef = useRef<Map<string, string>>(new Map());
  const nativeToCustomTopicMapRef = useRef<Map<string, string>>(new Map());
  const reconstructedNativeViewpointMapRef = useRef<Map<string, string>>(new Map());
  const loadedModelResultsRef = useRef<LoadedViewerModelResult[]>([]);
  const lastSectionBoxSelectionRef = useRef<OBC.ModelIdMap | null>(null);
  const lastColoredSelectionRef = useRef<OBC.ModelIdMap | null>(null);
  const lastGhostedSelectionRef = useRef<OBC.ModelIdMap | null>(null);
  const visibilityUniverseCacheRef = useRef<Map<string, number[]>>(new Map());
  const expandedModelIdMapCacheRef = useRef<Map<string, OBC.ModelIdMap>>(new Map());
  const flattenedTreeCacheRef = useRef<Map<string, ModelTreeNode[]>>(new Map());
  const levelMapCacheRef = useRef<Map<string, Map<number, string>>>(new Map());
  const smartViewModelIdMapCacheRef = useRef<Map<string, OBC.ModelIdMap>>(new Map());
  const smartViewIndexRunRef = useRef(0);
  const renderOperationTokenRef = useRef(0);
  const smartViewIndexInFlightSignatureRef = useRef<string | null>(null);

  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("properties");
  const activeRightPanelGroup = getRightPanelGroup(rightPanelTab);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [showViewerStats, setShowViewerStats] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [status, setStatus] = useState("Inicializando visor...");
  const [viewpoints, setViewpoints] = useState<ViewerViewpoint[]>([]);
  const [viewpointsLoaded, setViewpointsLoaded] = useState(false);
  const [bim2DViews, setBim2DViews] = useState<Bim2DViewEntry[]>([]);
  const [activeBim2DViewId, setActiveBim2DViewId] = useState<string | null>(null);
  const [bim2DViewsLoading, setBim2DViewsLoading] = useState(false);
  const skipNextViewpointsPersistRef = useRef(false);
  const [clipperEnabled, setClipperEnabled] = useState(false);
  const [selectedItemsData, setSelectedItemsData] = useState<
    Record<string, unknown>[]
  >([]);
  const [propertiesRequested, setPropertiesRequested] = useState(false);
  const [propertiesLoading, setPropertiesLoading] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const [selectedColor, setSelectedColor] = useState("#e30613");
  const [sectionBoxPadding, setSectionBoxPadding] = useState(0.2);
  const [measurementSnapConfig, setMeasurementSnapConfig] =
    useState<ViewerSnapConfig>({
      point: true,
      edge: true,
      face: true
    });
  const [containmentData, setContainmentData] = useState<
    Record<string, unknown>[]
  >([]);
  const [associationsData, setAssociationsData] = useState<
    Record<string, unknown>[]
  >([]);

  useEffect(() => {
    measurementSnapConfigRef.current = measurementSnapConfig;
  }, [measurementSnapConfig]);
  const [containmentLoading, setContainmentLoading] = useState(false);
  const [associationsLoading, setAssociationsLoading] = useState(false);
  const [models, setModels] = useState<FederatedModelEntry[]>([]);
  const [savedSmartViews, setSavedSmartViews] = useState<SavedSmartView[]>([]);
  const [auditRules, setAuditRules] = useState<AuditRule[]>([]);
  const [auditResults, setAuditResults] = useState<AuditResult[]>([]);
  const [auditIndex, setAuditIndex] = useState<AuditElementRecord[]>([]);
  const [auditIndexSignature, setAuditIndexSignature] = useState("");
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditMessage, setAuditMessage] = useState("");
  const [activeAuditResultId, setActiveAuditResultId] = useState<string | null>(null);
  const [smartViewPropertyIndex, setSmartViewPropertyIndex] =
    useState<SmartViewPropertyIndex>({
      sets: [],
      propertiesBySet: {},
      valuesBySetAndProperty: {},
      localIdsBySetPropertyValue: {}
    });
  const [smartViewPropertiesIndexLoading, setSmartViewPropertiesIndexLoading] =
    useState(false);
  const [smartViewPropertyCatalog, setSmartViewPropertyCatalog] =
    useState<SmartViewPropertyCatalog | null>(null);
  const [smartViewPropertyCatalogLoading, setSmartViewPropertyCatalogLoading] =
    useState(false);
  const [bimIndexOverview, setBimIndexOverview] =
    useState<BimIndexOverview | null>(null);
  const [bimIndexOverviewLoading, setBimIndexOverviewLoading] = useState(false);
  const [smartViewPropertyIndexSignature, setSmartViewPropertyIndexSignature] =
    useState("");
  const [openProjectProjectId, setOpenProjectProjectId] = useState<string>("");
  const [viewerLoadMs, setViewerLoadMs] = useState<number | null>(null);
  const [viewerStats, setViewerStats] = useState<ViewerPerformanceStats>({
    fps: 0,
    heapUsedMb: null,
    heapLimitMb: null,
    geometries: null,
    textures: null,
    triangles: null,
    calls: null,
    loadedModels: 0,
    visibleModels: 0,
    treeNodes: 0,
    loadMs: null
  });

  const primaryDocumentPath = documentPaths[0] ?? sources[0]?.documentPath;
  const primaryDocumentName = documentNames[0] ?? sources[0]?.documentName;
  const loadedModelsSignature = useMemo(
    () => getFederatedModelsAnalysisSignature(models),
    [models]
  );
  const loadedModelKeys = useMemo(
    () => models.map((model) => model.key).filter(Boolean),
    [loadedModelsSignature]
  );
  useEffect(() => {
    visibilityUniverseCacheRef.current.clear();
    expandedModelIdMapCacheRef.current.clear();
    flattenedTreeCacheRef.current.clear();
    levelMapCacheRef.current.clear();
    smartViewModelIdMapCacheRef.current.clear();
  }, [loadedModelsSignature]);
  const viewerTreeNodes = useMemo(
    () =>
      models.reduce(
        (total, model) => total + countModelTreeNodes(model.spatialTree ?? []),
        0
      ),
    [models]
  );
  const smartViewsStorageKey = useMemo(
    () =>
      `typsa-cde:smartviews:${projectCode ?? "global"}:${
        primaryDocumentName ?? "viewer"
      }`,
    [primaryDocumentName, projectCode]
  );
  const refreshSmartViewPropertyCatalog = useCallback(async () => {
    if (!projectCode || loadedModelKeys.length === 0) {
      setSmartViewPropertyCatalog(null);
      return;
    }

    setSmartViewPropertyCatalogLoading(true);
    try {
      const catalog = await loadSmartViewPropertyCatalogFromDatabase({
        projectCode,
        modelKeys: loadedModelKeys
      });
      setSmartViewPropertyCatalog(catalog);
    } finally {
      setSmartViewPropertyCatalogLoading(false);
    }
  }, [loadedModelKeys, projectCode]);

  useEffect(() => {
    void refreshSmartViewPropertyCatalog();
  }, [refreshSmartViewPropertyCatalog]);

  const refreshBimIndexOverview = useCallback(async () => {
    if (!projectCode) {
      setBimIndexOverview(null);
      return;
    }

    setBimIndexOverviewLoading(true);
    try {
      setBimIndexOverview(await loadBimIndexOverview(projectCode));
    } finally {
      setBimIndexOverviewLoading(false);
    }
  }, [projectCode]);

  useEffect(() => {
    void refreshBimIndexOverview();
  }, [refreshBimIndexOverview]);

  const auditRulesStorageKey = useMemo(
    () =>
      `typsa-cde:audit-rules:${projectCode ?? "global"}:${
        primaryDocumentName ?? "viewer"
      }`,
    [primaryDocumentName, projectCode]
  );
  const auditSummary = useMemo(
    () => getAuditSummary(auditResults),
    [auditResults]
  );

  const topicSummary = useMemo(() => {
    const open = topics.filter((topic) => topic.status === "open").length;
    const inProgress = topics.filter((topic) => topic.status === "in_progress").length;
    const critical = topics.filter((topic) => topic.priority === "critical").length;
    const synced = topics.filter(
      (topic) =>
        topic.openProject?.syncStatus === "synced" ||
        Boolean(topic.openProject?.workPackageId)
    ).length;

    return {
      total: topics.length,
      open,
      inProgress,
      critical,
      synced
    };
  }, [topics]);

  const filteredTopics = useMemo(() => {
    const normalizedSearch = topicSearch.trim().toLowerCase();

    return topics.filter((topic) => {
      if (topicStatusFilter !== "all" && topic.status !== topicStatusFilter) return false;
      if (topicPriorityFilter !== "all" && topic.priority !== topicPriorityFilter) return false;

      if (!normalizedSearch) return true;

      const searchable = [
        topic.title,
        topic.description,
        topic.assignedTo,
        topic.author,
        topic.discipline,
        topic.issueType,
        topic.source?.modelNames?.join(" "),
        topic.source?.documentNames?.join(" "),
        topic.openProject?.workPackageId
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      return searchable.includes(normalizedSearch);
    });
  }, [topicPriorityFilter, topicSearch, topicStatusFilter, topics]);

  const backHref = useMemo(() => {
    if (primaryDocumentPath) {
      return getParentFolderPath(primaryDocumentPath, projectCode);
    }

    return projectCode
      ? `/documents?projectCode=${encodeURIComponent(projectCode)}`
      : "/admin/project-cards";
  }, [primaryDocumentPath, projectCode]);

  const titleText = useMemo(() => {
    if (documentNames.length === 1 && documentNames[0]?.trim()) {
      return documentNames[0];
    }

    if (models.length === 1) {
      return models[0].name;
    }

    if (models.length > 1) {
      return `${models.length} modelos cargados`;
    }

    if (primaryDocumentName?.trim()) {
      return primaryDocumentName;
    }

    return "Visor federado";
  }, [documentNames, models, primaryDocumentName]);

  useEffect(() => {
    try {
      const rawSmartViews = window.localStorage.getItem(smartViewsStorageKey);
      const parsedSmartViews = rawSmartViews
        ? (JSON.parse(rawSmartViews) as SavedSmartView[])
        : [];

      setSavedSmartViews(Array.isArray(parsedSmartViews) ? parsedSmartViews : []);
    } catch (error) {
      console.warn("[viewer-ifc] No se pudieron cargar SmartViews:", error);
      setSavedSmartViews([]);
    }
  }, [smartViewsStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        smartViewsStorageKey,
        JSON.stringify(savedSmartViews)
      );
    } catch (error) {
      console.warn("[viewer-ifc] No se pudieron guardar SmartViews:", error);
    }
  }, [savedSmartViews, smartViewsStorageKey]);

  useEffect(() => {
    try {
      const rawRules = window.localStorage.getItem(auditRulesStorageKey);
      const parsedRules = rawRules ? (JSON.parse(rawRules) as AuditRule[]) : [];
      setAuditRules(Array.isArray(parsedRules) ? parsedRules : []);
    } catch (error) {
      console.warn("[viewer-ifc] No se pudieron cargar reglas de auditoria:", error);
      setAuditRules([]);
    }
  }, [auditRulesStorageKey]);

  useEffect(() => {
    try {
      window.localStorage.setItem(auditRulesStorageKey, JSON.stringify(auditRules));
    } catch (error) {
      console.warn("[viewer-ifc] No se pudieron guardar reglas de auditoria:", error);
    }
  }, [auditRules, auditRulesStorageKey]);

  useEffect(() => {
  if (!projectCode) {
    setOpenProjectProjectId("");
    return;
  }

  let cancelled = false;

  async function loadOpenProjectProjectId() {
    try {
      const response = await bffFetch(
        `/api/project-cards/${encodeURIComponent(
          projectCode
        )}`
      );

      const result = await response.json();
      const projectId = result?.data?.openProject?.projectId;

      if (!cancelled) {
        setOpenProjectProjectId(
          projectId !== undefined && projectId !== null ? String(projectId) : ""
        );
      }
    } catch (error) {
      console.error("[BCF/OpenProject] No se pudo obtener projectId:", error);

      if (!cancelled) {
        setOpenProjectProjectId("");
      }
    }
  }

  void loadOpenProjectProjectId();

  return () => {
    cancelled = true;
  };
}, [projectCode]);
  useEffect(() => {
    let cancelled = false;

    async function loadRemoteViewpoints() {
      if (!primaryDocumentPath) {
        setViewpoints([]);
        setViewpointsLoaded(true);
        return;
      }

      try {
        const data = await fetchViewpoints(primaryDocumentPath);
        if (!cancelled) {
          skipNextViewpointsPersistRef.current = true;
          setViewpoints(data);
          setViewpointsLoaded(true);
        }
      } catch (error) {
        console.error("[viewer-ifc] Error loading viewpoints:", error);
        if (!cancelled) {
          skipNextViewpointsPersistRef.current = true;
          setViewpoints([]);
          setViewpointsLoaded(true);
        }
      }
    }

    setViewpointsLoaded(false);
    void loadRemoteViewpoints();

    return () => {
      cancelled = true;
    };
  }, [primaryDocumentPath]);

  useEffect(() => {
    let animationFrame = 0;
    let frameCount = 0;
    let lastSampleTime = performance.now();

    type MemoryPerformance = Performance & {
      memory?: {
        usedJSHeapSize: number;
        jsHeapSizeLimit: number;
      };
    };

    type RendererWithInfo = {
      three?: {
        info?: {
          memory?: {
            geometries?: number;
            textures?: number;
          };
          render?: {
            triangles?: number;
            calls?: number;
          };
        };
      };
    };

    const tick = () => {
      frameCount += 1;
      const now = performance.now();

      if (now - lastSampleTime >= 2500) {
        const rendererInfo = (rendererRef.current as RendererWithInfo | null)
          ?.three?.info;
        const memory = (performance as MemoryPerformance).memory;

        setViewerStats({
          fps: Math.round((frameCount * 1000) / (now - lastSampleTime)),
          heapUsedMb: memory
            ? Math.round(memory.usedJSHeapSize / 1024 / 1024)
            : null,
          heapLimitMb: memory
            ? Math.round(memory.jsHeapSizeLimit / 1024 / 1024)
            : null,
          geometries: rendererInfo?.memory?.geometries ?? null,
          textures: rendererInfo?.memory?.textures ?? null,
          triangles: rendererInfo?.render?.triangles ?? null,
          calls: rendererInfo?.render?.calls ?? null,
          loadedModels: models.length,
          visibleModels: models.filter((model) => model.visible).length,
          treeNodes: viewerTreeNodes,
          loadMs: viewerLoadMs
        });

        frameCount = 0;
        lastSampleTime = now;
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [models, viewerLoadMs, viewerTreeNodes]);

  useEffect(() => {
    if (!primaryDocumentPath || !viewpointsLoaded) return;

    if (skipNextViewpointsPersistRef.current) {
      skipNextViewpointsPersistRef.current = false;
      return;
    }

    const timeout = window.setTimeout(() => {
      const viewpointsForStorage = viewpoints.map(({ snapshot, ...viewpoint }) => viewpoint);

      void persistViewpoints(primaryDocumentPath, viewpointsForStorage).catch((error) => {
        console.error("[viewer-ifc] Error saving viewpoints:", error);
      });
    }, 250);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [viewpoints, primaryDocumentPath, viewpointsLoaded]);

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) return;

    let components: OBC.Components | null = null;
    let handleResize: (() => void) | null = null;
    let workerUrls: string[] = [];
    let disposed = false;
    let viewport: HTMLElement | null = null;
    let handleViewportDoubleClick:
      | ((event: MouseEvent) => Promise<void>)
      | null = null;
      let handleViewportClick:
        | ((event: MouseEvent) => Promise<void>)
        | null = null;
      let handleViewportPointerMove:
        | ((event: PointerEvent) => Promise<void>)
        | null = null;
      let handleViewportContextMenu:
        | ((event: MouseEvent) => void)
        | null = null;
      let handleViewportAuxClick:
        | ((event: MouseEvent) => void)
        | null = null;
      let lastMeasurementSnapPreviewAt = 0;

    let handleMeasurementDelete:
      | ((event: KeyboardEvent) => void)
      | null = null;
    const currentSelectionTimeoutRef = selectionDataTimeoutRef;
    const currentPropertiesCacheRef = propertiesCacheRef;
    const currentLoadedModelResultsRef = loadedModelResultsRef;
    const currentLoadedSourceKeysRef = loadedSourceKeysRef;
    const currentLastSectionBoxSelectionRef = lastSectionBoxSelectionRef;
    const currentLastColoredSelectionRef = lastColoredSelectionRef;

    const setup = async () => {
      try {
        const viewerSetupStartedAt = performance.now();
        setStatus("Cargando UI...");

        const BUI = await import("@thatopen/ui");
        if (disposed) return;

        hostElement.innerHTML = "";
        BUI.Manager.init();
        
        viewport = document.createElement("bim-viewport");
        viewport.style.width = "100%";
        viewport.style.height = "100%";
        viewport.style.display = "block";

        hostElement.appendChild(viewport);
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
        if (disposed) return;

        setStatus("Creando escena...");

        const viewer = createWorld(viewport);
        components = viewer.components;
        viewerRef.current = viewer;

        const world = viewer.world;
        const renderer = viewer.renderer;
        rendererRef.current = renderer;
        const camera = viewer.camera;
        const initialSources = initialSourcesRef.current;
        const initialDocumentNames = initialDocumentNamesRef.current;

        const modelsGroup = new THREE.Group();
        modelsGroup.name = "federated-models-group";
        world.scene.three.add(modelsGroup);
        modelsGroupRef.current = modelsGroup;

        handleResize = () => {
          renderer.resize();
          camera.updateAspect();

          const rendererWithDirty = renderer as typeof renderer & {
            needsUpdate?: boolean;
          };
          rendererWithDirty.needsUpdate = true;
        };

        window.addEventListener("resize", handleResize);

        const modules = setupViewerModules({
          components,
          world
        });
        
        const raycaster = components.get(OBC.Raycasters).get(world);       
                

        modulesRef.current = modules;
        modules.bcfTopics.enabled = true;

        await modules.bcfTopics.setup({
          author: currentAuthor,
          includeSelectionTag: true
        });


        handleMeasurementDelete = (event: KeyboardEvent) => {
          if (event.code === "Escape" && measurementModeRef.current) {
            modules.measurement?.cancel();
            measurementModeRef.current = null;
            setStatus("Medicion cancelada.");
            requestViewerRefresh();
            return;
          }

          if (event.code === "Delete" || event.code === "Backspace") {
            modules.measurement?.deleteHovered();
            requestViewerRefresh();
          }
        };
        window.addEventListener("keydown", handleMeasurementDelete);

        modules.selection.highlighter.events.select.onHighlight.add(() => {
          const map = modules.selection.getSelectionModelIdMap();
          const hasAnySelection = Object.keys(map).length > 0;
          const selectedModelIds = new Set(Object.keys(map));

          setModels((prev) =>
            prev.map((model) => ({
              ...model,
              isSelected: model.modelId ? selectedModelIds.has(model.modelId) : false,
              expanded:
                model.modelId && selectedModelIds.has(model.modelId)
                  ? true
                  : model.expanded
            }))
          );

          setHasSelection(hasAnySelection);

          if (selectionDataTimeoutRef.current !== null) {
            window.clearTimeout(selectionDataTimeoutRef.current);
            selectionDataTimeoutRef.current = null;
          }

          if (!hasAnySelection) return;

          setPropertiesRequested(false);
          setPropertiesLoading(false);
          setContainmentData([]);
          setAssociationsData([]);

          const selectedCount = Object.values(map).reduce((total, ids) => {
            return total + ids.size;
          }, 0);

          if (selectedCount > 25) {
            setStatus(`Seleccion multiple: ${selectedCount} elementos`);
          }
        });

        modules.selection.highlighter.events.select.onClear.add(() => {
          if (selectionDataTimeoutRef.current !== null) {
            window.clearTimeout(selectionDataTimeoutRef.current);
            selectionDataTimeoutRef.current = null;
          }
          setModels((prev) =>
            prev.map((model) => ({
              ...model,
              isSelected: false
            }))
          );

          setHasSelection(false);
          setSelectedItemsData([]);
          setPropertiesRequested(false);
          setPropertiesLoading(false);
          setContainmentData([]);
          setAssociationsData([]);
          setContainmentLoading(false);
          setAssociationsLoading(false);
        });

        const castMeasurementRay = async () => {
          const snapConfig = measurementSnapConfigRef.current;
          const snappingClasses = [
            snapConfig.point ? FRAGS.SnappingClass.POINT : null,
            snapConfig.edge ? FRAGS.SnappingClass.LINE : null,
            snapConfig.face ? FRAGS.SnappingClass.FACE : null
          ].filter((value): value is FRAGS.SnappingClass => value !== null);

          return raycaster.castRay(
            snappingClasses.length > 0 ? { snappingClasses } : undefined
          );
        };

        handleViewportClick = async (event: MouseEvent) => {
          const activeMeasurementMode = measurementModeRef.current;
          if (!activeMeasurementMode || !modules.measurement) return;

          event.preventDefault();
          event.stopPropagation();
        };

        const finishMeasurementAreaFromViewport = (event: MouseEvent) => {
          if (measurementModeRef.current !== "area" || !modules.measurement) {
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          const record = modules.measurement.finishArea();

          if (!record) {
            setStatus("El area necesita al menos 3 puntos.");
            return;
          }

          setViewerMeasurements((prev) => [
            ...prev,
            {
              ...record,
              author: currentAuthor
            }
          ]);
          setStatus(`Area: ${record.value.toFixed(3)} m2`);
          requestViewerRefresh();
        };

        handleViewportContextMenu = (event: MouseEvent) => {
          finishMeasurementAreaFromViewport(event);
        };

        handleViewportAuxClick = (event: MouseEvent) => {
          if (event.button === 1) {
            finishMeasurementAreaFromViewport(event);
          }
        };

        handleViewportPointerMove = async () => {
          if (!measurementModeRef.current || !modules.measurement) return;

          const now = performance.now();
          if (now - lastMeasurementSnapPreviewAt < 80) return;
          lastMeasurementSnapPreviewAt = now;

          try {
            const result = await castMeasurementRay();
            modules.measurement.showSnapCandidate(result?.point?.clone() ?? null);
            requestViewerRefresh();
          } catch {
            modules.measurement.clearSnapCandidate();
          }
        };

        viewport.addEventListener(
          "pointermove",
          handleViewportPointerMove as unknown as EventListener
        );

        const addMeasurementPointFromPointer = async () => {
          const activeMeasurementMode = measurementModeRef.current;
          if (!activeMeasurementMode || !modules.measurement) return;

          const result = await castMeasurementRay();
          const position = result?.point?.clone();

          if (!position) {
            setStatus("No se detecto geometria para medir.");
            return;
          }

          const record = modules.measurement.addPoint(position);
          modules.measurement.showSnapCandidate(position);

          if (record) {
            setViewerMeasurements((prev) => [
              ...prev,
              {
                ...record,
                author: currentAuthor
              }
            ]);
          }

          if (activeMeasurementMode === "distance") {
            setStatus(record ? `Distancia: ${record.value.toFixed(3)} m` : "Doble clic para seleccionar el segundo punto.");
          } else if (activeMeasurementMode === "area") {
            setStatus(
              record
                ? `Area: ${record.value.toFixed(3)} m2`
                : "Area: doble clic para agregar puntos; doble clic cerca del primer punto para cerrar."
            );
          } else {
            setStatus(record ? `Volumen: ${record.value.toFixed(3)} m3` : "Volumen: selecciona 3 puntos.");
          }

          requestViewerRefresh();
        };

        viewport.addEventListener(
          "click",
          handleViewportClick as unknown as EventListener,
          true
        );
        viewport.addEventListener(
          "contextmenu",
          handleViewportContextMenu as unknown as EventListener
        );
        viewport.addEventListener(
          "auxclick",
          handleViewportAuxClick as unknown as EventListener
        );

        handleViewportDoubleClick = async (event: MouseEvent) => {
          if (annotationModeRef.current) {

            const raycaster = viewer.components.get(OBC.Raycasters).get(world);

            const result = await raycaster.castRay();

            const position = result?.point
              ? result.point.clone()
              : (() => {
                  const target = new THREE.Vector3();
                  camera.controls.getTarget(target);
                  return target;
                })();

            const rect = viewport!.getBoundingClientRect();

            setAnnotationInput({
              visible: true,
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
              text: "",
              position
            });

            annotationModeRef.current = false;
            setStatus("Escribe texto y presiona Enter");

            return;
          }

          if (measurementModeRef.current) {
            event.preventDefault();
            event.stopPropagation();
            await addMeasurementPointFromPointer();
            requestViewerRefresh();
            return;
          }
          await modules.clipper.create();
          requestViewerRefresh();
        };

        viewport.addEventListener(
          "dblclick",
          handleViewportDoubleClick as unknown as EventListener
        );

        if (!initialSources.length) {
          setStatus("No hay modelos para cargar");
          return;
        }

        setStatus(
          initialSources.length > 1
            ? `Cargando ${initialSources.length} modelos...`
            : initialSources[0]?.kind === "frag"
            ? "Cargando modelo FRAG..."
            : "Cargando modelo IFC..."
        );

        const loadedEntries: FederatedModelEntry[] = [];
        currentLoadedModelResultsRef.current = [];
        currentLoadedSourceKeysRef.current = new Set();
        workerUrls = [];

        for (let index = 0; index < initialSources.length; index += 1) {
          const currentSource = initialSources[index];
          const currentName = getDisplayNameFromSource(
            currentSource,
            initialDocumentNames[index],
            index
          );

          const result = await loadViewerModel({
            components,
            world,
            source: currentSource,
            modelName: currentName
          });

          currentLoadedModelResultsRef.current.push(result);

          if (result.workerUrl) {
            workerUrls.push(result.workerUrl);
          }

          const object = result.model.object as THREE.Object3D<THREE.Object3DEventMap>;
          object.name = currentName;

          if (object.parent && object.parent !== modelsGroup) {
            object.parent.remove(object);
          }

          modelsGroup.add(object);

          let spatialTree: ModelTreeNode[] | undefined;
          let spatialTreeError: string | undefined;

          if (index === 0) {
            try {
              spatialTree = await buildIfcSpatialTree(
                result.model as RuntimeIfcModel,
                currentName
              );
            } catch (error) {
              spatialTreeError =
                error instanceof Error
                  ? error.message
                  : "No se pudo leer la jerarquia IFC.";
            }
          }

          loadedEntries.push({
            key: `${currentName}-${index}`,
            name: currentName,
            source: currentSource,
            object,
            runtimeModel: result.model as RuntimeIfcModel,
            visible: true,
            expanded: index === 0,
            isolated: false,
            isSelected: false,
            spatialTree,
            spatialTreeError,
            modelId:
              "modelId" in result.model
                ? String(result.model.modelId)
                : undefined
          });

          currentLoadedSourceKeysRef.current.add(getSourceKey(currentSource));
        }

        setModels(loadedEntries);
        setAuditIndex([]);
        setAuditIndexSignature("");
        setAuditResults([]);
        setActiveAuditResultId(null);
        setSmartViewPropertyIndex({
          sets: [],
          propertiesBySet: {},
          valuesBySetAndProperty: {},
          localIdsBySetPropertyValue: {}
        });
        setSmartViewPropertyIndexSignature("");

        if (loadedEntries.length > 0) {
          hasLoadedAnyModelRef.current = true;
          await fitObjectInView(viewer, modelsGroup);
        }

        renderer.resize();
        camera.updateAspect();

        const rendererWithDirty = renderer as typeof renderer & {
          needsUpdate?: boolean;
        };
        rendererWithDirty.needsUpdate = true;

        setStatus(
          loadedEntries.length > 1
            ? `${loadedEntries.length} modelos cargados`
            : initialSources[0]?.kind === "frag"
            ? "FRAG cargado"
            : "IFC cargado"
        );
        setViewerLoadMs(Math.round(performance.now() - viewerSetupStartedAt));
      } catch (error) {
        console.error("Error inicializando IfcViewerCanvas:", error);
        setStatus(
          error instanceof Error
            ? `Error: ${error.message}`
            : "Error desconocido cargando el visor"
        );
      }
    };

    void setup();

    return () => {
      disposed = true;
      try {
        const modules = modulesRef.current;

        if (modules?.clipper) {
          modules.clipper.deleteAll();
        }
        modules?.measurement?.dispose();
      } catch (error) {
        console.warn("[viewer-ifc] Error limpiando clipping planes antes de dispose:", error);
      }
      modulesRef.current = null;
      viewerRef.current = null;
      rendererRef.current = null;
      modelsGroupRef.current = null;
      currentLoadedModelResultsRef.current = [];
      currentLoadedSourceKeysRef.current = new Set();
      currentPropertiesCacheRef.current.clear();
      currentLastSectionBoxSelectionRef.current = null;
      currentLastColoredSelectionRef.current = null;

      if (currentSelectionTimeoutRef.current !== null) {
        window.clearTimeout(currentSelectionTimeoutRef.current);
        currentSelectionTimeoutRef.current = null;
      }

      setClipperEnabled(false);
      setHasSelection(false);
      setSelectedItemsData([]);
      setPropertiesRequested(false);
      setPropertiesLoading(false);
      setContainmentData([]);
      setAssociationsData([]);
      setContainmentLoading(false);
      setAssociationsLoading(false);
      setModels([]);
      setAuditIndex([]);
      setAuditIndexSignature("");
      setAuditResults([]);
      setActiveAuditResultId(null);
      setSmartViewPropertyIndex({
        sets: [],
        propertiesBySet: {},
        valuesBySetAndProperty: {},
        localIdsBySetPropertyValue: {}
      });
      setSmartViewPropertyIndexSignature("");

      if (handleResize) {
        window.removeEventListener("resize", handleResize);
      }

      if (viewport && handleViewportDoubleClick) {
        viewport.removeEventListener(
          "dblclick",
          handleViewportDoubleClick as unknown as EventListener
        );
      }
      if (viewport && handleViewportClick) {
        viewport.removeEventListener(
          "click",
          handleViewportClick as unknown as EventListener,
          true
        );
      }
      if (viewport && handleViewportPointerMove) {
        viewport.removeEventListener(
          "pointermove",
          handleViewportPointerMove as unknown as EventListener
        );
      }
      if (viewport && handleViewportContextMenu) {
        viewport.removeEventListener(
          "contextmenu",
          handleViewportContextMenu as unknown as EventListener
        );
      }
      if (viewport && handleViewportAuxClick) {
        viewport.removeEventListener(
          "auxclick",
          handleViewportAuxClick as unknown as EventListener
        );
      }
      if (handleMeasurementDelete) {
        window.removeEventListener(
          "keydown",
          handleMeasurementDelete as EventListener
        );
      }

      if (components && hasLoadedAnyModelRef.current) {
        safelyDisposeComponents(components);
      } else if (components) {
        console.warn(
          "[viewer-ifc] Dispose completo omitido: visor sin modelos cargados."
        );
      }
      

      for (const workerUrl of workerUrls) {
        URL.revokeObjectURL(workerUrl);
      }
      hostElement.replaceChildren();

      
    };
  }, []);

  useEffect(() => {
  if (!projectCode) {
    setTopics([]);
    return;
  }

  let cancelled = false;

  async function loadTopics() {
    try {
      const data = await getBcfTopics(projectCode);

      if (!cancelled) {
        setTopics(data);
      }
    } catch (error) {
      console.error("Error loading BCF topics:", error);

      if (!cancelled) {
        setTopics([]);
      }
    }
  }

  void loadTopics();

  return () => {
    cancelled = true;
  };
}, [projectCode]);

  useEffect(() => {
  if (!projectCode) {
    setProjectMembers([]);
    return;
  }

  let cancelled = false;
  setProjectMembersLoading(true);

  getProjectMembers(projectCode.trim().toUpperCase(), "active")
    .then((members) => {
      if (!cancelled) setProjectMembers(members);
    })
    .catch((error) => {
      console.error("[viewer-ifc] Error loading project members:", error);
      if (!cancelled) setProjectMembers([]);
    })
    .finally(() => {
      if (!cancelled) setProjectMembersLoading(false);
    });

  return () => {
    cancelled = true;
  };
}, [projectCode]);

  useEffect(() => {
  if (!projectCode) return;
  if (!topics.length) return;

  const normalizedProjectCode = projectCode.trim().toUpperCase();

  const timeout = setTimeout(() => {
    const topicsForStorage = topics.map((topic) => ({
      ...topic,
      projectCode: projectCode.trim().toUpperCase(),
      snapshot:
        topic.snapshot && topic.snapshot.startsWith("data:")
          ? null
          : topic.snapshot ?? null,
      attachments: topic.attachments.map((attachment) => ({
        ...attachment,
        dataUrl: attachment.dataUrl.startsWith("data:")
          ? ""
          : attachment.dataUrl
      }))
    }));

    saveBcfTopics(topicsForStorage, normalizedProjectCode).catch((error) => {
      console.error("Error saving BCF topics:", error);
    });
  }, 500);

  return () => clearTimeout(timeout);
}, [topics, projectCode]);

  function requestViewerRefresh() {
    const viewer = viewerRef.current;
    if (!viewer) return;

    requestAnimationFrame(() => {
      try {
        const rendererWithDirty = viewer.renderer as typeof viewer.renderer & {
          needsUpdate?: boolean;
        };

        rendererWithDirty.needsUpdate = true;
        viewer.renderer.resize();
        viewer.camera.updateAspect();
      } catch (error) {
        console.error("[viewer-ifc] Error refreshing viewer:", error);
      }
    });
  }

  function handleToggleModelExpanded(key: string) {
    const target = models.find((model) => model.key === key);
    const shouldLoadSpatialTree =
      target &&
      !target.expanded &&
      !target.spatialTree &&
      !target.spatialTreeLoading &&
      !target.spatialTreeError;

    setModels((prev) =>
      prev.map((model) =>
        model.key === key
          ? {
              ...model,
              expanded: !model.expanded,
              spatialTreeLoading: shouldLoadSpatialTree
                ? true
                : model.spatialTreeLoading
            }
          : model
      )
    );

    if (shouldLoadSpatialTree) {
      void loadSpatialTreeForModel(target);
    }
  }

  async function loadSpatialTreeForModel(model: FederatedModelEntry) {
    try {
      const spatialTree = await buildIfcSpatialTree(
        model.runtimeModel,
        model.name
      );

      setModels((prev) =>
        prev.map((current) =>
          current.key === model.key
            ? {
                ...current,
                spatialTree,
                spatialTreeLoading: false,
                spatialTreeError: undefined
              }
            : current
        )
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo leer la jerarquia IFC.";

      setModels((prev) =>
        prev.map((current) =>
          current.key === model.key
            ? {
                ...current,
                spatialTreeLoading: false,
                spatialTreeError: message
              }
            : current
        )
      );
    }
  }

  async function ensureSpatialTreesForAnalysis() {
    let changed = false;
    const nextModels: FederatedModelEntry[] = [];

    for (const model of models) {
      if (model.spatialTree || model.spatialTreeError) {
        nextModels.push(model);
        continue;
      }

      try {
        const spatialTree = await buildIfcSpatialTree(
          model.runtimeModel,
          model.name
        );

        nextModels.push({
          ...model,
          spatialTree,
          spatialTreeLoading: false,
          spatialTreeError: undefined
        });
        changed = true;
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "No se pudo leer la jerarquia IFC.";

        nextModels.push({
          ...model,
          spatialTreeLoading: false,
          spatialTreeError: message
        });
        changed = true;
      }
    }

    if (changed) {
      setModels(nextModels);
      setAuditIndex([]);
      setAuditIndexSignature("");
      setSmartViewPropertyIndex({
        sets: [],
        propertiesBySet: {},
        valuesBySetAndProperty: {},
        localIdsBySetPropertyValue: {}
      });
      setSmartViewPropertyIndexSignature("");
    }

    return nextModels;
  }

  async function handleSelectTreeNode(modelKey: string, node: ModelTreeNode) {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    const model = models.find((item) => item.key === modelKey);

    if (!modules || !viewer || !model?.modelId || typeof node.localId !== "number") {
      return;
    }

    const selectionMap: OBC.ModelIdMap = {
      [model.modelId]: new Set([node.localId])
    };

    try {
      await modules.selection.highlighter.highlightByID(
        "select",
        selectionMap,
        true,
        false
      );

      setHasSelection(true);
      setStatus(`Elemento seleccionado: ${node.name}`);

      try {
        await fitSelectionInView(viewer, viewer.components, selectionMap);
      } catch (fitError) {
        console.warn("[viewer-ifc] No se pudo enfocar nodo IFC:", fitError);
      }

      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error seleccionando nodo IFC:", error);
      setStatus("No se pudo seleccionar el elemento del arbol IFC.");
    }
  }

  function getTreeNodeModelIdMap(modelKey: string, node: ModelTreeNode) {
    const model = models.find((item) => item.key === modelKey);
    if (!model?.modelId) return null;

    const localIds = collectModelTreeLocalIds(node);
    if (localIds.size === 0) return null;

    return {
      [model.modelId]: localIds
    } satisfies OBC.ModelIdMap;
  }

  async function handleBuildNativeLevelIndex() {
    setSmartViewPropertiesIndexLoading(true);
    setStatus("Indexando niveles IFC nativos...");

    try {
      const analysisModels = await ensureSpatialTreesForAnalysis();
      const levelLocalIdsByModelKey: Record<string, Record<string, Set<number>>> = {};
      const localIdsByModelKey: Record<string, number[]> = {};

      for (const model of analysisModels) {
        const treeLocalIds = flattenModelTreeNodes(model.spatialTree ?? [])
          .filter(
            (node) => isModelTreeElement(node) && typeof node.localId === "number"
          )
          .map((node) => node.localId as number);
        let universeLocalIds = treeLocalIds;

        try {
          if (model.runtimeModel.getItemsIdsWithGeometry) {
            universeLocalIds = await Promise.resolve(
              model.runtimeModel.getItemsIdsWithGeometry()
            );
          } else if (model.runtimeModel.getLocalIds) {
            universeLocalIds = await Promise.resolve(model.runtimeModel.getLocalIds());
          }
        } catch (universeError) {
          console.warn(
            "[viewer-ifc] No se pudo obtener universo para niveles IFC:",
            universeError
          );
        }

        const indexedLocalIds = Array.from(
          new Set([...treeLocalIds, ...universeLocalIds])
        ).slice(0, MAX_NATIVE_LEVEL_INDEX_LOCAL_IDS);
        localIdsByModelKey[model.key] = indexedLocalIds;

        if (indexedLocalIds.length === 0 || !model.runtimeModel.getItemsData) {
          continue;
        }

        for (
          let index = 0;
          index < indexedLocalIds.length;
          index += NATIVE_LEVEL_INDEX_BATCH_SIZE
        ) {
          const batch = indexedLocalIds.slice(
            index,
            index + NATIVE_LEVEL_INDEX_BATCH_SIZE
          );
          let itemsData: Record<string, unknown>[] = [];

          try {
            itemsData = (await Promise.resolve(
              model.runtimeModel.getItemsData(batch, {
                attributesDefault: true,
                relations: {
                  ContainedInStructure: {
                    attributes: true,
                    relations: true
                  }
                }
              })
            )) as Record<string, unknown>[];
          } catch (relationsError) {
            console.warn(
              "[viewer-ifc] Native level index batch skipped:",
              relationsError
            );
            continue;
          }

          for (let itemIndex = 0; itemIndex < itemsData.length; itemIndex += 1) {
            const item = itemsData[itemIndex];
            const localId = batch[itemIndex];
            const itemIndexMap = collectSmartViewPropertyPairs(item);

            const nativeLevelValue = getNativeIfcLevelValue(item, itemIndexMap);

            if (!nativeLevelValue) continue;

            const modelLevels =
              levelLocalIdsByModelKey[model.key] ??
              (levelLocalIdsByModelKey[model.key] = {});
            const levelIds =
              modelLevels[nativeLevelValue] ??
              (modelLevels[nativeLevelValue] = new Set<number>());
            levelIds.add(localId);
          }
        }
      }

      const levelLocalIdsByModel: Record<string, Record<string, number[]>> = {};
      for (const [modelKey, levels] of Object.entries(levelLocalIdsByModelKey)) {
        levelLocalIdsByModel[modelKey] = Object.fromEntries(
          Object.entries(levels)
            .filter(([, ids]) => ids.size > 0)
            .map(([levelName, ids]) => [levelName, Array.from(ids)])
        );
      }

      setSmartViewPropertyIndex((current) => ({
        ...current,
        localIdsByModelKey: {
          ...(current.localIdsByModelKey ?? {}),
          ...localIdsByModelKey
        },
        levelLocalIdsByModelKey: {
          ...(current.levelLocalIdsByModelKey ?? {}),
          ...levelLocalIdsByModel
        }
      }));

      const levelCount = Object.values(levelLocalIdsByModel).reduce(
        (total, levels) => total + Object.keys(levels).length,
        0
      );
      setStatus(
        levelCount > 0
          ? `Niveles IFC indexados: ${levelCount}.`
          : "No se detectaron niveles IFC nativos en los modelos cargados."
      );
    } catch (error) {
      console.error("[viewer-ifc] Error indexando niveles IFC:", error);
      setStatus("No se pudieron indexar niveles IFC nativos.");
    } finally {
      setSmartViewPropertiesIndexLoading(false);
    }
  }

  async function handleBuildSmartViewPropertyIndex() {
    const runId = smartViewIndexRunRef.current + 1;
    smartViewIndexRunRef.current = runId;
    setSmartViewPropertiesIndexLoading(true);
    setStatus("Buscando indice BIM en base de datos...");
    let indexingJobModels: FederatedModelEntry[] = [];
    let indexingJobSignature = "";

    try {
      const modelKeys = models.map((model) => model.key).filter(Boolean);
      const lightweightSignature =
        loadedModelsSignature || modelKeys.join("|") || "no-models";

      if (modelKeys.length === 0) {
        setStatus("Carga un modelo para indexar parametros BIM.");
        return;
      }

      if (smartViewIndexInFlightSignatureRef.current === lightweightSignature) {
        setStatus("Indice BIM ya esta en proceso para los modelos cargados.");
        return;
      }
      smartViewIndexInFlightSignatureRef.current = lightweightSignature;
      indexingJobSignature = lightweightSignature;

      if (
        smartViewPropertyIndexSignature === lightweightSignature &&
        smartViewPropertyIndex.sets.length > 0
      ) {
        setStatus("Indice de parametros vigente para los modelos cargados.");
        return;
      }

      const indexedModelRecords = await loadIndexedBimModels(projectCode);
      const readyIndexedModelKeys = new Set(
        indexedModelRecords
          .filter(isIndexedModelRecordReady)
          .map(getIndexedModelRecordKey)
      );
      const indexedModelKeysForCurrentLoad = modelKeys.filter((key) =>
        readyIndexedModelKeys.has(key)
      );
      const allLoadedModelsIndexed =
        modelKeys.length > 0 && indexedModelKeysForCurrentLoad.length === modelKeys.length;
      const normalizedDbIndex = await loadSmartViewPropertyIndexFromDatabase({
        projectCode,
        modelKeys
      });

      if (normalizedDbIndex && smartViewIndexRunRef.current === runId) {
        setSmartViewPropertyIndex(normalizedDbIndex);
        setSmartViewPropertyIndexSignature(lightweightSignature);

        if (allLoadedModelsIndexed) {
          setStatus(
            `Indice BIM recuperado desde PostgreSQL: ${normalizedDbIndex.sets.length} conjuntos.`
          );
          return;
        }

        setStatus(
          `Indice BIM parcial: ${indexedModelKeysForCurrentLoad.length}/${modelKeys.length} modelos listos. Completando faltantes...`
        );
      }

      const lightweightPersistedIndex = await loadSmartViewPropertyIndexSnapshot(
        projectCode,
        lightweightSignature
      );

      if (lightweightPersistedIndex && smartViewIndexRunRef.current === runId) {
        setSmartViewPropertyIndex(lightweightPersistedIndex);
        setSmartViewPropertyIndexSignature(lightweightSignature);
        setStatus(`Indice BIM recuperado desde snapshot: ${lightweightPersistedIndex.sets.length} conjuntos.`);
        return;
      }

      setStatus("Indexando propiedades para SmartView...");
      const analysisModels = await ensureSpatialTreesForAnalysis();
      const analysisSignature = getFederatedModelsAnalysisSignature(analysisModels);
      const analysisModelKeys = analysisModels.map((model) => model.key).filter(Boolean);
      const readyIndexedModelKeysForAnalysis = new Set(readyIndexedModelKeys);
      const modelsToIndex = analysisModels.filter(
        (model) => !readyIndexedModelKeysForAnalysis.has(model.key)
      );
      indexingJobModels = modelsToIndex;
      indexingJobSignature = analysisSignature;

      if (
        smartViewIndexInFlightSignatureRef.current === analysisSignature &&
        analysisSignature !== lightweightSignature
      ) {
        setStatus("Indice BIM ya esta en proceso para los modelos cargados.");
        return;
      }
      smartViewIndexInFlightSignatureRef.current = analysisSignature;

      if (
        smartViewPropertyIndexSignature === analysisSignature &&
        smartViewPropertyIndex.sets.length > 0
      ) {
        setStatus("Indice de parametros vigente para los modelos cargados.");
        return;
      }

      const persistedIndex = await loadSmartViewPropertyIndexSnapshot(
        projectCode,
        analysisSignature
      );

      if (persistedIndex && smartViewIndexRunRef.current === runId) {
        setSmartViewPropertyIndex(persistedIndex);
        setSmartViewPropertyIndexSignature(analysisSignature);
        setStatus(`Indice BIM recuperado desde snapshot: ${persistedIndex.sets.length} conjuntos.`);
        return;
      }

      if (modelsToIndex.length === 0) {
        const combinedDbIndex = await loadSmartViewPropertyIndexFromDatabase({
          projectCode,
          modelKeys: analysisModelKeys
        });

        if (combinedDbIndex && smartViewIndexRunRef.current === runId) {
          setSmartViewPropertyIndex(combinedDbIndex);
          setSmartViewPropertyIndexSignature(analysisSignature);
          setStatus(
            `Indice BIM listo desde PostgreSQL: ${combinedDbIndex.sets.length} conjuntos.`
          );
          return;
        }
      }

      const propertyMap = new Map<string, Map<string, Set<string>>>();
      const localIdsBySetPropertyValue: SmartViewPropertyIndex["localIdsBySetPropertyValue"] = {};
      const localIdsByModelKey: Record<string, number[]> = {};
      const elementIdentityByKey: Record<string, string> = {};
      const levelLocalIdsByModelKey: Record<string, Record<string, Set<number>>> = {};
      const maxLocalIdsPerModel = getDynamicPropertyIndexLimit(modelsToIndex.length);
      let indexedItems = 0;
      let skippedHighCardinalityValues = 0;
      let indexPartial = false;
      let lastYieldAt = typeof performance !== "undefined" ? performance.now() : 0;

      for (let modelIndex = 0; modelIndex < modelsToIndex.length; modelIndex += 1) {
        if (smartViewIndexRunRef.current !== runId) return;
        const model = modelsToIndex[modelIndex];
        const treeLocalIds = flattenModelTreeNodes(model.spatialTree ?? [])
          .filter(
            (node) => isModelTreeElement(node) && typeof node.localId === "number"
          )
          .map((node) => node.localId as number)
          .slice(0, MAX_TREE_ELEMENT_NODES);
        let universeLocalIds = treeLocalIds;

        try {
          if (model.runtimeModel.getItemsIdsWithGeometry) {
            universeLocalIds = await Promise.resolve(
              model.runtimeModel.getItemsIdsWithGeometry()
            );
          } else if (model.runtimeModel.getLocalIds) {
            universeLocalIds = await Promise.resolve(model.runtimeModel.getLocalIds());
          }
        } catch (universeError) {
          console.warn(
            "[viewer-ifc] No se pudo obtener universo geometrico del modelo:",
            universeError
          );
        }

        const indexedLocalIds = Array.from(
          new Set([...treeLocalIds, ...universeLocalIds])
        ).slice(0, maxLocalIdsPerModel);
        localIdsByModelKey[model.key] = indexedLocalIds;

        await upsertBimIndexJob({
          projectCode,
          model,
          sourceHash: analysisSignature,
          status: "processing",
          stats: {
            stage: "browser-index",
            elementCount: indexedLocalIds.length
          }
        });

        const persistedModelId = await upsertBimIndexModel({
          projectCode,
          model,
          signature: analysisSignature,
          elementCount: indexedLocalIds.length
        });
        const persistedElementBuffer: BimIndexElementPayload[] = [];
        const activePersistWrites: Promise<void>[] = [];
        const schedulePersistedElements = async () => {
          if (!persistedModelId || persistedElementBuffer.length === 0) return;
          const batch = persistedElementBuffer.splice(0, BIM_INDEX_PERSIST_BATCH_SIZE);
          let write: Promise<void>;
          write = persistBimIndexElementBatch(persistedModelId, batch).finally(() => {
            const writeIndex = activePersistWrites.indexOf(write);
            if (writeIndex >= 0) activePersistWrites.splice(writeIndex, 1);
          });
          activePersistWrites.push(write);

          if (activePersistWrites.length >= BIM_INDEX_PERSIST_MAX_CONCURRENT) {
            await Promise.race(activePersistWrites);
          }
        };

        if (indexedLocalIds.length === 0 || !model.runtimeModel.getItemsData) {
          continue;
        }

        for (
          let index = 0;
          index < indexedLocalIds.length;
          index += PROPERTY_INDEX_BATCH_SIZE
        ) {
          const batch = indexedLocalIds.slice(index, index + PROPERTY_INDEX_BATCH_SIZE);
          let itemsData: Record<string, unknown>[] = [];

          try {
            itemsData = (await Promise.resolve(
              model.runtimeModel.getItemsData(batch, {
                attributesDefault: true,
                relations: {
                  IsDefinedBy: {
                    attributes: true,
                    relations: true
                  },
                  IsTypedBy: {
                    attributes: true,
                    relations: true
                  },
                  ContainedInStructure: {
                    attributes: true,
                    relations: true
                  }
                }
              })
            )) as Record<string, unknown>[];
          } catch (relationsError) {
            console.warn(
              "[viewer-ifc] SmartView property batch with relations failed; retrying basic attributes:",
              relationsError
            );

            try {
              itemsData = (await Promise.resolve(
                model.runtimeModel.getItemsData(batch, {
                  attributesDefault: true
                })
              )) as Record<string, unknown>[];
            } catch (basicError) {
              console.warn(
                "[viewer-ifc] SmartView property batch skipped:",
                basicError
              );
              continue;
            }
          }

          indexedItems += itemsData.length;

          for (let itemIndex = 0; itemIndex < itemsData.length; itemIndex += 1) {
            const item = itemsData[itemIndex];
            const localId = batch[itemIndex];
            const itemIndexMap = collectSmartViewPropertyPairs(item);
            if (persistedModelId) {
              persistedElementBuffer.push(
                createBimIndexElementPayload({ item, pairs: itemIndexMap, model, localId })
              );

              if (persistedElementBuffer.length >= BIM_INDEX_PERSIST_BATCH_SIZE) {
                await schedulePersistedElements();
              }
            }
            elementIdentityByKey[`${model.key}:${localId}`] =
              getCost5DElementIdentity(item, itemIndexMap, model.key, localId);
            const nativeLevelValue = getNativeIfcLevelValue(item, itemIndexMap);

            if (nativeLevelValue) {
              const modelLevels =
                levelLocalIdsByModelKey[model.key] ??
                (levelLocalIdsByModelKey[model.key] = {});
              const levelIds =
                modelLevels[nativeLevelValue] ??
                (modelLevels[nativeLevelValue] = new Set<number>());
              levelIds.add(localId);
            }

            for (const [setName, properties] of itemIndexMap) {
              const targetProperties =
                propertyMap.get(setName) ?? new Map<string, Set<string>>();
              const modelBuckets =
                localIdsBySetPropertyValue[setName] ??
                (localIdsBySetPropertyValue[setName] = {});

              for (const [propertyName, values] of properties) {
                if (isSmartViewInternalPropertyKey(propertyName)) continue;

                const targetValues =
                  targetProperties.get(propertyName) ?? new Set<string>();
                const propertyBuckets =
                  modelBuckets[propertyName] ?? (modelBuckets[propertyName] = {});
                const isLevelProperty = isSmartViewNativeIfcLevelProperty(
                  setName,
                  propertyName
                );

                for (const value of values) {
                  const isKnownValue = targetValues.has(value);

                  if (
                    !isKnownValue &&
                    targetValues.size >= MAX_INDEXED_VALUES_PER_PROPERTY
                  ) {
                    skippedHighCardinalityValues += 1;
                    continue;
                  }

                  targetValues.add(value);

                  const valueBuckets =
                    propertyBuckets[value] ?? (propertyBuckets[value] = {});
                  const ids = valueBuckets[model.key] ?? [];

                  if (ids.length < MAX_LOCAL_IDS_PER_VALUE_BUCKET) {
                    ids.push(localId);
                  }

                  valueBuckets[model.key] = ids;

                  if (isLevelProperty && value.trim()) {
                    const modelLevels =
                      levelLocalIdsByModelKey[model.key] ??
                      (levelLocalIdsByModelKey[model.key] = {});
                    const levelIds =
                      modelLevels[value] ?? (modelLevels[value] = new Set<number>());
                    levelIds.add(localId);
                  }
                }

                targetProperties.set(propertyName, targetValues);
              }

              propertyMap.set(setName, targetProperties);
            }
          }

          if (shouldYieldPropertyIndex(lastYieldAt)) {
            const heapRatio = getBrowserHeapUsageRatio();

            if (heapRatio !== null && heapRatio > PROPERTY_INDEX_HEAP_WARN_RATIO) {
              indexPartial = true;
              setStatus(
                `Indice parcial por memoria: ${indexedItems.toLocaleString()} elementos indexados.`
              );
              break;
            }

            setStatus(
              `Indexando parametros ${modelIndex + 1}/${modelsToIndex.length}: ${Math.min(
                index + PROPERTY_INDEX_BATCH_SIZE,
                indexedLocalIds.length
              ).toLocaleString()}/${indexedLocalIds.length.toLocaleString()}`
            );
            await waitForNextFrame();
            lastYieldAt = typeof performance !== "undefined" ? performance.now() : lastYieldAt;
          }

          if (smartViewIndexRunRef.current !== runId) return;
        }

        await schedulePersistedElements();
        if (activePersistWrites.length > 0) {
          await Promise.allSettled([...activePersistWrites]);
        }
        await upsertBimIndexJob({
          projectCode,
          model,
          sourceHash: analysisSignature,
          status: "ready",
          stats: {
            stage: indexPartial ? "browser-index-partial" : "browser-index",
            elementCount: indexedLocalIds.length,
            indexedItems
          }
        });
        if (indexPartial) break;
      }

      const sets = Array.from(propertyMap.keys()).sort((a, b) =>
        a.localeCompare(b)
      );
      const propertiesBySet: Record<string, string[]> = {};
      const valuesBySetAndProperty: Record<string, Record<string, string[]>> = {};
      const levelLocalIdsByModel: Record<string, Record<string, number[]>> = {};

      for (const setName of sets) {
        const properties = propertyMap.get(setName) ?? new Map<string, Set<string>>();
        const propertyNames = Array.from(properties.keys()).sort((a, b) =>
          a.localeCompare(b)
        );

        propertiesBySet[setName] = propertyNames;
        valuesBySetAndProperty[setName] = Object.fromEntries(
          propertyNames.map((propertyName) => [
            propertyName,
            Array.from(properties.get(propertyName) ?? [])
              .filter(Boolean)
              .slice(0, 250)
              .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
          ])
        );
      }

      for (const [modelKey, levels] of Object.entries(levelLocalIdsByModelKey)) {
        levelLocalIdsByModel[modelKey] = Object.fromEntries(
          Object.entries(levels)
            .filter(([, ids]) => ids.size > 0)
            .map(([levelName, ids]) => [levelName, Array.from(ids)])
        );
      }

      const nextPropertyIndex: SmartViewPropertyIndex = {
        sets,
        propertiesBySet,
        valuesBySetAndProperty,
        localIdsBySetPropertyValue,
        localIdsByModelKey,
        elementIdentityByKey,
        levelLocalIdsByModelKey: levelLocalIdsByModel
      };

      const combinedDbIndex = await loadSmartViewPropertyIndexFromDatabase({
        projectCode,
        modelKeys: analysisModelKeys
      });
      const finalPropertyIndex = combinedDbIndex ?? nextPropertyIndex;

      setSmartViewPropertyIndex(finalPropertyIndex);
      setSmartViewPropertyIndexSignature(analysisSignature);
      void saveSmartViewPropertyIndexSnapshot({
        projectCode,
        signature: analysisSignature,
        modelKeys: analysisModelKeys,
        elementCount: indexedItems,
        index: finalPropertyIndex
      });
      setStatus(
        finalPropertyIndex.sets.length > 0
          ? `Conjuntos indexados: ${finalPropertyIndex.sets.length}.`
          : "No se encontraron conjuntos de propiedades indexables en los modelos cargados."
      );
    } catch (error) {
      console.error("[viewer-ifc] Error indexando propiedades SmartView:", error);
      const message = error instanceof Error ? error.message : "Error desconocido indexando propiedades";
      await Promise.allSettled(
        indexingJobModels.map((model) =>
          upsertBimIndexJob({
            projectCode,
            model,
            sourceHash: indexingJobSignature || getFederatedModelsAnalysisSignature([model]),
            status: "failed",
            errorMessage: message,
            stats: { stage: "browser-index" }
          })
        )
      );
      setStatus("No se pudieron indexar propiedades para SmartView.");
    } finally {
      if (
        indexingJobSignature &&
        smartViewIndexInFlightSignatureRef.current === indexingJobSignature
      ) {
        smartViewIndexInFlightSignatureRef.current = null;
      }
      setSmartViewPropertiesIndexLoading(false);
      void refreshBimIndexOverview();
    }
  }

  function getCachedModelTreeNodes(model: FederatedModelEntry) {
    const cached = flattenedTreeCacheRef.current.get(model.key);
    if (cached) return cached;

    const nodes = flattenModelTreeNodes(model.spatialTree ?? []);
    flattenedTreeCacheRef.current.set(model.key, nodes);
    return nodes;
  }

  function getCachedModelLevelMap(model: FederatedModelEntry) {
    const cached = levelMapCacheRef.current.get(model.key);
    if (cached) return cached;

    const levelMap = buildElementLevelMap(model.spatialTree ?? []);
    levelMapCacheRef.current.set(model.key, levelMap);
    return levelMap;
  }
  async function getSmartViewModelIdMap(criteria: SmartViewCriteria) {
    const analysisModels = await ensureSpatialTreesForAnalysis();
    const criteriaCacheKey = JSON.stringify({
      criteria,
      models: analysisModels
        .map(
          (model) =>
            `${model.key}:${model.modelId ?? "no-model"}:${model.spatialTree?.length ?? 0}`
        )
        .sort()
    });
    const cachedResult = smartViewModelIdMapCacheRef.current.get(criteriaCacheKey);

    if (cachedResult) {
      return cloneModelIdMap(cachedResult);
    }
    const normalizedText = criteria.text.trim().toLowerCase();
    const normalizedType = criteria.type.trim().toUpperCase();
    const normalizedLevel = criteria.level.trim().toLowerCase();
    const normalizedPropertySet = criteria.propertySet.trim();
    const normalizedPropertyName = criteria.propertyName.trim().toLowerCase();
    const normalizedPropertyValue = criteria.propertyValue.trim().toLowerCase();
    const result: OBC.ModelIdMap = {};
    const shouldQueryDbPropertyLocalIds = Boolean(
      !normalizedText && normalizedPropertySet && normalizedPropertyName
    );
    const dbLocalIdsByModelKey = shouldQueryDbPropertyLocalIds
      ? await loadSmartViewPropertyLocalIdsFromDatabase({
          projectCode,
          modelKeys: criteria.modelKey
            ? [criteria.modelKey]
            : analysisModels.map((model) => model.key),
          propertySet: criteria.propertySet,
          propertyName: criteria.propertyName,
          propertyValue: criteria.propertyValue
        })
      : null;

    for (const model of analysisModels) {
      if (criteria.modelKey && model.key !== criteria.modelKey) continue;
      if (!model.modelId) continue;

      if (dbLocalIdsByModelKey && !normalizedType && !normalizedLevel) {
        const dbIds = dbLocalIdsByModelKey[model.key] ?? [];
        if (dbIds.length > 0) {
          result[model.modelId] = new Set(dbIds);
        }
        continue;
      }

      const levelByLocalId = getCachedModelLevelMap(model);
      const candidateNodes = getCachedModelTreeNodes(model).filter((node) => {
        if (!isModelTreeElement(node) || typeof node.localId !== "number") {
          return false;
        }

        if (normalizedType && node.type.toUpperCase() !== normalizedType) {
          return false;
        }

        if (normalizedLevel) {
          const levelName = levelByLocalId.get(node.localId) ?? "";
          if (levelName.toLowerCase() !== normalizedLevel) return false;
        }

        return true;
      });

      if (candidateNodes.length === 0) continue;

      if (dbLocalIdsByModelKey) {
        const dbIds = new Set(dbLocalIdsByModelKey[model.key] ?? []);
        if (dbIds.size === 0) continue;

        const filteredIds = candidateNodes
          .map((node) => node.localId as number)
          .filter((localId) => dbIds.has(localId));

        if (filteredIds.length > 0) {
          result[model.modelId] = new Set(filteredIds);
        }

        continue;
      }

      const indexedValueBuckets =
        criteria.propertySet && criteria.propertyName
          ? smartViewPropertyIndex.localIdsBySetPropertyValue[criteria.propertySet]?.[
              criteria.propertyName
            ]
          : undefined;

      if (indexedValueBuckets && Object.keys(indexedValueBuckets).length > 0) {
        const indexedIds = new Set<number>();

        if (criteria.propertyValue) {
          for (const id of indexedValueBuckets[criteria.propertyValue]?.[model.key] ?? []) {
            indexedIds.add(id);
          }
        } else {
          for (const modelBuckets of Object.values(indexedValueBuckets)) {
            for (const id of modelBuckets[model.key] ?? []) {
              indexedIds.add(id);
            }
          }
        }

        const filteredIds = candidateNodes
          .map((node) => node.localId as number)
          .filter((localId) => indexedIds.has(localId));

        if (filteredIds.length > 0) {
          result[model.modelId] = new Set(filteredIds);
        }

        continue;
      }

      const localIds = candidateNodes.map((node) => node.localId as number);
      const needsPropertyData = Boolean(
        normalizedText ||
          normalizedPropertySet ||
          normalizedPropertyName ||
          normalizedPropertyValue
      );
      const itemDataMap = needsPropertyData
        ? new Map<number, Record<string, unknown>>()
        : await getIfcItemDataMap(model.runtimeModel, localIds);

      if (needsPropertyData && model.runtimeModel.getItemsData) {
        const smartViewApplyBatchSize = 12;

        for (let index = 0; index < localIds.length; index += smartViewApplyBatchSize) {
          const batch = localIds.slice(index, index + smartViewApplyBatchSize);
          let itemsData: Record<string, unknown>[] = [];

          try {
            itemsData = (await Promise.resolve(
              model.runtimeModel.getItemsData(batch, {
                attributesDefault: true,
                relations: {
                  IsDefinedBy: {
                    attributes: true,
                    relations: true
                  },
                  IsTypedBy: {
                    attributes: true,
                    relations: true
                  }
                }
              })
            )) as Record<string, unknown>[];
          } catch (relationsError) {
            console.warn(
              "[viewer-ifc] SmartView apply batch with relations failed; retrying basic attributes:",
              relationsError
            );

            try {
              itemsData = (await Promise.resolve(
                model.runtimeModel.getItemsData(batch, {
                  attributesDefault: true
                })
              )) as Record<string, unknown>[];
            } catch (basicError) {
              console.warn(
                "[viewer-ifc] SmartView apply batch skipped:",
                basicError
              );
              continue;
            }
          }

          itemsData.forEach((item, itemIndex) => {
            itemDataMap.set(batch[itemIndex], item);
          });
        }
      }
      const matchedLocalIds = new Set<number>();

      for (const node of candidateNodes) {
        if (typeof node.localId !== "number") continue;

        const itemData = itemDataMap.get(node.localId);
        const levelName = levelByLocalId.get(node.localId) ?? "";
        const searchableText = [
          model.name,
          node.name,
          node.type,
          prettyIfcCategory(node.type),
          levelName,
          readSearchableText(itemData)
        ]
          .join(" ")
          .toLowerCase();

        if (normalizedText && !searchableText.includes(normalizedText)) {
          continue;
        }

        if (
          normalizedPropertySet &&
          !itemMatchesSmartViewProperty(
            itemData,
            criteria.propertySet,
            criteria.propertyName,
            criteria.propertyValue
          )
        ) {
          continue;
        }

        if (!normalizedPropertySet && normalizedPropertyName && !searchableText.includes(normalizedPropertyName)) {
          continue;
        }

        if (!normalizedPropertySet && normalizedPropertyValue && !searchableText.includes(normalizedPropertyValue)) {
          continue;
        }

        matchedLocalIds.add(node.localId);
      }

      if (matchedLocalIds.size > 0) {
        result[model.modelId] = matchedLocalIds;
      }
    }

    setBoundedModelIdMapCache(
      smartViewModelIdMapCacheRef.current,
      criteriaCacheKey,
      result
    );

    return cloneModelIdMap(result);
  }

  async function handleApplySmartView(criteria: SmartViewCriteria) {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    if (!modules || !viewer) return;

    setStatus("Aplicando SmartView...");

    try {
      const modelIdMap = await getSmartViewModelIdMap(criteria);
      const matchCount = Object.values(modelIdMap).reduce(
        (total, ids) => total + ids.size,
        0
      );

      if (matchCount === 0) {
        setStatus("SmartView sin resultados.");
        return;
      }

      try {
        await modules.visibility.isolate(modelIdMap);
      } catch (visibilityError) {
        console.warn("[viewer-ifc] SmartView visibility isolate failed:", visibilityError);
        await modules.visibility.showAll();
      }

      try {
        await modules.coloring.restoreAllColors();
        await modules.coloring.colorSelection(modelIdMap, criteria.color);
      } catch (colorError) {
        console.warn("[viewer-ifc] SmartView color failed:", colorError);
      }

      try {
        await modules.selection.highlighter.highlightByID(
          "select",
          modelIdMap,
          true,
          false
        );
      } catch (selectionError) {
        console.warn("[viewer-ifc] SmartView selection highlight failed:", selectionError);
      }

      try {
        await fitSelectionInView(viewer, viewer.components, modelIdMap);
      } catch (fitError) {
        console.warn("[viewer-ifc] No se pudo enfocar SmartView:", fitError);
      }

      lastColoredSelectionRef.current = cloneModelIdMap(modelIdMap);
      setHasSelection(true);
      setStatus(`SmartView aplicada: ${matchCount} elementos.`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error aplicando SmartView:", error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`No se pudo aplicar la SmartView: ${message}`);
    }
  }

  async function handleClearSmartView() {
    const modules = modulesRef.current;
    if (!modules) return;

    beginRenderOperation();

    try {
      await modules.visibility.showAll();
      await waitForNextFrame();
      await modules.coloring.restoreAllColors();
      await modules.selection.clearSelection();
      lastColoredSelectionRef.current = null;
      setHasSelection(false);
      setStatus("SmartView limpiada.");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error limpiando SmartView:", error);
      setStatus("No se pudo limpiar la SmartView.");
    }
  }

  async function expandModelIdMapForRendering(modelIdMap: OBC.ModelIdMap) {
    const sourceCount = getModelIdMapItemCount(modelIdMap);

    if (sourceCount > MAX_MODEL_ID_MAP_EXPANSION_IDS) {
      return cloneModelIdMap(modelIdMap);
    }

    const cacheKey = getSelectionCacheKey(modelIdMap);
    const cached = expandedModelIdMapCacheRef.current.get(cacheKey);

    if (cached) {
      return cloneModelIdMap(cached);
    }

    const expanded: OBC.ModelIdMap = {};

    for (const [modelId, ids] of Object.entries(modelIdMap)) {
      const model = models.find((item) => item.modelId === modelId);
      const expandedIds = new Set<number>(ids);

      if (model) {
        const nodeByLocalId = new Map<number, ModelTreeNode>();
        for (const node of flattenModelTreeNodes(model.spatialTree ?? [])) {
          if (typeof node.localId === "number") {
            nodeByLocalId.set(node.localId, node);
          }
        }

        for (const localId of ids) {
          const node = nodeByLocalId.get(localId);
          if (!node) continue;

          for (const descendantId of collectModelTreeLocalIds(node)) {
            expandedIds.add(descendantId);
          }
        }

        if (model.runtimeModel.getItemsChildren) {
          const visited = new Set<number>(expandedIds);
          let queue = Array.from(ids);

          while (queue.length > 0) {
            const batch = queue.slice(0, 80);
            queue = queue.slice(80);

            try {
              const children = await Promise.resolve(
                model.runtimeModel.getItemsChildren(batch)
              );

              for (const childId of children) {
                if (visited.has(childId)) continue;
                visited.add(childId);
                expandedIds.add(childId);
                queue.push(childId);
              }
            } catch (error) {
              console.warn(
                "[viewer-ifc] No se pudieron expandir hijos de parametros:",
                error
              );
              break;
            }
          }
        }
      }

      if (expandedIds.size > 0) {
        expanded[modelId] = expandedIds;
      }
    }

    expandedModelIdMapCacheRef.current.set(cacheKey, cloneModelIdMap(expanded));
    return expanded;
  }

  function takeExclusiveModelIdMap(
    modelIdMap: OBC.ModelIdMap,
    seenKeys: Set<string>
  ) {
    const exclusive: OBC.ModelIdMap = {};

    for (const [modelId, ids] of Object.entries(modelIdMap)) {
      const exclusiveIds = new Set<number>();

      for (const localId of ids) {
        const key = `${modelId}:${localId}`;
        if (seenKeys.has(key)) continue;

        seenKeys.add(key);
        exclusiveIds.add(localId);
      }

      if (exclusiveIds.size > 0) {
        exclusive[modelId] = exclusiveIds;
      }
    }

    return exclusive;
  }


  function beginRenderOperation() {
    renderOperationTokenRef.current += 1;
    return renderOperationTokenRef.current;
  }

  function isRenderOperationCurrent(token: number) {
    return renderOperationTokenRef.current === token;
  }

  async function applyChunkedVisibility(
    modelIdMap: OBC.ModelIdMap,
    visible: boolean,
    token: number
  ) {
    const modules = modulesRef.current;
    if (!modules) return false;

    return forEachModelIdMapChunk(
      modelIdMap,
      async (chunk) => {
        if (visible) {
          await modules.visibility.show(chunk);
        } else {
          await modules.visibility.hide(chunk);
        }
      },
      MODEL_ID_MAP_RENDER_CHUNK_SIZE,
      () => isRenderOperationCurrent(token)
    );
  }

  async function applyChunkedColorSelections(
    selections: Array<{ modelIdMap: OBC.ModelIdMap; color: string }>,
    token: number
  ) {
    const modules = modulesRef.current;
    if (!modules) return false;

    for (const selection of selections) {
      const completed = await forEachModelIdMapChunk(
        selection.modelIdMap,
        async (chunk) => {
          await modules.coloring.colorSelections([
            {
              modelIdMap: chunk,
              color: selection.color
            }
          ]);
        },
        MODEL_ID_MAP_COLOR_CHUNK_SIZE,
        () => isRenderOperationCurrent(token)
      );

      if (!completed) return false;
    }

    return true;
  }

  async function handleApplyParameterColors(
    propertySet: string,
    propertyName: string,
    buckets: ParameterValueBucket[]
  ) {
    const modules = modulesRef.current;
    if (!modules) return;

    if (!propertySet || !propertyName || buckets.length === 0) {
      setStatus("Selecciona un parametro con valores para colorear.");
      return;
    }

    const token = beginRenderOperation();

    try {
      await modules.visibility.showAll();
      await waitForNextFrame();

      const coloredMap: OBC.ModelIdMap = {};
      const seenKeys = new Set<string>();
      let overlapCount = 0;
      const renderBuckets: ParameterValueBucket[] = [];

      const orderedBuckets = [...buckets].sort((a, b) => {
        if (a.value === "Sin valor") return 1;
        if (b.value === "Sin valor") return -1;
        return b.count - a.count || a.value.localeCompare(b.value);
      });

      for (const bucket of orderedBuckets) {
        const renderModelIdMap = await expandModelIdMapForRendering(
          bucket.modelIdMap
        );
        const exclusiveModelIdMap = takeExclusiveModelIdMap(
          renderModelIdMap,
          seenKeys
        );

        for (const [modelId, ids] of Object.entries(renderModelIdMap)) {
          for (const localId of ids) {
            const key = `${modelId}:${localId}`;
            if (!exclusiveModelIdMap[modelId]?.has(localId)) overlapCount += 1;
          }
        }

        mergeModelIdMap(coloredMap, exclusiveModelIdMap);
        renderBuckets.push({
          ...bucket,
          modelIdMap: exclusiveModelIdMap
        });
      }

      console.debug(
        "[viewer-ifc] Parameter color buckets",
        buckets.map((bucket) => ({
          value: bucket.value,
          color: bucket.color,
          count: bucket.count,
          mapCount: countModelIdMapElements(bucket.modelIdMap),
          renderMapCount: countModelIdMapElements(
            renderBuckets.find((item) => item.value === bucket.value)?.modelIdMap ??
              bucket.modelIdMap
          )
        })),
        { overlapCount }
      );

      const completed = await applyChunkedColorSelections(
        renderBuckets.map((bucket) => ({
          modelIdMap: bucket.modelIdMap,
          color: bucket.color
        })),
        token
      );

      if (!completed || !isRenderOperationCurrent(token)) {
        setStatus("Operacion de coloreo cancelada por una accion nueva.");
        return;
      }

      lastColoredSelectionRef.current = cloneModelIdMap(coloredMap);
      setHasSelection(countModelIdMapElements(coloredMap) > 0);
      setStatus(
        `Parametro coloreado: ${propertySet} / ${propertyName} (${buckets.length} valores).`
      );
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error coloreando parametro:", error);
      setStatus("No se pudo colorear el parametro seleccionado.");
    }
  }

  async function handleSelectParameterBucket(bucket: ParameterValueBucket) {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    if (!modules || !viewer) return;

    const token = beginRenderOperation();

    try {
      const modelIdMap = await expandModelIdMapForRendering(bucket.modelIdMap);
      if (!isRenderOperationCurrent(token)) return;

      const elementCount = countModelIdMapElements(modelIdMap);

      if (elementCount <= TREE_ACTION_HIGHLIGHT_LIMIT) {
        try {
          await modules.selection.highlighter.highlightByID(
            "select",
            modelIdMap,
            true,
            false
          );
        } catch (selectionError) {
          console.warn(
            "[viewer-ifc] Parameter bucket selection highlight failed:",
            selectionError
          );
        }

        await fitSelectionInView(viewer, viewer.components, modelIdMap);
      } else {
        await modules.selection.clearSelection();
      }

      if (!isRenderOperationCurrent(token)) return;
      await resetContextGhostOpacity();
      setHasSelection(true);
      setStatus(`Valor seleccionado: ${bucket.value} (${bucket.count} elementos).`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error seleccionando bucket de parametro:", error);
      setStatus("No se pudo seleccionar el valor del parametro.");
    }
  }

  async function resetContextGhostOpacity() {
    if (!lastGhostedSelectionRef.current) return;

    for (const model of models) {
      await model.runtimeModel.resetOpacity?.(undefined);
    }
    lastGhostedSelectionRef.current = null;
  }

  async function getModelContextLocalIds(model: FederatedModelEntry) {
    const indexedIds = smartViewPropertyIndex.localIdsByModelKey?.[model.key];
    if (indexedIds?.length) return Array.from(new Set(indexedIds));

    const treeIds = flattenModelTreeNodes(model.spatialTree ?? [])
      .filter((node) => isModelTreeElement(node) && typeof node.localId === "number")
      .map((node) => node.localId as number);
    if (treeIds.length) return Array.from(new Set(treeIds));

    try {
      if (model.runtimeModel.getItemsIdsWithGeometry) {
        return Array.from(
          new Set(await Promise.resolve(model.runtimeModel.getItemsIdsWithGeometry()))
        );
      }

      if (model.runtimeModel.getLocalIds) {
        return Array.from(
          new Set(await Promise.resolve(model.runtimeModel.getLocalIds()))
        );
      }
    } catch (error) {
      console.warn("[viewer-ifc] No se pudo obtener universo para contexto ghost:", error);
    }

    return [];
  }

  async function getModelVisibilityUniverseLocalIds(model: FederatedModelEntry) {
    const cachedIds = visibilityUniverseCacheRef.current.get(model.key);
    if (cachedIds) return cachedIds;

    let ids: number[] = [];

    try {
      if (model.runtimeModel.getItemsIdsWithGeometry) {
        ids = await Promise.resolve(model.runtimeModel.getItemsIdsWithGeometry());
      } else if (model.runtimeModel.getLocalIds) {
        ids = await Promise.resolve(model.runtimeModel.getLocalIds());
      }
    } catch (error) {
      console.warn("[viewer-ifc] No se pudo obtener universo de visibilidad:", error);
    }

    if (ids.length === 0) {
      ids = await getModelContextLocalIds(model);
    }

    const uniqueIds = Array.from(new Set(ids));
    visibilityUniverseCacheRef.current.set(model.key, uniqueIds);
    return uniqueIds;
  }

  async function buildLoadedUniverseModelIdMap() {
    const universeMap: OBC.ModelIdMap = {};

    for (const model of models) {
      if (!model.modelId) continue;
      const contextIds = await getModelVisibilityUniverseLocalIds(model);
      if (contextIds.length > 0) {
        universeMap[model.modelId] = new Set(contextIds);
      }
    }

    return universeMap;
  }
  async function applySelectionFocusMode(
    modelIdMap: OBC.ModelIdMap,
    token = beginRenderOperation()
  ) {
    const modules = modulesRef.current;

    if (!modules) return false;

    await modules.visibility.showAll();
    await waitForNextFrame();
    if (!isRenderOperationCurrent(token)) return false;
    await resetContextGhostOpacity();

    const dimWork: Array<{ model: (typeof models)[number]; ids: number[] }> = [];
    let totalDimIds = 0;

    for (const model of models) {
      if (!isRenderOperationCurrent(token)) return false;

      const modelId = model.modelId;
      const selectedIds = modelId ? modelIdMap[modelId] : undefined;
      if (!modelId || !selectedIds?.size || !model.runtimeModel.setOpacity) continue;

      const contextIds = await getModelContextLocalIds(model);
      const contextIdsToDim = contextIds.filter(
        (localId) => !selectedIds.has(localId)
      );

      if (contextIdsToDim.length > 0) {
        totalDimIds += contextIdsToDim.length;
        dimWork.push({ model, ids: contextIdsToDim });
      }
    }

    if (totalDimIds > CONTEXT_GHOST_MAX_DIM_IDS) {
      for (const [modelId, selectedIds] of Object.entries(modelIdMap)) {
        const model = models.find((entry) => entry.modelId === modelId);
        if (model?.runtimeModel.resetOpacity && selectedIds?.size) {
          await model.runtimeModel.resetOpacity(Array.from(selectedIds));
        }
      }
      lastGhostedSelectionRef.current = null;
      return false;
    }

    for (const { model, ids } of dimWork) {
      if (!isRenderOperationCurrent(token)) return false;

      for (let index = 0; index < ids.length; index += MODEL_ID_MAP_RENDER_CHUNK_SIZE) {
        if (!isRenderOperationCurrent(token)) return false;
        await model.runtimeModel.setOpacity(
          ids.slice(index, index + MODEL_ID_MAP_RENDER_CHUNK_SIZE),
          0.16
        );
        await waitForNextFrame();
      }

      const modelId = model.modelId;
      const selectedIds = modelId ? modelIdMap[modelId] : undefined;
      if (selectedIds?.size) await model.runtimeModel.resetOpacity?.(Array.from(selectedIds));
    }

    lastGhostedSelectionRef.current = cloneModelIdMap(modelIdMap);
    return true;
  }

  async function handleSelectModelIdMap(
    sourceMap: OBC.ModelIdMap,
    successStatus: string,
    errorStatus: string
  ) {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    if (!modules || !viewer) return;

    const token = beginRenderOperation();

    try {
      const modelIdMap = await expandModelIdMapForRendering(sourceMap);
      if (!isRenderOperationCurrent(token)) return;

      const elementCount = countModelIdMapElements(modelIdMap);

      if (elementCount <= TREE_ACTION_HIGHLIGHT_LIMIT) {
        try {
          await modules.selection.highlighter.highlightByID(
            "select",
            modelIdMap,
            true,
            false
          );
        } catch (selectionError) {
          console.warn("[viewer-ifc] 5D selection highlight failed:", selectionError);
        }

        await fitSelectionInView(viewer, viewer.components, modelIdMap);
      } else {
        await modules.selection.clearSelection();
        setStatus("Seleccion grande detectada. Aplicando contexto liviano por lotes...");
      }

      if (!isRenderOperationCurrent(token)) return;
      const ghostApplied = await applySelectionFocusMode(modelIdMap, token);
      setHasSelection(true);
      setStatus(
        ghostApplied
          ? successStatus
          : successStatus + " Contexto atenuado omitido por tamano para proteger rendimiento."
      );
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error seleccionando elementos tabulares:", error);
      setStatus(errorStatus);
    }
  }

  async function handleSelectCost5DRow(row: Cost5DRow) {
    await handleSelectModelIdMap(
      row.modelIdMap,
      `Partida seleccionada: ${row.itemId} - ${row.itemName} (${row.elementCount} elementos, ${row.quantity} ${row.itemUnit}).`,
      "No se pudo seleccionar la partida 5D."
    );
  }

  async function handleSetParameterBucketVisibility(
    bucket: ParameterValueBucket,
    visible: boolean
  ) {
    const modules = modulesRef.current;
    if (!modules) return;

    const token = beginRenderOperation();

    try {
      const modelIdMap = await expandModelIdMapForRendering(bucket.modelIdMap);
      const elementCount = countModelIdMapElements(modelIdMap);
      if (elementCount > MODEL_ID_MAP_RENDER_CHUNK_SIZE) {
        setStatus(`${visible ? "Mostrando" : "Ocultando"} ${bucket.value} por lotes...`);
      }

      const completed = await applyChunkedVisibility(modelIdMap, visible, token);
      if (!completed || !isRenderOperationCurrent(token)) return;

      setStatus(visible ? `Grupo visible: ${bucket.value}.` : `Grupo oculto: ${bucket.value}.`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error cambiando visibilidad de parametro:", error);
      setStatus("No se pudo cambiar la visibilidad del grupo.");
    }
  }

  async function handleRestoreParameterVisibility() {
    const modules = modulesRef.current;
    if (!modules) return;

    beginRenderOperation();

    try {
      await modules.visibility.showAll();
      await waitForNextFrame();
      setStatus("Todos los grupos del analisis estan visibles.");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error restableciendo visibilidad:", error);
      setStatus("No se pudo restablecer la visibilidad.");
    }
  }

  async function handleClearParameterAnalysis() {
    beginRenderOperation();
    await handleClearSmartView();
    setStatus("Analisis de parametros limpiado.");
  }

  function handleSaveSmartView(criteria: SmartViewCriteria, name: string) {
    const savedView: SavedSmartView = {
      ...criteria,
      id: `smartview-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name
    };

    setSavedSmartViews((current) => [savedView, ...current]);
    setStatus(`SmartView guardada: ${name}`);
  }

  function handleDeleteSmartView(id: string) {
    setSavedSmartViews((current) => current.filter((view) => view.id !== id));
  }

  function createDefaultAuditRule(): AuditRule {
    return {
      id: `audit-rule-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: `Requisito ${auditRules.length + 1}`,
      modelKey: "",
      type: "",
      level: "",
      propertySet: "",
      propertyName: "",
      operator: "exists",
      value: "",
      severity: "medium"
    };
  }

  function handleAddAuditRule() {
    setAuditRules((current) => [createDefaultAuditRule(), ...current]);
  }

  function handleUpdateAuditRule(id: string, patch: Partial<AuditRule>) {
    setAuditRules((current) =>
      current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule))
    );
    setAuditResults([]);
    setActiveAuditResultId(null);
  }

  function handleDeleteAuditRule(id: string) {
    setAuditRules((current) => current.filter((rule) => rule.id !== id));
    setAuditResults((current) => current.filter((result) => result.ruleId !== id));
  }

  async function buildAuditElementIndex(sourceModels: FederatedModelEntry[] = models) {
    const records: AuditElementRecord[] = [];
    const auditBatchSize = 12;

    for (const model of sourceModels) {
      if (!model.modelId || !model.runtimeModel.getItemsData) continue;

      const sourceTree = model.spatialTree ?? [];
      const levelByLocalId = buildElementLevelMap(sourceTree);
      const nodes = flattenModelTreeNodes(sourceTree)
        .filter((node) => isModelTreeElement(node) && typeof node.localId === "number")
        .slice(0, MAX_TREE_ELEMENT_NODES);
      const localIds = nodes.map((node) => node.localId as number);
      const nodeByLocalId = new Map<number, ModelTreeNode>();

      for (const node of nodes) {
        nodeByLocalId.set(node.localId as number, node);
      }

      for (let index = 0; index < localIds.length; index += auditBatchSize) {
        const batch = localIds.slice(index, index + auditBatchSize);
        let itemsData: Record<string, unknown>[] = [];

        try {
          itemsData = (await Promise.resolve(
            model.runtimeModel.getItemsData(batch, {
              attributesDefault: true,
              relations: {
                IsDefinedBy: {
                  attributes: true,
                  relations: true
                },
                IsTypedBy: {
                  attributes: true,
                  relations: true
                }
              }
            })
          )) as Record<string, unknown>[];
        } catch (relationsError) {
          console.warn(
            "[viewer-ifc] Auditoria con relaciones fallo; reintentando atributos:",
            relationsError
          );

          try {
            itemsData = (await Promise.resolve(
              model.runtimeModel.getItemsData(batch, {
                attributesDefault: true
              })
            )) as Record<string, unknown>[];
          } catch (basicError) {
            console.warn("[viewer-ifc] Lote de auditoria omitido:", basicError);
            continue;
          }
        }

        itemsData.forEach((item, itemIndex) => {
          const localId = batch[itemIndex];
          const node = nodeByLocalId.get(localId);
          if (!node) return;

          const type = node.type.toUpperCase();
          const level = levelByLocalId.get(localId) ?? "";
          const globalId =
            readItemAttributeValue(item.GlobalId) ||
            readItemAttributeValue(item.GlobalID) ||
            readItemAttributeValue(item.globalId);
          let properties: AuditElementRecord["properties"] = {};

          try {
            properties = smartViewPropertyPairsToRecord(
              collectSmartViewPropertyPairs(item)
            );
          } catch (propertyError) {
            console.warn("[viewer-ifc] Propiedades IFC omitidas en auditoria:", {
              model: model.name,
              localId,
              propertyError
            });
          }

          let searchableMetadata = "";

          try {
            searchableMetadata = readSearchableText(item);
          } catch (searchError) {
            console.warn("[viewer-ifc] Texto buscable omitido en auditoria:", {
              model: model.name,
              localId,
              searchError
            });
          }

          const searchableText = [
            model.name,
            node.name,
            type,
            prettyIfcCategory(type),
            level,
            globalId,
            searchableMetadata
          ]
            .join(" ")
            .toLowerCase();

          records.push({
            key: `${model.key}:${localId}`,
            modelKey: model.key,
            modelId: model.modelId as string,
            modelName: model.name,
            localId,
            name: node.name,
            type,
            level,
            globalId,
            properties,
            searchableText
          });
        });
      }
    }

    return records;
  }

  async function handleRunAudit() {
    if (auditRules.length === 0 || models.length === 0) return;

    const validRules = auditRules.filter(
      (rule) => rule.propertySet.trim() && rule.propertyName.trim()
    );

    if (validRules.length === 0) {
      const message = "No hay reglas evaluables: selecciona conjunto y propiedad.";
      setAuditMessage(message);
      setStatus(message);
      return;
    }

    setAuditLoading(true);
    setStatus("Ejecutando auditoria de modelos...");
    setAuditMessage("Construyendo indice de elementos y propiedades...");

    try {
      const analysisModels =
        auditIndexSignature === loadedModelsSignature
          ? models
          : await ensureSpatialTreesForAnalysis();
      const analysisSignature = getFederatedModelsAnalysisSignature(analysisModels);
      let records =
        auditIndexSignature === analysisSignature
          ? auditIndex
          : await buildAuditElementIndex(analysisModels);

      if (records.length === 0) {
        setAuditIndex(records);
        setAuditIndexSignature(analysisSignature);
        const message =
          "No se encontraron elementos auditables. Recarga el modelo o revisa que la jerarquia IFC este disponible.";
        setAuditMessage(message);
        setStatus(message);
        setAuditResults([]);
        return;
      }

      if (auditIndexSignature !== analysisSignature) {
        setAuditIndex(records);
        setAuditIndexSignature(analysisSignature);
      }

      const nextResults: AuditResult[] = [];

      for (const rule of validRules) {
        const candidateRecords = records.filter((record) => {
          if (rule.modelKey && record.modelKey !== rule.modelKey) return false;
          if (rule.type && record.type !== rule.type.toUpperCase()) return false;
          if (rule.level && record.level !== rule.level) return false;
          return true;
        });

        for (const record of candidateRecords) {
          const evaluation = evaluateAuditRuleForRecord(rule, record);

          nextResults.push({
            id: `${rule.id}:${record.key}`,
            ruleId: rule.id,
            ruleName: rule.name || "Requisito sin nombre",
            status: evaluation.passes ? "pass" : "fail",
            severity: rule.severity,
            message: evaluation.passes
              ? "Cumple requisito"
              : `No cumple: ${rule.propertySet} / ${rule.propertyName}`,
            actualValue: evaluation.actualValue,
            modelKey: record.modelKey,
            modelId: record.modelId,
            modelName: record.modelName,
            localId: record.localId,
            elementName: record.name,
            type: record.type,
            level: record.level,
            globalId: record.globalId,
            propertySet: rule.propertySet,
            propertyName: rule.propertyName
          });
        }
      }

      setAuditResults(nextResults);
      setActiveAuditResultId(null);
      const failed = nextResults.filter((result) => result.status === "fail").length;
      const message =
        nextResults.length > 0
          ? `Auditoria completada: ${nextResults.length} evaluaciones, ${failed} fallas.`
          : "Auditoria sin resultados: los filtros de regla no coinciden con elementos cargados.";
      setAuditMessage(message);
      setStatus(message);
    } catch (error) {
      console.error("[viewer-ifc] Error ejecutando auditoria:", error);
      const message =
        error instanceof Error
          ? `No se pudo ejecutar la auditoria: ${error.message}`
          : "No se pudo ejecutar la auditoria.";
      setAuditMessage(message);
      setStatus(message);
    } finally {
      setAuditLoading(false);
    }
  }

  async function handleSelectAuditResult(result: AuditResult) {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    if (!modules || !viewer) return;

    const sourceMap: OBC.ModelIdMap = {
      [result.modelId]: new Set([result.localId])
    };

    try {
      const modelIdMap = await expandModelIdMapForRendering(sourceMap);
      await modules.selection.highlighter.highlightByID(
        "select",
        modelIdMap,
        true,
        false
      );
      await fitSelectionInView(viewer, viewer.components, modelIdMap);
      await resetContextGhostOpacity();
      setActiveAuditResultId(result.id);
      setRightPanelTab("audit");
      setStatus(`Elemento auditado seleccionado: ${result.elementName}`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error seleccionando resultado de auditoria:", error);
      setStatus("No se pudo seleccionar el resultado de auditoria.");
    }
  }

  function handleExportAuditCsv() {
    if (auditResults.length === 0) return;

    downloadTextFile(
      `auditoria-${projectCode ?? "cde"}-${Date.now()}.csv`,
      buildAuditCsv(auditResults),
      "text/csv;charset=utf-8"
    );
  }

  function getAuditReportHtml() {
    return buildAuditHtmlReport({
      title: `Reporte de auditoria BIM - ${titleText}`,
      results: auditResults,
      generatedAt: new Date().toLocaleString()
    });
  }

  function handleExportAuditHtml() {
    if (auditResults.length === 0) return;

    downloadTextFile(
      `reporte-auditoria-${projectCode ?? "cde"}-${Date.now()}.html`,
      getAuditReportHtml(),
      "text/html;charset=utf-8"
    );
  }

  function handlePrintAuditReport() {
    if (auditResults.length === 0) return;

    const popup = window.open("", "_blank", "noopener,noreferrer");
    if (!popup) {
      setStatus("El navegador bloqueo la ventana de reporte PDF.");
      return;
    }

    popup.document.open();
    popup.document.write(getAuditReportHtml());
    popup.document.close();
    popup.focus();
    window.setTimeout(() => popup.print(), 400);
  }

  async function handleIsolateTreeNode(modelKey: string, node: ModelTreeNode) {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    if (!modules || !viewer) return;

    const modelIdMap = getTreeNodeModelIdMap(modelKey, node);
    if (!modelIdMap) return;

    const token = beginRenderOperation();

    try {
      const elementCount = countModelIdMapElements(modelIdMap);
      const universeMap = await buildLoadedUniverseModelIdMap();
      if (!isRenderOperationCurrent(token)) return;
      await resetContextGhostOpacity();
      await modules.visibility.showOnly(modelIdMap, universeMap);
      if (!isRenderOperationCurrent(token)) return;

      if (elementCount <= TREE_ACTION_HIGHLIGHT_LIMIT) {
        await modules.selection.highlighter.highlightByID(
          "select",
          modelIdMap,
          true,
          false
        );
        await fitSelectionInView(viewer, viewer.components, modelIdMap);
      } else {
        await modules.selection.clearSelection();
      }

      setStatus(
        elementCount > TREE_ACTION_HIGHLIGHT_LIMIT
          ? `Rama aislada: ${node.name} (${elementCount} elementos). Enfoque omitido para rendimiento.`
          : `Rama aislada: ${node.name}`
      );
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error aislando rama IFC:", error);
      setStatus("No se pudo aislar la rama del arbol IFC.");
    }
  }

  async function handleToggleTreeNodeVisibility(
    modelKey: string,
    node: ModelTreeNode,
    hidden: boolean
  ) {
    const modules = modulesRef.current;
    if (!modules) return;

    const sourceMap = getTreeNodeModelIdMap(modelKey, node);
    if (!sourceMap) return;

    const token = beginRenderOperation();

    try {
      const modelIdMap = sourceMap;
      const elementCount = countModelIdMapElements(modelIdMap);
      if (elementCount > MODEL_ID_MAP_RENDER_CHUNK_SIZE) {
        setStatus(`${hidden ? "Ocultando" : "Mostrando"} ${node.name} por lotes...`);
      }

      const completed = await applyChunkedVisibility(modelIdMap, !hidden, token);
      if (!completed || !isRenderOperationCurrent(token)) return;

      setStatus(hidden ? `Rama oculta: ${node.name}` : `Rama visible: ${node.name}`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error cambiando visibilidad de rama IFC:", error);
      setStatus("No se pudo cambiar la visibilidad de la rama IFC.");
    }
  }

  function handleToggleModelVisibility(key: string) {
    setModels((prev) =>
      prev.map((model) => {
        if (model.key !== key) return model;

        model.object.visible = !model.visible;
        return { ...model, visible: !model.visible };
      })
    );

    requestViewerRefresh();
  }

  async function handleFocusModel(key: string) {
  const viewer = viewerRef.current;
  const target = models.find((model) => model.key === key);

  if (!viewer || !target) return;

  try {
    await fitObjectInView(viewer, target.object);
    setStatus(`Modelo enfocado: ${target.name}`);
    requestViewerRefresh();
  } catch (error) {
    console.error("[viewer-ifc] Error focusing model:", error);
    setStatus("Error enfocando modelo. Revisa la consola.");
  }
}

async function handleIsolateModel(key: string) {
  const target = models.find((model) => model.key === key);
  if (!target) return;

  try {
    setModels((prev) =>
      prev.map((model) => {
        const shouldBeVisible = model.key === key;
        model.object.visible = shouldBeVisible;

        return {
          ...model,
          visible: shouldBeVisible,
          isolated: shouldBeVisible
        };
      })
    );

    setStatus(`Modelo aislado: ${target.name}`);
    requestViewerRefresh();
  } catch (error) {
    console.error("[viewer-ifc] Error isolating model:", error);
    setStatus("Error aislando modelo. Revisa la consola.");
  }
}

  function handleRemoveModel(key: string) {
    const target = models.find((model) => model.key === key);
    if (!target) return;

    try {
      if (target.object.parent) {
        target.object.parent.remove(target.object);
      }

      setModels((prev) => prev.filter((model) => model.key !== key));
      setAuditIndex([]);
      setAuditIndexSignature("");
      setAuditResults([]);
      setActiveAuditResultId(null);
      setSmartViewPropertyIndex({
        sets: [],
        propertiesBySet: {},
        valuesBySetAndProperty: {},
        localIdsBySetPropertyValue: {}
      });
      setSmartViewPropertyIndexSignature("");

      if (target.source) {
        const keyToDelete = getSourceKey(target.source);
        loadedSourceKeysRef.current.delete(keyToDelete);
      }

      setStatus(`Modelo quitado: ${target.name}`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error removing model:", error);
      setStatus("Error quitando modelo. Revisa la consola.");
    }
  }

  function handleOpenModelSelector() {
    setIsModelSelectorOpen(true);
  }

  function handleCloseModelSelector() {
    setIsModelSelectorOpen(false);
  }

  async function handleAddModelsIncrementally(
    selected: Array<{ path: string; name: string }>
  ) {
    const viewer = viewerRef.current;
    const modelsGroup = modelsGroupRef.current;

    if (!viewer || !modelsGroup) return;
    if (!selected.length) {
      setIsModelSelectorOpen(false);
      return;
    }

    setIsModelSelectorOpen(false);

    try {
      const addModelsStartedAt = performance.now();
      setStatus(`Resolviendo ${selected.length} modelo(s)...`);

      const resolvedSources: ViewerSource[] = [];

      for (let index = 0; index < selected.length; index += 1) {
        const item = selected[index];

        setStatus(
          `Resolviendo modelo ${index + 1} de ${selected.length}: ${item.name}`
        );

        const source = await resolveViewerSource({
          documentPath: item.path,
          documentName: item.name,
          requireFrag: true
        });

        resolvedSources.push(source);
      }

      const pending = resolvedSources
        .map((source, index) => ({
          source,
          name:
            selected[index]?.name ||
            getDisplayNameFromSource(source, undefined, index)
        }))
        .filter(({ source }) => {
          const key = getSourceKey(source);
          return !loadedSourceKeysRef.current.has(key);
        });

      if (!pending.length) {
        setStatus("Los modelos seleccionados ya estaban cargados");
        return;
      }

      setStatus(`Agregando ${pending.length} modelo(s)...`);

      const loadedEntries: FederatedModelEntry[] = [];

      for (let index = 0; index < pending.length; index += 1) {
        const { source, name } = pending[index];

        setStatus(`Cargando modelo ${index + 1} de ${pending.length}: ${name}`);

        const result = await loadViewerModel({
          components: viewer.components,
          world: viewer.world,
          source,
          modelName: name
        });

        loadedModelResultsRef.current.push(result);

        const object = result.model.object as THREE.Object3D<THREE.Object3DEventMap>;
        object.name = name;

        if (object.parent && object.parent !== modelsGroup) {
          object.parent.remove(object);
        }

        modelsGroup.add(object);

        const entry: FederatedModelEntry = {
          key: `${name}-${Date.now()}-${index}`,
          name,
          source,
          object,
          runtimeModel: result.model as RuntimeIfcModel,
          visible: true,
          expanded: false,
          isolated: false,
          isSelected: false,
          modelId:
            "modelId" in result.model ? String(result.model.modelId) : undefined,
          spatialTree: undefined,
          spatialTreeError: undefined
        };

        loadedEntries.push(entry);
        loadedSourceKeysRef.current.add(getSourceKey(source));
      }

      if (loadedEntries.length) {
        hasLoadedAnyModelRef.current = true;
        modulesRef.current?.views?.close();
        setModels((prev) => [...prev, ...loadedEntries]);
        setBim2DViews([]);
        setActiveBim2DViewId(null);
        setAuditIndex([]);
        setAuditIndexSignature("");
        setAuditResults([]);
        setActiveAuditResultId(null);
        setSmartViewPropertyIndex({
          sets: [],
          propertiesBySet: {},
          valuesBySetAndProperty: {},
          localIdsBySetPropertyValue: {}
        });
        setSmartViewPropertyIndexSignature("");
        const elapsedMs = Math.round(performance.now() - addModelsStartedAt);
        setViewerLoadMs(elapsedMs);
        setStatus(`${loadedEntries.length} modelo(s) agregados en ${elapsedMs} ms`);
        await fitObjectInView(viewer, modelsGroup);
        requestViewerRefresh();
      }
    } catch (error) {
      console.error("[viewer-ifc] Error agregando modelos federados:", error);
      setStatus(
        error instanceof Error
          ? `No se pudo agregar modelo: ${error.message}`
          : "No se pudo agregar modelo federado"
      );
    }
  }

  async function ensureViewpointModelsLoaded(viewpoint: ViewerViewpoint) {
    const loadedModels = viewpoint.federated?.loadedModels ?? [];

    const missing = loadedModels
      .filter((model) => model.documentPath)
      .filter((model) => {
        const key = model.documentPath;
        return key ? !loadedSourceKeysRef.current.has(key) : false;
      })
      .map((model) => ({
        path: model.documentPath as string,
        name: model.documentName ?? model.documentPath ?? "Modelo"
      }));

    if (!missing.length) return;

    setStatus(`Cargando ${missing.length} modelo(s) del viewpoint...`);

    await handleAddModelsIncrementally(missing);
  }

  async function handleApplyModelSelection(
    selected: Array<{ path: string; name: string }>
  ) {
    await handleAddModelsIncrementally(selected);
  }

  async function handleIsolateSelection() {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;

    if (!modules || !viewer) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    try {
      setStatus("Aislando seleccion...");
      await modules.visibility.isolate(map);
      await fitSelectionInView(viewer, viewer.components, map);
      setStatus("Seleccion aislada");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error isolating selection:", error);
      setStatus("Error aislando seleccion. Revisa la consola.");
    }
  }

  async function handleLoadSelectedProperties() {
    const modules = modulesRef.current;
    if (!modules) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    const cacheKey = getSelectionCacheKey(map);
    const cached = propertiesCacheRef.current.get(cacheKey);

    if (cached) {
      setSelectedItemsData(cached);
      setPropertiesRequested(true);
      setPropertiesLoading(false);
      setContainmentLoading(true);
      setAssociationsLoading(true);

      try {
        const [containment, associations] = await Promise.all([
          modules.selection.getSelectedContainmentData(),
          modules.selection.getSelectedAssociationsData()
        ]);
        setContainmentData(containment as Record<string, unknown>[]);
        setAssociationsData(associations as Record<string, unknown>[]);
      } finally {
        setContainmentLoading(false);
        setAssociationsLoading(false);
      }

      setStatus("Propiedades cargadas");
      return;
    }

    setPropertiesLoading(true);
    setContainmentLoading(true);
    setAssociationsLoading(true);

    try {
      const [data, containment, associations] = await Promise.all([
        modules.selection.getSelectedItemsData(),
        modules.selection.getSelectedContainmentData(),
        modules.selection.getSelectedAssociationsData()
      ]);
      const typedData = data as Record<string, unknown>[];

      propertiesCacheRef.current.set(cacheKey, typedData);
      setSelectedItemsData(typedData);
      setContainmentData(containment as Record<string, unknown>[]);
      setAssociationsData(associations as Record<string, unknown>[]);
      setPropertiesRequested(true);
      setStatus("Propiedades cargadas");
    } catch (error) {
      console.error("[viewer-ifc] Error loading selected item data:", error);
      setStatus("Error cargando propiedades. Revisa la consola.");
    } finally {
      setPropertiesLoading(false);
      setContainmentLoading(false);
      setAssociationsLoading(false);
    }
  }

  async function handleToggleSelection() {
    const modules = modulesRef.current;
    if (!modules) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    try {
      await modules.visibility.toggle(map);
      setStatus("Visibilidad actualizada");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error toggling selection visibility:", error);
      setStatus("Error cambiando visibilidad. Revisa la consola.");
    }
  }

  async function handleToggleGhostSelection() {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    if (!modules) return;

    const currentMap = modules.selection.getSelectionModelIdMap();
    const hasCurrentSelection = countModelIdMapElements(currentMap) > 0;

    try {
      if (!hasCurrentSelection && lastGhostedSelectionRef.current) {
        await resetContextGhostOpacity();
        setStatus("Contexto ghost desactivado");
        requestViewerRefresh();
        return;
      }

      if (!hasCurrentSelection) return;

      const modelIdMap = await expandModelIdMapForRendering(currentMap);
      await applySelectionFocusMode(modelIdMap);

      if (viewer) {
        await fitSelectionInView(viewer, viewer.components, modelIdMap);
      }

      setStatus("Contexto ghost aplicado");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error aplicando ghost:", error);
      setStatus("No se pudo aplicar contexto ghost en la seleccion.");
    }
  }

  async function handleShowAll() {
    const modules = modulesRef.current;
    if (!modules) return;

    beginRenderOperation();

    try {
      await modules.visibility.showAll();
      await waitForNextFrame();

      for (const model of models) {
        await model.runtimeModel.resetOpacity?.(undefined);
      }
      lastGhostedSelectionRef.current = null;

      setModels((prev) =>
        prev.map((model) => {
          model.object.visible = true;
          return {
            ...model,
            visible: true,
            isolated: false
          };
        })
      );

      setStatus("Todos los elementos visibles");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error showing all:", error);
      setStatus("Error mostrando todos los elementos. Revisa la consola.");
    }
  }

  async function handleFitModel() {
    const viewer = viewerRef.current;
    const modelsGroup = modelsGroupRef.current;

    if (!viewer || !modelsGroup) return;

    await fitObjectInView(viewer, modelsGroup);
  }

  async function handleFocusSelection() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    const modelIdMap = modules.selection.getSelectionModelIdMap();
    if (Object.keys(modelIdMap).length === 0) return;

    await fitSelectionInView(viewer, viewer.components, modelIdMap);
  }

  async function handleResetView() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;
    const modelsGroup = modelsGroupRef.current;

    if (!viewer || !modules || !modelsGroup) return;

    await modules.visibility.showAll();

    if (modules.coloring) {
      await modules.coloring.restoreAllColors();
    }

    if (modules.sectionBox) {
      modules.sectionBox.clear();
    }

    lastSectionBoxSelectionRef.current = null;
    lastColoredSelectionRef.current = null;

    setModels((prev) =>
      prev.map((model) => {
        model.object.visible = true;
        return { ...model, visible: true };
      })
    );

    await fitObjectInView(viewer, modelsGroup);
    setStatus("Vista restablecida");
    requestViewerRefresh();
  }

  async function handleSaveViewpoint() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    const canvas = viewer.renderer?.three?.domElement ?? null;

    const snapshot = canvas
      ? await captureViewerSnapshot(canvas)
      : null;

    const viewpoint = await captureViewpoint(viewer, modules, {
      loadedModels: models.map((model) => ({
        key: model.key,
        name: model.name,
        documentPath: model.source.documentPath,
        documentName: model.source.documentName ?? model.name,
        visible: model.visible,
        isolated: model.isolated ?? false
      })),
      selectedColor,
      sectionBoxPadding,
      snapshot,
        coloredSelection: lastColoredSelectionRef.current
          ? Object.entries(lastColoredSelectionRef.current).map(([modelId, ids]) => ({
              modelId,
              expressIds: Array.from(ids)
            }))
          : [],
    });
    if (!viewpoint) return;

    setViewpoints((prev) => [
      ...prev,
      {
        ...viewpoint,
        name: `Vista ${prev.length + 1}`
      }
    ]);
    
    setStatus("Vista guardada");
  }

  function buildTopicSelectionModelIdMap(customTopic: BcfTopic): OBC.ModelIdMap {
    const modelIdMap: OBC.ModelIdMap = {};

    for (const selection of customTopic.linkedSelection ?? []) {
      if (!selection.expressIds.length) continue;

      const resolvedModel = models.find((model) => {
        const documentName = model.source.documentName ?? model.name;
        const documentPath = model.source.documentPath ?? "";

        return (
          model.modelId === selection.modelId ||
          model.name === selection.modelId ||
          documentName === selection.modelId ||
          documentPath.endsWith(`/${selection.modelId}`)
        );
      });

      const resolvedModelId = resolvedModel?.modelId ?? selection.modelId;

      if (!modelIdMap[resolvedModelId]) {
        modelIdMap[resolvedModelId] = new Set<number>();
      }

      for (const expressId of selection.expressIds) {
        modelIdMap[resolvedModelId].add(expressId);
      }
    }

    return modelIdMap;
  }

  async function hydrateNativeViewpointSnapshot(
    nativeViewpoint: NativeViewpointLike,
    snapshot?: string | null
  ) {
    const modules = modulesRef.current;
    if (!modules?.viewpoints || !snapshot) return false;

    try {
      const response = await bffAssetFetch(snapshot);
      if (!response.ok) return false;

      const bytes = new Uint8Array(await response.arrayBuffer());
      modules.viewpoints.snapshots.set(nativeViewpoint.guid, bytes);
      nativeViewpoint.snapshot = nativeViewpoint.guid;
      return true;
    } catch (error) {
      console.warn("[BCF] No se pudo hidratar snapshot de viewpoint:", error);
      return false;
    }
  }

  async function populateNativeViewpointSelection(
    nativeViewpoint: NativeViewpointLike,
    modelIdMap: OBC.ModelIdMap
  ) {
    const modules = modulesRef.current;
    if (!modules?.viewpoints || !nativeViewpoint.selectionComponents) return;

    try {
      const fragments = viewerRef.current?.components.get(OBC.FragmentsManager);
      nativeViewpoint.selectionComponents.clear();
      let linkedGuidCount = 0;

      for (const [modelId, localIds] of Object.entries(modelIdMap)) {
        const model = fragments?.list.get(modelId) as
          | {
              getGuidsByLocalIds?: (localIds: number[]) => Promise<Array<string | null>> | Array<string | null>;
            }
          | undefined;

        if (!model?.getGuidsByLocalIds) continue;

        const guids = await model.getGuidsByLocalIds(Array.from(localIds));

        for (const guid of guids) {
          if (guid) {
            nativeViewpoint.selectionComponents.add(guid);
            linkedGuidCount += 1;
          }
        }
      }

      console.log("[BCF] viewpoint selection GUIDs", {
        viewpointGuid: nativeViewpoint.guid,
        models: Object.keys(modelIdMap).length,
        linkedGuidCount
      });
    } catch (error) {
      console.warn("[BCF] No se pudo poblar seleccion IFC GUID del viewpoint:", error);
    }
  }

  function applySavedCameraToNativeViewpoint(
    nativeViewpoint: NativeViewpointLike,
    savedViewpoint?: ViewerViewpoint
  ) {
    if (!savedViewpoint?.camera || typeof nativeViewpoint.set !== "function") {
      return false;
    }

    const [x, y, z] = savedViewpoint.camera.position;
    const [tx, ty, tz] = savedViewpoint.camera.target;
    const [ux, uy, uz] = savedViewpoint.camera.up ?? [0, 1, 0];
    const direction = new THREE.Vector3(tx - x, ty - y, tz - z);
    const up = new THREE.Vector3(ux, uy, uz);

    if (direction.lengthSq() === 0) {
      direction.set(0, 0, -1);
    } else {
      direction.normalize();
    }

    if (up.lengthSq() === 0) {
      up.set(0, 1, 0);
    } else {
      up.normalize();
    }

    const canvas = viewerRef.current?.renderer?.three?.domElement ?? null;
    const aspectRatio =
      canvas && canvas.clientHeight > 0
        ? canvas.clientWidth / canvas.clientHeight
        : 1;

    nativeViewpoint.set({
      perspective_camera: {
        camera_view_point: { x, y, z },
        camera_direction: {
          x: direction.x,
          y: direction.y,
          z: direction.z
        },
        camera_up_vector: { x: up.x, y: up.y, z: up.z },
        aspect_ratio: aspectRatio,
        field_of_view: 60
      }
    });

    return true;
  }

  async function updateNativeViewpointCameraFromSavedViewpoint(
    nativeViewpoint: NativeViewpointLike,
    savedViewpoint?: ViewerViewpoint
  ) {
    const viewer = viewerRef.current;
    const controls = viewer?.camera?.controls;

    if (
      !viewer ||
      !controls ||
      !savedViewpoint?.camera ||
      typeof nativeViewpoint.updateCamera !== "function"
    ) {
      return false;
    }

    const camera = viewer.camera.three;
    const previousPosition = camera.position.clone();
    const previousTarget = new THREE.Vector3();
    const previousUp = camera.up.clone();
    controls.getTarget(previousTarget);

    const [x, y, z] = savedViewpoint.camera.position;
    const [tx, ty, tz] = savedViewpoint.camera.target;
    const [ux, uy, uz] = savedViewpoint.camera.up ?? [0, 1, 0];
    const nextUp = new THREE.Vector3(ux, uy, uz);

    if (nextUp.lengthSq() > 0) {
      camera.up.copy(nextUp.normalize());
    }

    try {
      await controls.setLookAt(x, y, z, tx, ty, tz, false);
      await nativeViewpoint.updateCamera(false);
      return true;
    } catch (error) {
      console.warn("[BCF] No se pudo sincronizar camara guardada con viewpoint nativo:", error);
      return false;
    } finally {
      camera.up.copy(previousUp);
      try {
        await controls.setLookAt(
          previousPosition.x,
          previousPosition.y,
          previousPosition.z,
          previousTarget.x,
          previousTarget.y,
          previousTarget.z,
          false
        );
      } catch (error) {
        console.warn("[BCF] No se pudo restaurar camara despues de preparar exportacion:", error);
      }
      requestViewerRefresh();
    }
  }

  async function ensureNativeViewpointForTopic(customTopic: BcfTopic) {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;
    if (!viewer || !modules?.viewpoints) return null;

    const cachedGuid = reconstructedNativeViewpointMapRef.current.get(customTopic.id);
    const candidateGuid = cachedGuid ?? customTopic.nativeViewpointGuid;

    let nativeViewpoint = candidateGuid
      ? (modules.viewpoints.list.get(candidateGuid) as NativeViewpointLike | undefined)
      : undefined;

    if (!nativeViewpoint) {
      modules.viewpoints.world = viewer.world;
      nativeViewpoint = modules.viewpoints.create() as NativeViewpointLike;
      reconstructedNativeViewpointMapRef.current.set(customTopic.id, nativeViewpoint.guid);

      try {
        (nativeViewpoint as { world?: unknown }).world = viewer.world;
      } catch {
        // Algunas versiones no permiten asignar world directamente.
      }
    }

    nativeViewpoint.title = customTopic.title || customTopic.id;
    const savedViewpoint = viewpoints.find(
      (viewpoint) => viewpoint.id === customTopic.viewpointId
    );
    const cameraAppliedFromSavedViewpoint =
      (await updateNativeViewpointCameraFromSavedViewpoint(
        nativeViewpoint,
        savedViewpoint
      )) ||
      applySavedCameraToNativeViewpoint(nativeViewpoint, savedViewpoint);

    try {
      if (!cameraAppliedFromSavedViewpoint && typeof nativeViewpoint.updateCamera === "function") {
        await nativeViewpoint.updateCamera(!customTopic.snapshot);
      }
    } catch (error) {
      console.warn("[BCF] No se pudo actualizar camara del viewpoint:", error);
    }

    const selectionMap = buildTopicSelectionModelIdMap(customTopic);

    await populateNativeViewpointSelection(nativeViewpoint, selectionMap);

    if (
      Object.keys(selectionMap).length > 0 &&
      typeof nativeViewpoint.addComponentsFromMap === "function"
    ) {
      try {
        await nativeViewpoint.addComponentsFromMap(selectionMap);
      } catch (error) {
        console.warn("[BCF] No se pudo agregar seleccion al viewpoint:", error);
      }
    }

    const snapshotHydrated = await hydrateNativeViewpointSnapshot(
      nativeViewpoint,
      customTopic.snapshot
    );

    if (!customTopic.snapshot && !snapshotHydrated && typeof nativeViewpoint.takeSnapshot === "function") {
      try {
        await nativeViewpoint.takeSnapshot();
      } catch (error) {
        console.warn("[BCF] No se pudo capturar snapshot fallback:", error);
      }
    }

    return nativeViewpoint.guid;
  }

  /**
   * Sincroniza el estado de topics[] custom con los nativeTopics del list nativo.
   * - Crea nativeTopics para cada customTopic nuevo
   * - Actualiza nativeTopics existentes con los datos del customTopic
   * - Elimina nativeTopics huerfanos (que no estan en topics[] custom)
   * - Vincula el viewpoint nativo si el customTopic tiene snapshot/camara/seleccion
   * - Sincroniza comentarios sin duplicar
   *
   * NO inventa metodos delete/remove/clear. Si no hay metodo nativo para borrar,
   * el fallback es exportar solo los nativeTopics vinculados a topics[] custom vivos.
   */
  async function syncCustomTopicsToNative() {
    const modules = modulesRef.current;
    if (!modules?.bcfTopics) return;

    const customIdToNativeGuid = customToNativeTopicMapRef.current;
    const nativeGuidToCustomId = nativeToCustomTopicMapRef.current;
    const orphanNativeGuids: string[] = [];
    const deletedCustomIds: string[] = [];
    const syncedFieldsLog: string[] = [];

    // 1) Detectar customTopics vivos actuales
    const aliveCustomIds = new Set(topics.map((t) => t.id));

    // 2) Detectar huerfanos (nativeTopics sin custom vivo)
    for (const [nativeGuid, customId] of nativeGuidToCustomId.entries()) {
      if (!aliveCustomIds.has(customId)) {
        orphanNativeGuids.push(nativeGuid);
        deletedCustomIds.push(customId);
      }
    }

    // 3) Limpiar indices de huerfanos (sin borrar del list nativo; lo haremos al exportar)
    for (const nativeGuid of orphanNativeGuids) {
      const customId = nativeGuidToCustomId.get(nativeGuid);
      nativeGuidToCustomId.delete(nativeGuid);
      if (customId) customIdToNativeGuid.delete(customId);
    }

    // 4) Crear o actualizar nativeTopics para cada customTopic vivo
    for (const customTopic of topics) {
      let existingNativeGuid = customIdToNativeGuid.get(customTopic.id);
      let nativeTopic = existingNativeGuid
        ? modules.bcfTopics.list.get(existingNativeGuid)
        : undefined;

      if (existingNativeGuid && !nativeTopic) {
        nativeGuidToCustomId.delete(existingNativeGuid);
        customIdToNativeGuid.delete(customTopic.id);
        existingNativeGuid = undefined;
      }

      if (existingNativeGuid && nativeTopic) {
        // UPDATE: sincronizar campos del custom -> native
        if (nativeTopic && typeof nativeTopic.set === "function") {
          try {
            nativeTopic.set({
              title: customTopic.title,
              description: customTopic.description ?? "",
              status: customTopic.status,
              priority: customTopic.priority,
              assignedTo: customTopic.assignedTo ?? "",
              modifiedDate: new Date(customTopic.modifiedDate),
              modifiedAuthor: currentAuthor,
            } as Partial<OBC.BCFTopic>);
            syncedFieldsLog.push(`updated:${customTopic.id}`);
          } catch (e) {
            console.warn("[syncCustomTopicsToNative] update failed:", e);
          }

          const nativeViewpointGuid = await ensureNativeViewpointForTopic(customTopic);
          if (nativeViewpointGuid) {
            try {
              nativeTopic.viewpoints.add(nativeViewpointGuid);
            } catch (e) {
              console.warn("[syncCustomTopicsToNative] existing viewpoint link failed:", e);
            }
          }

          // Sincronizar comentarios nativos (sin duplicar)
          try {
            const nativeCommentIds = new Set<string>();
            for (const [commentId] of nativeTopic.comments) {
              nativeCommentIds.add(commentId);
            }
            for (const customComment of customTopic.comments) {
              if (!nativeCommentIds.has(customComment.id)) {
                nativeTopic.createComment(customComment.comment);
                // Marcar como sincronizado para no duplicar en siguiente pasada
                nativeCommentIds.add(customComment.id);
              }
            }
          } catch (e) {
            console.warn("[syncCustomTopicsToNative] comment sync failed:", e);
          }
        }
      } else {
        // CREATE: nuevo nativeTopic para este customTopic
        try {
          const nativeTopic = modules.bcfTopics.create({
            guid: customTopic.id,
            title: customTopic.title,
            description: customTopic.description ?? "",
            creationDate: new Date(customTopic.creationDate),
            modifiedDate: new Date(customTopic.modifiedDate),
            creationAuthor: customTopic.author ?? currentAuthor,
            modifiedAuthor: currentAuthor,
            priority: customTopic.priority,
            status: customTopic.status,
            assignedTo: customTopic.assignedTo ?? "",
          } as OBC.BCFTopic);

          // Guardar relacion
          customIdToNativeGuid.set(customTopic.id, nativeTopic.guid);
          nativeGuidToCustomId.set(nativeTopic.guid, customTopic.id);
          syncedFieldsLog.push(`created:${customTopic.id}`);

          // Sincronizar comentarios iniciales
          for (const customComment of customTopic.comments) {
            try {
              nativeTopic.createComment(customComment.comment);
            } catch (e) {
              console.warn("[syncCustomTopicsToNative] initial comment sync failed:", e);
            }
          }

          const nativeViewpointGuid = await ensureNativeViewpointForTopic(customTopic);
          if (nativeViewpointGuid) {
            try {
              nativeTopic.viewpoints.add(nativeViewpointGuid);
            } catch (e) {
              console.warn("[syncCustomTopicsToNative] viewpoint link failed:", e);
            }
          }
        } catch (e) {
          console.warn("[syncCustomTopicsToNative] create failed:", e);
        }
      }
    }

    // 5) Log de validacion
    console.log("[BCF sync validation]", {
      customTopicsCount: topics.length,
      nativeTopicsTotalCount: modules.bcfTopics.list.size,
      nativeTopicsExportCount: topics.length, // solo los vivos
      deletedCustomIds,
      orphanNativeGuidsDetected: orphanNativeGuids,
      syncedFields: syncedFieldsLog,
    });
  }

  /**
   * Exporta solo los nativeTopics vinculados a topics[] custom vivos.
   * Este es el fallback obligatorio cuando no hay metodo nativo delete/remove.
   */
  function buildNativeTopicsToExport(): Iterable<OBC.Topic> {
    const modules = modulesRef.current;
    if (!modules?.bcfTopics) return [];

    const aliveCustomIds = new Set(topics.map((t) => t.id));
    const result: OBC.Topic[] = [];

    for (const [nativeGuid, topic] of modules.bcfTopics.list) {
      const customId = nativeToCustomTopicMapRef.current.get(nativeGuid);
      if (customId && aliveCustomIds.has(customId)) {
        result.push(topic);
      }
    }

    return result;
  }

  async function handleNativeBcfExport() {
    const modules = modulesRef.current;

    if (!modules?.bcfTopics) return;

    try {
      // 1) Sincronizar antes de exportar
      await syncCustomTopicsToNative();

      // 2) Construir subset: solo nativeTopics vinculados a topics[] custom vivos
      const nativeTopicsToExport = buildNativeTopicsToExport();
      const exportArray = Array.isArray(nativeTopicsToExport)
        ? nativeTopicsToExport
        : Array.from(nativeTopicsToExport);

      console.log("[BCF export]", {
        customTopicsCount: topics.length,
        nativeTotalCount: modules.bcfTopics.list.size,
        exportCount: exportArray.length,
      });

      // 3) Exportar solo el subset (no el list entero)
      const exported = exportArray.length > 0
        ? await modules.bcfTopics.export(exportArray)
        : await modules.bcfTopics.export([]);

      console.log("[BCF native export result]", exported);

      const blob =
        exported instanceof Blob
          ? exported
          : new Blob([exported as BlobPart], {
              type: "application/octet-stream"
            });

      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = "topics.bcfzip";
      document.body.appendChild(link);
      link.click();
      link.remove();

      URL.revokeObjectURL(url);

      setStatus("BCF exportado (sincronizado con panel custom)");
    } catch (error) {
      console.warn("[BCF export]", error);
      setStatus("Error exportando BCF");
    }
  }

  function handleCreateViewerAnnotation() {
    annotationModeRef.current = true;
    pendingAnnotationTextRef.current = "__PENDING__";
    setPendingAnnotationText("__PENDING__");
    setStatus("Modo anotacion activo. Haz doble clic donde quieres colocarla.");
  }

  function createAnnotationMarker(text: string, position: THREE.Vector3) {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    const element = document.createElement("div");
    element.textContent = `PIN ${text}`;
    element.style.background = "#1e293b";
    element.style.color = "white";
    element.style.padding = "4px 8px";
    element.style.borderRadius = "6px";
    element.style.fontSize = "12px";
    element.style.border = "1px solid #64748b";
    element.style.whiteSpace = "nowrap";

    modules.marker.create(viewer.world, element, position);

    setViewerAnnotations((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        type: "pin3d",
        text,
        color: selectedColor,
        position: [position.x, position.y, position.z],
        createdAt: new Date().toISOString(),
        author: currentAuthor
      }
    ]);

    setStatus("Anotacion 3D agregada");
    requestViewerRefresh();
  }

  function handleClearAnnotations() {
    const modules = modulesRef.current;

    if (!modules) return;

    modules.marker.dispose();
    setViewerAnnotations([]);

    setStatus("Anotaciones eliminadas");
    requestViewerRefresh();
  }
  async function handleCreateTopicFromCurrentView() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    const currentSelectionMap = modules.selection.getSelectionModelIdMap();
    const linkedSelection = Object.entries(currentSelectionMap).map(
      ([modelId, ids]) => ({
        modelId,
        expressIds: Array.from(ids)
      })
    );
    let nativeViewpointGuid: string | undefined;
    let serializedPlanes: {
      normal: [number, number, number];
      origin: [number, number, number];
    }[] = [];

    try {
      modules.viewpoints.world = viewer.world;
      const nativeViewpoint = modules.viewpoints.create();

      nativeViewpointGuid = nativeViewpoint.guid;

      try {
        (nativeViewpoint as { world?: unknown }).world = viewer.world;
      } catch {
        // Algunas versiones no permiten asignar world directamente
      }

      if (
        "updateCamera" in nativeViewpoint &&
        typeof nativeViewpoint.updateCamera === "function"
      ) {
        await nativeViewpoint.updateCamera(true);
      }

      if (
        "updateClippingPlanes" in nativeViewpoint &&
        typeof nativeViewpoint.updateClippingPlanes === "function"
      ) {
        nativeViewpoint.updateClippingPlanes();

        const rawPlanes = Array.from(modules.clipper.debugPlanes());

        serializedPlanes = (rawPlanes as ClipperPlaneEntry[]).map(([, plane]) => {
          const normal = plane.normal ?? { x: 0, y: 0, z: 1 };
          const origin = plane.origin ?? { x: 0, y: 0, z: 0 };

          return {
            normal: [normal.x, normal.y, normal.z] as [number, number, number],
            origin: [origin.x, origin.y, origin.z] as [number, number, number]
          };
        });

        console.log("[BCF serialized planes]", serializedPlanes);
        console.log("[BCF native clipping planes raw]", nativeViewpoint.clippingPlanes);
        console.log(
          "[BCF native clipping planes entries]",
          Array.from(nativeViewpoint.clippingPlanes ?? [])
        );
      }

      console.log("[BCF native viewpoint]", nativeViewpoint);

      if (
        Object.keys(currentSelectionMap).length > 0 &&
        "addComponentsFromMap" in nativeViewpoint &&
        typeof nativeViewpoint.addComponentsFromMap === "function"
      ) {
        await nativeViewpoint.addComponentsFromMap(currentSelectionMap);
      }

      await populateNativeViewpointSelection(
        nativeViewpoint as NativeViewpointLike,
        currentSelectionMap
      );

      if (
        "takeSnapshot" in nativeViewpoint &&
        typeof nativeViewpoint.takeSnapshot === "function"
      ) {
        await nativeViewpoint.takeSnapshot();
      }
    } catch (error) {
      console.warn("[BCF] No se pudo crear viewpoint nativo:", error);
    }

    const canvas = viewer.renderer?.three?.domElement ?? null;
    const snapshot = canvas
      ? await captureViewerSnapshot(canvas, requestViewerRefresh)
      : null;

    const topicId = crypto.randomUUID();
    let snapshotUrl: string | null = null;

    if (snapshot) {
      const blob = await (await bffAssetFetch(snapshot)).blob();

      const formData = new FormData();
      formData.append("file", blob, "snapshot.png");

      const response = await bffFetch(
        `/api/documents/bcf/${topicId}/snapshot?projectCode=${encodeURIComponent(
          projectCode.trim().toUpperCase()
        )}`,
        {
          method: "POST",
          body: formData
        }
      );

      const result = await response.json();

      if (result.success) {
        snapshotUrl = result.data.url;
      }
    }

    const viewpoint = await captureViewpoint(viewer, modules, {
      loadedModels: models.map((model) => ({
        key: model.key,
        name: model.name,
        documentPath: model.source.documentPath,
        documentName: model.source.documentName ?? model.name,
        visible: model.visible,
        isolated: model.isolated ?? false
      })),
      selectedColor,
      sectionBoxPadding,
      snapshot,
      coloredSelection: lastColoredSelectionRef.current
        ? Object.entries(lastColoredSelectionRef.current).map(([modelId, ids]) => ({
            modelId,
            expressIds: Array.from(ids)
          }))
        : []
    });

    if (!viewpoint) return;

    const normalizedProjectCode = projectCode.trim().toUpperCase();

    const existingNumbers = topics
      .map((topic) => {
        const match = topic.title.match(/^Incidencia\s+(\d+)$/i);
        return match ? Number(match[1]) : 0;
      })
      .filter((value) => Number.isFinite(value));

    const nextTopicNumber =
      existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
    const topic: BcfTopic = {
      id: topicId,
      projectCode: normalizedProjectCode,
      title: `Incidencia ${nextTopicNumber}`,
      description: "",
      issueType: "coordination",
      discipline: "",
      dueDate: "",
      status: "open",
      priority: "medium",
      author: currentAuthor,
      assignedTo: "",
      creationDate: new Date().toISOString(),
      modifiedDate: new Date().toISOString(),
      viewpointId: viewpoint.id,
      nativeViewpointGuid,
      clippingPlanes: serializedPlanes,
      source: {
        kind: "model",
        modelNames: models.map((model) => model.name),
        documentPaths: models
          .map((model) => model.source.documentPath)
          .filter((value): value is string => Boolean(value)),
        documentNames: models.map(
          (model) => model.source.documentName ?? model.name
        )
      },
      linkedSelection,
      snapshot: snapshotUrl,
      comments: [],
      attachments: [],
      annotations: viewerAnnotations,
      measurements: viewerMeasurements
    };
    setPendingTopicDraft({
      topic,
      viewpoint
    });

    setSelectedTopicId(null);
    setRightPanelTab("topics");
    setStatus("Completa el formulario de incidencia.");
  }
  async function handleConfirmCreateTopic() {
    const modules = modulesRef.current;

    if (!pendingTopicDraft || !modules) return;

    const { topic, viewpoint } = pendingTopicDraft;

    const topicToCreate: BcfTopic = {
      ...topic,
      comments: pendingTopicCommentText.trim()
        ? [
            ...topic.comments,
            {
              id: crypto.randomUUID(),
              author: currentAuthor,
              date: new Date().toISOString(),
              comment: pendingTopicCommentText.trim()
            }
          ]
        : topic.comments,
      modifiedDate: new Date().toISOString()
    };

    setStatus("Creando incidencia...");

    try {
      const nativeTopic = modules.bcfTopics.create({
        guid: topicToCreate.id,
        title: topicToCreate.title,
        description: topicToCreate.description ?? "",
        creationDate: new Date(topicToCreate.creationDate),
        modifiedDate: new Date(topicToCreate.modifiedDate),
        creationAuthor: topicToCreate.author ?? currentAuthor,
        modifiedAuthor: currentAuthor,
        priority: topicToCreate.priority,
        status: topicToCreate.status
      } as never);

      console.log("[BCF native topic created]", nativeTopic);
      console.log("[BCF native topics count]", modules.bcfTopics.list.size);

      customToNativeTopicMapRef.current.set(topicToCreate.id, nativeTopic.guid);
      nativeToCustomTopicMapRef.current.set(nativeTopic.guid, topicToCreate.id);

      if (topicToCreate.nativeViewpointGuid && modules.viewpoints) {
        const nativeViewpoint = modules.viewpoints.list.get(
          topicToCreate.nativeViewpointGuid
        );

        if (nativeViewpoint) {
          nativeTopic.viewpoints.add(topicToCreate.nativeViewpointGuid);

          for (const comment of topicToCreate.comments) {
            try {
              nativeTopic.createComment(
                comment.comment,
                topicToCreate.nativeViewpointGuid
              );
            } catch {
              nativeTopic.createComment(comment.comment);
            }
          }
        }
      }
    } catch (error) {
      console.warn("[BCF] No se pudo crear topic nativo:", error);
    }

    setViewpoints((prev) => [...prev, viewpoint]);
    setTopics((prev) => [...prev, topicToCreate]);
    setSelectedTopicId(topicToCreate.id);
    setPendingTopicDraft(null);
    setPendingTopicCommentText("");
    setIsTopicDetailOpen(true);
    setRightPanelTab("topics");

    if (!openProjectProjectId) {
      setStatus("Incidencia creada en CDE. Este proyecto no tiene OpenProject vinculado.");
      return;
    }

    setStatus("Incidencia creada. Enviando a OpenProject...");

    try {
      const normalizedProjectCode = projectCode.trim().toUpperCase();

      const wp = await createWorkPackageFromBcfTopic({
        ...topicToCreate,
        projectCode: normalizedProjectCode,
        openProjectProjectId: Number(openProjectProjectId)
      });

      if (!wp.openProjectId) {
        throw new Error("OpenProject no devolvio un ID de Work Package");
      }

      const workPackageId = String(wp.openProjectId);

      const topicWithOpenProject: BcfTopic = {
        ...topicToCreate,
        openProject: {
          ...topicToCreate.openProject,
          projectId: openProjectProjectId,
          topicGuid: topicToCreate.id,
          workPackageId,
          href: `/work_packages/${workPackageId}`,
          lastSyncedAt: new Date().toISOString(),
          syncStatus: "synced",
          lastError: undefined
        }
      };

      setTopics((prev) =>
        prev.map((existingTopic) =>
          existingTopic.id === topicWithOpenProject.id
            ? topicWithOpenProject
            : existingTopic
        )
      );
      setSelectedTopicId(topicWithOpenProject.id);

      setStatus(`Incidencia creada y enviada a OpenProject: #${workPackageId}`);
    } catch (error) {
      console.warn("[BCF/OpenProject] Incidencia creada en CDE, sincronizacion OP fallida:", error);

      const message = error instanceof Error ? error.message : "Error desconocido";
      setTopics((prev) =>
        prev.map((existingTopic) =>
          existingTopic.id === topicToCreate.id
            ? {
                ...existingTopic,
                openProject: {
                  ...existingTopic.openProject,
                  projectId: openProjectProjectId,
                  topicGuid: topicToCreate.id,
                  syncStatus: "error",
                  lastError: message
                }
              }
            : existingTopic
        )
      );

      setStatus(
        `Incidencia creada en CDE. Error enviando a OpenProject: ${message}`
      );
    }
  }
  async function handleAddPendingTopicAttachment(file: File) {
    if (!pendingTopicDraft) return;

    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await bffFetch(
        `/api/documents/bcf/${pendingTopicDraft.topic.id}/attachments?projectCode=${encodeURIComponent(
          projectCode.trim().toUpperCase()
        )}`,
        {
          method: "POST",
          body: formData
        }
      );

      const result = await response.json();

      if (!result.success) {
        throw new Error("No se pudo subir el adjunto");
      }

      const attachment = result.data;

      setPendingTopicDraft((prev) =>
        prev
          ? {
              ...prev,
              topic: {
                ...prev.topic,
                attachments: [
                  ...prev.topic.attachments,
                  {
                    id: crypto.randomUUID(),
                    name: attachment.name,
                    type: file.type,
                    size: file.size,
                    dataUrl: attachment.url,
                    createdAt: new Date().toISOString()
                  }
                ],
                modifiedDate: new Date().toISOString()
              }
            }
          : prev
      );
    } catch (error) {
      console.error("[BCF] Error subiendo adjunto del borrador:", error);
      setStatus(
        error instanceof Error
          ? `Error subiendo adjunto: ${error.message}`
          : "Error subiendo adjunto"
      );
    }
  }
  function handleCancelCreateTopic() {
    setPendingTopicDraft(null);
    setPendingTopicCommentText("");
    setStatus("Creacion de incidencia cancelada");
  }

  async function handleDeleteTopic(topicId: string) {
    const topic = topics.find((item) => item.id === topicId);
    const modules = modulesRef.current;

    if (modules?.bcfTopics) {
      const nativeGuid =
        customToNativeTopicMapRef.current.get(topicId) ?? topicId;

      try {
        modules.bcfTopics.list.delete(nativeGuid);
      } catch (error) {
        console.warn("[BCF] No se pudo eliminar topic nativo:", error);
      }

      customToNativeTopicMapRef.current.delete(topicId);
      nativeToCustomTopicMapRef.current.delete(nativeGuid);
    }

    if (modules?.viewpoints && topic?.nativeViewpointGuid) {
      try {
        modules.viewpoints.list.delete(topic.nativeViewpointGuid);
        modules.viewpoints.snapshots.delete(topic.nativeViewpointGuid);
      } catch (error) {
        console.warn("[BCF] No se pudo eliminar viewpoint nativo:", error);
      }
    }

    setTopics((prev) => prev.filter((topic) => topic.id !== topicId));

    if (selectedTopicId === topicId) {
      setSelectedTopicId(null);
      setIsTopicDetailOpen(false);
    }

    setStatus("Incidencia eliminada");

    try {
      await deletePersistedBcfTopic(topicId, projectCode);
    } catch (error) {
      console.warn("[BCF] No se pudo eliminar incidencia persistida:", error);
      setStatus("Incidencia eliminada en la sesion. No se pudo eliminar en BFF.");
    }
  }

  async function handleOpenTopicDetail(topic: BcfTopic) {
    setSelectedTopicId(topic.id);
    setIsTopicDetailOpen(true);

    const linkedViewpoint = viewpoints.find(
      (viewpoint) => viewpoint.id === topic.viewpointId
    );

    if (linkedViewpoint) {
      await handleApplyViewpoint(linkedViewpoint);
    }
  }

  async function handleFocusTopicSelection(topic: BcfTopic) {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;
    if (!viewer || !modules || !topic.linkedSelection?.length) return;

    const modelIdMap = buildTopicSelectionModelIdMap(topic);

    if (Object.keys(modelIdMap).length === 0) return;

    try {
      await modules.selection.highlighter.highlightByID(
        "select",
        modelIdMap,
        true,
        false
      );
      setHasSelection(true);
      await fitSelectionInView(viewer, viewer.components, modelIdMap);
      setStatus("Elementos de la incidencia resaltados");
      requestViewerRefresh();
    } catch (error) {
      console.error("[BCF] Error focusing issue selection:", error);
      setStatus("No se pudo enfocar la seleccion vinculada.");
    }
  }

  async function handlePushTopicToOpenProject(topicId: string) {
    const topic = topics.find((t) => t.id === topicId);
    if (!topic) return;
    if (topic.openProject?.workPackageId) {
      setStatus(
        `La incidencia ya esta vinculada al Work Package #${topic.openProject.workPackageId}. La actualizacion automatica se implementara en fase 2.`
      );
      return;
    }

    setStatus("Enviando a OpenProject...");

    try {
      if (!openProjectProjectId) {
        alert(
          "Este proyecto no tiene un proyecto OpenProject vinculado. No se puede sincronizar la incidencia."
        );
        return;
      }
      const normalizedProjectCode = projectCode.trim().toUpperCase();

    const wp = await createWorkPackageFromBcfTopic({
      ...topic,
      projectCode: normalizedProjectCode,
      openProjectProjectId: Number(openProjectProjectId)
    });

      if (!wp.openProjectId) {
        throw new Error("OpenProject no devolvio un ID de Work Package");
      }

      const workPackageId = String(wp.openProjectId);

      setTopics((prev) =>
        prev.map((t) =>
          t.id === topicId
            ? {
                ...t,
                modifiedDate: new Date().toISOString(),
                openProject: {
                  ...t.openProject,
                  projectId: openProjectProjectId,
                  workPackageId,
                  href: `/work_packages/${workPackageId}`,
                  lastSyncedAt: new Date().toISOString(),
                  syncStatus: "synced",
                  lastError: undefined
                }
              }
            : t
        )
      );

      setStatus(`Incidencia enviada a OpenProject (WP #${workPackageId})`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error desconocido";

      console.warn("[OpenProject] Sincronizacion de topic fallida:", message);

      setTopics((prev) =>
        prev.map((t) =>
          t.id === topicId
            ? {
                ...t,
                openProject: {
                  ...t.openProject,
                  syncStatus: "error",
                  lastError: message
                }
              }
            : t
        )
      );

      setStatus(`Error enviando a OpenProject: ${message}`);
    }
  }

  function handleUpdateTopic(
    topicId: string,
    patch: Partial<
            Pick<
              BcfTopic,
              | "title"
              | "description"
              | "status"
              | "priority"
              | "assignedTo"
              | "issueType"
              | "discipline"
              | "dueDate"
            >
          >
  ) {
    setTopics((prev) =>
      prev.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              ...patch,
              modifiedDate: new Date().toISOString()
            }
          : topic
      )
    );
  }
  function handleAddComment(topicId: string, comment: string) {
    if (!comment.trim()) return;

    setTopics((prev) =>
      prev.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              comments: [
                ...topic.comments,
                {
                  id: crypto.randomUUID(),
                  author: currentAuthor,
                  date: new Date().toISOString(),
                  comment
                }
              ],
              modifiedDate: new Date().toISOString()
            }
          : topic
      )
    );
  }
  async function handleAddTopicAttachment(topicId: string, file: File) {
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await bffFetch(
        `/api/documents/bcf/${topicId}/attachments?projectCode=${encodeURIComponent(
          projectCode.trim().toUpperCase()
        )}`,
        {
          method: "POST",
          body: formData
        }
      );

      const result = await response.json();

      if (!result.success) {
        throw new Error("Upload failed");
      }

      const attachment = result.data;

      setTopics((prev) =>
        prev.map((topic) =>
          topic.id === topicId
            ? {
                ...topic,
                attachments: [
                  ...topic.attachments,
                  {
                    id: crypto.randomUUID(),
                    name: attachment.name,
                    type: file.type,
                    size: file.size,
                    dataUrl: attachment.url, // URL real
                    createdAt: new Date().toISOString()
                  }
                ],
                modifiedDate: new Date().toISOString()
              }
            : topic
        )
      );
    } catch (error) {
      console.error("Error uploading attachment:", error);
    }
  }
  function handleAddTopicAnnotation(topicId: string, text: string) {
    if (!text.trim()) return;

    const viewer = viewerRef.current;
    const controls = viewer?.camera.controls;

    const target = new THREE.Vector3();

    if (controls) {
      controls.getTarget(target);
    }

    setTopics((prev) =>
      prev.map((topic) =>
        topic.id === topicId
          ? {
              ...topic,
              annotations: [
                ...topic.annotations,
                {
                  id: crypto.randomUUID(),
                  type: "pin3d",
                  text: text.trim(),
                  color: selectedColor,
                  position: [target.x, target.y, target.z],
                  createdAt: new Date().toISOString(),
                  author: currentAuthor
                }
              ],
              modifiedDate: new Date().toISOString()
            }
          : topic
      )
    );
  }
  function inferBim2DViewKind(id: string): Bim2DViewEntry["kind"] {
    const normalized = id.toLowerCase();

    if (
      normalized.includes("storey") ||
      normalized.includes("floor") ||
      normalized.includes("planta") ||
      normalized.includes("nivel") ||
      /^n\d+/i.test(id) ||
      /^as\d+/i.test(id) ||
      /^ns\d+/i.test(id)
    ) {
      return "plan";
    }

    if (
      normalized.includes("front") ||
      normalized.includes("back") ||
      normalized.includes("left") ||
      normalized.includes("right") ||
      normalized.includes("elevation") ||
      normalized.includes("elevacion")
    ) {
      return "elevation";
    }

    if (normalized.includes("section") || normalized.includes("seccion")) {
      return "section";
    }

    return "other";
  }

  function refreshBim2DViewsList() {
    const modules = modulesRef.current;
    if (!modules?.views) return;

    const entries = Array.from(modules.views.list.keys())
      .map((id) => ({
        id,
        name: id,
        kind: inferBim2DViewKind(id)
      }))
      .sort((a, b) => {
        const kindOrder = { plan: 0, elevation: 1, section: 2, other: 3 };
        const orderDelta = kindOrder[a.kind] - kindOrder[b.kind];
        if (orderDelta !== 0) return orderDelta;
        return a.name.localeCompare(b.name, undefined, { numeric: true });
      });

    setBim2DViews(entries);
  }

  async function handleGenerateBim2DViews() {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;
    if (!viewer || !modules?.views) return;

    setBim2DViewsLoading(true);
    setStatus("Generando vistas 2D desde plantas IFC...");

    try {
      modules.views.world = viewer.world;

      if (modules.views.list.size === 0) {
        await modules.views.createFromIfcStoreys({
          world: viewer.world,
          offset: 0.25
        });
        modules.views.createElevations({
          world: viewer.world,
          combine: true
        });
      }

      refreshBim2DViewsList();
      setStatus(`Vistas 2D disponibles: ${modules.views.list.size}`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error generando vistas 2D:", error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`No se pudieron generar vistas 2D: ${message}`);
    } finally {
      setBim2DViewsLoading(false);
    }
  }

  function handleOpenBim2DView(viewId: string) {
    const modules = modulesRef.current;
    if (!modules?.views) return;

    try {
      modules.views.open(viewId);
      setActiveBim2DViewId(viewId);
      setStatus(`Vista 2D activa: ${viewId}`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error abriendo vista 2D:", error);
      setStatus("No se pudo abrir la vista 2D.");
    }
  }

  async function handleFocusBim2DViewIn3D(viewId: string) {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    if (!modules || !viewer) return;

    const view = bim2DViews.find((entry) => entry.id === viewId);
    if (!view) return;

    const target = findStoreyNodeByViewName(models, view.name);

    try {
      modules.views?.close();
      setActiveBim2DViewId(null);

      if (!target) {
        setStatus(`No se encontro nivel IFC para la vista: ${view.name}`);
        return;
      }

      const sourceMap = getTreeNodeModelIdMap(target.model.key, target.node);
      if (!sourceMap) {
        setStatus(`No se pudo resolver geometria de nivel: ${view.name}`);
        return;
      }

      const modelIdMap = await expandModelIdMapForRendering(sourceMap);
      setActiveBim2DViewId(viewId);
      await modules.visibility.isolate(modelIdMap);
      await modules.selection.highlighter.highlightByID(
        "select",
        modelIdMap,
        true,
        false
      );
      await fitSelectionInView(viewer, viewer.components, modelIdMap);
      setStatus(`Planta enfocada en 3D: ${view.name}`);
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error vinculando vista 2D/3D:", error);
      setStatus("No se pudo vincular la vista 2D con el 3D.");
    }
  }

  function handleCloseBim2DView() {
    const modules = modulesRef.current;
    if (!modules?.views) return;

    try {
      modules.views.close();
      setActiveBim2DViewId(null);
      setStatus("Vista 3D restaurada");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error cerrando vista 2D:", error);
      setStatus("No se pudo volver a 3D.");
    }
  }

  async function handleApplyViewpoint(viewpoint: ViewerViewpoint) {
    const viewer = viewerRef.current;
    const modules = modulesRef.current;

    if (!viewer || !modules) return;

    await ensureViewpointModelsLoaded(viewpoint);
    const linkedTopicForClipping = topics.find(
      (topic) => topic.viewpointId === viewpoint.id
    );

    if (linkedTopicForClipping?.clippingPlanes?.length && modules.clipper) {
      modules.clipper.deleteAll();

      for (const planeState of linkedTopicForClipping.clippingPlanes) {
        await modules.clipper.createFromState(planeState);
      }
    }

    // 1) Intentar aplicar viewpoint nativo ThatOpen
    const linkedTopic = topics.find((topic) => topic.viewpointId === viewpoint.id);

    if (linkedTopic?.nativeViewpointGuid && modules.viewpoints) {
      try {
        const nativeVp = modules.viewpoints.list.get(linkedTopic.nativeViewpointGuid);
        try {
          (nativeVp as { world?: unknown }).world = viewer.world;
        } catch {
          // Algunas versiones no permiten asignar world directamente
        }

        if (nativeVp && typeof nativeVp.go === "function") {
          try {
            if ("setClippingState" in nativeVp && typeof nativeVp.setClippingState === "function") {
              nativeVp.setClippingState(true);
            }

            if ("setClippingVisibility" in nativeVp && typeof nativeVp.setClippingVisibility === "function") {
              nativeVp.setClippingVisibility(true);
            }
          } catch (error) {
            console.warn("[BCF] error enabling native clipping:", error);
          }

          await nativeVp.go({
            transition: true,
            applyClippings: false,
            clippingsVisibility: true,
            applyVisibility: true
          });

          if (viewpoint.display?.selectedColor) {
            setSelectedColor(viewpoint.display.selectedColor);
          }

          if (typeof viewpoint.display?.sectionBoxPadding === "number") {
            setSectionBoxPadding(viewpoint.display.sectionBoxPadding);
          }

          setStatus(`Viewpoint aplicado: ${viewpoint.name}`);
          requestViewerRefresh();
          return;
        }
      } catch (error) {
        console.warn("[BCF] error applying native viewpoint:", error);
      }
    }

    // 2) Fallback: aplicar nuestro viewpoint custom
    await modules.visibility.showAll();
    await modules.selection.clearSelection();

    if (modules.coloring) {
      await modules.coloring.restoreAllColors();
    }

    await applyViewpoint(viewer, modules, viewpoint, {
      applyModelsState: async (modelsState) => {
        setModels((prev) =>
          prev.map((model) => {
            const match = modelsState.find(
              (item) =>
                item.documentPath &&
                model.source.documentPath &&
                item.documentPath === model.source.documentPath
            );

            if (!match) return model;

            model.object.visible = match.visible;

            return {
              ...model,
              visible: match.visible,
              isolated: match.isolated
            };
          })
        );

        requestViewerRefresh();
      }
    });

    if (viewpoint.coloring?.selection && viewpoint.coloring.color && modules.coloring) {
      const coloredSelectionMap: OBC.ModelIdMap = {};

      for (const item of viewpoint.coloring.selection) {
        coloredSelectionMap[item.modelId] = new Set(item.expressIds);
      }

      await modules.coloring.colorSelection(
        coloredSelectionMap,
        viewpoint.coloring.color
      );
    }

    if (viewpoint.display?.selectedColor) {
      setSelectedColor(viewpoint.display.selectedColor);
    }

    if (typeof viewpoint.display?.sectionBoxPadding === "number") {
      setSectionBoxPadding(viewpoint.display.sectionBoxPadding);
    }

    setStatus(`Viewpoint aplicado: ${viewpoint.name}`);
    requestViewerRefresh();
  }

  async function handleLoadContainment() {
    const modules = modulesRef.current;
    if (!modules) return;

    setContainmentLoading(true);

    try {
      const data = await modules.selection.getSelectedContainmentData();
      setContainmentData(data as Record<string, unknown>[]);
      setStatus("Contenedor espacial cargado");
    } catch (error) {
      console.error("[viewer-ifc] Error loading containment data:", error);
      setStatus("Error cargando contenedor espacial. Revisa la consola.");
    } finally {
      setContainmentLoading(false);
    }
  }

  async function handleLoadAssociations() {
    const modules = modulesRef.current;
    if (!modules) return;

    setAssociationsLoading(true);

    try {
      const data = await modules.selection.getSelectedAssociationsData();
      setAssociationsData(data as Record<string, unknown>[]);
      setStatus("Asociaciones cargadas");
    } catch (error) {
      console.error("[viewer-ifc] Error loading associations data:", error);
      setStatus("Error cargando asociaciones. Revisa la consola.");
    } finally {
      setAssociationsLoading(false);
    }
  }

  function handleRenameViewpoint(viewpointId: string, nextName: string) {
    setViewpoints((prev) =>
      prev.map((viewpoint) =>
        viewpoint.id === viewpointId
          ? { ...viewpoint, name: nextName }
          : viewpoint
      )
    );
  }

  function handleDeleteViewpoint(viewpointId: string) {
    setViewpoints((prev) =>
      prev.filter((viewpoint) => viewpoint.id !== viewpointId)
    );
  }

  function handleToggleClipper() {
    const modules = modulesRef.current;
    if (!modules) return;

    const enabled = modules.clipper.toggle();
    setClipperEnabled(enabled);
    setStatus(enabled ? "Modo de corte activo" : "Modo de corte desactivado");
    requestViewerRefresh();
  }

  function handleDeleteClippingPlanes() {
    const modules = modulesRef.current;
    if (!modules) return;

    modules.clipper.deleteAll();
    setStatus("Cortes eliminados");
    requestViewerRefresh();
  }

  async function handleApplySelectionColor() {
    const modules = modulesRef.current;
    if (!modules) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    const colorTarget = cloneModelIdMap(map);

    try {
      const applied = await modules.coloring.colorSelection(
        colorTarget,
        selectedColor
      );

      if (applied) {
        lastColoredSelectionRef.current = colorTarget;
        setStatus(`Color aplicado: ${selectedColor}`);
        requestViewerRefresh();
      }
    } catch (error) {
      console.error("[viewer-ifc] Error applying color:", error);
      setStatus("Error aplicando color. Revisa la consola.");
    }
  }

  function handleSelectedColorChange(value: string) {
    setSelectedColor(value);
  }

  async function handleRestoreSelectionColor() {
    const modules = modulesRef.current;
    if (!modules) return;

    const restoreTarget =
      lastColoredSelectionRef.current &&
      Object.keys(lastColoredSelectionRef.current).length > 0
        ? cloneModelIdMap(lastColoredSelectionRef.current)
        : modules.selection.getSelectionModelIdMap();

    if (Object.keys(restoreTarget).length === 0) return;

    try {
      const restored = await modules.coloring.restoreSelectionColor(
        restoreTarget
      );

      if (restored) {
        lastColoredSelectionRef.current = null;
        setStatus("Color restaurado");
        requestViewerRefresh();
      }
    } catch (error) {
      console.error("[viewer-ifc] Error restoring color:", error);
      setStatus("Error restaurando color. Revisa la consola.");
    }
  }

  async function handleCreateSelectionSectionBox() {
    const modules = modulesRef.current;
    const viewer = viewerRef.current;

    if (!modules || !viewer) return;

    const map = modules.selection.getSelectionModelIdMap();
    if (Object.keys(map).length === 0) return;

    try {
      const selectionClone = cloneModelIdMap(map);

      const created = await modules.sectionBox.createFromSelection(
        selectionClone,
        {
          paddingFactor: sectionBoxPadding,
          minPadding: 0.5
        }
      );

      if (created) {
        lastSectionBoxSelectionRef.current = selectionClone;
        await fitSelectionInView(viewer, viewer.components, selectionClone);
        setStatus(`Caja de seccion creada (${sectionBoxPadding.toFixed(2)})`);
        requestViewerRefresh();
      } else {
        setStatus("No se pudo crear la caja de seccion");
      }
    } catch (error) {
      console.error("[viewer-ifc] Error creating section box:", error);
      setStatus("Error creando caja de seccion. Revisa la consola.");
    }
  }

  function handleClearSelectionSectionBox() {
    const modules = modulesRef.current;
    if (!modules) return;

    try {
      modules.sectionBox.clear();
      lastSectionBoxSelectionRef.current = null;
      setStatus("Caja de seccion eliminada");
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error clearing section box:", error);
      setStatus("Error limpiando caja de seccion. Revisa la consola.");
    }
  }

  function handleClearMeasurements() {
    const modules = modulesRef.current;

    if (!modules?.measurement) return;
    modules.measurement.cancel();
    measurementModeRef.current = null;
    modules.measurement.deleteAll();

    setViewerMeasurements([]);

    setStatus("Mediciones eliminadas");
    requestViewerRefresh();
  }

  function handleStartMeasurementMode(mode: ViewerMeasurementMode) {
    const modules = modulesRef.current;

    if (!modules?.measurement) return;

    modules.measurement.start(mode);
    measurementModeRef.current = mode;

    if (mode === "distance") {
      setStatus("Medicion de distancia: doble clic para seleccionar 2 puntos. Esc cancela.");
    } else if (mode === "area") {
      setStatus("Medicion de area: doble clic para agregar puntos; clic derecho o central para cerrar. Esc cancela.");
    } else {
      setStatus("Medicion de volumen: doble clic para seleccionar 2 puntos de base y 1 punto de altura. Esc cancela.");
    }

    requestViewerRefresh();
  }

  function handleFinishAreaMeasurement() {
    const modules = modulesRef.current;

    if (!modules?.measurement) return;

    const record = modules.measurement.finishArea();

    if (!record) {
      setStatus("El area necesita al menos 3 puntos.");
      return;
    }

    setViewerMeasurements((prev) => [
      ...prev,
      {
        ...record,
        author: currentAuthor
      }
    ]);
    setStatus(`Area: ${record.value.toFixed(3)} m2`);
    requestViewerRefresh();
  }

  async function handleMeasureSelectionGeometry(type: "area" | "volume") {
    const modules = modulesRef.current;
    if (!modules?.measurement) return;

    const modelIdMap = modules.selection.getSelectionModelIdMap();
    const selectedCount = getModelIdMapItemCount(modelIdMap);

    if (selectedCount === 0) {
      setStatus("Selecciona elementos antes de medir superficie o volumen.");
      return;
    }

    setStatus(type === "area" ? "Calculando superficie seleccionada..." : "Calculando volumen seleccionado...");

    try {
      let totalArea = 0;
      let totalVolume = 0;
      let triangleCount = 0;
      let areaItemsFromIfcQuantity = 0;
      let areaItemsFromParameter = 0;
      let areaItemsFromGeometry = 0;
      const areaSources = new Set<string>();
      const center = new THREE.Vector3();
      let centerSamples = 0;
      const selectionBounds = new THREE.Box3();
      let hasSelectionBounds = false;

      const expandSelectionBounds = (point: THREE.Vector3) => {
        selectionBounds.expandByPoint(point);
        hasSelectionBounds = true;
      };

      const expandSelectionBoundsFromBox = (box: THREE.Box3) => {
        if (box.isEmpty()) return;
        selectionBounds.union(box);
        hasSelectionBounds = true;
      };

      const addMeshBounds = (
        meshDataList: Array<{
          positions?: ArrayLike<number>;
          transform?: THREE.Matrix4;
        }>
      ) => {
        let addedSamples = 0;

        for (const meshData of meshDataList) {
          if (!meshData.positions) continue;

          const transform = meshData.transform ?? new THREE.Matrix4();
          const point = new THREE.Vector3();

          for (let index = 0; index < meshData.positions.length; index += 3) {
            point
              .set(
                meshData.positions[index] ?? 0,
                meshData.positions[index + 1] ?? 0,
                meshData.positions[index + 2] ?? 0
              )
              .applyMatrix4(transform);
            center.add(point);
            expandSelectionBounds(point);
            centerSamples += 1;
            addedSamples += 1;
          }
        }

        return addedSamples;
      };

      for (const [modelId, ids] of Object.entries(modelIdMap)) {
        const model = models.find((entry) => entry.modelId === modelId);
        if (!model) continue;

        const localIds = Array.from(ids);
        let geometryLocalIds = localIds;

        if (type === "area") {
          const itemsData = await getIfcItemsDataForMeasurement(
            model.runtimeModel,
            localIds
          );
          const missingAreaLocalIds: number[] = [];

          localIds.forEach((localId, index) => {
            const metric = getIfcAreaMetricFromItem(itemsData[index] ?? {});

            if (metric) {
              totalArea += metric.value;
              areaSources.add(metric.label);
              if (metric.source === "ifc-quantity") {
                areaItemsFromIfcQuantity += 1;
              } else {
                areaItemsFromParameter += 1;
              }
              return;
            }

            missingAreaLocalIds.push(localId);
          });

          geometryLocalIds = missingAreaLocalIds;
        }

        if (type === "volume") {
          if (!model.runtimeModel.getItemsVolume) {
            throw new Error("El modelo no expone getItemsVolume().");
          }

          totalVolume += await Promise.resolve(
            model.runtimeModel.getItemsVolume(localIds)
          );
        }

        if (type === "area" && geometryLocalIds.length === 0) {
          if (model.runtimeModel.getItemsGeometry) {
            const anchorGeometryGroups = await Promise.resolve(
              model.runtimeModel.getItemsGeometry(localIds)
            );
            const anchorSamples = addMeshBounds(anchorGeometryGroups.flat());

            if (anchorSamples > 0) {
              continue;
            }
          }

          const fallbackBox = new THREE.Box3().setFromObject(model.object);
          if (!fallbackBox.isEmpty()) {
            center.add(fallbackBox.getCenter(new THREE.Vector3()));
            expandSelectionBoundsFromBox(fallbackBox);
            centerSamples += 1;
          }
          continue;
        }

        if (!model.runtimeModel.getItemsGeometry) {
          const box = new THREE.Box3().setFromObject(model.object);
          if (!box.isEmpty()) {
            center.add(box.getCenter(new THREE.Vector3()));
            expandSelectionBoundsFromBox(box);
            centerSamples += 1;
          }
          continue;
        }

        const geometryGroups = await Promise.resolve(
          model.runtimeModel.getItemsGeometry(
            type === "area" ? geometryLocalIds : localIds
          )
        );
        if (type === "area") {
          areaItemsFromGeometry += geometryLocalIds.length;
        }
        const meshDataList = geometryGroups.flat();

        for (const meshData of meshDataList) {
          triangleCount += getMeshDataTriangleCount(meshData);
          if (triangleCount > MAX_GEOMETRY_MEASUREMENT_TRIANGLES) {
            throw new Error(
              `La seleccion supera ${MAX_GEOMETRY_MEASUREMENT_TRIANGLES.toLocaleString()} triangulos. Reduce la seleccion.`
            );
          }

          if (type === "area") {
            totalArea += getMeshDataSurfaceArea(meshData);
          }

          addMeshBounds([meshData]);
        }
      }

      if (centerSamples > 0) {
        center.divideScalar(centerSamples);
      }

      if (hasSelectionBounds) {
        const size = selectionBounds.getSize(new THREE.Vector3());
        selectionBounds.getCenter(center);
        center.y =
          selectionBounds.max.y +
          Math.min(Math.max(size.length() * 0.02, 0.35), 1.75);
      }

      const value = type === "area" ? totalArea : totalVolume;
      if (!Number.isFinite(value) || value <= 0) {
        setStatus("No se pudo calcular una medicion valida para la seleccion.");
        return;
      }

      const record =
        type === "area"
          ? modules.measurement.addGeometryArea(value, center)
          : modules.measurement.addGeometryVolume(value, center);

      setViewerMeasurements((prev) => [
        ...prev,
        {
          ...record,
          author: currentAuthor
        }
      ]);

      const areaSourceLabel =
        areaItemsFromGeometry > 0 &&
        (areaItemsFromIfcQuantity > 0 || areaItemsFromParameter > 0)
          ? "IFC/parametros + geometria"
          : areaItemsFromIfcQuantity > 0
            ? "cantidades IFC"
            : areaItemsFromParameter > 0
              ? "parametros"
              : "geometria";

      setStatus(
        type === "area"
          ? `Superficie seleccionada: ${value.toFixed(3)} m2 (${areaSourceLabel}${areaSources.size > 0 ? `: ${Array.from(areaSources).slice(0, 2).join(", ")}` : ""})`
          : `Volumen seleccionado: ${value.toFixed(3)} m3`
      );
      requestViewerRefresh();
    } catch (error) {
      console.error("[viewer-ifc] Error midiendo geometria seleccionada:", error);
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`No se pudo medir la geometria seleccionada: ${message}`);
    }
  }

  async function handleSectionBoxPaddingChange(value: number) {
    setSectionBoxPadding(value);

    const modules = modulesRef.current;
    const viewer = viewerRef.current;
    const lastSelection = lastSectionBoxSelectionRef.current;

    if (!modules || !viewer || !lastSelection) return;

    try {
      const created = await modules.sectionBox.createFromSelection(
        lastSelection,
        {
          paddingFactor: value,
          minPadding: 0.5
        }
      );

      if (created) {
        await fitSelectionInView(viewer, viewer.components, lastSelection);
        setStatus(`Caja de seccion actualizada (${value.toFixed(2)})`);
        requestViewerRefresh();
      }
    } catch (error) {
      console.error("[viewer-ifc] Error updating section box:", error);
      setStatus("Error actualizando caja de seccion. Revisa la consola.");
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2">
        <div className="min-w-0 flex flex-1 flex-col">
          <p className="truncate text-sm font-semibold text-zinc-100">
            {titleText}
          </p>
          <p className="truncate text-xs text-zinc-400">{status}</p>
        </div>

        <Link
          href={backHref}
          className="inline-flex min-h-8 items-center border border-zinc-700 bg-zinc-900 px-3 py-1 text-sm text-zinc-200 hover:bg-zinc-800"
        >
          Volver
        </Link>
      </div>

      <div className="hidden">
        <IfcViewerToolbar        
          onIsolateSelection={handleIsolateSelection}
          onToggleSelection={handleToggleSelection}
          onToggleGhostSelection={handleToggleGhostSelection}
          onShowAll={handleShowAll}
          onFitModel={handleFitModel}
          onFocusSelection={handleFocusSelection}
          onResetView={handleResetView}
          onSaveViewpoint={handleSaveViewpoint}
          onCreateAnnotation={handleCreateViewerAnnotation}
          onClearAnnotations={handleClearAnnotations}

          onCreateDistanceMeasurement={() => handleStartMeasurementMode("distance")}
          onCreateAreaMeasurement={() => handleStartMeasurementMode("area")}
          onFinishAreaMeasurement={handleFinishAreaMeasurement}
          onMeasureSelectionArea={() => handleMeasureSelectionGeometry("area")}
          onMeasureSelectionVolume={() => handleMeasureSelectionGeometry("volume")}
          onClearMeasurements={handleClearMeasurements}

          onCreateRevisionCloud={() => {
            console.log("[coordination] create revision cloud");
          }}
          onToggleClipper={handleToggleClipper}
          onDeleteClippingPlanes={handleDeleteClippingPlanes}
          onCreateSelectionSectionBox={handleCreateSelectionSectionBox}
          onClearSelectionSectionBox={handleClearSelectionSectionBox}
          onApplySelectionColor={handleApplySelectionColor}
          onRestoreSelectionColor={handleRestoreSelectionColor}
          onSelectedColorChange={handleSelectedColorChange}
          onSectionBoxPaddingChange={handleSectionBoxPaddingChange}
          onSnapConfigChange={setMeasurementSnapConfig}
          clipperEnabled={clipperEnabled}
          hasSelection={hasSelection}
          selectedColor={selectedColor}
          sectionBoxPadding={sectionBoxPadding}
          snapConfig={measurementSnapConfig}
        />
      </div>

      <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div ref={viewerFrameRef} className="relative min-h-0 w-full flex-1">
            <div
              ref={hostRef}
              className="h-full w-full overflow-hidden bg-zinc-950"
              style={{ position: "relative", zIndex: 0 }}
            />
            <div className="absolute left-3 top-3 z-30 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleCreateTopicFromCurrentView}
                className="min-h-8 rounded border border-red-700 bg-red-700 px-3 py-1 text-sm font-semibold text-white shadow-xl hover:bg-red-800"
              >
                Incidencia
              </button>
              <button
                type="button"
                onClick={handleNativeBcfExport}
                className="min-h-8 rounded border border-zinc-700 bg-zinc-950/95 px-3 py-1 text-sm text-zinc-200 shadow-xl hover:bg-zinc-800"
              >
                Exportar BCF
              </button>
              <button
                type="button"
                onClick={() => setShowViewerStats((current) => !current)}
                className="min-h-8 rounded border border-zinc-700 bg-zinc-950/95 px-3 py-1 text-sm text-zinc-200 shadow-xl hover:bg-zinc-800"
              >
                {showViewerStats ? "Ocultar stats" : "Stats"}
              </button>
            </div>
            {showViewerStats ? <ViewerStatsOverlay stats={viewerStats} /> : null}
            {annotationInput.visible && (
                <div
                  style={{
                    position: "absolute",
                    left: annotationInput.x,
                    top: annotationInput.y,
                    zIndex: 50,
                    transform: "translate(-50%, -120%)"
                  }}
                >
                  <input
                    autoFocus
                    value={annotationInput.text}
                    onChange={(e) =>
                      setAnnotationInput((prev) => ({
                        ...prev,
                        text: e.target.value
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        if (
                          annotationInput.text.trim() &&
                          annotationInput.position
                        ) {
                          createAnnotationMarker(
                            annotationInput.text.trim(),
                            annotationInput.position
                          );
                        }

                        setAnnotationInput({
                          visible: false,
                          x: 0,
                          y: 0,
                          text: "",
                          position: null
                        });
                      }

                      if (e.key === "Escape") {
                        setAnnotationInput({
                          visible: false,
                          x: 0,
                          y: 0,
                          text: "",
                          position: null
                        });

                        setStatus("Anotacion cancelada");
                      }
                    }}
                    placeholder="Escribe anotacion..."
                    className="h-10 w-64 rounded-lg border border-slate-600 bg-slate-950 px-3 text-sm text-white shadow-2xl outline-none"
            />
                </div>
              )}              
            <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
              <div className="pointer-events-auto max-w-[calc(100%-2rem)] overflow-hidden rounded-lg border border-zinc-700/80 bg-zinc-950/95 shadow-2xl backdrop-blur">
                <IfcViewerToolbar
                  onIsolateSelection={handleIsolateSelection}
                  onToggleSelection={handleToggleSelection}
                  onToggleGhostSelection={handleToggleGhostSelection}
                  onShowAll={handleShowAll}
                  onFitModel={handleFitModel}
                  onFocusSelection={handleFocusSelection}
                  onResetView={handleResetView}
                  onSaveViewpoint={handleSaveViewpoint}
                  onCreateAnnotation={handleCreateViewerAnnotation}
                  onClearAnnotations={handleClearAnnotations}
                  onCreateDistanceMeasurement={() => handleStartMeasurementMode("distance")}
                  onCreateAreaMeasurement={() => handleStartMeasurementMode("area")}
                  onFinishAreaMeasurement={handleFinishAreaMeasurement}
                  onMeasureSelectionArea={() => handleMeasureSelectionGeometry("area")}
                  onMeasureSelectionVolume={() => handleMeasureSelectionGeometry("volume")}
                  onClearMeasurements={handleClearMeasurements}
                  onCreateRevisionCloud={() => {
                    console.log("[coordination] create revision cloud");
                  }}
                  onToggleClipper={handleToggleClipper}
                  onDeleteClippingPlanes={handleDeleteClippingPlanes}
                  onCreateSelectionSectionBox={handleCreateSelectionSectionBox}
                  onClearSelectionSectionBox={handleClearSelectionSectionBox}
                  onApplySelectionColor={handleApplySelectionColor}
                  onRestoreSelectionColor={handleRestoreSelectionColor}
                  onSelectedColorChange={handleSelectedColorChange}
                  onSectionBoxPaddingChange={handleSectionBoxPaddingChange}
                  onSnapConfigChange={setMeasurementSnapConfig}
                  clipperEnabled={clipperEnabled}
                  hasSelection={hasSelection}
                  selectedColor={selectedColor}
                  sectionBoxPadding={sectionBoxPadding}
                  snapConfig={measurementSnapConfig}
                />
              </div>
            </div>
          </div>

          {rightPanelTab === "cost5d" ? (
            <div
              className="flex shrink-0 flex-col overflow-hidden border-t border-zinc-800 bg-zinc-950"
              style={{
                height: "min(46vh, 420px)",
                minHeight: "260px",
                maxHeight: "55vh",
                resize: "vertical"
              }}
            >
              <Cost5DPanel
                models={models}
                projectCode={projectCode}
                propertyIndex={smartViewPropertyIndex}
                propertyCatalog={smartViewPropertyCatalog}
                propertyCatalogLoading={smartViewPropertyCatalogLoading}
                propertiesIndexLoading={smartViewPropertiesIndexLoading}
                bimIndexOverview={bimIndexOverview}
                bimIndexOverviewLoading={bimIndexOverviewLoading}
                onBuildPropertyIndex={handleBuildSmartViewPropertyIndex}
                onSelectRow={handleSelectCost5DRow}
                onSelectModelIdMap={handleSelectModelIdMap}
              />
            </div>
          ) : null}
        </div>

        {isRightPanelCollapsed ? (
          <div className="flex h-full w-10 shrink-0 flex-col items-center border-l border-zinc-800 bg-zinc-950 py-2">
            <button
              type="button"
              onClick={() => setIsRightPanelCollapsed(false)}
              className="h-8 w-8 rounded border border-zinc-700 bg-zinc-900 text-xs text-zinc-200 hover:bg-zinc-800"
              title="Mostrar panel"
            >
              &lt;
            </button>
          </div>
        ) : (
        <aside
          className="flex h-full min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-l border-zinc-800 bg-zinc-950 text-zinc-100 shadow-2xl"
          style={{
            width: "440px",
            minWidth: "360px",
            maxWidth: "760px",
            resize: "horizontal"
          }}
        >
          <div className="border-b border-zinc-800 bg-zinc-900">
            <div className="flex items-center justify-between border-b border-zinc-800 px-2 py-1.5 text-xs text-zinc-400">
              <span className="font-semibold uppercase">
                Panel
              </span>
              <button
                type="button"
                onClick={() => setIsRightPanelCollapsed(true)}
                className="h-7 rounded border border-zinc-700 bg-zinc-950 px-2 text-zinc-300 hover:bg-zinc-800"
              >
                Ocultar
              </button>
            </div>
            <div className="grid grid-cols-4 gap-px border-b border-zinc-800 bg-zinc-800 p-px text-xs">
              {RIGHT_PANEL_GROUPS.map((group) => {
                const isActiveGroup = group.key === activeRightPanelGroup.key;

                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => setRightPanelTab(group.tabs[0].key)}
                    className={`min-h-10 min-w-0 px-3 py-2 text-left leading-tight ${
                      isActiveGroup
                        ? "bg-zinc-950 font-semibold text-white"
                        : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                    }`}
                  >
                    <span className="block truncate">{group.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1 overflow-x-auto px-2 py-2 text-xs">
              {activeRightPanelGroup.tabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setRightPanelTab(tab.key)}
                  className={`min-h-8 shrink-0 rounded px-3 py-1.5 leading-tight ${
                    rightPanelTab === tab.key
                      ? "bg-red-700 font-semibold text-white"
                      : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  <span className="block truncate">{tab.label}</span>
                </button>
              ))}
            </div>
          </div>

          {rightPanelTab === "models" && (
            <>
              <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-2">
                <button
                  type="button"
                  onClick={handleOpenModelSelector}
                  className="inline-flex min-h-8 max-w-full items-center border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm leading-tight text-zinc-200 hover:bg-zinc-800"
                >
                  Agregar modelos
                </button>
              </div>

              <IfcModelsPanelV2
                models={models}
                propertyIndex={smartViewPropertyIndex}
                propertiesIndexLoading={smartViewPropertiesIndexLoading}
                onBuildLevelIndex={handleBuildNativeLevelIndex}
                onAddModel={handleOpenModelSelector}
                onToggleModelVisibility={handleToggleModelVisibility}
                onToggleModelExpanded={handleToggleModelExpanded}
                onRemoveModel={handleRemoveModel}
                onFocusModel={handleFocusModel}
                onIsolateModel={handleIsolateModel}
                onSelectTreeNode={handleSelectTreeNode}
                onIsolateTreeNode={handleIsolateTreeNode}
                onToggleTreeNodeVisibility={handleToggleTreeNodeVisibility}
              />
            </>
          )}

          {rightPanelTab === "filters" && (
            <SmartViewPanel
              models={models}
              savedSmartViews={savedSmartViews}
              propertyIndex={smartViewPropertyIndex}
              propertyCatalog={smartViewPropertyCatalog}
              propertyCatalogLoading={smartViewPropertyCatalogLoading}
              propertiesIndexLoading={smartViewPropertiesIndexLoading}
              onApply={handleApplySmartView}
              onClear={handleClearSmartView}
              onSave={handleSaveSmartView}
              onApplySaved={handleApplySmartView}
              onDeleteSaved={handleDeleteSmartView}
              onBuildPropertyIndex={handleBuildSmartViewPropertyIndex}
            />
          )}

          {rightPanelTab === "parameters" && (
            <ParameterAnalysisPanel
              models={models}
              propertyIndex={smartViewPropertyIndex}
              propertyCatalog={smartViewPropertyCatalog}
              propertyCatalogLoading={smartViewPropertyCatalogLoading}
              propertiesIndexLoading={smartViewPropertiesIndexLoading}
              bimIndexOverview={bimIndexOverview}
              bimIndexOverviewLoading={bimIndexOverviewLoading}
              onBuildPropertyIndex={handleBuildSmartViewPropertyIndex}
              onApplyColors={handleApplyParameterColors}
              onSelectBucket={handleSelectParameterBucket}
              onSetBucketVisibility={handleSetParameterBucketVisibility}
              onRestoreVisibility={handleRestoreParameterVisibility}
              onClear={handleClearParameterAnalysis}
            />
          )}

          {rightPanelTab === "cost5d" && (
            <div className="flex min-h-0 flex-1 items-center justify-center bg-zinc-950 p-4 text-center text-sm text-zinc-500">
              El modulo 5D se muestra en la bandeja inferior para dar espacio a
              tablas, graficos y futuras vistas 4D.
            </div>
          )}

          {rightPanelTab === "audit" && (
            <AuditPanel
              models={models}
              rules={auditRules}
              results={auditResults}
              summary={auditSummary}
              message={auditMessage}
              propertyIndex={smartViewPropertyIndex}
              propertiesIndexLoading={smartViewPropertiesIndexLoading}
              auditLoading={auditLoading}
              activeResultId={activeAuditResultId}
              onBuildPropertyIndex={handleBuildSmartViewPropertyIndex}
              onAddRule={handleAddAuditRule}
              onUpdateRule={handleUpdateAuditRule}
              onDeleteRule={handleDeleteAuditRule}
              onRunAudit={handleRunAudit}
              onSelectResult={handleSelectAuditResult}
              onExportCsv={handleExportAuditCsv}
              onExportHtml={handleExportAuditHtml}
              onPrintReport={handlePrintAuditReport}
            />
          )}

          {rightPanelTab === "viewpoints" && (
            <div className="flex min-h-0 flex-1 flex-col bg-zinc-950">
              <Ifc2DViewsPanel
                views={bim2DViews}
                activeViewId={activeBim2DViewId}
                loading={bim2DViewsLoading}
                onGenerateViews={handleGenerateBim2DViews}
                onOpenView={handleOpenBim2DView}
                onCloseView={handleCloseBim2DView}
              />
              <IfcViewpointsPanel
                viewpoints={viewpoints}
                onApplyViewpoint={handleApplyViewpoint}
                onRenameViewpoint={handleRenameViewpoint}
                onDeleteViewpoint={handleDeleteViewpoint}
              />
            </div>
          )}

          {rightPanelTab === "topics" && (
            <div
              className="flex min-h-0 flex-1 flex-col overflow-y-auto"
              onWheel={(event) => event.stopPropagation()}
            >
              {pendingTopicDraft ? (
                <div className="border-b border-zinc-800 bg-zinc-950 px-3 py-3">
                  <h4 className="mb-1 text-sm font-semibold text-red-400">
                    Nueva incidencia BIM
                  </h4>

                  <p className="mb-3 text-xs text-zinc-400">
                    Completa los datos. Al presionar Crear se registrara en BCF y OpenProject.
                  </p>

                  {pendingTopicDraft.topic.snapshot ? (
                    <div className="mb-3 overflow-hidden rounded border border-zinc-800 bg-black">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={getBffAssetUrl(pendingTopicDraft.topic.snapshot)}
                        alt="Snapshot de incidencia"
                        className="block w-full"
                        style={{ maxHeight: 180, objectFit: "contain" }}
                      />
                    </div>
                  ) : null}

                  <label className="mb-2 block text-xs font-medium text-zinc-300">
                    Titulo
                    <input
                      value={pendingTopicDraft.topic.title}
                      onChange={(event) =>
                        setPendingTopicDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                topic: {
                                  ...prev.topic,
                                  title: event.target.value,
                                  modifiedDate: new Date().toISOString()
                                }
                              }
                            : prev
                        )
                      }
                      className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                    />
                  </label>

                  <label className="mb-2 block text-xs font-medium text-zinc-300">
                    Asignado a
                    <select
                      value={pendingTopicDraft.topic.assignedTo ?? ""}
                      onChange={(event) =>
                        setPendingTopicDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                topic: {
                                  ...prev.topic,
                                  assignedTo: event.target.value,
                                  modifiedDate: new Date().toISOString()
                                }
                              }
                            : prev
                        )
                      }
                      className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                    >
                      <option value="">
                        {projectMembersLoading
                          ? "Cargando miembros..."
                          : "Sin asignar"}
                      </option>
                      {projectMembers.map((member) => {
                        const displayName = `${member.firstName} ${member.lastName}`.trim();
                        return (
                          <option key={member.id} value={member.email}>
                            {displayName ? `${displayName} - ${member.email}` : member.email}
                          </option>
                        );
                      })}
                    </select>
                  </label>

                  <div className="mb-2 grid grid-cols-2 gap-2">
                    <label className="block text-xs font-medium text-zinc-300">
                      Tipo
                      <select
                        value={pendingTopicDraft.topic.issueType ?? "coordination"}
                        onChange={(event) =>
                          setPendingTopicDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  topic: {
                                    ...prev.topic,
                                    issueType: event.target.value as BcfTopic["issueType"],
                                    modifiedDate: new Date().toISOString()
                                  }
                                }
                              : prev
                          )
                        }
                        className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                      >
                        {ISSUE_TYPE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="block text-xs font-medium text-zinc-300">
                      Disciplina
                      <input
                        value={pendingTopicDraft.topic.discipline ?? ""}
                        onChange={(event) =>
                          setPendingTopicDraft((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  topic: {
                                    ...prev.topic,
                                    discipline: event.target.value,
                                    modifiedDate: new Date().toISOString()
                                  }
                                }
                              : prev
                          )
                        }
                        className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                        placeholder="ARQ, EST, MEP..."
                      />
                    </label>
                  </div>

                  <label className="mb-2 block text-xs font-medium text-zinc-300">
                    Fecha limite
                    <input
                      type="date"
                      value={pendingTopicDraft.topic.dueDate ?? ""}
                      onChange={(event) =>
                        setPendingTopicDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                topic: {
                                  ...prev.topic,
                                  dueDate: event.target.value,
                                  modifiedDate: new Date().toISOString()
                                }
                              }
                            : prev
                        )
                      }
                      className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                    />
                  </label>

                  <label className="mb-2 block text-xs font-medium text-zinc-300">
                    Estado
                    <select
                      value={pendingTopicDraft.topic.status}
                      onChange={(event) =>
                        setPendingTopicDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                topic: {
                                  ...prev.topic,
                                  status: event.target.value as BcfTopic["status"],
                                  modifiedDate: new Date().toISOString()
                                }
                              }
                            : prev
                        )
                      }
                      className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In progress</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </label>

                  <label className="mb-2 block text-xs font-medium text-zinc-300">
                    Prioridad
                    <select
                      value={pendingTopicDraft.topic.priority}
                      onChange={(event) =>
                        setPendingTopicDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                topic: {
                                  ...prev.topic,
                                  priority: event.target.value as BcfTopic["priority"],
                                  modifiedDate: new Date().toISOString()
                                }
                              }
                            : prev
                        )
                      }
                      className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </select>
                  </label>

                  <label className="mb-2 block text-xs font-medium text-zinc-300">
                    Descripcion
                    <textarea
                      value={pendingTopicDraft.topic.description ?? ""}
                      onChange={(event) =>
                        setPendingTopicDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                topic: {
                                  ...prev.topic,
                                  description: event.target.value,
                                  modifiedDate: new Date().toISOString()
                                }
                              }
                            : prev
                        )
                      }
                      className="mt-1 min-h-24 w-full border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                    />
                  </label>

                  <label className="mb-2 block text-xs font-medium text-zinc-300">
                    Comentario inicial
                    <textarea
                      value={pendingTopicCommentText}
                      onChange={(event) => setPendingTopicCommentText(event.target.value)}
                      className="mt-1 min-h-16 w-full border border-zinc-700 bg-zinc-900 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                      placeholder="Escribe un comentario inicial..."
                    />
                  </label>

                  <div className="mt-3">
                    <h5 className="mb-2 text-xs font-semibold text-zinc-300">
                      Adjuntos
                    </h5>

                    {pendingTopicDraft.topic.attachments.length === 0 ? (
                      <div className="mb-2 text-xs text-zinc-500">
                        No hay adjuntos.
                      </div>
                    ) : (
                      <div className="mb-2 flex flex-col gap-2">
                        {pendingTopicDraft.topic.attachments.map((attachment) => (
                          <a
                            key={attachment.id}
                            href={getBffAssetUrl(attachment.dataUrl)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="rounded border border-zinc-700 bg-zinc-900 p-2 text-xs text-zinc-100 hover:bg-zinc-800"
                          >
                            {attachment.name}
                          </a>
                        ))}
                      </div>
                    )}

                    <label className="inline-flex h-8 cursor-pointer items-center border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 hover:bg-zinc-800">
                      Adjuntar archivo
                      <input
                        type="file"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (!file) return;

                          void handleAddPendingTopicAttachment(file);
                          event.target.value = "";
                        }}
                      />
                    </label>
                  </div>

                  <div className="mt-4 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={handleCancelCreateTopic}
                      className="h-8 border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 hover:bg-zinc-800"
                    >
                      Cancelar
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleConfirmCreateTopic()}
                      disabled={!pendingTopicDraft.topic.title.trim()}
                      className="h-8 bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Crear
                    </button>
                  </div>
                </div>
              ) : null}

              {!pendingTopicDraft && !isTopicDetailOpen && (
                <div className="flex min-h-0 flex-1 flex-col bg-zinc-950 px-3 py-3">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold text-red-400">Incidencias</h3>
                      <p className="text-xs text-zinc-500">BCF, viewpoints y OpenProject</p>
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateTopicFromCurrentView}
                      className="h-8 shrink-0 bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800"
                    >
                      Nueva
                    </button>
                  </div>

                  <div className="mb-3 grid grid-cols-2 gap-2">
                    {[
                      ["Total", topicSummary.total],
                      ["Abiertas", topicSummary.open],
                      ["Criticas", topicSummary.critical],
                      ["OP sync", topicSummary.synced]
                    ].map(([label, value]) => (
                      <div key={label} className="border border-zinc-800 bg-zinc-900 px-3 py-2">
                        <div className="text-[10px] uppercase text-zinc-500">{label}</div>
                        <div className="text-lg font-semibold text-zinc-100">{value}</div>
                      </div>
                    ))}
                  </div>

                  <div className="mb-3 flex flex-col gap-2">
                    <input
                      value={topicSearch}
                      onChange={(event) => setTopicSearch(event.target.value)}
                      placeholder="Buscar incidencia, responsable, modelo..."
                      className="h-9 border border-zinc-800 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none focus:border-red-600"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <select
                        value={topicStatusFilter}
                        onChange={(event) =>
                          setTopicStatusFilter(event.target.value as typeof topicStatusFilter)
                        }
                        className="h-9 border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                      >
                        <option value="all">Todos los estados</option>
                        {TOPIC_STATUS_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      <select
                        value={topicPriorityFilter}
                        onChange={(event) =>
                          setTopicPriorityFilter(event.target.value as typeof topicPriorityFilter)
                        }
                        className="h-9 border border-zinc-800 bg-zinc-900 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                      >
                        <option value="all">Todas las prioridades</option>
                        {TOPIC_PRIORITY_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {topics.length === 0 ? (
                    <div className="border border-dashed border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500">
                      Aun no hay incidencias BIM.
                    </div>
                  ) : filteredTopics.length === 0 ? (
                    <div className="border border-dashed border-zinc-800 px-3 py-8 text-center text-sm text-zinc-500">
                      No hay incidencias para este filtro.
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
                      <div className="flex flex-col gap-2">
                        {filteredTopics.map((topic) => {
                          const linkedElementCount = getTopicLinkedElementCount(topic);

                          return (
                            <div
                              key={topic.id}
                              className={`border bg-zinc-900/80 p-3 ${
                                selectedTopicId === topic.id
                                  ? "border-red-600"
                                  : "border-zinc-800"
                              }`}
                            >
                              <button
                                type="button"
                                className="flex w-full flex-col items-start gap-2 text-left"
                                onClick={() => void handleOpenTopicDetail(topic)}
                              >
                                <div className="flex w-full items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="truncate text-sm font-semibold text-zinc-100">
                                      {topic.title}
                                    </div>
                                    <div className="mt-1 flex flex-wrap gap-1">
                                      <span className={`border px-2 py-0.5 text-[10px] ${getTopicStatusClass(topic.status)}`}>
                                        {getTopicStatusLabel(topic.status)}
                                      </span>
                                      <span className={`border px-2 py-0.5 text-[10px] ${getTopicPriorityClass(topic.priority)}`}>
                                        {getTopicPriorityLabel(topic.priority)}
                                      </span>
                                      <span className="border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-[10px] text-zinc-300">
                                        {getIssueTypeLabel(topic.issueType)}
                                      </span>
                                    </div>
                                  </div>
                                  <span className="shrink-0 text-[10px] text-zinc-500">
                                    {topic.openProject?.workPackageId
                                      ? `OP #${topic.openProject.workPackageId}`
                                      : "Sin OP"}
                                  </span>
                                </div>

                                {topic.snapshot ? (
                                  <div className="w-full overflow-hidden border border-zinc-800 bg-black">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={getBffAssetUrl(topic.snapshot)}
                                      alt={topic.title}
                                      className="block w-full"
                                      style={{ maxHeight: 140, objectFit: "contain" }}
                                    />
                                  </div>
                                ) : null}

                                <div className="grid w-full grid-cols-2 gap-2 text-[11px] text-zinc-500">
                                  <span>Asignado: {topic.assignedTo || "Sin asignar"}</span>
                                  <span>Elementos: {linkedElementCount}</span>
                                  <span>Disciplina: {topic.discipline || "-"}</span>
                                  <span>Fecha: {topic.dueDate || "-"}</span>
                                </div>
                              </button>

                              <div className="mt-3 flex gap-2">
                                <button
                                  type="button"
                                  onClick={() => void handleOpenTopicDetail(topic)}
                                  className="h-8 flex-1 border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 hover:bg-zinc-800"
                                >
                                  Abrir
                                </button>
                                <button
                                  type="button"
                                  disabled={!linkedElementCount}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void handleFocusTopicSelection(topic);
                                  }}
                                  className="h-8 flex-1 border border-zinc-700 bg-zinc-950 px-2 text-xs text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Resaltar
                                </button>
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    handleDeleteTopic(topic.id);
                                  }}
                                  className="h-8 border border-red-900 bg-zinc-950 px-2 text-xs text-red-300 hover:bg-red-950"
                                >
                                  Eliminar
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              
              {isTopicDetailOpen && selectedTopicId ? (
                (() => {
                  const selectedTopic = topics.find((topic) => topic.id === selectedTopicId) as BcfTopic | undefined;
                  if (!selectedTopic) return null;

                  const linkedElementCount = getTopicLinkedElementCount(selectedTopic);
                  const openProjectHref = selectedTopic.openProject?.workPackageId
                    ? `/work_packages/${selectedTopic.openProject?.workPackageId}`
                    : "";

                  return (
                    <div className="flex min-h-0 flex-1 flex-col bg-zinc-950 px-3 py-3">
                      <div className="mb-3 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          onClick={() => setIsTopicDetailOpen(false)}
                          className="h-8 border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 hover:bg-zinc-800"
                        >
                          Volver
                        </button>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={!linkedElementCount}
                            onClick={() => void handleFocusTopicSelection(selectedTopic)}
                            className="h-8 border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            Resaltar
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(selectedTopic.openProject?.workPackageId)}
                            onClick={(event) => {
                              event.stopPropagation();
                              handlePushTopicToOpenProject(selectedTopic.id);
                            }}
                            className="h-8 bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            {selectedTopic.openProject?.workPackageId ? "Sincronizada" : "Enviar OP"}
                          </button>
                        </div>
                      </div>

                      <div className="mb-3 border border-zinc-800 bg-zinc-900 p-3">
                        <label className="mb-2 block text-xs font-medium text-zinc-400">
                          Titulo
                          <input
                            value={selectedTopic.title}
                            onChange={(event) =>
                              handleUpdateTopic(selectedTopic.id, {
                                title: event.target.value
                              })
                            }
                            className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                          />
                        </label>

                        <div className="grid grid-cols-2 gap-2">
                          <label className="block text-xs font-medium text-zinc-400">
                            Tipo
                            <select
                              value={selectedTopic.issueType ?? "coordination"}
                              onChange={(event) =>
                                handleUpdateTopic(selectedTopic.id, {
                                  issueType: event.target.value as BcfTopic["issueType"]
                                })
                              }
                              className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                            >
                              {ISSUE_TYPE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block text-xs font-medium text-zinc-400">
                            Prioridad
                            <select
                              value={selectedTopic.priority}
                              onChange={(event) =>
                                handleUpdateTopic(selectedTopic.id, {
                                  priority: event.target.value as BcfTopic["priority"]
                                })
                              }
                              className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                            >
                              {TOPIC_PRIORITY_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block text-xs font-medium text-zinc-400">
                            Estado
                            <select
                              value={selectedTopic.status}
                              onChange={(event) =>
                                handleUpdateTopic(selectedTopic.id, {
                                  status: event.target.value as BcfTopic["status"]
                                })
                              }
                              className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                            >
                              {TOPIC_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="block text-xs font-medium text-zinc-400">
                            Fecha limite
                            <input
                              type="date"
                              value={selectedTopic.dueDate ?? ""}
                              onChange={(event) =>
                                handleUpdateTopic(selectedTopic.id, {
                                  dueDate: event.target.value
                                })
                              }
                              className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                            />
                          </label>
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="block text-xs font-medium text-zinc-400">
                            Responsable
                            <select
                              value={selectedTopic.assignedTo ?? ""}
                              onChange={(event) =>
                                handleUpdateTopic(selectedTopic.id, {
                                  assignedTo: event.target.value
                                })
                              }
                              className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                            >
                              <option value="">
                                {projectMembersLoading
                                  ? "Cargando miembros..."
                                  : "Sin asignar"}
                              </option>
                              {projectMembers.map((member) => {
                                const displayName = `${member.firstName} ${member.lastName}`.trim();
                                return (
                                  <option key={member.id} value={member.email}>
                                    {displayName ? `${displayName} - ${member.email}` : member.email}
                                  </option>
                                );
                              })}
                            </select>
                          </label>
                          <label className="block text-xs font-medium text-zinc-400">
                            Disciplina
                            <input
                              value={selectedTopic.discipline ?? ""}
                              onChange={(event) =>
                                handleUpdateTopic(selectedTopic.id, {
                                  discipline: event.target.value
                                })
                              }
                              className="mt-1 h-9 w-full border border-zinc-700 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                              placeholder="ARQ, EST, MEP..."
                            />
                          </label>
                        </div>

                        <label className="mt-2 block text-xs font-medium text-zinc-400">
                          Descripcion
                          <textarea
                            value={selectedTopic.description ?? ""}
                            onChange={(event) =>
                              handleUpdateTopic(selectedTopic.id, {
                                description: event.target.value
                              })
                            }
                            className="mt-1 min-h-24 w-full border border-zinc-700 bg-zinc-950 px-2 py-2 text-sm text-zinc-100 outline-none focus:border-red-600"
                          />
                        </label>
                      </div>

                      {selectedTopic.snapshot ? (
                        <div className="mb-3 overflow-hidden border border-zinc-800 bg-black">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={getBffAssetUrl(selectedTopic.snapshot)}
                            alt={selectedTopic.title}
                            className="block w-full"
                            style={{ maxHeight: 190, objectFit: "contain" }}
                          />
                        </div>
                      ) : null}

                      <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                        <div className="border border-zinc-800 bg-zinc-900 p-2">
                          <div className="text-zinc-500">Elementos</div>
                          <div className="font-semibold text-zinc-100">{linkedElementCount}</div>
                        </div>
                        <div className="border border-zinc-800 bg-zinc-900 p-2">
                          <div className="text-zinc-500">OpenProject</div>
                          <div className="font-semibold text-zinc-100">
                            {selectedTopic.openProject?.workPackageId
                              ? `WP #${selectedTopic.openProject?.workPackageId}`
                              : "No sincronizado"}
                          </div>
                        </div>
                      </div>

                      <div className="mb-3 border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400">
                        <div className="mb-1 font-semibold text-zinc-200">Contexto BIM</div>
                        <div>Autor: {selectedTopic.author || "Sin autor"}</div>
                        <div>Modelos: {selectedTopic.source?.modelNames?.join(", ") || "-"}</div>
                        <div>Viewpoint CDE: {selectedTopic.viewpointId || "-"}</div>
                        <div>Viewpoint BCF: {selectedTopic.nativeViewpointGuid || "-"}</div>
                        {openProjectHref ? <div>Ruta OP: {openProjectHref}</div> : null}
                      </div>

                      <div className="mb-3">
                        <h5 className="mb-2 text-xs font-semibold text-zinc-300">Comentarios</h5>
                        <div className="mb-2 flex max-h-40 flex-col gap-2 overflow-y-auto">
                          {selectedTopic.comments.length === 0 ? (
                            <div className="text-xs text-zinc-500">No hay comentarios.</div>
                          ) : (
                            selectedTopic.comments.map((comment) => (
                              <div key={comment.id} className="border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-300">
                                <div className="mb-1 text-[10px] text-zinc-500">
                                  {comment.author} - {new Date(comment.date).toLocaleString()}
                                </div>
                                <div>{comment.comment}</div>
                              </div>
                            ))
                          )}
                        </div>
                        <textarea
                          value={newComment}
                          onChange={(event) => setNewComment(event.target.value)}
                          placeholder="Escribe un comentario..."
                          className="mb-2 min-h-16 w-full border border-zinc-700 bg-zinc-900 px-2 py-2 text-xs text-zinc-100 outline-none focus:border-red-600"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            handleAddComment(selectedTopic.id, newComment);
                            setNewComment("");
                          }}
                          className="h-8 border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 hover:bg-zinc-800"
                        >
                          Agregar comentario
                        </button>
                      </div>

                      <div>
                        <h5 className="mb-2 text-xs font-semibold text-zinc-300">Adjuntos</h5>
                        <div className="mb-2 flex flex-col gap-2">
                          {selectedTopic.attachments.length === 0 ? (
                            <div className="text-xs text-zinc-500">No hay adjuntos.</div>
                          ) : (
                            selectedTopic.attachments.map((attachment) => (
                              <a
                                key={attachment.id}
                                href={getBffAssetUrl(attachment.dataUrl)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="border border-zinc-800 bg-zinc-900 p-2 text-xs text-zinc-100 hover:bg-zinc-800"
                              >
                                {attachment.name}
                              </a>
                            ))
                          )}
                        </div>
                        <label className="inline-flex h-8 cursor-pointer items-center border border-zinc-700 bg-zinc-900 px-3 text-xs text-zinc-100 hover:bg-zinc-800">
                          Adjuntar archivo
                          <input
                            type="file"
                            className="hidden"
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              if (!file) return;

                              handleAddTopicAttachment(selectedTopic.id, file);
                              event.target.value = "";
                            }}
                          />
                        </label>
                      </div>
                    </div>
                  );
                })()
              ) : null}

            </div>
          )}

          {rightPanelTab === "properties" && (
            <div
              style={{
                flex: "1 1 0",
                minHeight: 0,
                overflowY: "auto",
                overflowX: "hidden",
                paddingTop: "12px"
              }}
              onWheel={(event) => event.stopPropagation()}
            >
              {!hasSelection ? (
                <div className="px-4 py-3 text-sm text-zinc-500">
                  Selecciona un elemento para habilitar sus propiedades.
                </div>
              ) : !propertiesRequested ? (
                <div className="flex flex-col gap-3 px-4 py-3">
                  <div className="text-sm text-zinc-600">
                    La seleccion esta activa. Carga las propiedades solo cuando las
                    necesites.
                  </div>

                  <button
                    type="button"
                    onClick={handleLoadSelectedProperties}
                    disabled={propertiesLoading}
                    className="h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {propertiesLoading ? "Cargando propiedades..." : "Ver propiedades"}
                  </button>
                </div>
              ) : (
                <IfcSelectedPropertiesPanel
                  items={selectedItemsData}
                  containmentData={containmentData}
                  associationsData={associationsData}
                  containmentLoading={containmentLoading}
                  associationsLoading={associationsLoading}
                  onLoadContainment={handleLoadContainment}
                  onLoadAssociations={handleLoadAssociations}
                />
              )}
            </div>
          )}
        </aside>
        )}
      </div>

      <IfcModelSelector
        isOpen={isModelSelectorOpen}
        initialSelectedPaths={[]}
        disabledPaths={models
          .map((model) => model.source.documentPath)
          .filter((value): value is string => Boolean(value))}
        projectCode={projectCode}
        onClose={handleCloseModelSelector}
        onApply={handleApplyModelSelection}
      />
    </section>
  );
}
