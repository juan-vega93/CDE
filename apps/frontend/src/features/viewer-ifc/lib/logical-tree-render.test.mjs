import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';

test('actual tree rows reveal selection once; collapsed members do not render on unrelated updates',()=>{
  const source=ts.createSourceFile('canvas.tsx',fs.readFileSync(new URL('../components/ifc-viewer-canvas.tsx',import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const declaration=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='ModelTreeRows');
  assert.ok(declaration);
  const ref={current:null};let deps,effect,scrolls=0;
  const exports={};
  vm.runInNewContext(ts.transpileModule(`${declaration.getText(source)}\nexports.Rows=ModelTreeRows;`,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:()=>jsx,PanelIcon:()=>null,useRef:()=>ref,
    useEffect(fn,next){if(!deps||next.some((v,i)=>v!==deps[i])){effect=fn;deps=next;}},
  });
  const root={id:'roof',localId:1,name:'Roof',type:'IfcRoof',depth:0,children:[{id:'child',localId:2,name:'Slab',type:'IfcSlab',depth:1,children:[]}]};
  const props={nodes:[root],selectedNodeId:'roof',expandedNodes:new Set(['roof']),hiddenNodeIds:new Set(),onToggleNode:()=>props.expandedNodes.delete('roof')};
  function nodes(n,result=[]){if(!n||typeof n!=='object')return result;if(Array.isArray(n)){n.forEach(c=>nodes(c,result));return result;}result.push(n);nodes(n.props?.children,result);return result;}
  function render(){const tree=nodes(exports.Rows(props));ref.current=tree.some(n=>n.props?.ref===ref)?{scrollIntoView(){scrolls++;}}:null;const pending=effect;effect=undefined;pending?.();return tree;}
  let tree=render();assert.equal(scrolls,1);assert.ok(tree.some(n=>n.type===exports.Rows));
  tree.find(n=>n.props?.['aria-label']==='Colapsar').props.onClick();
  for(let i=0;i<100;i++){tree=render();assert.equal(tree.some(n=>n.type===exports.Rows),false);}
  assert.equal(scrolls,1,'ordinary renders do not recenter or reopen collapsed nodes');
  props.selectedNodeId=undefined;render();props.selectedNodeId='roof';render();assert.equal(scrolls,2);
});
