"use client";

import { useMemo, useState } from "react";

type IfcSelectedPropertiesPanelProps = {
  items: Record<string, unknown>[];
  containmentData: Record<string, unknown>[];
  associationsData: Record<string, unknown>[];
  containmentLoading: boolean;
  associationsLoading: boolean;
  onLoadContainment: () => void;
  onLoadAssociations: () => void;
};

type IfcWrappedValue = {
  value?: unknown;
  type?: string;
};

type NormalizedProperty = {
  key: string;
  name: string;
  value: string;
  type: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWrappedValue(value: unknown): value is IfcWrappedValue {
  return isObject(value) && "value" in value;
}

function unwrapValue(value: unknown): unknown {
  return isWrappedValue(value) ? value.value : value;
}

function renderPrimitive(value: unknown): string {
  const raw = unwrapValue(value);

  if (raw === null || raw === undefined || raw === "") return "-";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);

  if (Array.isArray(raw)) {
    return raw.map((item) => renderPrimitive(item)).join(", ");
  }

  try {
    return JSON.stringify(raw);
  } catch {
    return "[No serializable]";
  }
}

function getCategory(value: Record<string, unknown>) {
  return renderPrimitive(value._category ?? value.Category ?? value.type);
}

function getSectionTitle(value: unknown, fallback: string) {
  if (!isObject(value)) return fallback;

  const name = renderPrimitive(value.Name);
  if (name !== "-") return name;

  const category = getCategory(value);
  if (category !== "-") return category;

  return fallback;
}

function getRelationTarget(
  relation: Record<string, unknown>,
  targetKeys: string[]
) {
  for (const key of targetKeys) {
    if (isObject(relation[key])) return relation[key] as Record<string, unknown>;
  }

  return relation;
}

function extractPropertySets(item: Record<string, unknown>) {
  const relations = Array.isArray(item.IsDefinedBy)
    ? item.IsDefinedBy.filter(isObject)
    : [];

  const sets: Record<string, unknown>[] = [];

  for (const relation of relations) {
    const target = getRelationTarget(relation, ["RelatingPropertyDefinition"]);
    if (
      Array.isArray(target.HasProperties) ||
      Array.isArray(target.HasQuantities) ||
      target !== relation
    ) {
      sets.push(target);
    }
  }

  return sets;
}

function extractTypedBy(item: Record<string, unknown>) {
  const relations = Array.isArray(item.IsTypedBy)
    ? item.IsTypedBy.filter(isObject)
    : [];

  return relations.map((relation) => getRelationTarget(relation, ["RelatingType"]));
}

function extractContainment(item: Record<string, unknown>) {
  const relations = Array.isArray(item.ContainedInStructure)
    ? item.ContainedInStructure.filter(isObject)
    : [];

  return relations.map((relation) =>
    getRelationTarget(relation, ["RelatingStructure"])
  );
}

function extractAssociations(item: Record<string, unknown>) {
  const relations = Array.isArray(item.HasAssociations)
    ? item.HasAssociations.filter(isObject)
    : [];

  return relations.map((relation) =>
    getRelationTarget(relation, [
      "RelatingMaterial",
      "RelatingClassification",
      "RelatingDocument"
    ])
  );
}

function getPropertyCandidates(pset: Record<string, unknown>): unknown[] {
  if (Array.isArray(pset.HasProperties)) return pset.HasProperties;
  if (Array.isArray(pset.HasQuantities)) return pset.HasQuantities;
  return [];
}

function getPropertyValue(prop: Record<string, unknown>) {
  const valueKeys = [
    "NominalValue",
    "LengthValue",
    "AreaValue",
    "VolumeValue",
    "CountValue",
    "WeightValue",
    "TimeValue",
    "EnumerationValues",
    "ListValues",
    "LowerBoundValue",
    "UpperBoundValue"
  ];

  const lower = "LowerBoundValue" in prop ? renderPrimitive(prop.LowerBoundValue) : "";
  const upper = "UpperBoundValue" in prop ? renderPrimitive(prop.UpperBoundValue) : "";
  if (lower || upper) return `${lower || "-"} - ${upper || "-"}`;

  for (const key of valueKeys) {
    if (key in prop) return renderPrimitive(prop[key]);
  }

  return "-";
}

function normalizePropertyEntries(pset: Record<string, unknown>) {
  return getPropertyCandidates(pset)
    .map((prop, index): NormalizedProperty | null => {
      if (!isObject(prop)) {
        return {
          key: `raw-${index}`,
          name: `Propiedad ${index + 1}`,
          value: renderPrimitive(prop),
          type: "-"
        };
      }

      const name = renderPrimitive(prop.Name);
      const nominal = isObject(prop.NominalValue) ? prop.NominalValue : null;

      return {
        key: `${name}-${index}`,
        name: name === "-" ? `Propiedad ${index + 1}` : name,
        value: getPropertyValue(prop),
        type:
          (nominal && typeof nominal.type === "string" ? nominal.type : null) ??
          getCategory(prop)
      };
    })
    .filter((value): value is NormalizedProperty => Boolean(value))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
}

function findPropertyValue(item: Record<string, unknown>, propertyName: string) {
  for (const pset of extractPropertySets(item)) {
    for (const prop of normalizePropertyEntries(pset)) {
      if (prop.name.toLowerCase() === propertyName.toLowerCase()) {
        return prop.value;
      }
    }
  }

  return "-";
}

function keyValueEntries(item: Record<string, unknown>) {
  return [
    ["Modelo", item.__modelName],
    ["Categoria", item._category],
    ["Nombre", item.Name],
    ["Tipo", item.ObjectType],
    ["Predefinido", item.PredefinedType],
    ["Tag", item.Tag],
    ["GUID", item._guid],
    ["Local ID", item._localId]
  ].filter(([, value]) => value !== undefined) as Array<[string, unknown]>;
}

function summaryEntries(
  item: Record<string, unknown>,
  associations: Record<string, unknown>[]
) {
  const typedBy = extractTypedBy(item);
  const assocTargets =
    associations.length > 0
      ? associations.flatMap((assoc) => extractAssociations(assoc))
      : extractAssociations(item);

  return [
    ["IFC Element", item._category],
    ["Name", item.Name],
    ["Type Name", typedBy[0]?.Name ?? item.ObjectType],
    ["Material", assocTargets[0]?.Name],
    ["Is External", findPropertyValue(item, "IsExternal")],
    ["Load Bearing", findPropertyValue(item, "LoadBearing")],
    ["Fire Rating", findPropertyValue(item, "FireRating")],
    ["Phase", item.Phase],
    ["Description", item.Description]
  ].filter(([, value]) => value !== undefined) as Array<[string, unknown]>;
}

function filterText(value: string, query: string) {
  return value.toLowerCase().includes(query.trim().toLowerCase());
}

function SectionCard({
  title,
  count,
  children,
  defaultOpen = false
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="rounded border border-zinc-800 bg-zinc-950">
      <summary className="flex cursor-pointer items-center justify-between border-b border-zinc-800 bg-zinc-900 px-3 py-2">
        <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
        {typeof count === "number" ? (
          <span className="text-xs text-zinc-500">{count}</span>
        ) : null}
      </summary>
      <div className="p-3">{children}</div>
    </details>
  );
}

function KeyValueTable({ entries }: { entries: Array<[string, unknown]> }) {
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">Sin datos.</p>;
  }

  return (
    <div className="overflow-hidden rounded border border-zinc-800">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="grid grid-cols-[minmax(96px,32%)_1fr] border-b border-zinc-800 bg-zinc-950 px-2 py-2 last:border-b-0"
        >
          <div className="text-[11px] font-semibold uppercase text-zinc-500">
            {key}
          </div>
          <div className="min-w-0 break-words text-sm leading-5 text-zinc-200">
            {renderPrimitive(value)}
          </div>
        </div>
      ))}
    </div>
  );
}

function PropertyRows({
  properties
}: {
  properties: NormalizedProperty[];
}) {
  if (properties.length === 0) {
    return <p className="text-sm text-zinc-500">Sin propiedades visibles.</p>;
  }

  return (
    <div className="overflow-hidden rounded border border-zinc-800">
      {properties.map((prop) => (
        <div
          key={prop.key}
          className="grid grid-cols-[minmax(110px,38%)_1fr_24px] items-start gap-3 border-b border-zinc-800 bg-zinc-950 px-2 py-2 last:border-b-0"
        >
          <div className="min-w-0 truncate text-xs text-zinc-400">
            {prop.name}
          </div>
          <div className="min-w-0 break-words text-xs leading-5 text-zinc-100">
            {prop.value}
          </div>
          <div
            className="flex h-5 w-5 items-center justify-center text-zinc-500"
            title={prop.type}
          >
            {prop.type.toLowerCase().includes("boolean")
              ? "?"
              : prop.type.toLowerCase().includes("number") ||
                prop.type.toLowerCase().includes("integer") ||
                prop.type.toLowerCase().includes("real")
              ? "#"
              : "="}
          </div>
        </div>
      ))}
    </div>
  );
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadPropertiesCsv(
  filename: string,
  rows: Array<[string, string, string, string]>
) {
  const header = ["Grupo", "Propiedad", "Valor", "Tipo"];
  const csv = [header, ...rows]
    .map((row) => row.map((value) => csvEscape(value)).join(";"))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function IfcSelectedPropertiesPanel({
  items,
  associationsData
}: IfcSelectedPropertiesPanelProps) {
  const [query, setQuery] = useState("");
  const firstItem = items[0];

  const propertySets = useMemo(() => {
    if (!firstItem) return [];
    return extractPropertySets(firstItem).sort((a, b) =>
      getSectionTitle(a, "").localeCompare(getSectionTitle(b, ""), undefined, {
        numeric: true,
        sensitivity: "base"
      })
    );
  }, [firstItem]);

  const visiblePropertySets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return propertySets;

    return propertySets.filter((pset) => {
      const title = getSectionTitle(pset, "");
      const properties = normalizePropertyEntries(pset);
      return (
        filterText(title, normalizedQuery) ||
        properties.some((prop) =>
          filterText(`${prop.name} ${prop.value} ${prop.type}`, normalizedQuery)
        )
      );
    });
  }, [propertySets, query]);

  const exportRows = useMemo(() => {
    if (!firstItem) return [];

    const rows: Array<[string, string, string, string]> = [];

    for (const [key, value] of keyValueEntries(firstItem)) {
      rows.push(["IFC Entity", key, renderPrimitive(value), "-"]);
    }

    for (const [key, value] of summaryEntries(firstItem, associationsData)) {
      rows.push(["Summary", key, renderPrimitive(value), "-"]);
    }

    for (const pset of propertySets) {
      const group = getSectionTitle(pset, "Property Set");
      for (const prop of normalizePropertyEntries(pset)) {
        rows.push([group, prop.name, prop.value, prop.type]);
      }
    }

    return rows;
  }, [firstItem, associationsData, propertySets]);

  if (!firstItem) {
    return (
      <section className="bg-zinc-950">
        <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-100">Propiedades</h3>
            <span className="text-xs text-zinc-500">Sin seleccion</span>
          </div>
        </div>
        <div className="p-3 text-sm text-zinc-500">
          Selecciona un elemento para ver sus propiedades.
        </div>
      </section>
    );
  }

  return (
    <section className="bg-zinc-950">
      <div className="border-b border-zinc-800 bg-zinc-900 px-3 py-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-100">Propiedades</h3>
          <span className="text-xs text-zinc-500">{items.length} elemento(s)</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              downloadPropertiesCsv("ifc-properties.csv", exportRows)
            }
            className="min-h-8 border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            Descargar Excel
          </button>
          <button
            type="button"
            onClick={() =>
              downloadPropertiesCsv("ifc-properties-saved.csv", exportRows)
            }
            className="min-h-8 border border-zinc-700 bg-zinc-950 px-3 text-xs text-zinc-200 hover:bg-zinc-800"
          >
            Guardar en Excel
          </button>
        </div>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Buscar propiedad, valor o Pset..."
          className="mt-3 min-h-8 w-full rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-100 outline-none placeholder:text-zinc-500 focus:ring-1 focus:ring-red-600"
        />
      </div>

      <div className="space-y-3 p-3">
        <SectionCard title="Identidad" defaultOpen>
          <KeyValueTable entries={keyValueEntries(firstItem)} />
        </SectionCard>

        <SectionCard title="Resumen" defaultOpen>
          <KeyValueTable entries={summaryEntries(firstItem, associationsData)} />
        </SectionCard>

        <SectionCard title="Parametros" count={visiblePropertySets.length} defaultOpen>
          {visiblePropertySets.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No hay propiedades que coincidan con el filtro.
            </p>
          ) : (
            <div className="space-y-3">
              {visiblePropertySets.map((pset, index) => {
                const properties = normalizePropertyEntries(pset).filter((prop) => {
                  const normalizedQuery = query.trim().toLowerCase();
                  if (!normalizedQuery) return true;
                  return filterText(
                    `${prop.name} ${prop.value} ${prop.type}`,
                    normalizedQuery
                  );
                });

                return (
                  <details
                    key={`${getSectionTitle(pset, `Pset ${index + 1}`)}-${index}`}
                    open={index === 0}
                    className="rounded border border-zinc-800 bg-zinc-950"
                  >
                    <summary className="cursor-pointer border-b border-zinc-800 bg-zinc-900 px-3 py-2 text-sm font-medium text-zinc-200">
                      {getSectionTitle(pset, `Pset ${index + 1}`)} ({properties.length})
                    </summary>
                    <div className="p-3">
                      <PropertyRows properties={properties} />
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </SectionCard>

      </div>
    </section>
  );
}
