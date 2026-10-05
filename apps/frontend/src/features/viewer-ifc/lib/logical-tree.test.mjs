import test from 'node:test';
import assert from 'node:assert/strict';
import { projectLogicalTree, treeExpansion, treeSelectionPath } from './logical-tree.ts';
const slab={id:'slab',name:'Slab',type:'IfcSlab',depth:1,localId:389463,children:[]};
const spatial=[{id:'level',name:'Level',type:'IfcBuildingStorey',depth:0,children:[slab]}];
const roof={identityKey:'aggregate:389468',rootLocalId:389468,name:'Roof',ifcClass:'IfcRoof',authoringElementId:'2161482',memberLocalIds:[389463,389468],graphicalLocalIds:[389463]};
test('missing graphical root projects at spatial member position; member inspection is explicit',()=>{
  const tree=projectLogicalTree(spatial,[roof]);const node=tree[0].children[0];
  assert.equal(node.localId,389468);assert.deepEqual(node.aggregateLocalIds,[389463]);
  assert.equal(node.children[0].memberInspection,true);assert.equal(node.children[0].localId,389463);
  assert.equal(spatial[0].children[0],slab,'source tree is immutable');
  assert.deepEqual(treeSelectionPath(tree,new Set([389468])),['level','authoring:aggregate:389468']);
});
test('collapse overrides initial expansion and repeated selection reveal after React updates',()=>{
  const user=new Map();let expanded=treeExpansion(['level'],['level','roof'],user);
  assert.ok(expanded.has('roof'));user.set('roof',false);user.set('level',false);
  for(let n=0;n<5;n++){expanded=treeExpansion(['level'],['level','roof'],user);assert.equal(expanded.size,0);}
  user.set('roof',true);assert.ok(treeExpansion([],[],user).has('roof'));
});
test('large composition appears once even when multiple spatial members are present',()=>{
  const ids=Array.from({length:73},(_,i)=>209790+i);
  const c={...roof,identityKey:'aggregate:209862',rootLocalId:209862,memberLocalIds:ids,graphicalLocalIds:ids.slice(0,-1)};
  const tree=projectLogicalTree([{...spatial[0],children:ids.map(localId=>({...slab,localId}))}],[c]);
  assert.equal(tree[0].children.length,1);assert.equal(tree[0].children[0].children.length,72);
});

test('real rootless export split appears once and both graphical members remain inspectable',()=>{
  const c={...roof,identityKey:'export-split:173301',rootLocalId:null,representativeLocalId:173301,authoringElementId:'1020025',memberLocalIds:[173301,173302],graphicalLocalIds:[173301,173302]};
  const tree=projectLogicalTree([{...spatial[0],children:c.memberLocalIds.map(localId=>({...slab,localId}))}],[c]);
  assert.equal(tree[0].children.length,1);const logical=tree[0].children[0];
  assert.equal(logical.localId,173301);assert.deepEqual(logical.aggregateLocalIds,[173301,173302]);
  assert.deepEqual(logical.children.map(n=>[n.localId,n.memberInspection]),[[173301,true],[173302,true]]);
  assert.deepEqual(treeSelectionPath(tree,new Set([173302]),true),['level','authoring:export-split:173301']);
});
