import { Router, type Response } from "express";
import {
  bulkUpsertBimElements,
  getBimModelByDocument,
  getBimIndexOverview,
  getBimCost5DAggregation,
  getBimPropertyCatalog,
  getBimPropertyIndex,
  getBimPropertySummary,
  queryBimPropertyLocalIds,
  getBimPropertyIndexSnapshot,
  listBimIndexJobs,
  listBimModels,
  upsertBimModel,
  upsertBimIndexJob,
  upsertBimPropertyIndexSnapshot,
  type BimElementInput,
  type BimElementPropertyInput,
  type BimPropertyRef,
  type BimIndexJobStatus,
  type UpsertBimModelInput
} from "../db/bim-index-store";

const router = Router();

const MAX_ELEMENTS_PER_BATCH = 1200;

function isDatabaseDisabled(error: unknown): boolean {
  return error instanceof Error && error.name === "DatabaseDisabledError";
}

function toProjectCode(value: unknown): string {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

function toText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}


function toJobStatus(value: unknown): BimIndexJobStatus | undefined {
  return value === "pending" ||
    value === "processing" ||
    value === "ready" ||
    value === "failed" ||
    value === "cancelled"
    ? value
    : undefined;
}

function sendRouteError(res: Response, error: unknown) {
  if (isDatabaseDisabled(error)) {
    return res.status(503).json({
      success: false,
      message: "Indice BIM no disponible: DATABASE_URL no esta configurado"
    });
  }

  console.error("[bim-index.routes] error:", error);
  return res.status(500).json({
    success: false,
    message: "No se pudo procesar el indice BIM"
  });
}

function parseModelInput(body: unknown): UpsertBimModelInput | null {
  const data = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const projectCode = toProjectCode(data.projectCode);
  const documentPath = toText(data.documentPath);
  const documentName = toText(data.documentName);
  const modelKey = toText(data.modelKey);

  if (!projectCode || !documentPath || !documentName || !modelKey) return null;

  return {
    projectCode,
    documentPath,
    documentName,
    modelKey,
    documentId: toText(data.documentId),
    sourceVersion: toText(data.sourceVersion),
    sourceHash: toText(data.sourceHash),
    runtimeModelId: toText(data.runtimeModelId),
    status:
      data.status === "pending" ||
      data.status === "processing" ||
      data.status === "ready" ||
      data.status === "failed" ||
      data.status === "stale"
        ? data.status
        : undefined,
    elementCount: typeof data.elementCount === "number" ? data.elementCount : undefined,
    propertyCount: typeof data.propertyCount === "number" ? data.propertyCount : undefined,
    errorMessage: toText(data.errorMessage),
    metadata:
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : undefined
  };
}

function parseProperty(value: unknown): BimElementPropertyInput | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const setName = toText(data.setName);
  const name = toText(data.name);
  if (!setName || !name) return null;

  return {
    setName,
    name,
    value: data.value as BimElementPropertyInput["value"],
    valueType:
      data.valueType === "text" ||
      data.valueType === "number" ||
      data.valueType === "boolean" ||
      data.valueType === "date" ||
      data.valueType === "json"
        ? data.valueType
        : undefined,
    unit: toText(data.unit)
  };
}
function parseElement(value: unknown): BimElementInput | null {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const localId = typeof data.localId === "number" ? data.localId : Number(data.localId);
  if (!Number.isInteger(localId) || localId <= 0) return null;

  return {
    localId,
    globalId: toText(data.globalId),
    ifcClass: toText(data.ifcClass),
    name: toText(data.name),
    typeName: toText(data.typeName),
    levelName: toText(data.levelName),
    spatialPath: toStringArray(data.spatialPath),
    elementIdentity: toText(data.elementIdentity),
    hasGeometry: typeof data.hasGeometry === "boolean" ? data.hasGeometry : undefined,
    metadata:
      data.metadata && typeof data.metadata === "object" && !Array.isArray(data.metadata)
        ? (data.metadata as Record<string, unknown>)
        : undefined,
    properties: Array.isArray(data.properties)
      ? data.properties
          .map(parseProperty)
          .filter((property): property is BimElementPropertyInput => Boolean(property))
      : undefined
  };
}

function parsePropertyRef(value: unknown): BimPropertyRef | undefined {
  const data = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const setName = toText(data.setName);
  const propertyName = toText(data.propertyName);
  return setName && propertyName ? { setName, propertyName } : undefined;
}

function parseCsvQuery(value: unknown): string[] | undefined {
  return typeof value === "string"
    ? value
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : undefined;
}


router.get("/overview", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    if (!projectCode) {
      return res.status(400).json({ success: false, message: "projectCode es obligatorio" });
    }

    const data = await getBimIndexOverview(projectCode);
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.get("/jobs", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    if (!projectCode) {
      return res.status(400).json({ success: false, message: "projectCode es obligatorio" });
    }

    const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
    const data = await listBimIndexJobs({
      projectCode,
      status: toJobStatus(req.query.status),
      limit: Number.isFinite(limit) ? limit : undefined
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.put("/jobs", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const projectCode = toProjectCode(body.projectCode);
    const documentPath = toText(body.documentPath);
    const status = toJobStatus(body.status);

    if (!projectCode || !documentPath || !status) {
      return res.status(400).json({
        success: false,
        message: "projectCode, documentPath y status son obligatorios"
      });
    }

    const data = await upsertBimIndexJob({
      projectCode,
      documentPath,
      sourceHash: toText(body.sourceHash),
      status,
      errorMessage: toText(body.errorMessage),
      stats:
        body.stats && typeof body.stats === "object" && !Array.isArray(body.stats)
          ? (body.stats as Record<string, unknown>)
          : undefined
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.get("/models", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    if (!projectCode) {
      return res.status(400).json({ success: false, message: "projectCode es obligatorio" });
    }

    const documentPath = toText(req.query.documentPath);
    if (documentPath) {
      const data = await getBimModelByDocument({
        projectCode,
        documentPath,
        sourceHash: toText(req.query.sourceHash)
      });
      return res.json({ success: true, data });
    }

    const data = await listBimModels(projectCode);
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.put("/models", async (req, res) => {
  try {
    const input = parseModelInput(req.body);
    if (!input) {
      return res.status(400).json({
        success: false,
        message: "projectCode, documentPath, documentName y modelKey son obligatorios"
      });
    }

    const data = await upsertBimModel(input);
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.post("/models/:modelId/elements/bulk", async (req, res) => {
  try {
    const modelId = toText(req.params.modelId);
    const elementsRaw: unknown[] = Array.isArray(req.body?.elements) ? req.body.elements : [];

    if (!modelId) {
      return res.status(400).json({ success: false, message: "modelId es obligatorio" });
    }

    if (elementsRaw.length === 0 || elementsRaw.length > MAX_ELEMENTS_PER_BATCH) {
      return res.status(400).json({
        success: false,
        message: `elements debe contener entre 1 y ${MAX_ELEMENTS_PER_BATCH} elementos`
      });
    }

    const elements = elementsRaw.map(parseElement).filter((item): item is BimElementInput =>
      Boolean(item)
    );

    if (elements.length !== elementsRaw.length) {
      return res.status(400).json({
        success: false,
        message: "Uno o mas elementos del lote BIM no tienen formato valido"
      });
    }

    const data = await bulkUpsertBimElements(modelId, elements);
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.get("/properties/snapshot", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    const signature = toText(req.query.signature);

    if (!projectCode || !signature) {
      return res.status(400).json({
        success: false,
        message: "projectCode y signature son obligatorios"
      });
    }

    const data = await getBimPropertyIndexSnapshot({ projectCode, signature });
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.put("/properties/snapshot", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const projectCode = toProjectCode(body.projectCode);
    const signature = toText(body.signature);
    const modelKeys = toStringArray(body.modelKeys) ?? [];
    const index = body.index && typeof body.index === "object" ? body.index : null;
    const elementCount =
      typeof body.elementCount === "number" && Number.isFinite(body.elementCount)
        ? Math.max(0, Math.floor(body.elementCount))
        : 0;

    if (!projectCode || !signature || !index) {
      return res.status(400).json({
        success: false,
        message: "projectCode, signature e index son obligatorios"
      });
    }

    const data = await upsertBimPropertyIndexSnapshot({
      projectCode,
      signature,
      modelKeys,
      elementCount,
      index: index as Awaited<ReturnType<typeof getBimPropertyIndex>>
    });

    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.post("/cost5d/aggregate", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const projectCode = toProjectCode(body.projectCode);
    const itemId = parsePropertyRef(body.itemId);

    if (!projectCode || !itemId) {
      return res.status(400).json({
        success: false,
        message: "projectCode e itemId son obligatorios"
      });
    }

    const limit = typeof body.limit === "number" ? body.limit : Number(body.limit);
    const data = await getBimCost5DAggregation({
      projectCode,
      modelIds: toStringArray(body.modelIds),
      modelKeys: toStringArray(body.modelKeys),
      itemId,
      itemName: parsePropertyRef(body.itemName),
      itemUnit: parsePropertyRef(body.itemUnit),
      quantity: parsePropertyRef(body.quantity),
      limit: Number.isFinite(limit) ? limit : undefined
    });

    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.get("/properties/catalog", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    if (!projectCode) {
      return res.status(400).json({ success: false, message: "projectCode es obligatorio" });
    }

    const modelIds = parseCsvQuery(req.query.modelIds);
    const modelKeys = parseCsvQuery(req.query.modelKeys);

    const maxValues =
      typeof req.query.maxValuesPerProperty === "string"
        ? Number(req.query.maxValuesPerProperty)
        : undefined;

    const data = await getBimPropertyCatalog({
      projectCode,
      modelIds,
      modelKeys,
      maxValuesPerProperty: Number.isFinite(maxValues) ? maxValues : undefined
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});


router.post("/properties/summary", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const projectCode = toProjectCode(body.projectCode);
    const propertySetName = toText(body.propertySetName);
    const propertyName = toText(body.propertyName);

    if (!projectCode || !propertySetName || !propertyName) {
      return res.status(400).json({
        success: false,
        message: "projectCode, propertySetName y propertyName son obligatorios"
      });
    }

    const maxBuckets = typeof body.maxBuckets === "number" ? body.maxBuckets : Number(body.maxBuckets);
    const maxIdsPerBucket =
      typeof body.maxIdsPerBucket === "number" ? body.maxIdsPerBucket : Number(body.maxIdsPerBucket);

    const data = await getBimPropertySummary({
      projectCode,
      modelIds: toStringArray(body.modelIds),
      modelKeys: toStringArray(body.modelKeys),
      propertySetName,
      propertyName,
      className: toText(body.className),
      levelName: toText(body.levelName),
      text: toText(body.text),
      maxBuckets: Number.isFinite(maxBuckets) ? maxBuckets : undefined,
      maxIdsPerBucket: Number.isFinite(maxIdsPerBucket) ? maxIdsPerBucket : undefined
    });

    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});
router.post("/properties/query", async (req, res) => {
  try {
    const body = req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {};
    const projectCode = toProjectCode(body.projectCode);
    const property = parsePropertyRef(body.property);

    if (!projectCode || !property) {
      return res.status(400).json({
        success: false,
        message: "projectCode y property son obligatorios"
      });
    }

    const maxIdsPerModel =
      typeof body.maxIdsPerModel === "number" ? body.maxIdsPerModel : Number(body.maxIdsPerModel);

    const data = await queryBimPropertyLocalIds({
      projectCode,
      modelIds: toStringArray(body.modelIds),
      modelKeys: toStringArray(body.modelKeys),
      property,
      propertyValue: toText(body.propertyValue),
      maxIdsPerModel: Number.isFinite(maxIdsPerModel) ? maxIdsPerModel : undefined
    });

    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

router.get("/properties", async (req, res) => {
  try {
    const projectCode = toProjectCode(req.query.projectCode);
    if (!projectCode) {
      return res.status(400).json({ success: false, message: "projectCode es obligatorio" });
    }

    const modelIds = parseCsvQuery(req.query.modelIds);
    const modelKeys = parseCsvQuery(req.query.modelKeys);

    const maxValues =
      typeof req.query.maxValuesPerProperty === "string"
        ? Number(req.query.maxValuesPerProperty)
        : undefined;

    const data = await getBimPropertyIndex({
      projectCode,
      modelIds,
      modelKeys,
      maxValuesPerProperty: Number.isFinite(maxValues) ? maxValues : undefined
    });
    return res.json({ success: true, data });
  } catch (error) {
    return sendRouteError(res, error);
  }
});

export default router;
