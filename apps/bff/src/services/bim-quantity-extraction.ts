import * as WEBIFC from "web-ifc";
import type { AuthoringResolution } from "./bim-authoring-resolver";
import type { BimProcessingContext } from "./bim-revision-identity";
import { createQuantityObservation, type QuantityObservation, type QuantityOrigin, type QuantityRawValue, type QuantityUnit } from "./bim-quantity-provenance";

type RecordValue = Record<string, unknown>;
type QuantityType = Extract<QuantityOrigin, { source: "ifc_quantity" }>["quantityType"];
export type QuantityExtractionDiagnostic = Readonly<{ localId: number; nativeId: number; reason: "unsupported_property" | "unsupported_quantity" | "unsupported_unit" }>;
const object = (v: unknown): v is RecordValue => v !== null && typeof v === "object";
const scalar = (v: unknown): QuantityRawValue | undefined => {
  if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (!object(v)) return undefined;
  if ("value" in v) return scalar(v.value);
  return "_representationValue" in v ? scalar(v._representationValue) : undefined;
};
const label = (v: unknown): string => { const value = scalar(v); return typeof value === "string" ? value : ""; };
const ref = (v: unknown): number => Number(object(v) ? v.value : NaN);
const refs = (v: unknown): number[] => Array.isArray(v) ? v.map(ref) : [];

/** IFC4X3 adds Number to the six IFC2X3/IFC4 simple quantities. Dispatch uses
 * actual schema class names, never property names or presumed dimensions. */
const quantityFields: Record<QuantityType, string> = {
  IfcQuantityVolume: "VolumeValue", IfcQuantityArea: "AreaValue", IfcQuantityLength: "LengthValue",
  IfcQuantityCount: "CountValue", IfcQuantityWeight: "WeightValue", IfcQuantityTime: "TimeValue", IfcQuantityNumber: "NumberValue"
};
const quantityByIfcName = new Map(Object.entries(quantityFields).map(([type, field]) => [type.toUpperCase(), { type: type as QuantityType, field }]));

/** One traversal of assignments on an ALREADY open model. No legacy helpers,
 * caps, value deduplication, geometry, unit inference or retained web-ifc objects.
 * Includes type assignments and entities outside the legacy element universe. */
export function extractIfcQuantityObservations(api: WEBIFC.IfcAPI, modelId: number, context: BimProcessingContext, authoring: AuthoringResolution): {
  quantityObservations: QuantityObservation[]; quantityExtractionDiagnostics: QuantityExtractionDiagnostic[];
} {
  if (context.projectCode !== authoring.context.projectCode || context.modelKey !== authoring.context.modelKey || context.revisionId !== authoring.context.revisionId) {
    throw new Error("Quantity authoring context mismatch");
  }
  const enrichment = new Map<number, NonNullable<QuantityObservation["authoring"]>>();
  for (const element of authoring.elements) for (const localId of element.memberLocalIds) {
    enrichment.set(localId, { identityKey: element.identityKey,
      role: element.resolutionMethod === "corroborated_aggregate" ? (element.rootLocalId === localId ? "root" : "child") : "standalone" });
  }
  const quantityObservations: QuantityObservation[] = [];
  const quantityExtractionDiagnostics: QuantityExtractionDiagnostic[] = [];
  const occurrences = new Map<number, number>();
  const read = (id: number): RecordValue => {
    const line: unknown = api.GetLine(modelId, id, false, false);
    if (!object(line)) throw new Error(`Cannot read quantity provenance IFC line ${id}`);
    return line;
  };
  const typeName = (line: RecordValue) => api.GetNameFromTypeCode(Number(line.type)).toUpperCase();
  function unitLabel(id: number, ancestors = new Set<number>()): string | undefined {
    if (ancestors.has(id)) throw new Error(`Cyclic IFC unit ${id}`);
    const unit = read(id);
    // Preserve the IFC label, not a guessed display symbol or converted value.
    const name = label(unit.Name);
    const type = typeName(unit);
    if (name && ["IFCSIUNIT", "IFCCONVERSIONBASEDUNIT", "IFCCONVERSIONBASEDUNITWITHOFFSET", "IFCCONTEXTDEPENDENTUNIT"].includes(type)) {
      const prefix = label(unit.Prefix);
      return prefix ? `${prefix}.${name}` : name;
    }
    if (type === "IFCMONETARYUNIT") return label(unit.Currency) || undefined;
    if (type === "IFCDERIVEDUNIT") {
      ancestors.add(id);
      const components: { unit: string; exponent: QuantityRawValue }[] = [];
      for (const elementId of refs(unit.Elements)) {
        const element = read(elementId);
        const component = unitLabel(ref(element.Unit), ancestors);
        const exponent = scalar(element.Exponent);
        if (!component || exponent === undefined) { ancestors.delete(id); return undefined; }
        components.push({ unit: component, exponent });
      }
      ancestors.delete(id);
      // Structural encoding of explicit IFC evidence, NOT a derived SI symbol
      // or conversion. Preserve component order and exponent as supplied.
      return JSON.stringify({ ifcType: "IfcDerivedUnit", unitType: label(unit.UnitType), userDefinedType: label(unit.UserDefinedType), components });
    }
    return undefined;
  }
  function unitOf(line: RecordValue, localId: number): QuantityUnit {
    if (line.Unit == null) return { kind: "unknown" };
    const id = ref(line.Unit);
    const raw = unitLabel(id);
    if (raw !== undefined) return { kind: "explicit", raw, evidence: { ifcUnitLocalId: id } };
    quantityExtractionDiagnostics.push({ localId, nativeId: id, reason: "unsupported_unit" });
    return { kind: "unknown" };
  }
  function visit(localId: number, setId: number, id: number, source: "stored_parameter" | "ifc_quantity", setName: string, ancestors: Set<number>) {
    if (ancestors.has(id)) throw new Error(`Cyclic quantity/property structure at ${id}`);
    const line = read(id);
    const type = typeName(line);
    if (type === "IFCCOMPLEXPROPERTY" || type === "IFCPHYSICALCOMPLEXQUANTITY") {
      ancestors.add(id);
      for (const child of refs(source === "stored_parameter" ? line.HasProperties : line.HasQuantities)) visit(localId, setId, child, source, setName, ancestors);
      ancestors.delete(id);
      return;
    }
    let origin: QuantityOrigin;
    let raw: QuantityRawValue | undefined;
    if (source === "stored_parameter" && type === "IFCPROPERTYSINGLEVALUE") {
      origin = { source, propertySet: setName, propertyName: label(line.Name), propertySetLocalId: setId, propertyLocalId: id, valueField: "NominalValue" };
      raw = scalar(line.NominalValue);
    } else if (source === "ifc_quantity" && quantityByIfcName.has(type)) {
      const quantity = quantityByIfcName.get(type)!;
      origin = { source, quantitySet: setName, quantityName: label(line.Name), quantityType: quantity.type, quantitySetLocalId: setId, quantityLocalId: id };
      raw = scalar(line[quantity.field]);
    } else {
      quantityExtractionDiagnostics.push({ localId, nativeId: id, reason: source === "stored_parameter" ? "unsupported_property" : "unsupported_quantity" });
      return;
    }
    if (raw === undefined) throw new Error(`Unsupported scalar at IFC observation ${id}`);
    const occurrenceIndex = occurrences.get(localId) ?? 0;
    occurrences.set(localId, occurrenceIndex + 1);
    quantityObservations.push(createQuantityObservation({ context, localId, origin, rawValue: raw, occurrenceIndex,
      unit: unitOf(line, localId), authoring: enrichment.get(localId) }));
  }
  function visitSet(localId: number, setId: number) {
    const set = read(setId);
    const type = typeName(set);
    if (type === "IFCPROPERTYSET") {
      for (const id of refs(set.HasProperties)) visit(localId, setId, id, "stored_parameter", label(set.Name), new Set());
    } else if (type === "IFCELEMENTQUANTITY") {
      for (const id of refs(set.Quantities)) visit(localId, setId, id, "ifc_quantity", label(set.Name), new Set());
    }
  }
  // Canonical relationship/target order makes occurrence positions stable for the same bytes.
  // Distinct relationships/sets remain distinct occurrences, even with identical values.
  for (const relationType of [WEBIFC.IFCRELDEFINESBYPROPERTIES, WEBIFC.IFCRELDEFINESBYTYPE]) {
    const vector = api.GetLineIDsWithType(modelId, relationType, false);
    const ids = Array.from({ length: vector.size() }, (_, i) => vector.get(i)).sort((a, b) => a - b);
    for (const id of ids) {
      const relation = read(id);
      const sets = relationType === WEBIFC.IFCRELDEFINESBYTYPE
        ? refs(read(ref(relation.RelatingType)).HasPropertySets)
        : Array.isArray(relation.RelatingPropertyDefinition) ? refs(relation.RelatingPropertyDefinition) : [ref(relation.RelatingPropertyDefinition)];
      for (const localId of refs(relation.RelatedObjects).sort((a, b) => a - b)) for (const setId of sets) visitSet(localId, setId);
    }
  }
  return { quantityObservations, quantityExtractionDiagnostics };
}
