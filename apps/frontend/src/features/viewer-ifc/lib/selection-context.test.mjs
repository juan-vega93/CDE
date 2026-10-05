import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectionContext } from './selection-context.ts';
import { logicalInspectorMap, labelInspectorItems } from './logical-inspector.ts';

function setup(afterWrite=async()=>{}) {
  const hidden={A:new Set([3]),B:new Set([12])},dim={A:new Set(),B:new Set()},calls=[];
  const controller=createSelectionContext({
    models:()=>Object.entries({A:[1,2,3,4,5],B:[10,11,12]}).map(([model,ids])=>[model,{
      getItemsIdsWithGeometry:async()=>ids,
      setOpacity:async(batch,value)=>{assert.equal(value,0.16);calls.push(['dim',model,batch]);batch.forEach(id=>dim[model].add(id));await afterWrite();},
      resetOpacity:async batch=>{assert.ok(Array.isArray(batch));calls.push(['reset',model,batch]);batch.forEach(id=>dim[model].delete(id));await afterWrite();}
    }]),hidden:async()=>Object.fromEntries(Object.entries(hidden).map(([id,ids])=>[id,[...ids]])),refresh:async()=>{}
  },2);
  return {controller,hidden,dim,calls};
}
test('ghost only unselected visible graphical memberships across federated models; never visibility writes',async()=>{
  const h=setup();await h.controller.setSelection({A:new Set([1,2])});
  assert.deepEqual([...h.dim.A],[4,5]);assert.deepEqual([...h.dim.B],[10,11]);assert.deepEqual([...h.hidden.A],[3]);assert.deepEqual([...h.hidden.B],[12]);
  await h.controller.setSelection({});assert.equal(h.dim.A.size+h.dim.B.size,0);assert.deepEqual([...h.hidden.A],[3]);
});
test('clear selection restores independent context; isolate/SmartView hidden stay hidden',async()=>{
  const h=setup();h.hidden.A.add(5);await h.controller.setContext({A:new Set([1]),B:new Set([10])});
  const previous=[...h.dim.A];await h.controller.setSelection({A:new Set([2])});assert.equal(h.dim.A.has(2),false);
  await h.controller.setSelection({});assert.deepEqual([...h.dim.A].sort(),previous.sort());assert.equal(h.dim.A.has(3),false);assert.equal(h.dim.A.has(5),false);
  h.hidden.A.delete(5);await h.controller.reconcile();assert.equal(h.dim.A.has(5),true);
});
test('rapid presentation decisions converge after asynchronous chunk; clear wins',async()=>{
  let resolve;const pending=new Promise(r=>{resolve=r;});let once=true;
  const h=setup(async()=>{if(once){once=false;await pending;}});
  const a=h.controller.setSelection({A:new Set([1])});await new Promise(r=>setImmediate(r));
  const b=h.controller.setSelection({B:new Set([10])});resolve();await Promise.all([a,b]);
  assert.equal(h.dim.B.has(10),false);assert.equal(h.dim.A.has(1),true);assert.equal(h.dim.A.has(3),false);
  await h.controller.setSelection({});assert.equal(h.dim.A.size+h.dim.B.size,0);
});
test('Roof root stays identity primary even without geometry; clicked Slab properties remain separate',()=>{
  const logical={authoringElement:{identityKey:'aggregate:389468',rootLocalId:389468,authoringElementId:'2161482',resolutionMethod:'corroborated_aggregate'}};
  assert.deepEqual([...logicalInspectorMap({OCI:new Set([389463])},logical).OCI],[389468,389463]);
  const child={_localId:389463,_category:'IfcSlab',_guid:'0EEVeb_X11ARAc6bfxkglh',NetArea:1.6210723625493098};
  const root={_localId:389468,_category:'IfcRoof',_guid:'0EEVeb_X11ARAc6bXxkglh',NetArea:17.449077689484753};
  const labelled=labelInspectorItems([child,root],logical);
  assert.equal(labelled.find(i=>i.__inspectorRole==='root')._category,'IfcRoof');
  assert.equal(labelled.find(i=>i.__inspectorRole==='child').NetArea,child.NetArea);
  assert.equal(root.__inspectorRole,undefined);
  assert.deepEqual([...logicalInspectorMap({OCI:new Set([301309])},{authoringElement:{resolutionMethod:'standalone'}}).OCI],[301309]);
});
