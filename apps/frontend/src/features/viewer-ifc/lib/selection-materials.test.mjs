import assert from 'node:assert/strict';
import test from 'node:test';
import {createSelectionContext} from './selection-context.ts';
import {createSelectionMaterialBridge} from './selection-materials.ts';
test('100 transitions over 10000 meshes do not allocate 10000 opacity materials per transition',async()=>{
  const dim=new Set();let writes=0,selections={};
  const model={getItemsIdsWithGeometry:async()=>Array.from({length:10000},(_,i)=>i+1),
    setOpacity:async ids=>{writes+=ids.length;ids.forEach(id=>dim.add(id));},resetOpacity:async ids=>ids.forEach(id=>dim.delete(id))};
  const context=createSelectionContext({models:()=>[['M',model]],hidden:async()=>({}),refresh:async()=>{}});
  const bridge=createSelectionMaterialBridge({selections:()=>selections,reset:async map=>{for(const id of map.M??[])dim.delete(id);}});
  for(let step=0;step<100;step++) {
    const id=step%3+1;selections={select:{M:new Set([id])}};
    await context.rebuildMaterials(()=>bridge.reset(),()=>true);
    await context.setSelection(selections.select);
    assert.equal(dim.size,9999);assert.equal(dim.has(id),false);assert.ok(dim.has(10000));
  }
  assert.equal(writes,9999+99,'only the previous selected mesh needs a new ghost override');
});
