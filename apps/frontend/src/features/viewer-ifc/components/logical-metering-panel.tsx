"use client";
import { useEffect, useState } from 'react';
import { bffFetch } from '@/services/bff-client';
import { logicalCostCsv, type LogicalCostDetail, type LogicalCostGroup } from '../lib/logical-cost-rows';

type Row = LogicalCostDetail & Omit<LogicalCostGroup,'logicalRows'>;
type Result = {rows:Row[];total:number;quantity:number|null;offset:number;limit:number;
  options:{partidas:string[];sectors:string[];classes:string[]};errors:{itemId:string;error:string}[]};
const endpoint='/api/bim-index/cost5d/logical-metering-rows';

/** Layout-independent table: data and actions only, reusable in a future workspace. */
export function LogicalMeteringTable({rows,onSelect}:{rows:Row[];onSelect:(detail:LogicalCostDetail,group:LogicalCostGroup)=>void}) {
  return <div className="overflow-auto"><table className="w-full text-left text-xs"><thead><tr>
    {['Partida','Sector','ID elemento','Tipo','IFC Class lógica','AuthoringElement','Miembros','Geometrías','Metrado','Unidad','Estado','Root/representante'].map(c=><th className="whitespace-nowrap p-2" key={c}>{c}</th>)}
  </tr></thead><tbody>{rows.map(row=><tr className="border-t border-zinc-800" key={`${row.itemId}:${row.itemUnit}:${row.itemName}:${row.key}`}>
    <td className="p-2"><button onClick={()=>onSelect(row,row)}>{row.itemId}</button></td><td>{row.sector??'-'}</td><td>{row.authoringElementId??'-'}</td>
    <td>{row.elementType??'-'}</td><td>{row.logicalIfcClass??'-'}</td><td><button onClick={()=>onSelect(row,row)}>{row.identityKey}</button></td>
    <td>{row.memberLocalIds.length}</td><td>{row.graphicalLocalIds.length}</td><td>{row.quantity===null?'Pendiente':row.quantity.toLocaleString('es-PE',{maximumFractionDigits:3})}</td>
    <td>{row.itemUnit}</td><td title={row.reason??''}>{row.status}</td><td>{row.representativeLocalId??'-'}</td>
  </tr>)}</tbody></table></div>;
}

export function LogicalMeteringPanel({request,onSelect}:{request:Record<string,unknown>;onSelect:(detail:LogicalCostDetail,group:LogicalCostGroup)=>void}) {
  const [filters,setFilters]=useState({partida:'',sector:'',logicalIfcClass:'',search:''});
  const [page,setPage]=useState(0),[data,setData]=useState<Result|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const query=JSON.stringify({...request,...filters,limit:100,offset:page*100});
  useEffect(()=>{
    const controller=new AbortController();
    async function load() {
      setLoading(true); setError('');
      try {
        const response=await bffFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:query,signal:controller.signal});
        if(!response.ok) throw new Error(`Metrados HTTP ${response.status}`);
        const payload=await response.json();
        if(!payload.success) throw new Error('Respuesta de Metrados inválida');
        if(!controller.signal.aborted) setData(payload.data);
      } catch(error) {if(!controller.signal.aborted) setError(error instanceof Error?error.message:'No se pudieron cargar Metrados');}
      finally {if(!controller.signal.aborted) setLoading(false);}
    }
    void load(); return ()=>controller.abort();
  },[query]);
  async function exportCsv() {
    try {
      const response=await bffFetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...JSON.parse(query),exportAll:true})});
      if(!response.ok) throw new Error(`CSV HTTP ${response.status}`);
      const payload=await response.json() as {success:boolean;data:Result};
      if(!payload.success) throw new Error('Exportación inválida');
      const groups:LogicalCostGroup[]=payload.data.rows.map(row=>({...row,logicalRows:[row]}));
      groups.push(...payload.data.errors.map(row=>({itemId:row.itemId,itemName:'',itemUnit:'',consolidationError:row.error})));
      const url=URL.createObjectURL(new Blob([logicalCostCsv(groups)],{type:'text/csv;charset=utf-8'}));
      const link=document.createElement('a');link.href=url;link.download='metrados-logicos.csv';link.click();URL.revokeObjectURL(url);
    } catch(error) {setError(error instanceof Error?error.message:'No se pudo exportar');}
  }
  return <section className="space-y-3 rounded border border-zinc-800 p-3 text-xs text-zinc-300">
    <strong>Metrados por elemento de autoría</strong>
    <div className="flex flex-wrap gap-2">{([
      ['partida','Partida',data?.options.partidas],['sector','Sector',data?.options.sectors],['logicalIfcClass','Clase IFC lógica',data?.options.classes]
    ] as const).map(([key,label,options])=><label key={key}>{label}<select aria-label={label} className="ml-2 bg-zinc-900" value={filters[key]} onChange={e=>{setFilters({...filters,[key]:e.target.value});setPage(0);}}><option value="">Todas</option>{options?.map(v=><option key={v}>{v}</option>)}</select></label>)}
    <input aria-label="Buscar Metrados" className="bg-zinc-900 p-1" placeholder="Buscar" value={filters.search} onChange={e=>{setFilters({...filters,search:e.target.value});setPage(0);}} />
    <button onClick={()=>void exportCsv()} disabled={loading||!data}>CSV lógico filtrado</button></div>
    <p>{data?.total??0} filas lógicas · Suma: {data?.quantity==null?'Pendiente':data.quantity.toLocaleString('es-PE',{maximumFractionDigits:3})} {loading?'· Actualizando…':''}</p>
    {error&&<p role="alert">{error}</p>}{data?.errors.map(e=><p key={e.itemId}>{e.itemId}: {e.error}</p>)}
    <LogicalMeteringTable rows={data?.rows??[]} onSelect={onSelect}/>
    <div className="flex gap-3"><button disabled={!page||loading} onClick={()=>setPage(page-1)}>Anterior</button><span>{page+1}</span><button disabled={loading||(page+1)*100>=(data?.total??0)} onClick={()=>setPage(page+1)}>Siguiente</button></div>
  </section>;
}
