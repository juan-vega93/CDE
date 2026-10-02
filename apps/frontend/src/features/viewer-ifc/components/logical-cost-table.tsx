import { logicalCostTable, type LogicalCostGroup, type LogicalCostDetail } from "../lib/logical-cost-rows";
import { useState } from "react";

export function LogicalCostTable({ groups, onSelect, onExport }: {
  groups: LogicalCostGroup[];
  onSelect: (detail: LogicalCostDetail, group: LogicalCostGroup) => void;
  onExport: () => void;
}) {
  const [page, setPage] = useState(0);
  const rows = logicalCostTable(groups);
  const pages = Math.max(1, Math.ceil(rows.length / 100));
  const currentPage = Math.min(page, pages - 1);
  return <section className="rounded border border-zinc-800 p-3 text-xs text-zinc-300">
    <div className="flex justify-between"><strong>Metrados por elemento de autoría</strong>
      <button onClick={onExport} className="rounded bg-zinc-800 px-3 py-1">CSV lógico</button></div>
    <p className="my-2">Parámetro almacenado · {rows.length} filas lógicas. Configura propiedad y unidad en Partidas.
      Las cantidades pendientes no se sustituyen por cero.</p>
    <div className="my-2 flex gap-3"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Anterior</button>
      <span>{currentPage + 1} / {pages}</span><button disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Siguiente</button>
      <span>CSV: todas las filas recibidas</span></div>
    {groups.filter(g => g.consolidationError).map(g => <p key={`${g.itemId}:${g.itemUnit}`} className="text-amber-300">{g.itemId}: {g.consolidationError}</p>)}
    <div className="max-h-96 overflow-auto"><table className="w-full text-left"><thead><tr>
      <th>Partida / Autoría</th><th>Cantidad</th><th>IFC / Gráficos</th>
    </tr></thead><tbody>{rows.slice(currentPage * 100, (currentPage + 1) * 100).map(row => <tr key={`${row.itemId}:${row.itemName}:${row.itemUnit}:${row.key}`} className="border-t border-zinc-800">
      <td><button className="py-2 text-left" onClick={() => onSelect(row, row)}>{row.itemId}<br />{row.identityKey}</button></td>
      <td title={row.reason ?? `${row.replicaCount} réplicas; representante ${row.representativeLocalId}`}>
        {row.quantity === null ? `Pendiente: ${row.reason}` : `${row.quantity.toLocaleString("es-PE", { maximumFractionDigits: 3 })} ${row.itemUnit}`}</td>
      <td>{row.memberLocalIds.length} / {row.graphicalLocalIds.length}</td>
    </tr>)}</tbody></table></div>
  </section>;
}
