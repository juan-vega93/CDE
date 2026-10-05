import type { FragmentsModel, MaterialDefinition } from '@thatopen/fragments';
import type { Highlighter } from '@thatopen/components-front';

/** Fragments 3.4 setOpacity/resetOpacity allocate preserveOriginalMaterial
 * definitions per mesh, even for unchanged values, and exhaust Uint16 IDs.
 * A partial highlight is merged onto each original tile material by Fragments;
 * unlike setOpacity it can reuse the same definition. No color is supplied.
 */
export function createSelectionOpacityModel(model:FragmentsModel, id:string, highlighter:Highlighter) {
  return {
    getItemsIdsWithGeometry:()=>model.getItemsIdsWithGeometry(),
    setOpacity:(ids:number[],opacity:number)=>model.highlight(ids,
      {opacity,transparent:opacity<1} as MaterialDefinition),
    async resetOpacity(ids:number[]) {
      await model.resetHighlight(ids);
      // Restore current style owners for these IDs only. Select has priority,
      // just as in Highlighter.updateColors; unstyled IDs use original materials.
      const selected=highlighter.selection.select?.[id];
      for(const [name,map] of Object.entries(highlighter.selection)) {
        const style=highlighter.styles.get(name);
        if(!style)continue;
        const targets=ids.filter(localId=>map[id]?.has(localId)&&(name==='select'||!selected?.has(localId)));
        if(targets.length)await model.highlight(targets,style);
      }
    }
  };
}
