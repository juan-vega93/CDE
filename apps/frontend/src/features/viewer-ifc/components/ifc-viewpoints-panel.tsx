"use client";

import { useState } from "react";
import type { ViewerViewpoint } from "@/features/viewer-ifc/types/viewpoint";

type IfcViewpointsPanelProps = {
  viewpoints: ViewerViewpoint[];
  onApplyViewpoint: (viewpoint: ViewerViewpoint) => void | Promise<void>;
  onRenameViewpoint: (viewpointId: string, nextName: string) => void;
  onDeleteViewpoint: (viewpointId: string) => void;
};

export function IfcViewpointsPanel({
  viewpoints,
  onApplyViewpoint,
  onRenameViewpoint,
  onDeleteViewpoint
}: IfcViewpointsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  function startEditing(viewpoint: ViewerViewpoint) {
    setEditingId(viewpoint.id);
    setDraftName(viewpoint.name);
  }

  function cancelEditing() {
    setEditingId(null);
    setDraftName("");
  }

  function saveEditing(viewpointId: string) {
    const nextName = draftName.trim();
    if (!nextName) return;

    onRenameViewpoint(viewpointId, nextName);
    cancelEditing();
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col border border-zinc-300 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-300 bg-zinc-100 px-3 py-2">
        <h3 className="text-sm font-semibold text-zinc-800">Viewpoints</h3>
        <span className="text-xs text-zinc-500">{viewpoints.length}</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {viewpoints.length === 0 ? (
          <p className="text-sm text-zinc-500">Aún no hay vistas guardadas.</p>
        ) : (
          <div className="space-y-2">
            {viewpoints.map((viewpoint, index) => {
              const isEditing = editingId === viewpoint.id;

              return (
                <div
                  key={viewpoint.id}
                  className="min-w-0 border border-zinc-300 bg-zinc-50 p-2"
                >
                  <div className="flex flex-col gap-2">
                    {isEditing ? (
                      <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        className="min-h-9 w-full border border-zinc-300 px-2 py-2 text-sm text-zinc-800 outline-none"
                        autoFocus
                      />
                    ) : (
                      <p className="min-w-0 text-sm font-medium leading-5 text-zinc-800 [overflow-wrap:anywhere]">
                        {viewpoint.name || `Vista ${index + 1}`}
                      </p>
                    )}

                    <div className="flex min-w-0 flex-wrap gap-2">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            onClick={() => saveEditing(viewpoint.id)}
                            className="min-h-8 border border-zinc-300 bg-white px-2.5 py-1 text-xs leading-tight text-zinc-700 hover:bg-zinc-50"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditing}
                            className="min-h-8 border border-zinc-300 bg-white px-2.5 py-1 text-xs leading-tight text-zinc-700 hover:bg-zinc-50"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onApplyViewpoint(viewpoint)}
                            className="min-h-8 border border-zinc-300 bg-white px-2.5 py-1 text-xs leading-tight text-zinc-700 hover:bg-zinc-50"
                          >
                            Aplicar
                          </button>
                          <button
                            type="button"
                            onClick={() => startEditing(viewpoint)}
                            className="min-h-8 border border-zinc-300 bg-white px-2.5 py-1 text-xs leading-tight text-zinc-700 hover:bg-zinc-50"
                          >
                            Renombrar
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeleteViewpoint(viewpoint.id)}
                            className="min-h-8 border border-red-300 bg-white px-2.5 py-1 text-xs leading-tight text-red-700 hover:bg-red-50"
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
