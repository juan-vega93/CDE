"use client";

import { useMemo, useState } from "react";

type ToolbarGroup = "view" | "selection" | "color" | "cut" | "coordination";

type IfcViewerToolbarProps = {
  onIsolateSelection: () => void | Promise<void>;
  onToggleSelection: () => void | Promise<void>;
  onShowAll: () => void | Promise<void>;
  onFitModel: () => void | Promise<void>;
  onFocusSelection: () => void | Promise<void>;
  onResetView: () => void | Promise<void>;
  onSaveViewpoint: () => void;
  onCreateAnnotation: () => void;
  onCreateMeasurement: () => void;
  onCreateRevisionCloud: () => void;
  onClearAnnotations: () => void;

  onToggleClipper: () => void;
  onDeleteClippingPlanes: () => void;
  onCreateSelectionSectionBox: () => void;
  onClearSelectionSectionBox: () => void;

  onApplySelectionColor: () => void;
  onRestoreSelectionColor: () => void;
  onSelectedColorChange: (value: string) => void;

  onSectionBoxPaddingChange: (value: number) => void;
  onClearMeasurements: () => void;

  clipperEnabled: boolean;
  hasSelection: boolean;
  selectedColor: string;
  sectionBoxPadding: number;
};

type GroupButton = {
  id: ToolbarGroup;
  label: string;
  icon: string;
};

export function IfcViewerToolbar({
  onIsolateSelection,
  onToggleSelection,
  onShowAll,
  onFitModel,
  onFocusSelection,
  onResetView,
  onSaveViewpoint,
  onCreateAnnotation,
  onClearAnnotations,
  onCreateMeasurement,
  onClearMeasurements,
  onCreateRevisionCloud,
  onToggleClipper,
  onDeleteClippingPlanes,
  onCreateSelectionSectionBox,
  onClearSelectionSectionBox,
  onApplySelectionColor,
  onRestoreSelectionColor,
  onSelectedColorChange,
  onSectionBoxPaddingChange,
  clipperEnabled,
  hasSelection,
  selectedColor,
  sectionBoxPadding
}: IfcViewerToolbarProps) {
  const [activeGroup, setActiveGroup] = useState<ToolbarGroup>("view");

  const groups: GroupButton[] = [
    { id: "view", label: "Vista", icon: "⌖" },
    { id: "selection", label: "Selección", icon: "▣" },
    { id: "color", label: "Color", icon: "⬛" },
    { id: "cut", label: "Corte", icon: "✂" },
    { id: "coordination", label: "Coord.", icon: "✎" }
  ];

  const groupButtonClass =
    "flex h-10 min-w-[92px] items-center justify-center gap-2 border-r border-zinc-300 px-3 text-sm";

  const actionButtonClass =
    "h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45";

  const actions = useMemo(() => {
    if (activeGroup === "view") {
      return (
        <>
          <button type="button" className={actionButtonClass} onClick={onFitModel}>
            Ajustar modelo
          </button>
          <button
            type="button"
            className={actionButtonClass}
            onClick={onFocusSelection}
            disabled={!hasSelection}
          >
            Enfocar selección
          </button>
          <button type="button" className={actionButtonClass} onClick={onResetView}>
            Reset
          </button>
          <button type="button" className={actionButtonClass} onClick={onSaveViewpoint}>
            Guardar vista
          </button>
        </>
      );
    }

    if (activeGroup === "selection") {
      return (
        <>
          
          <button
            type="button"
            className={actionButtonClass}
            onClick={onIsolateSelection}
            disabled={!hasSelection}
            title="Aislar selección"
          >
            Aislar
          </button>

          <button
            type="button"
            className={actionButtonClass}
            onClick={onToggleSelection}
            disabled={!hasSelection}
            title="Ocultar / mostrar selección"
          >
            Ojo
          </button>

          <button type="button" className={actionButtonClass} onClick={onShowAll}>
            Mostrar todo
          </button>
        </>
      );
    }

    if (activeGroup === "color") {
      return (
        <>
          <label className="flex h-9 items-center gap-2 border border-zinc-300 bg-white px-3 text-sm text-zinc-700">
            <span>Color</span>
            <input
              type="color"
              value={selectedColor}
              onChange={(event) => onSelectedColorChange(event.target.value)}
              disabled={!hasSelection}
              className="h-6 w-8 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
              title="Elegir color"
            />
          </label>

          <button
            type="button"
            className={actionButtonClass}
            onClick={onApplySelectionColor}
            disabled={!hasSelection}
          >
            Aplicar color
          </button>

          <button
            type="button"
            className={actionButtonClass}
            onClick={onRestoreSelectionColor}
          >
            Restaurar color
          </button>

          <div className="flex h-9 items-center gap-2 border border-zinc-300 bg-zinc-50 px-3 text-sm text-zinc-600">
            <span>Muestra</span>
            <span
              className="inline-block h-4 w-4 border border-zinc-400"
              style={{ backgroundColor: selectedColor }}
            />
            <span>{selectedColor}</span>
          </div>
        </>
      );
    }

    if (activeGroup === "coordination") {
      return (
        <>
          <button
            type="button"
            className={actionButtonClass}
            onClick={onCreateAnnotation}
          >
            Anotación 3D
          </button>
          <button
            type="button"
            className={actionButtonClass}
            onClick={onClearAnnotations}
          >
            Limpiar anotaciones
          </button>

          <button
            type="button"
            className={actionButtonClass}
            onClick={onCreateMeasurement}
          >
            Medición
          </button>
          <button
            type="button"
            className={actionButtonClass}
            onClick={onClearMeasurements}
          >
            Limpiar medidas
          </button>

          <button
            type="button"
            className={actionButtonClass}
            onClick={onCreateRevisionCloud}
          >
            Nube
          </button>
        </>
      );
    }
    
    

    return (
      <>
        <button
          type="button"
          className={actionButtonClass}
          onClick={onCreateSelectionSectionBox}
          disabled={!hasSelection}
        >
          Caja de sección
        </button>
        <button
          type="button"
          className={actionButtonClass}
          onClick={onClearSelectionSectionBox}
        >
          Limpiar caja
        </button>
        <button
          type="button"
          className={`${actionButtonClass} ${
            clipperEnabled ? "border-blue-600 bg-blue-50 text-blue-700" : ""
          }`}
          onClick={onToggleClipper}
        >
          {clipperEnabled ? "Corte activo" : "Activar corte"}
        </button>
        <button
          type="button"
          className={actionButtonClass}
          onClick={onDeleteClippingPlanes}
        >
          Borrar cortes
        </button>

        <div className="flex min-w-[280px] items-center gap-3 border border-zinc-300 bg-zinc-50 px-3 py-2">
          <span className="text-sm text-zinc-600">Margen</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={sectionBoxPadding}
            onChange={(event) =>
              onSectionBoxPaddingChange(Number(event.target.value))
            }
            className="w-full"
          />
          <span className="w-12 text-right text-sm text-zinc-700">
            {sectionBoxPadding.toFixed(2)}
          </span>
        </div>
      </>
    );
  }, [
    activeGroup,
    actionButtonClass,
    clipperEnabled,
    hasSelection,
    onApplySelectionColor,
    onClearSelectionSectionBox,
    onCreateSelectionSectionBox,
    onDeleteClippingPlanes,
    onFitModel,
    onFocusSelection,
    onIsolateSelection,
    onResetView,
    onRestoreSelectionColor,
    onSaveViewpoint,
    onSectionBoxPaddingChange,
    onSelectedColorChange,
    onShowAll,
    onToggleClipper,
    onToggleSelection,
    sectionBoxPadding,
    selectedColor,
    onCreateAnnotation,
    onClearAnnotations,    
    onCreateMeasurement,
    onCreateRevisionCloud,
    onClearMeasurements,
  ]);

  return (
    <div className="mb-3 border border-zinc-300 bg-white">
      <div className="flex flex-wrap border-b border-zinc-300 bg-zinc-100">
        {groups.map((group) => {
          const isActive = activeGroup === group.id;

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroup(group.id)}
              className={`${groupButtonClass} ${
                isActive
                  ? "bg-white text-zinc-900"
                  : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
              }`}
            >
              <span aria-hidden="true">{group.icon}</span>
              <span>{group.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-2 p-3">{actions}</div>
    </div>
  );
}