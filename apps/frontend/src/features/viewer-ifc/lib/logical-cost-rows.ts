import type { ViewerBimContext } from "./viewer-bim-context";
export type LogicalCostDetail = {
  key: string; context: ViewerBimContext; identityKey: string;
  representativeLocalId: number | null; memberLocalIds: number[]; graphicalLocalIds: number[];
  quantity: number | null; status: "resolved" | "ambiguous"; reason: string | null; replicaCount: number;
  logicalIfcClass?: string | null; sector?: string | null; elementType?: string | null; authoringElementId?: string | null;
};
export type LogicalCostGroup = {
  itemId: string; itemName: string; itemUnit: string; logicalRows?: LogicalCostDetail[];
  quantityPolicy?: string; consolidationError?: string;
  quantityProvenance?: { source: "stored_parameter"; declaration: "mapping"; sourceProperty: { setName: string; propertyName: string }; unitProperty: { setName: string; propertyName: string } };
};
/** Both table and export consume the exact same server observations, including conflicts. */
export function logicalCostTable(groups: LogicalCostGroup[]) {
  return groups.flatMap(group => (group.logicalRows ?? []).map(detail => ({ ...detail,
    quantityPolicy: group.quantityPolicy, itemId: group.itemId, itemName: group.itemName, itemUnit: group.itemUnit, quantityProvenance: group.quantityProvenance
  })));
}
export function logicalCostCsv(groups: LogicalCostGroup[]) {
  const escape = (value: unknown) => {
    let text = String(value ?? "");
    if (/^[=+@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"', '""')}"`;
  };
  const rows: unknown[][] = [["Partida", "Nombre", "Unidad", "Cantidad lógica almacenada", "Estado", "Conflicto",
    "Project", "ModelKey", "RevisionId", "AuthoringElement", "Representante", "IFC members", "Gráficos", "Réplicas", "Policy", "Source", "Source property", "Unit property", "Source evidence", "Sector", "ID elemento", "Tipo", "IFC Class lógica"]];
  for (const row of logicalCostTable(groups)) rows.push([row.itemId, row.itemName, row.itemUnit, row.quantity,
    row.status, row.reason, row.context.projectCode, row.context.modelKey, row.context.revisionId, row.identityKey,
    row.representativeLocalId, row.memberLocalIds.join("|"), row.graphicalLocalIds.join("|"), row.replicaCount, row.quantityPolicy ?? "stored-authoring-replicas@1", row.quantityProvenance?.source,
    row.quantityProvenance ? `${row.quantityProvenance.sourceProperty.setName}.${row.quantityProvenance.sourceProperty.propertyName}` : "",
    row.quantityProvenance ? `${row.quantityProvenance.unitProperty.setName}.${row.quantityProvenance.unitProperty.propertyName}` : "", row.quantityProvenance?.declaration,
    row.sector,row.authoringElementId,row.elementType,row.logicalIfcClass]);
  for (const group of groups) if (group.consolidationError) rows.push([group.itemId, group.itemName, group.itemUnit, "", "ambiguous", group.consolidationError]);
  return "\ufeff" + rows.map(row => row.map(escape).join(",")).join("\r\n");
}
