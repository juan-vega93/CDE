import type { QuantityObservation } from './bim-quantity-provenance';

export type GeometricSelector = {
  source: 'ifc_quantity'; quantitySet: string; quantityName: string;
  quantityType: Extract<QuantityObservation['origin'], {source:'ifc_quantity'}>['quantityType'];
  entityRole: 'root' | 'child' | 'standalone';
};
export type ComparisonStatus = 'match' | 'within_tolerance' | 'mismatch' | 'unassessed'
  | 'missing_stored' | 'missing_geometric' | 'ambiguous_geometric' | 'unit_incompatible';

/** Numeric diagnostics never select a contractual source. No implicit units or tolerances. */
export function compareStoredToIfcQuantity(input: {
  stored: QuantityObservation | undefined;
  geometric: readonly QuantityObservation[];
  /** Pass the query summary's auditTruncated when supplying its bounded evidence arrays. */
  geometricEvidenceTruncated?: boolean;
  selector: GeometricSelector;
  tolerance?: { absoluteTolerance: number; relativeTolerancePercent: number };
}) {
  const { stored, selector, tolerance } = input;
  if (tolerance && Object.values(tolerance).some(v => !Number.isFinite(v) || v < 0)) throw new Error('INVALID_QUANTITY_TOLERANCE');
  if (stored && stored.source !== 'stored_parameter') throw new Error('EXPECTED_STORED_PARAMETER');
  const candidates = input.geometric.filter(q => q.origin.source === 'ifc_quantity' &&
    q.origin.quantitySet === selector.quantitySet && q.origin.quantityName === selector.quantityName &&
    q.origin.quantityType === selector.quantityType && q.authoring?.role === selector.entityRole &&
    (!stored || (q.context.projectCode === stored.context.projectCode && q.context.modelKey === stored.context.modelKey &&
      q.context.revisionId === stored.context.revisionId && (stored.authoring
        ? q.authoring?.identityKey === stored.authoring.identityKey : q.localId === stored.localId))));
  const geometric = !input.geometricEvidenceTruncated && candidates.length === 1 ? candidates[0] : undefined;
  const storedValue = stored?.numericValue;
  const geometricValue = geometric?.numericValue;
  const signedDelta = storedValue !== undefined && geometricValue !== undefined ? geometricValue - storedValue : undefined;
  const absoluteDelta = signedDelta === undefined ? undefined : Math.abs(signedDelta);
  const relativeDeltaPercent = signedDelta !== undefined && storedValue !== 0 ? signedDelta / Math.abs(storedValue!) * 100 : undefined;
  const unitsCompatible = Boolean(stored?.unit.kind === 'explicit' && geometric?.unit.kind === 'explicit' && stored.unit.raw === geometric.unit.raw);
  let status: ComparisonStatus;
  if (storedValue === undefined) status = 'missing_stored';
  else if (input.geometricEvidenceTruncated || candidates.length > 1) status = 'ambiguous_geometric';
  else if (geometricValue === undefined) status = 'missing_geometric';
  else if (!unitsCompatible) status = 'unit_incompatible';
  else if (!tolerance) status = 'unassessed';
  else if (absoluteDelta === 0) status = 'match';
  else if (absoluteDelta! <= tolerance.absoluteTolerance ||
    (relativeDeltaPercent !== undefined && Math.abs(relativeDeltaPercent) <= tolerance.relativeTolerancePercent)) status = 'within_tolerance';
  else status = 'mismatch';
  return { storedValue, geometricValue, signedDelta, absoluteDelta, relativeDeltaPercent, status,
    storedObservationKey: stored?.observationKey, geometricObservationKey: geometric?.observationKey,
    unitsCompatible, candidateCount: candidates.length };
}
