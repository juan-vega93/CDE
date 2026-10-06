import { bffFetch } from '@/services/bff-client';
import type { ViewerBimContext } from './viewer-bim-context';

/** No alias inference: only the verified context transported with the model. */
export async function loadGraphicalRepresentation(context: ViewerBimContext, localIds: number[]): Promise<Map<number, number[]>> {
  const response = await bffFetch('/api/bim-index/graphical-representation', {
    method: 'POST', body: JSON.stringify({ ...context, localIds })
  });
  if (!response.ok) throw new Error(`Graphical representation HTTP ${response.status}`);
  const { success, data } = await response.json();
  if (!success || data?.context?.projectCode !== context.projectCode || data?.context?.modelKey !== context.modelKey ||
    data?.context?.revisionId !== context.revisionId || !Array.isArray(data.results)) throw new Error('Invalid graphical context');
  const result = new Map<number, number[]>();
  const requested = new Set(localIds);
  for (const row of data.results) {
    if (!requested.has(row.semanticLocalId) || result.has(row.semanticLocalId) ||
      !['direct', 'structural_delegate', 'unresolved'].includes(row.resolution) || !Array.isArray(row.graphicalLocalIds) ||
      row.graphicalLocalIds.some((id: number) => !Number.isSafeInteger(id) || id <= 0) ||
      (row.resolution === 'unresolved' && row.graphicalLocalIds.length !== 0) ||
      (row.resolution === 'direct' && (row.graphicalLocalIds.length !== 1 || row.graphicalLocalIds[0] !== row.semanticLocalId))) throw new Error('Invalid graphical targets');
    result.set(row.semanticLocalId, row.graphicalLocalIds);
  }
  if (result.size !== requested.size) throw new Error('Incomplete graphical resolution');
  return result;
}
