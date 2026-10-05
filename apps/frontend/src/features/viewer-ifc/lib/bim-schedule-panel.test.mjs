import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
function compile(file,deps,globals={}) {
  const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,require:id=>{assert.ok(id in deps,id);return deps[id];},console,AbortController,performance,...globals});return exports;
}
const schedule=compile('./bim-schedule.ts',{});
const tick=async()=>{for(let n=0;n<8;n++)await new Promise(r=>setImmediate(r));};
function harness(){
  let cursor=0;const slots=[],effects=[],requests=[],downloads=[];
  const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],v=>{slots[i]=typeof v==='function'?v(slots[i]):v;}];},
    useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial});},
    useEffect(fn,deps){const i=cursor++;const prev=slots[i];if(!prev||deps.some((v,n)=>!Object.is(v,prev.deps[n]))){prev?.cleanup?.();slots[i]={deps};effects.push(()=>{slots[i].cleanup=fn();});}}};
  const panel=compile('../components/bim-schedule-panel.tsx',{'react':react,'react/jsx-runtime':jsx,'../lib/bim-schedule':schedule,
    '@/services/bff-client':{bffFetch:(_url,options)=>new Promise(resolve=>requests.push({body:JSON.parse(options.body),signal:options.signal,resolve}))}},
    {Blob,URL:{createObjectURL:blob=>{downloads.push(blob);return 'blob:test';},revokeObjectURL:()=>{}},document:{createElement:()=>({click(){}})}});
  let selected;
  const props={projectCode:'P',modelKeys:['/M.ifc'],catalog:{sets:['Custom','Qto_RoofBaseQuantities'],propertiesBySet:{Custom:['X','Y']}},onSelect:row=>{selected=row;}};
  function render(){cursor=0;const node=panel.BimSchedulePanel(props);effects.splice(0).forEach(f=>f());return node;}
  function nodes(node,result=[]){if(!node||typeof node!=='object')return result;if(Array.isArray(node)){node.forEach(n=>nodes(n,result));return result;}result.push(node);nodes(node.props?.children,result);return result;}
  const find=(tree,predicate)=>nodes(tree).find(predicate);
  const reply=(i,rows,total=300,publication='g1')=>requests[i].resolve({ok:true,json:async()=>({success:true,data:{rows,total,offset:requests[i].body.offset,limit:100,publication}})});
  return {render,requests,reply,find,downloads,selected:()=>selected};
}
test('real Schedule component keeps previous rows while pagination is pending; stale response ignored',async()=>{
  const h=harness();h.render();h.reply(0,[{key:'A'}]);await tick();let tree=h.render();
  const table=()=>h.find(tree,n=>n.type?.name==='ScheduleTable');assert.equal(table().props.rows[0].key,'A');
  h.find(tree,n=>n.type==='button'&&n.props.children==='Siguiente').props.onClick();tree=h.render();
  assert.equal(h.requests[1].body.offset,100);assert.equal(table().props.rows[0].key,'A');
  h.find(tree,n=>n.props?.['aria-label']==='Buscar Metrados').props.onChange({target:{value:'roof'}});tree=h.render();
  assert.equal(h.requests[1].signal.aborted,true);h.reply(1,[{key:'stale'}]);h.reply(2,[{key:'Roof'}]);await tick();tree=h.render();assert.equal(table().props.rows[0].key,'Roof');
});
test('column picker uses catalog; filters serialize independently of Partida mappings',async()=>{
  const h=harness();let tree=h.render();
  h.find(tree,n=>n.props?.['aria-label']==='Conjunto de columna').props.onChange({target:{value:'Custom'}});tree=h.render();
  h.find(tree,n=>n.props?.['aria-label']==='Parámetro de columna').props.onChange({target:{value:'X'}});tree=h.render();
  h.find(tree,n=>n.type==='button'&&n.props.children==='Agregar columna').props.onClick();tree=h.render();
  assert.equal(h.requests.at(-1).body.columns[0].propertyName,'X');assert.equal('itemId' in h.requests.at(-1).body,false);
  h.find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});h.render();
  assert.equal(h.requests.at(-1).body.filters.withoutPartida,true);
});

test('actual CSV action uses table configuration across bounded pages and rejects publication changes',async()=>{
  for(const changed of [false,true]){
    const h=harness();let tree=h.render();
    h.find(tree,n=>n.props?.['aria-label']==='Conjunto de columna').props.onChange({target:{value:'Custom'}});tree=h.render();
    h.find(tree,n=>n.props?.['aria-label']==='Parámetro de columna').props.onChange({target:{value:'X'}});tree=h.render();
    h.find(tree,n=>n.type==='button'&&n.props.children==='Agregar columna').props.onClick();tree=h.render();
    h.find(tree,n=>n.type==='input'&&n.props.type==='checkbox').props.onChange({target:{checked:true}});tree=h.render();
    const tableRequest=h.requests.at(-1).body,col=tableRequest.columns[0];
    const row={key:'roof',modelName:'M',logicalIfcClass:'IfcRoof',name:'Roof',elementType:'Type',level:'N01',cells:{[col.id]:{status:'resolved',value:'17.45'}}};
    h.reply(h.requests.length-1,[row],501);await tick();tree=h.render();
    const first=h.requests.length;h.find(tree,n=>n.type==='button'&&n.props.children==='Exportar CSV').props.onClick();
    assert.deepEqual(h.requests[first].body.columns,tableRequest.columns);assert.deepEqual(h.requests[first].body.filters,{withoutPartida:true});
    assert.equal(h.requests[first].body.limit,500);h.reply(first,[row],501);await tick();
    assert.equal(h.requests[first+1].body.offset,500);h.reply(first+1,[{...row,key:'other',name:'Other'}],501,changed?'g2':'g1');await tick();
    if(changed){assert.equal(h.downloads.length,0);tree=h.render();assert.match(h.find(tree,n=>n.props?.role==='alert').props.children,/índice cambió/);}
    else {assert.equal(h.downloads.length,1);const csv=await h.downloads[0].text();assert.match(csv,/Custom.X/);assert.match(csv,/17.45/);assert.equal(csv.split('\r\n').length,3);}
  }
});

for(const page of [1,20,70])test(`page ${page}: row selection retains logical identity, export starts at zero and includes ALL filtered rows`,async()=>{
  const h=harness();h.render();const total=7100;
  const row=n=>({key:`logical-${n}`,identityKey:`entity:${n+1}`,context:{projectCode:'P',modelKey:'/M.ifc',revisionId:'sha256:r'},memberLocalIds:[n+1],graphicalLocalIds:[n+1],representativeLocalId:n+1,modelName:'M',name:`Element ${n}`,partida:null,cells:{}});
  h.reply(0,[row(0)],total);await tick();let tree=h.render();
  for(let p=1;p<page;p++){h.find(tree,n=>n.type==='button'&&n.props.children==='Siguiente').props.onClick();tree=h.render();h.reply(h.requests.length-1,[row(p*100)],total);await tick();tree=h.render();}
  const table=h.find(tree,n=>n.type?.name==='ScheduleTable');table.props.onSelect(table.props.rows[0]);
  assert.equal(h.selected().identityKey,`entity:${(page-1)*100+1}`);assert.deepEqual(h.selected().graphicalLocalIds,[(page-1)*100+1]);
  const first=h.requests.length;h.find(tree,n=>n.type==='button'&&n.props.children==='Exportar CSV').props.onClick();
  assert.equal(h.requests[first].body.offset,0);
  for(let offset=0;offset<total;offset+=500){const index=h.requests.length-1;assert.equal(h.requests[index].body.offset,offset);h.reply(index,Array.from({length:Math.min(500,total-offset)},(_,i)=>row(offset+i)),total);await tick();}
  assert.equal(h.downloads.length,1);const csv=await h.downloads[0].text();assert.equal(csv.split('\r\n').length,total+1);
  assert.equal(new Set(csv.split('\r\n').slice(1)).size,total);
});

for(const total of [237,4784])test(`filtered CSV includes ${total} rows from page two with active search`,async()=>{
  const h=harness();let tree=h.render();
  h.find(tree,n=>n.props?.['aria-label']==='Buscar Metrados').props.onChange({target:{value:'Floor'}});tree=h.render();
  const row=i=>({key:`ae-${i}`,name:`Floor ${i}`,modelName:'M',cells:{}});
  h.reply(h.requests.length-1,[row(0)],total);await tick();tree=h.render();
  h.find(tree,n=>n.type==='button'&&n.props.children==='Siguiente').props.onClick();tree=h.render();
  h.reply(h.requests.length-1,[row(100)],total);await tick();tree=h.render();
  h.find(tree,n=>n.type==='button'&&n.props.children==='Exportar CSV').props.onClick();
  for(let offset=0;offset<total;offset+=500){const index=h.requests.length-1;assert.equal(h.requests[index].body.offset,offset);
    assert.deepEqual(h.requests[index].body.filters,{search:'Floor'});
    h.reply(index,Array.from({length:Math.min(500,total-offset)},(_,i)=>row(offset+i)),total);await tick();}
  assert.equal((await h.downloads[0].text()).split('\r\n').length,total+1);
});
