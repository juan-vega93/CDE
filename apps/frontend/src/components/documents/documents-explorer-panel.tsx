"use client";

import { useMemo, useState } from "react";
import { DocumentsExplorer } from "@/components/documents/documents-explorer";
import type { ExplorerRow } from "@/types/documents";

type DocumentsExplorerPanelProps = {
  rows: ExplorerRow[];
  currentPath: string;
  projectCode?: string;
};

export function DocumentsExplorerPanel({
  rows,
  currentPath,
  projectCode = ""
}: DocumentsExplorerPanelProps) {
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (!normalizedQuery) {
      return rows;
    }

    return rows.filter((row) => {
      const name = String(row.name || "").toLowerCase();
      return name.includes(normalizedQuery);
    });
  }, [rows, normalizedQuery]);

   return (
    <section className="mt-6 rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-slate-200 p-5 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            Explorador
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {filteredRows.length} elemento(s) visible(s)
          </p>
        </div>

        <div className="w-full md:max-w-sm">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre..."
            className="h-10 w-full rounded border border-slate-300 bg-white px-3 text-sm outline-none placeholder:text-slate-400 focus:border-red-600"
          />
        </div>
      </div>

      <DocumentsExplorer
        rows={filteredRows}
        currentPath={currentPath}
        projectCode={projectCode}
      />
    </section>
  );
}