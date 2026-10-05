import type {ModelIdMap} from '@thatopen/components';
/** Keep Highlighter's styles/priority rules; narrow its unconditional material reset.
 * Visibility is never touched. The returned union is the exact invalidation set.
 */
export function createSelectionMaterialBridge(driver:{
  selections():Record<string,ModelIdMap>;
  reset(map:ModelIdMap):Promise<void>;
}) {
  let previous:ModelIdMap={};
  function capture() {
    const next:ModelIdMap={};
    for(const map of Object.values(driver.selections())) for(const [id,ids] of Object.entries(map)) {
      const target=next[id]??(next[id]=new Set());for(const localId of ids)target.add(localId);
    }
    return next;
  }
  return {
    async reset() {
      const current=capture(),affected:ModelIdMap={};
      for(const map of [previous,current])for(const [id,ids] of Object.entries(map)) {
        const target=affected[id]??(affected[id]=new Set());for(const localId of ids)target.add(localId);
      }
      if(Object.values(affected).some(ids=>ids.size))await driver.reset(affected);
      previous=current;return affected;
    }
  };
}
