import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareStoredToIfcQuantity, type GeometricSelector } from './bim-quantity-comparison';
import { createQuantityObservation, type QuantityUnit } from './bim-quantity-provenance';
import type { BimProcessingContext, BimRevisionId } from './bim-revision-identity';
import { toCanonicalBimModelKey } from './bim-model-identity';

// Synthetic comparison scope, not a claim to have parsed/hashed an IFC fixture.
const context: BimProcessingContext = {projectCode:'TEST',modelKey:toCanonicalBimModelKey('/Test.ifc'),revisionId:`sha256:${'a'.repeat(64)}` as BimRevisionId};
const selector: GeometricSelector = { source:'ifc_quantity',quantitySet:'Qto_SlabBaseQuantities',quantityName:'NetVolume',quantityType:'IfcQuantityVolume',entityRole:'root' };
const unit: QuantityUnit = { kind:'explicit',raw:'m3',evidence:{propertySet:'Test',propertyName:'Unit'} };
function pair(stored: number, geometric: number, explicit = true) {
  const base = {context,localId:209862,occurrenceIndex:0,authoring:{identityKey:'aggregate:209862',role:'root' as const},unit:explicit ? unit : undefined};
  return {stored:createQuantityObservation({...base,rawValue:stored,origin:{source:'stored_parameter',propertySet:'Datos_Partida',propertyName:'Metrado'}}),
    geometric:[createQuantityObservation({...base,rawValue:geometric,origin:selector})],selector};
}
test('A5 actual numeric evidence: derived delta, unknown units cannot assert compliance', () => {
  const input = pair(156.616,188.05910326170218,false);
  const result = compareStoredToIfcQuantity(input);
  assert.equal(result.signedDelta,188.05910326170218-156.616);
  assert.equal(result.relativeDeltaPercent,(188.05910326170218-156.616)/156.616*100);
  assert.equal(result.status,'unit_incompatible'); assert.equal(input.stored.numericValue,156.616);
});
test('explicit synthetic unit evidence and supplied tolerances: match/within/mismatch', () => {
  const tolerance = {absoluteTolerance:0.1,relativeTolerancePercent:0};
  assert.equal(compareStoredToIfcQuantity({...pair(10,10),tolerance}).status,'match');
  assert.equal(compareStoredToIfcQuantity({...pair(582.668,582.608592949144),tolerance}).status,'within_tolerance');
  assert.equal(compareStoredToIfcQuantity({...pair(156.616,188.05910326170218),tolerance}).status,'mismatch');
  assert.equal(compareStoredToIfcQuantity(pair(10,11)).status,'unassessed');
});
test('missing, ambiguous, units and explicit role/set/type selection', () => {
  const input = pair(10,11);
  assert.equal(compareStoredToIfcQuantity({...input,stored:undefined}).status,'missing_stored');
  assert.equal(compareStoredToIfcQuantity({...input,geometric:[]}).status,'missing_geometric');
  assert.equal(compareStoredToIfcQuantity({...input,geometric:[...input.geometric,...input.geometric]}).status,'ambiguous_geometric');
  assert.equal(compareStoredToIfcQuantity({...input,geometricEvidenceTruncated:true}).status,'ambiguous_geometric');
  assert.equal(compareStoredToIfcQuantity({...input,geometricEvidenceTruncated:true}).geometricValue,undefined);
  assert.equal(compareStoredToIfcQuantity({...input,selector:{...selector,entityRole:'child'}}).status,'missing_geometric');
  assert.equal(compareStoredToIfcQuantity({...input,selector:{...selector,quantitySet:'Qto_RoofBaseQuantities'}}).status,'missing_geometric');
  assert.equal(compareStoredToIfcQuantity({...input,selector:{...selector,quantityType:'IfcQuantityArea'}}).status,'missing_geometric');
  const geometric = [createQuantityObservation({...input.geometric[0],unit:{...unit,raw:'ft3'}})];
  assert.equal(compareStoredToIfcQuantity({...input,geometric}).status,'unit_incompatible');
  assert.equal(compareStoredToIfcQuantity(pair(0,1)).relativeDeltaPercent,undefined);
  assert.throws(() => compareStoredToIfcQuantity({...input,tolerance:{absoluteTolerance:-1,relativeTolerancePercent:0}}));
});
