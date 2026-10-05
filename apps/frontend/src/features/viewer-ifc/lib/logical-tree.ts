/** Projection of the existing spatial hierarchy, never another IFC parser. */
export type LogicalTreeNode = {
  id: string; name: string; type: string; depth: number; localId?: number;
  children: LogicalTreeNode[]; aggregateLocalIds?: number[];
  memberInspection?: boolean; logicalKey?: string;
};
export type TreeComposition = {
  identityKey: string; rootLocalId: number; name: string; ifcClass: string;
  authoringElementId: string | null; memberLocalIds: number[]; graphicalLocalIds: number[];
};

export function projectLogicalTree(nodes: LogicalTreeNode[], compositions: TreeComposition[]): LogicalTreeNode[] {
  const byMember = new Map<number, TreeComposition>(), original = new Map<number, LogicalTreeNode>();
  const visit = (items: LogicalTreeNode[]) => items.forEach(n => { if(n.localId) original.set(n.localId,n); visit(n.children); });
  visit(nodes);
  for(const c of compositions) for(const id of c.memberLocalIds) byMember.set(id,c);
  const emitted = new Set<string>();
  function project(items: LogicalTreeNode[], depth: number): LogicalTreeNode[] {
    return items.flatMap(n => {
      const c = n.localId ? byMember.get(n.localId) : undefined;
      if(!c) return [{...n,depth,children:project(n.children,depth+1)}];
      if(emitted.has(c.identityKey)) return [];
      emitted.add(c.identityKey);
      return [{id:`authoring:${c.identityKey}`,name:`${c.name || c.ifcClass} — ID ${c.authoringElementId ?? c.rootLocalId} · ${c.memberLocalIds.length} miembros / ${c.graphicalLocalIds.length} geometrías`,
        type:c.ifcClass,depth,
        localId:c.rootLocalId,logicalKey:c.identityKey,aggregateLocalIds:c.graphicalLocalIds,
        children:c.memberLocalIds.filter(id=>id!==c.rootLocalId).map(id=>({
          id:`authoring:${c.identityKey}:member:${id}`,name:original.get(id)?.name ?? `Miembro IFC #${id}`,
          type:original.get(id)?.type ?? 'IFC member',depth:depth+1,localId:id,memberInspection:true,children:[]
        }))}];
    });
  }
  return project(nodes,0);
}

/** User overrides always win over defaults and one-shot selection reveals. */
export function treeExpansion(defaults: Iterable<string>, revealed: Iterable<string>, user: ReadonlyMap<string, boolean>) {
  const expanded = new Set([...defaults,...revealed]);
  for(const [id,value] of user) { if(value) expanded.add(id); else expanded.delete(id); }
  return expanded;
}
export function treeSelectionPath(nodes: LogicalTreeNode[], localIds: ReadonlySet<number>, logical = false): string[] {
  for(const n of nodes) {
    if(logical && n.logicalKey && n.aggregateLocalIds?.some(id=>localIds.has(id))) return [n.id];
    if(n.localId && localIds.has(n.localId)) return [n.id];
    const child = treeSelectionPath(n.children,localIds,logical);
    if(child.length) return [n.id,...child];
  }
  return [];
}
