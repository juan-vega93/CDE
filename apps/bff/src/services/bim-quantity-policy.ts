import type { QuantityObservation, QuantityOrigin } from "./bim-quantity-provenance";

export type QuantityTarget =
  | Pick<Extract<QuantityOrigin, { source: "stored_parameter" }>, "source" | "propertySet" | "propertyName">
  | Pick<Extract<QuantityOrigin, { source: "ifc_quantity" }>, "source" | "quantitySet" | "quantityName" | "quantityType">
  | Pick<Extract<QuantityOrigin, { source: "viewer_geometry" }>, "source" | "metric" | "calculation">;

/** Diagnostic policies only. Changing these semantics requires a NEW version. */
export type QuantityPolicy = Readonly<{
  policyId: "quantity-policy/entity-sum" | "quantity-policy/authoring-root-only" | "quantity-policy/authoring-single-observation";
  version: 1;
  purpose: "diagnostic";
  target: QuantityTarget;
  numericRequirement: "finite";
  units: Readonly<{ kind: "exact"; raw: string }> | Readonly<{ kind: "uniform"; allowAllUnknown: boolean }>;
  operation: "sum";
}>;

type Reason = "entity_sum" | "unique_root_or_standalone" | "unique_authoring_observation" |
  "source_mismatch" | "quantity_mismatch" | "invalid_numeric" | "unit_unknown" |
  "unit_mismatch" | "missing_authoring" | "child_not_selected" | "evaluation_blocked";
type DiagnosticCode = "unsupported_policy" | "mixed_context" | "duplicate_observation_key" |
  "inconsistent_source" | "unit_unknown" | "unit_mismatch" | "missing_authoring" |
  "zero_authoring_observations" | "multiple_authoring_observations" | "inconsistent_authoring_roles" |
  "no_eligible_observations" | "numeric_overflow";
export type QuantityEvaluation = Readonly<{
  policy: QuantityPolicy;
  status: "resolved" | "ambiguous" | "not_evaluable";
  value?: number;
  unit?: Readonly<{ kind: "explicit"; raw: string }> | Readonly<{ kind: "unknown" }>;
  inputObservationCount: number;
  /** Candidates passing per-observation filters; global unit uniformity and
   * authoring checks can still block the entire evaluation. */
  eligibleObservationCount: number;
  includedObservationKeys: readonly string[];
  trace: readonly Readonly<{ observationKey: string; disposition: "included" | "excluded" | "blocked"; reason: Reason }>[];
  diagnostics: readonly Readonly<{ code: DiagnosticCode; authoringKey?: string }>[];
}>;

const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const contextKey = (o: QuantityObservation) => JSON.stringify([o.context.projectCode, o.context.modelKey, o.context.revisionId]);
function matches(origin: QuantityOrigin, target: QuantityTarget): boolean {
  if (origin.source === "stored_parameter" && target.source === "stored_parameter")
    return origin.propertySet === target.propertySet && origin.propertyName === target.propertyName;
  if (origin.source === "ifc_quantity" && target.source === "ifc_quantity")
    return origin.quantitySet === target.quantitySet && origin.quantityName === target.quantityName && origin.quantityType === target.quantityType;
  return origin.source === "viewer_geometry" && target.source === "viewer_geometry" &&
    origin.metric === target.metric && origin.calculation === target.calculation;
}

/** No IO, mutation, conversion, source ranking or production integration.
 * Authoring group universe = target-matching observations, including ineligible
 * ones. An entirely absent AuthoringElement cannot be inferred from this input. */
export function evaluateQuantityPolicy(observations: readonly QuantityObservation[], policy: QuantityPolicy): QuantityEvaluation {
  const input = [...observations].sort((a, b) => compare(a.observationKey, b.observationKey));
  const diagnostics: { code: DiagnosticCode; authoringKey?: string }[] = [];
  const reasons = new Map<QuantityObservation, Reason>();
  let blocked = false;
  let ambiguous = false;
  const diagnose = (code: DiagnosticCode, authoringKey?: string, ambiguity = false) => {
    diagnostics.push({ code, ...(authoringKey === undefined ? {} : { authoringKey }) });
    if (ambiguity) ambiguous = true; else blocked = true;
  };
  if (policy.version !== 1 || policy.purpose !== "diagnostic" || policy.operation !== "sum" ||
      policy.numericRequirement !== "finite" || ![
        "quantity-policy/entity-sum", "quantity-policy/authoring-root-only", "quantity-policy/authoring-single-observation"
      ].includes(policy.policyId)) diagnose("unsupported_policy");
  if (new Set(input.map(contextKey)).size > 1) diagnose("mixed_context");
  if (new Set(input.map((o) => o.observationKey)).size !== input.length) diagnose("duplicate_observation_key", undefined, true);
  if (blocked || ambiguous) return {
    policy: { ...policy, target: { ...policy.target }, units: { ...policy.units } },
    status: blocked ? "not_evaluable" : "ambiguous", inputObservationCount: input.length,
    eligibleObservationCount: 0, includedObservationKeys: [],
    trace: input.map((o) => ({ observationKey: o.observationKey, disposition: "blocked", reason: "evaluation_blocked" })),
    diagnostics: diagnostics.sort((a, b) => compare(a.code, b.code))
  };
  const relevant: QuantityObservation[] = [];
  const eligible: QuantityObservation[] = [];
  for (const o of input) {
    if (o.source !== o.origin.source) { diagnose("inconsistent_source"); reasons.set(o, "evaluation_blocked"); continue; }
    if (o.source !== policy.target.source) { reasons.set(o, "source_mismatch"); continue; }
    if (!matches(o.origin, policy.target)) { reasons.set(o, "quantity_mismatch"); continue; }
    relevant.push(o);
    if (o.numericValue === undefined || !Number.isFinite(o.numericValue)) { reasons.set(o, "invalid_numeric"); continue; }
    if (policy.units.kind === "exact" && (o.unit.kind !== "explicit" || o.unit.raw !== policy.units.raw)) {
      const code = o.unit.kind === "unknown" ? "unit_unknown" : "unit_mismatch";
      reasons.set(o, code); diagnose(code); continue;
    }
    eligible.push(o);
  }
  let unit: QuantityEvaluation["unit"];
  if (policy.units.kind === "exact") unit = { kind: "explicit", raw: policy.units.raw };
  else {
    const labels = new Set(eligible.map((o) => o.unit.kind === "explicit" ? JSON.stringify(o.unit.raw) : "unknown"));
    if (labels.size > 1) diagnose("unit_mismatch");
    else if (labels.has("unknown") && !policy.units.allowAllUnknown) diagnose("unit_unknown");
    else if (eligible.length) unit = eligible[0].unit.kind === "explicit"
      ? { kind: "explicit", raw: eligible[0].unit.raw } : { kind: "unknown" };
  }
  const selected = new Set<QuantityObservation>();
  let inclusion: Reason = "entity_sum";
  if (policy.policyId === "quantity-policy/entity-sum") eligible.forEach((o) => selected.add(o));
  else {
    inclusion = policy.policyId === "quantity-policy/authoring-root-only" ? "unique_root_or_standalone" : "unique_authoring_observation";
    const groups = new Map<string, QuantityObservation[]>();
    const eligibleSet = new Set(eligible);
    for (const o of relevant) {
      if (!o.authoring?.identityKey.trim()) { reasons.set(o, "missing_authoring"); diagnose("missing_authoring"); continue; }
      const group = groups.get(o.authoring.identityKey) ?? [];
      group.push(o); groups.set(o.authoring.identityKey, group);
    }
    for (const [key, group] of groups) {
      const roles = new Set(group.map((o) => o.authoring!.role));
      const roots = new Set(group.filter((o) => o.authoring!.role === "root").map((o) => o.localId));
      const entities = new Set(group.map((o) => o.localId));
      const rolesByEntity = new Map<number, Set<string>>();
      for (const o of group) {
        const entityRoles = rolesByEntity.get(o.localId) ?? new Set<string>();
        entityRoles.add(o.authoring!.role); rolesByEntity.set(o.localId, entityRoles);
      }
      if ((roles.has("standalone") && (roles.size > 1 || entities.size > 1)) || roots.size > 1 ||
          [...rolesByEntity.values()].some((r) => r.size > 1)) diagnose("inconsistent_authoring_roles", key, true);
      const candidates = group.filter((o) => {
        if (!eligibleSet.has(o)) return false;
        if (policy.policyId === "quantity-policy/authoring-root-only" && o.authoring!.role === "child") {
          reasons.set(o, "child_not_selected"); return false;
        }
        return true;
      });
      if (!candidates.length) diagnose("zero_authoring_observations", key);
      else if (candidates.length > 1) diagnose("multiple_authoring_observations", key, true);
      else selected.add(candidates[0]);
    }
  }
  if (!eligible.length) diagnose("no_eligible_observations");
  // Canonical key ordering makes floating-point addition reproducible for permutations.
  const value = input.filter((o) => selected.has(o)).reduce((sum, o) => sum + o.numericValue!, 0);
  if (!Number.isFinite(value)) diagnose("numeric_overflow");
  const status = blocked ? "not_evaluable" : ambiguous ? "ambiguous" : "resolved";
  const trace = input.map((o): QuantityEvaluation["trace"][number] => {
    const reason = reasons.get(o);
    if (reason && reason !== "evaluation_blocked") return { observationKey: o.observationKey, disposition: "excluded", reason };
    if (status === "resolved" && selected.has(o)) return { observationKey: o.observationKey, disposition: "included", reason: inclusion };
    return { observationKey: o.observationKey, disposition: "blocked", reason: "evaluation_blocked" };
  });
  // Compact repeated diagnostics without dropping any observation from the trace.
  const uniqueDiagnostics = [...new Map(diagnostics.map((d) => [JSON.stringify([d.code, d.authoringKey]), d])).values()]
    .sort((a, b) => compare(JSON.stringify([a.code, a.authoringKey]), JSON.stringify([b.code, b.authoringKey])));
  return {
    policy: { ...policy, target: { ...policy.target }, units: { ...policy.units } }, status,
    ...(status === "resolved" ? { value, unit } : {}),
    inputObservationCount: input.length, eligibleObservationCount: eligible.length,
    includedObservationKeys: trace.filter((t) => t.disposition === "included").map((t) => t.observationKey),
    trace, diagnostics: uniqueDiagnostics
  };
}
