"use client";

import { useMemo, useState } from "react";
import { DocumentsExplorer } from "@/components/documents/documents-explorer";
import type { ExplorerRow } from "@/types/documents";

type DocumentsExplorerPanelProps = {
  rows: ExplorerRow[];
  currentPath: string;
};

export function DocumentsExplorerPanel({
  rows,
  currentPath
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
    <div className="mt-6">
      <div className="rounded-xl border bg-white p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-gray-900">Explorador</p>
            <p className="mt-1 text-sm text-gray-600">
              {filteredRows.length} elemento(s) visible(s)
            </p>
          </div>

          <div className="w-full md:max-w-sm">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por nombre..."
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none placeholder:text-gray-400 focus:border-blue-400"
            />
          </div>
        </div>
      </div>

      <DocumentsExplorer rows={filteredRows} currentPath={currentPath} />
    </div>
  );
}