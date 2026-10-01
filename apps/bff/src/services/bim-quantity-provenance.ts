import type { BimProcessingContext } from "./bim-revision-identity";

export type QuantitySource = "stored_parameter" | "ifc_quantity" | "viewer_geometry";
export type QuantityRawValue = string | number | boolean | null;

/** Names and optional native IDs are evidence, never inferred from a numeric value. */
export type QuantityOrigin =
  | Readonly<{ source: "stored_parameter"; propertySet: string; propertyName: string;
      propertySetLocalId?: number; propertyLocalId?: number; valueField?: "NominalValue" }>
  | Readonly<{ source: "ifc_quantity"; quantitySet: string; quantityName: string;
      quantityType: "IfcQuantityVolume" | "IfcQuantityArea" | "IfcQuantityLength" |
        "IfcQuantityCount" | "IfcQuantityWeight" | "IfcQuantityTime";
      quantitySetLocalId?: number; quantityLocalId?: number }>
  | Readonly<{ source: "viewer_geometry"; metric: "volume" | "area";
      calculation: string }>;

export type QuantityUnit =
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "explicit"; raw: string;
      evidence: Readonly<{ propertySet: string; propertyName: string }> | Readonly<{ ifcUnitLocalId: number }> }>;

export type QuantityObservationInput = Readonly<{
  context: BimProcessingContext;
  localId: number;
  origin: QuantityOrigin;
  /** Position in the supplied extraction/measurement collection, not a generated IFC ID.
   * Caller preserves this position when identical observations occur more than once. */
  occurrenceIndex: number;
  rawValue: QuantityRawValue;
  unit?: QuantityUnit;
  /** Optional enrichment in the SAME context; not the owner/source of the value. */
  authoring?: Readonly<{ identityKey: string; role: "root" | "child" | "standalone" }>;
}>;

export type QuantityObservation = Readonly<Omit<QuantityObservationInput, "unit"> & {
  observationKey: string;
  source: QuantitySource;
  numericValue?: number;
  unit: QuantityUnit;
}>;

/** Conservative intersection of existing decimal parsers. No locale guessing,
 * stripping of unit suffixes, exponent/hex coercion or unit conversion. */
export function normalizeQuantityNumericValue(raw: QuantityRawValue): number | undefined {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw !== "string" || !/^-?[0-9]+(?:\.[0-9]+)?$/.test(raw)) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/** Pure builder for ALREADY extracted evidence. Not an IFC extractor or aggregator.
 * The key is revision-local and deterministic; never a cross-revision identity. */
export function createQuantityObservation(input: QuantityObservationInput): QuantityObservation {
  if (!Number.isSafeInteger(input.localId) || input.localId <= 0) throw new Error("Invalid entity localId");
  if (!Number.isSafeInteger(input.occurrenceIndex) || input.occurrenceIndex < 0) throw new Error("Invalid observation occurrenceIndex");
  const context = Object.freeze({ ...input.context });
  const origin = Object.freeze({ ...input.origin });
  // Explicit tuple order, independent of object insertion order and of value/unit.
  const locator = origin.source === "stored_parameter"
    ? [origin.propertySet, origin.propertyName, origin.propertySetLocalId ?? null, origin.propertyLocalId ?? null, origin.valueField ?? null]
    : origin.source === "ifc_quantity"
      ? [origin.quantitySet, origin.quantityName, origin.quantityType, origin.quantitySetLocalId ?? null, origin.quantityLocalId ?? null]
      : [origin.metric, origin.calculation];
  const observationKey = JSON.stringify([
    context.projectCode, context.modelKey, context.revisionId, input.localId,
    origin.source, locator, input.occurrenceIndex
  ]);
  const numericValue = normalizeQuantityNumericValue(input.rawValue);
  const unit: QuantityUnit = input.unit?.kind === "explicit"
    ? Object.freeze({ ...input.unit, evidence: Object.freeze({ ...input.unit.evidence }) })
    : Object.freeze({ kind: "unknown" });
  return Object.freeze({
    context, localId: input.localId, origin, source: origin.source,
    occurrenceIndex: input.occurrenceIndex, observationKey, rawValue: input.rawValue,
    ...(numericValue === undefined ? {} : { numericValue }), unit,
    ...(input.authoring ? { authoring: Object.freeze({ ...input.authoring }) } : {})
  });
}
