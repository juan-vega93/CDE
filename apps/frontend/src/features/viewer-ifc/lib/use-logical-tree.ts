"use client";
import { useEffect, useState } from 'react';
import { bffFetch } from '@/services/bff-client';
import type { ViewerBimContext } from './viewer-bim-context';
import type { TreeComposition } from './logical-tree';

export function useLogicalTree(models: {key:string;bimContext?:ViewerBimContext}[]) {
  const query=JSON.stringify(models.filter(m=>m.bimContext).map(m=>({key:m.key,context:m.bimContext!})));
  const [state,setState]=useState<{query:string;data:Record<string,TreeComposition[]>}>({query:'',data:{}});
  useEffect(()=>{
    const abort=new AbortController();
    const requested=JSON.parse(query) as {key:string;context:ViewerBimContext}[];
    void Promise.all(requested.map(async ({key,context})=>{
      const response=await bffFetch(`/api/bim-index/authoring/tree?${new URLSearchParams(context)}`,{signal:abort.signal});
      if(!response.ok) throw new Error(`Árbol lógico HTTP ${response.status}`);
      const payload=await response.json();
      if(!payload.success || JSON.stringify(payload.context)!==JSON.stringify(context)) throw new Error('Tree revision mismatch');
      return [key,payload.data] as const;
    })).then(entries=>{if(!abort.signal.aborted)setState({query,data:Object.fromEntries(entries)});})
      .catch(error=>{if(!abort.signal.aborted)console.warn('[viewer-ifc] Logical tree unavailable',error);});
    return ()=>abort.abort();
  },[query]);
  return state.query===query?state.data:{};
}
