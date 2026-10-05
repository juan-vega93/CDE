import type { ModelIdMap } from '@thatopen/components';
import type { AuthoringSelection } from './resolve-authoring-selection';

/** Root first even without geometry. Never replaces or copies the clicked member's properties. */
export function logicalInspectorMap(primary: ModelIdMap, logical?: AuthoringSelection): ModelIdMap {
  const root = logical?.authoringElement.resolutionMethod === 'corroborated_aggregate'
    ? logical.authoringElement.rootLocalId : undefined;
  return Object.fromEntries(Object.entries(primary).map(([model, ids]) =>
    [model, new Set(root === undefined ? ids : [root, ...ids])]));
}
export function labelInspectorItems(items: Record<string, unknown>[], logical?: AuthoringSelection) {
  if (logical?.authoringElement.resolutionMethod !== 'corroborated_aggregate') return items;
  return items.map(item => {
    const id = item._localId as number | {value?:number} | undefined;
    const localId = typeof id === 'object' ? id?.value : id;
    return {...item, __inspectorRole:localId===logical.authoringElement.rootLocalId?'root':'child',
      __authoringKey:logical.authoringElement.identityKey, __authoringId:logical.authoringElement.authoringElementId};
  });
}
