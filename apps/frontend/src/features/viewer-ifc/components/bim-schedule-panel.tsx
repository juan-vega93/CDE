"use client";
import { useEffect, useRef, useState } from 'react';
import { bffFetch } from '@/services/bff-client';
import { scheduleBaseColumns,scheduleValues,scheduleCsv,type ScheduleConfiguration,type ScheduleRow,type ScheduleColumn } from '../lib/bim-schedule';
type Result={rows:ScheduleRow[];total:number;offset:number;limit:number;publication:string};
const endpoint='/api/bim-index/schedule/rows';
export function ScheduleTable({rows,columns,onSelect}:{rows:ScheduleRow[];columns:ScheduleColumn[];onSelect:(row:ScheduleRow)=>void}) {
  return <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr>{[...scheduleBaseColumns,...columns.map(c=>c.label)].map((c,i)=><th className="whitespace-nowrap p-2" key={i}>{c}</th>)}</tr></thead>
    <tbody>{rows.map(row=><tr className="border-t border-zinc-800" key={row.key}>{scheduleValues(row,columns).map((v,i)=><td className="max-w-[260px] truncate whitespace-nowrap p-2" title={v} key={i}>{i===2?<button title={row.identityKey} onClick={()=>onSelect(row)}>{v}</button>:v}</td>)}</tr>)}</tbody></table></div>;
}
export function BimSchedulePanel({projectCode,modelKeys,modelOptions=[],catalog,onSelect}:{projectCode?:string;modelKeys:string[];modelOptions?:{key:string;name:string}[];
  catalog:{sets:string[];propertiesBySet:Record<string,string[]>}|null;onSelect:(row:ScheduleRow)=>void}) {
  const [config,setConfig]=useState<ScheduleConfiguration>({version:1,columns:[],filters:{}});
  const [setName,setSetName]=useState(''),[propertyName,setPropertyName]=useState('');
  const [page,setPage]=useState(0),[data,setData]=useState<Result|null>(null),[loading,setLoading]=useState(false),[exporting,setExporting]=useState(false),[error,setError]=useState('');
  const receivedAt=useRef(0);
  const query=JSON.stringify({projectCode,modelKeys,columns:config.columns,filters:config.filters,offset:page*100,limit:100});
  useEffect(()=>{
    if(!projectCode)return;
    const abort=new AbortController();
    async function load(){setLoading(true);setError('');const started=performance.now();try{
      const response=await bffFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:query,signal:abort.signal});
      if(!response.ok)throw new Error(`Schedule HTTP ${response.status}`);
      const payload=await response.json();if(!payload.success)throw new Error('Respuesta de Schedule inválida');
      if(!abort.signal.aborted){receivedAt.current=performance.now();console.debug('[bim-schedule] response',JSON.stringify({httpAndParseMs:receivedAt.current-started,rows:payload.data.rows.length}));setData(payload.data);}
    }catch(e){if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Error de Schedule');}
    finally{if(!abort.signal.aborted)setLoading(false);}}
    void load();return()=>abort.abort();
  },[query,projectCode]);
  useEffect(()=>{if(data&&receivedAt.current)console.debug('[bim-schedule] response-to-commit',JSON.stringify({ms:performance.now()-receivedAt.current}));},[data]);
  function filter(key:string,value:string|boolean){setConfig(c=>({...c,filters:{...c.filters,[key]:value}}));setPage(0);}
  async function exportCsv(){
    setExporting(true);setError('');
    try {
      // Bounded pages, same configuration and logical row contract as the table.
      const rows:ScheduleRow[]=[];const snapshot=JSON.parse(query);let total=1,publication:string|undefined;
      for(let offset=0;offset<total;offset+=500){
        const response=await bffFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...snapshot,offset,limit:500})});
        if(!response.ok)throw new Error(`CSV HTTP ${response.status}`);
        const payload=await response.json();if(!payload.success)throw new Error('Exportación inválida');
        if(publication!==undefined&&publication!==payload.data.publication)throw new Error('El índice cambió durante la exportación; vuelve a exportar.');
        publication=payload.data.publication;total=payload.data.total;rows.push(...payload.data.rows);
      }
      const url=URL.createObjectURL(new Blob([scheduleCsv(rows,config.columns)],{type:'text/csv;charset=utf-8'}));
      const a=document.createElement('a');a.href=url;a.download='schedule-logico.csv';a.click();URL.revokeObjectURL(url);
    }catch(e){setError(e instanceof Error?e.message:'Error CSV');}finally{setExporting(false);}
  }
  return <section className="space-y-3 rounded border border-zinc-800 p-3 text-xs text-zinc-300" aria-label="Schedule BIM">
    <strong>Metrados · Tabla BIM por elemento de autoría</strong>
    <div className="flex flex-wrap gap-2">
      <select aria-label="Conjunto de columna" value={setName} onChange={e=>{setSetName(e.target.value);setPropertyName('');}} className="bg-zinc-900"><option value="">Conjunto</option>{catalog?.sets.filter(s=>!/^Qto_/i.test(s)).map(s=><option key={s}>{s}</option>)}</select>
      <select aria-label="Parámetro de columna" value={propertyName} onChange={e=>setPropertyName(e.target.value)} className="bg-zinc-900"><option value="">Parámetro</option>{catalog?.propertiesBySet[setName]?.map(p=><option key={p}>{p}</option>)}</select>
      <button disabled={!setName||!propertyName||config.columns.length>=24} onClick={()=>{const id=JSON.stringify([setName,propertyName]);setConfig(c=>c.columns.some(col=>col.id===id)?c:{...c,columns:[...c.columns,{id,label:`${setName}.${propertyName}`,source:'stored_parameter',setName,propertyName}]});}}>Agregar columna</button>
      <button disabled={loading||exporting||!data} onClick={()=>void exportCsv()}>{exporting?'Exportando…':'Exportar CSV'}</button>
    </div>
    <div className="flex flex-wrap gap-2">{config.columns.map(c=><button key={c.id} title="Quitar columna" onClick={()=>setConfig(s=>({...s,columns:s.columns.filter(col=>col.id!==c.id)}))}>{c.label} ×</button>)}</div>
    <details><summary>Filtros</summary><div className="flex flex-wrap gap-2 p-2">
      <label>Modelo<select aria-label="Modelo del Schedule" className="ml-1 bg-zinc-900" value={String(config.filters.modelKey??'')} onChange={e=>filter('modelKey',e.target.value)}><option value="">Todos</option>{modelOptions.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}</select></label>
      {[['logicalIfcClass','Clase IFC lógica'],['level','Nivel'],['sector','Sector'],['elementType','Tipo'],['partida','Partida'],['search','Buscar Metrados']].map(([key,label])=><label key={key}>{label}<input className="ml-1 bg-zinc-900 p-1" aria-label={label} value={String(config.filters[key]??'')} onChange={e=>filter(key,e.target.value)}/></label>)}
      <label><input type="checkbox" checked={config.filters.withoutPartida===true} onChange={e=>filter('withoutPartida',e.target.checked)}/>Sin Partida</label>
    </div></details>
    <p>{data?.total??0} elementos lógicos · Página {page+1}{loading?' · Cargando página…':''}</p>
    {error&&<p role="alert">{error}</p>}
    <ScheduleTable rows={data?.rows??[]} columns={config.columns} onSelect={onSelect}/>
    <div className="flex gap-3"><button disabled={!page||loading} onClick={()=>setPage(p=>p-1)}>Anterior</button><button disabled={loading||(page+1)*100>=(data?.total??0)} onClick={()=>setPage(p=>p+1)}>Siguiente</button></div>
  </section>;
}
