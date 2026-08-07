"use client";

import { useState } from "react";

export type ViewerSnapConfig = {
  point: boolean;
  edge: boolean;
  face: boolean;
};

type IfcViewerToolbarProps = {
  onIsolateSelection: () => void | Promise<void>;
  onToggleSelection: () => void | Promise<void>;
  onToggleGhostSelection: () => void | Promise<void>;
  onShowAll: () => void | Promise<void>;
  onFitModel: () => void | Promise<void>;
  onFocusSelection: () => void | Promise<void>;
  onResetView: () => void | Promise<void>;
  onSaveViewpoint: () => void;
  onCreateAnnotation: () => void;
  onCreateDistanceMeasurement: () => void;
  onCreateAreaMeasurement: () => void;
  onFinishAreaMeasurement: () => void;
  onMeasureSelectionArea: () => void | Promise<void>;
  onMeasureSelectionVolume: () => void | Promise<void>;
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
  onSnapConfigChange: (value: ViewerSnapConfig) => void;
  onClearMeasurements: () => void;
  clipperEnabled: boolean;
  hasSelection: boolean;
  selectedColor: string;
  sectionBoxPadding: number;
  snapConfig: ViewerSnapConfig;
};

type ToolbarIconName =
  | "eye"
  | "ghost"
  | "focus"
  | "eyeOff"
  | "isolate"
  | "paint"
  | "cut"
  | "measure"
  | "area"
  | "volume"
  | "pin"
  | "save"
  | "reset"
  | "box";

type ToolbarGroupKey = "view" | "selection" | "measure" | "cut";

function ToolbarIcon({ name }: { name: ToolbarIconName }) {
  const props = {
    className: "h-4 w-4 shrink-0",
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };

  if (name === "eye") {
    return (
      <svg {...props}>
        <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </svg>
    );
  }

  if (name === "ghost") {
    return (
      <svg {...props}>
        <path d="M5 21V9a7 7 0 0 1 14 0v12l-3-2-2 2-2-2-2 2-2-2-3 2Z" />
        <path d="M9 10h.01" />
        <path d="M15 10h.01" />
      </svg>
    );
  }

  if (name === "focus") {
    return (
      <svg {...props}>
        <path d="M8 3H5a2 2 0 0 0-2 2v3" />
        <path d="M16 3h3a2 2 0 0 1 2 2v3" />
        <path d="M8 21H5a2 2 0 0 1-2-2v-3" />
        <path d="M16 21h3a2 2 0 0 0 2-2v-3" />
        <circle cx="12" cy="12" r="2" />
      </svg>
    );
  }

  if (name === "eyeOff") {
    return (
      <svg {...props}>
        <path d="m3 3 18 18" />
        <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
        <path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a17.8 17.8 0 0 1-3.1 4.4" />
        <path d="M6.6 6.6C3.6 8.7 2 12 2 12s3.5 8 10 8a10.7 10.7 0 0 0 4.1-.8" />
      </svg>
    );
  }

  if (name === "isolate") {
    return (
      <svg {...props}>
        <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
        <path d="M12 11 4.5 7.2" />
        <path d="M12 11v10" />
        <path d="m12 11 7.5-3.8" />
      </svg>
    );
  }

  if (name === "paint") {
    return (
      <svg {...props}>
        <path d="m14 4 6 6-8 8H6v-6l8-8Z" />
        <path d="m14 4-2-2" />
        <path d="M6 18 4 20" />
      </svg>
    );
  }

  if (name === "cut") {
    return (
      <svg {...props}>
        <circle cx="6" cy="6" r="2" />
        <circle cx="6" cy="18" r="2" />
        <path d="M8 8 20 20" />
        <path d="M8 16 20 4" />
      </svg>
    );
  }

  if (name === "measure") {
    return (
      <svg {...props}>
        <path d="M4 17 17 4" />
        <path d="m7 14 3 3" />
        <path d="m10 11 3 3" />
        <path d="m13 8 3 3" />
      </svg>
    );
  }

  if (name === "area") {
    return (
      <svg {...props}>
        <path d="M5 6h11l3 6-5 6H5l-3-6 3-6Z" />
        <path d="M5 6 14 18" />
      </svg>
    );
  }

  if (name === "volume") {
    return (
      <svg {...props}>
        <path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Z" />
        <path d="M12 12 4 7.5" />
        <path d="M12 12v9" />
        <path d="m12 12 8-4.5" />
      </svg>
    );
  }

  if (name === "pin") {
    return (
      <svg {...props}>
        <path d="M12 21s6-5.1 6-11a6 6 0 0 0-12 0c0 5.9 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2" />
      </svg>
    );
  }

  if (name === "save") {
    return (
      <svg {...props}>
        <path d="M5 3h12l2 2v16H5V3Z" />
        <path d="M8 3v6h8V3" />
        <path d="M8 21v-7h8v7" />
      </svg>
    );
  }

  if (name === "box") {
    return (
      <svg {...props}>
        <path d="M21 16V8l-9-5-9 5v8l9 5 9-5Z" />
        <path d="M3.3 7.7 12 13l8.7-5.3" />
        <path d="M12 22V13" />
      </svg>
    );
  }

  return (
    <svg {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v6h6" />
    </svg>
  );
}

function ToolButton({
  icon,
  label,
  disabled,
  active,
  onClick
}: {
  icon: ToolbarIconName;
  label: string;
  disabled?: boolean;
  active?: boolean;
  onClick: () => void | Promise<void>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium ${
        active
          ? "bg-zinc-800 text-white"
          : "text-zinc-200 hover:bg-zinc-800"
      } disabled:cursor-not-allowed disabled:opacity-40`}
      title={label}
    >
      <ToolbarIcon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function SnapToggle({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-8 rounded border px-2 text-[11px] font-semibold ${
        active
          ? "border-red-700 bg-red-700 text-white"
          : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
      }`}
      title={`Snap ${label}`}
    >
      {label}
    </button>
  );
}

export function IfcViewerToolbar({
  onIsolateSelection,
  onToggleSelection,
  onToggleGhostSelection,
  onShowAll,
  onFitModel,
  onFocusSelection,
  onResetView,
  onSaveViewpoint,
  onCreateAnnotation,
  onClearAnnotations,
  onCreateDistanceMeasurement,
  onCreateAreaMeasurement,
  onFinishAreaMeasurement,
  onMeasureSelectionArea,
  onMeasureSelectionVolume,
  onClearMeasurements,
  onToggleClipper,
  onDeleteClippingPlanes,
  onCreateSelectionSectionBox,
  onClearSelectionSectionBox,
  onApplySelectionColor,
  onRestoreSelectionColor,
  onSelectedColorChange,
  onSectionBoxPaddingChange,
  onSnapConfigChange,
  clipperEnabled,
  hasSelection,
  selectedColor,
  sectionBoxPadding,
  snapConfig
}: IfcViewerToolbarProps) {
  const [activeGroup, setActiveGroup] = useState<ToolbarGroupKey>("view");
  const groupButtonClass = (group: ToolbarGroupKey) =>
    `min-h-8 rounded px-3 text-xs font-semibold ${
      activeGroup === group
        ? "bg-red-700 text-white"
        : "bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
    }`;

  return (
    <div className="flex max-w-full flex-col rounded-lg border border-zinc-700 bg-zinc-950/95 text-zinc-200 shadow-2xl">
      <div className="flex min-w-0 flex-wrap items-center justify-center gap-1 border-b border-zinc-800 px-2 py-1.5">
        <button
          type="button"
          onClick={() => setActiveGroup("view")}
          className={groupButtonClass("view")}
        >
          Vista
        </button>
        <button
          type="button"
          onClick={() => setActiveGroup("selection")}
          className={groupButtonClass("selection")}
        >
          Seleccion
        </button>
        <button
          type="button"
          onClick={() => setActiveGroup("measure")}
          className={groupButtonClass("measure")}
        >
          Medir
        </button>
        <button
          type="button"
          onClick={() => setActiveGroup("cut")}
          className={groupButtonClass("cut")}
        >
          Corte
        </button>
      </div>

      <div className="flex min-w-0 flex-wrap items-center justify-center gap-1 px-2 py-1.5">
        {activeGroup === "view" && (
          <>
            <ToolButton icon="box" label="Fit" onClick={onFitModel} />
            <ToolButton icon="reset" label="Reset" onClick={onResetView} />
            <ToolButton icon="save" label="View" onClick={onSaveViewpoint} />
            <ToolButton icon="eye" label="Show All" onClick={onShowAll} />
          </>
        )}

        {activeGroup === "selection" && (
          <>
            <ToolButton
              icon="focus"
              label="Focus"
              disabled={!hasSelection}
              onClick={onFocusSelection}
            />
            <ToolButton
              icon="eyeOff"
              label="Hide"
              disabled={!hasSelection}
              onClick={onToggleSelection}
            />
            <ToolButton
              icon="ghost"
              label="Contexto"
              disabled={!hasSelection}
              onClick={onToggleGhostSelection}
            />
            <ToolButton
              icon="isolate"
              label="Isolate"
              disabled={!hasSelection}
              onClick={onIsolateSelection}
            />
            <label
              className={`inline-flex min-h-8 items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium ${
                hasSelection ? "text-zinc-200 hover:bg-zinc-800" : "opacity-40"
              }`}
              title="Colorize"
            >
              <ToolbarIcon name="paint" />
              <span>Color</span>
              <input
                type="color"
                value={selectedColor}
                onChange={(event) => onSelectedColorChange(event.target.value)}
                disabled={!hasSelection}
                className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
              />
            </label>
            <button
              type="button"
              onClick={onApplySelectionColor}
              disabled={!hasSelection}
              className="min-h-8 rounded px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={onRestoreSelectionColor}
              className="min-h-8 rounded px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            >
              Reset color
            </button>
          </>
        )}

        {activeGroup === "measure" && (
          <>
        <div className="mx-1 flex items-center gap-1 rounded border border-zinc-800 bg-zinc-950 px-1 py-1">
          <span className="px-1 text-[11px] font-semibold uppercase text-zinc-500">
            Snap
          </span>
          <SnapToggle
            label="Punto"
            active={snapConfig.point}
            onClick={() =>
              onSnapConfigChange({ ...snapConfig, point: !snapConfig.point })
            }
          />
          <SnapToggle
            label="Borde"
            active={snapConfig.edge}
            onClick={() =>
              onSnapConfigChange({ ...snapConfig, edge: !snapConfig.edge })
            }
          />
          <SnapToggle
            label="Cara"
            active={snapConfig.face}
            onClick={() =>
              onSnapConfigChange({ ...snapConfig, face: !snapConfig.face })
            }
          />
        </div>
        <ToolButton icon="measure" label="Dist" onClick={onCreateDistanceMeasurement} />
        <ToolButton icon="area" label="Area" onClick={onCreateAreaMeasurement} />
        <ToolButton icon="area" label="Surf" disabled={!hasSelection} onClick={onMeasureSelectionArea} />
        <ToolButton icon="volume" label="Vol" disabled={!hasSelection} onClick={onMeasureSelectionVolume} />
        <ToolButton icon="measure" label="Clear" onClick={onClearMeasurements} />
          </>
        )}

        {activeGroup === "cut" && (
          <>
        <ToolButton
          icon="cut"
          label={clipperEnabled ? "Cut On" : "Cut"}
          active={clipperEnabled}
          onClick={onToggleClipper}
        />
        <ToolButton
          icon="box"
          label="Section"
          disabled={!hasSelection}
          onClick={onCreateSelectionSectionBox}
        />
        <ToolButton icon="cut" label="Clear Cuts" onClick={onDeleteClippingPlanes} />
        <button
          type="button"
          onClick={onClearSelectionSectionBox}
          className="min-h-8 rounded px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Clear Box
        </button>
        <button
          type="button"
          onClick={onClearAnnotations}
          className="min-h-8 rounded px-2 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
        >
          Clear Issues
        </button>
        <label className="flex min-h-8 min-w-[132px] items-center gap-2 px-2 text-xs text-zinc-400">
          <span>Pad</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={sectionBoxPadding}
            onChange={(event) =>
              onSectionBoxPaddingChange(Number(event.target.value))
            }
            className="w-24"
          />
        </label>
        <ToolButton icon="pin" label="Issue" onClick={onCreateAnnotation} />
          </>
        )}
      </div>
    </div>
  );
}
