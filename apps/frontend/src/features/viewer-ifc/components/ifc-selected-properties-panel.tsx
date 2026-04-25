"use client";

import { useMemo } from "react";

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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWrappedValue(value: unknown): value is IfcWrappedValue {
  return isObject(value) && "value" in value;
}

function unwrapValue(value: unknown): unknown {
  if (isWrappedValue(value)) return value.value;
  return value;
}

function renderPrimitive(value: unknown): string {
  const raw = unwrapValue(value);

  if (raw === null) return "null";
  if (raw === undefined) return "-";

  if (
    typeof raw === "string" ||
    typeof raw === "number" ||
    typeof raw === "boolean"
  ) {
    return String(raw);
  }

  try {
    return JSON.stringify(raw);
  } catch {
    return "[No serializable]";
  }
}

function getSectionTitle(value: unknown, fallback: string) {
  if (!isObject(value)) return fallback;

  const name = unwrapValue(value.Name);
  if (typeof name === "string" && name.trim()) return name;

  const category = unwrapValue(value._category);
  if (typeof category === "string" && category.trim()) return category;

  return fallback;
}

function normalizeIdentityEntries(
  item: Record<string, unknown>
): ReadonlyArray<readonly [string, unknown]> {
  const preferredKeys = [
    "__modelName",
    "_category",
    "_guid",
    "_localId",
    "Name",
    "ObjectType",
    "PredefinedType",
    "Tag",
    "Description"
  ];

  return preferredKeys
    .filter((key) => key in item)
    .map((key) => [key, item[key]] as const);
}

function normalizeScalarEntries(
  item: Record<string, unknown>
): ReadonlyArray<readonly [string, unknown]> {
  return Object.entries(item).filter(([key, value]) => {
    if (
      key === "IsDefinedBy" ||
      key === "IsTypedBy" ||
      key === "ContainedInStructure" ||
      key === "HasAssociations"
    ) {
      return false;
    }

    if (Array.isArray(value)) return false;
    if (isWrappedValue(value)) return true;

    return (
      value === null ||
      value === undefined ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    );
  });
}

function extractPropertySets(item: Record<string, unknown>): Record<string, unknown>[] {
  const relations = Array.isArray(item.IsDefinedBy)
    ? item.IsDefinedBy.filter(isObject)
    : [];

  const result: Record<string, unknown>[] = [];

  for (const relation of relations) {
    const directPset = isObject(relation.RelatingPropertyDefinition)
      ? relation.RelatingPropertyDefinition
      : null;

    if (directPset) {
      result.push(directPset);
      continue;
    }

    if (
      Array.isArray(relation.HasProperties) ||
      Array.isArray(relation.HasQuantities)
    ) {
      result.push(relation);
    }
  }

  return result;
}

function extractTypedBy(item: Record<string, unknown>): Record<string, unknown>[] {
  const relations = Array.isArray(item.IsTypedBy)
    ? item.IsTypedBy.filter(isObject)
    : [];

  const result: Record<string, unknown>[] = [];

  for (const relation of relations) {
    const directType = isObject(relation.RelatingType)
      ? relation.RelatingType
      : null;

    if (directType) {
      result.push(directType);
      continue;
    }

    result.push(relation);
  }

  return result;
}

function extractContainment(item: Record<string, unknown>): Record<string, unknown>[] {
  if (isObject(item.RelatingStructure)) {
    return [item.RelatingStructure];
  }

  const relations = Array.isArray(item.ContainedInStructure)
    ? item.ContainedInStructure.filter(isObject)
    : [];

  const result: Record<string, unknown>[] = [];

  for (const relation of relations) {
    const directContainer = isObject(relation.RelatingStructure)
      ? relation.RelatingStructure
      : null;

    if (directContainer) {
      result.push(directContainer);
      continue;
    }

    result.push(relation);
  }

  return result;
}

function extractAssociations(item: Record<string, unknown>): Record<string, unknown>[] {
  if (isObject(item.RelatingMaterial)) return [item.RelatingMaterial];
  if (isObject(item.RelatingClassification)) return [item.RelatingClassification];
  if (isObject(item.RelatingDocument)) return [item.RelatingDocument];

  const relations = Array.isArray(item.HasAssociations)
    ? item.HasAssociations.filter(isObject)
    : [];

  const result: Record<string, unknown>[] = [];

  for (const relation of relations) {
    if (isObject(relation.RelatingMaterial)) {
      result.push(relation.RelatingMaterial);
      continue;
    }

    if (isObject(relation.RelatingClassification)) {
      result.push(relation.RelatingClassification);
      continue;
    }

    if (isObject(relation.RelatingDocument)) {
      result.push(relation.RelatingDocument);
      continue;
    }

    result.push(relation);
  }

  return result;
}

function getPropertyCandidates(pset: Record<string, unknown>): unknown[] {
  if (Array.isArray(pset.HasProperties)) return pset.HasProperties;
  if (Array.isArray(pset.HasQuantities)) return pset.HasQuantities;

  if (isObject(pset.RelatingPropertyDefinition)) {
    const nested = pset.RelatingPropertyDefinition;
    if (Array.isArray(nested.HasProperties)) return nested.HasProperties;
    if (Array.isArray(nested.HasQuantities)) return nested.HasQuantities;
  }

  return [];
}

function getPropertyValueByName(
  item: Record<string, unknown>,
  propertyName: string
): string | null {
  const sets = extractPropertySets(item);

  for (const set of sets) {
    const candidates = getPropertyCandidates(set);

    for (const prop of candidates) {
      if (!isObject(prop)) continue;

      const currentName = renderPrimitive(prop.Name);
      if (currentName !== propertyName) continue;

      if ("NominalValue" in prop) return renderPrimitive(prop.NominalValue);
      if ("LengthValue" in prop) return renderPrimitive(prop.LengthValue);
      if ("AreaValue" in prop) return renderPrimitive(prop.AreaValue);
      if ("VolumeValue" in prop) return renderPrimitive(prop.VolumeValue);
      if ("CountValue" in prop) return renderPrimitive(prop.CountValue);
      if ("WeightValue" in prop) return renderPrimitive(prop.WeightValue);
      if ("TimeValue" in prop) return renderPrimitive(prop.TimeValue);

      return renderPrimitive(prop);
    }
  }

  return null;
}

function buildSummaryEntries(
  item: Record<string, unknown>,
  associationsData: Record<string, unknown>[]
): ReadonlyArray<readonly [string, unknown]> {
  const flattenedAssociations = associationsData.flatMap((assoc) =>
    extractAssociations(assoc)
  );

  const typedBy = extractTypedBy(item);

  const materialName =
    flattenedAssociations.length > 0
      ? renderPrimitive(flattenedAssociations[0].Name)
      : "-";

  const typeName =
    typedBy.length > 0
      ? renderPrimitive(typedBy[0].Name)
      : "ObjectType" in item
      ? renderPrimitive(item.ObjectType)
      : "-";

  const phase = "Phase" in item ? renderPrimitive(item.Phase) : "-";
  const isExternal = getPropertyValueByName(item, "IsExternal") ?? "-";
  const loadBearing = getPropertyValueByName(item, "LoadBearing") ?? "-";

  const entries: Array<readonly [string, unknown]> = [
    ["Model", item.__modelName],
    ["IFC Element", item._category],
    ["Name", item.Name],
    ["Phase", phase],
    ["Type Name", typeName],
    ["Description", item.Description],
    ["Material Name", materialName],
    ["Is External", isExternal],
    ["Load Bearing", loadBearing],
    ["Predefined Type", item.PredefinedType],
    ["Tag", item.Tag],
    ["GUID", item._guid]
  ];

  return entries.filter(([, value]) => value !== undefined);
}

function normalizePropertyEntries(pset: Record<string, unknown>) {
  const rawProps = getPropertyCandidates(pset);

  if (!Array.isArray(rawProps) || rawProps.length === 0) return [];

  const sortedProps = [...rawProps].sort((a, b) => {
  const aName = isObject(a) ? renderPrimitive(a.Name).toLowerCase() : "";
  const bName = isObject(b) ? renderPrimitive(b.Name).toLowerCase() : "";
  return aName.localeCompare(bName, undefined, {
    numeric: true,
    sensitivity: "base"
  });
});

return sortedProps.map((prop, index) => {
    if (!isObject(prop)) {
      return {
        key: `prop-${index}`,
        name: `Propiedad ${index + 1}`,
        value: renderPrimitive(prop),
        type: "-"
      };
    }

    const name = renderPrimitive(prop.Name);

    const value =
      "NominalValue" in prop
        ? renderPrimitive(prop.NominalValue)
        : "LengthValue" in prop
        ? renderPrimitive(prop.LengthValue)
        : "AreaValue" in prop
        ? renderPrimitive(prop.AreaValue)
        : "VolumeValue" in prop
        ? renderPrimitive(prop.VolumeValue)
        : "CountValue" in prop
        ? renderPrimitive(prop.CountValue)
        : "WeightValue" in prop
        ? renderPrimitive(prop.WeightValue)
        : "TimeValue" in prop
        ? renderPrimitive(prop.TimeValue)
        : "EnumerationValues" in prop
        ? renderPrimitive(prop.EnumerationValues)
        : "ListValues" in prop
        ? renderPrimitive(prop.ListValues)
        : "UpperBoundValue" in prop || "LowerBoundValue" in prop
        ? `${renderPrimitive(prop.LowerBoundValue)} - ${renderPrimitive(
            prop.UpperBoundValue
          )}`
        : renderPrimitive(prop);

    const type =
      isObject(prop.NominalValue) && typeof prop.NominalValue.type === "string"
        ? prop.NominalValue.type
        : typeof prop._category === "string"
        ? prop._category
        : "-";

    return {
      key: `${name}-${index}`,
      name,
      value,
      type
    };
  });
}

function SectionCard({
  title,
  children,
  count,
  defaultOpen = false
}: {
  title: string;
  children: React.ReactNode;
  count?: number;
  defaultOpen?: boolean;
}) {
  return (
    <details open={defaultOpen} className="border border-zinc-300 bg-white">
      <summary className="flex cursor-pointer items-center justify-between border-b border-zinc-300 bg-zinc-100 px-3 py-2">
        <h4 className="text-sm font-semibold text-zinc-800">{title}</h4>
        {typeof count === "number" ? (
          <span className="text-xs text-zinc-500">{count}</span>
        ) : null}
      </summary>
      <div className="p-3">{children}</div>
    </details>
  );
}

function KeyValueTable({
  entries
}: {
  entries: ReadonlyArray<readonly [string, unknown]>;
}) {
  if (entries.length === 0) {
    return <p className="text-sm text-zinc-500">Sin datos.</p>;
  }

  return (
    <div className="border border-zinc-300">
      <div className="divide-y divide-zinc-200">
        {entries.map(([key, value]) => (
          <div
            key={key}
            className="grid grid-cols-[minmax(90px,30%)_1fr] gap-x-2 gap-y-1 px-2 py-2"
          >
            <div className="min-w-0 text-[11px] font-semibold uppercase tracking-normal text-zinc-500">
              {key}
            </div>
            <div className="min-w-0 break-words text-sm leading-5 text-zinc-700">
              {renderPrimitive(value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PropertySetTable({ pset }: { pset: Record<string, unknown> }) {
  const properties = normalizePropertyEntries(pset);

  if (properties.length === 0) {
    return (
      <p className="text-sm text-zinc-500">
        Este set no tiene propiedades visibles.
      </p>
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto overflow-y-hidden border border-zinc-300">
      <table className="w-full table-fixed border-collapse text-sm">
        <thead className="bg-zinc-50">
          <tr>
            <th className="w-[38%] border-b border-zinc-300 px-2 py-2 text-left font-semibold text-zinc-700">
              Propiedad
            </th>
            <th className="w-[42%] border-b border-zinc-300 px-2 py-2 text-left font-semibold text-zinc-700">
              Valor
            </th>
            <th className="w-[20%] border-b border-zinc-300 px-2 py-2 text-left font-semibold text-zinc-700">
              Tipo
            </th>
          </tr>
        </thead>
        <tbody>
          {properties.map((prop) => (
            <tr key={prop.key} className="align-top">
              <td className="border-b border-zinc-200 px-2 py-2 leading-5 text-zinc-800 [overflow-wrap:anywhere]">
                {prop.name}
              </td>
              <td className="border-b border-zinc-200 px-2 py-2 leading-5 text-zinc-800 [overflow-wrap:anywhere]">
                {prop.value}
              </td>
              <td className="border-b border-zinc-200 px-2 py-2 leading-5 text-zinc-800 [overflow-wrap:anywhere]">
                {prop.type}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function IfcSelectedPropertiesPanel({
  items,
  containmentData,
  associationsData,
  containmentLoading,
  associationsLoading: _associationsLoading,
  onLoadContainment,
  onLoadAssociations: _onLoadAssociations
}: IfcSelectedPropertiesPanelProps) {
  const firstItem = items[0];

  const identityEntries = useMemo(
    () => (firstItem ? normalizeIdentityEntries(firstItem) : []),
    [firstItem]
  );

  const summaryEntries = useMemo(
    () => (firstItem ? buildSummaryEntries(firstItem, associationsData) : []),
    [firstItem, associationsData]
  );

  const propertySets = useMemo(() => {
    if (!firstItem) return [];

    return [...extractPropertySets(firstItem)].sort((a, b) => {
      const aName = getSectionTitle(a, "").toLowerCase();
      const bName = getSectionTitle(b, "").toLowerCase();
      return aName.localeCompare(bName, undefined, {
        numeric: true,
        sensitivity: "base"
      });
    });
  }, [firstItem]);

  const typedBy = useMemo(
    () => (firstItem ? extractTypedBy(firstItem) : []),
    [firstItem]
  );

  const containment = useMemo(
    () =>
      containmentData.length > 0
        ? containmentData.flatMap((item) => extractContainment(item))
        : [],
    [containmentData]
  );

  const associations = useMemo(
    () =>
      associationsData.length > 0
        ? associationsData.flatMap((item) => extractAssociations(item))
        : [],
    [associationsData]
  );

  if (!firstItem) {
    return (
      <section className="border border-zinc-300 bg-zinc-100">
        <div className="border-b border-zinc-300 bg-zinc-200 px-3 py-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-800">Propiedades</h3>
            <span className="text-xs text-zinc-500">Sin selección</span>
          </div>
        </div>

        <div className="p-3">
          <p className="text-sm text-zinc-500">
            Selecciona un elemento para ver sus propiedades.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="border border-zinc-300 bg-zinc-100">
      <div className="border-b border-zinc-300 bg-zinc-200 px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-800">Propiedades</h3>
          <span className="text-xs text-zinc-500">1 elemento</span>
        </div>
      </div>

      <div className="space-y-3 p-3">
        <SectionCard title="Identidad" defaultOpen>
          <KeyValueTable entries={identityEntries} />
        </SectionCard>

        <SectionCard title="Summary" defaultOpen>
          <KeyValueTable entries={summaryEntries} />
        </SectionCard>

        <SectionCard title="Property Sets" count={propertySets.length} defaultOpen>
          {propertySets.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No se encontraron Property Sets.
            </p>
          ) : (
            <div className="space-y-3">
              {propertySets.map((pset, index) => (
                <details
                  key={`${getSectionTitle(pset, `Pset ${index + 1}`)}-${index}`}
                  open={index === 0}
                  className="border border-zinc-300 bg-white"
                >
                  <summary className="cursor-pointer border-b border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800">
                    {getSectionTitle(pset, `Pset ${index + 1}`)}
                  </summary>
                  <div className="p-3">
                    <PropertySetTable pset={pset} />
                  </div>
                </details>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Tipo" count={typedBy.length}>
          {typedBy.length === 0 ? (
            <p className="text-sm text-zinc-500">
              Sin información de tipo visible.
            </p>
          ) : (
            <div className="space-y-3">
              {typedBy.map((typeItem, index) => {
                const typeIdentity = normalizeIdentityEntries(typeItem);
                const typePropertySets = extractPropertySets(typeItem);

                return (
                  <div
                    key={`typed-by-${index}`}
                    className="border border-zinc-300 bg-white"
                  >
                    <div className="border-b border-zinc-300 bg-zinc-50 px-2 py-2 text-sm font-medium text-zinc-800">
                      {getSectionTitle(typeItem, `Tipo ${index + 1}`)}
                    </div>

                    <div className="space-y-3 p-3">
                      <KeyValueTable entries={typeIdentity} />

                      {typePropertySets.length > 0 ? (
                        <div className="space-y-3">
                          {typePropertySets.map((pset, psetIndex) => (
                            <details
                              key={`type-pset-${index}-${psetIndex}`}
                              open={psetIndex === 0}
                              className="border border-zinc-300 bg-white"
                            >
                              <summary className="cursor-pointer border-b border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800">
                                {getSectionTitle(
                                  pset,
                                  `Pset de tipo ${psetIndex + 1}`
                                )}
                              </summary>
                              <div className="p-3">
                                <PropertySetTable pset={pset} />
                              </div>
                            </details>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-zinc-500">
                          Este tipo no tiene Property Sets visibles.
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Contenedor espacial" count={containment.length}>
          {containment.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-zinc-500">
                Información no cargada para mantener el rendimiento.
              </p>
              <button
                type="button"
                onClick={onLoadContainment}
                disabled={containmentLoading}
                className="h-9 border border-zinc-300 bg-white px-3 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {containmentLoading ? "Cargando..." : "Cargar contenedor espacial"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {containment.map((item, index) => (
                <div
                  key={`containment-${index}`}
                  className="border border-zinc-300 bg-white"
                >
                  <div className="border-b border-zinc-300 bg-zinc-50 px-2 py-2 text-sm font-medium text-zinc-800">
                    {getSectionTitle(item, `Contenedor ${index + 1}`)}
                  </div>
                  <div className="p-3">
                    <KeyValueTable entries={normalizeScalarEntries(item)} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </SectionCard>

      {associations.length > 0 ? (
        <SectionCard title="Asociaciones" count={associations.length}>
          <div className="space-y-3">
            {associations.map((assoc, index) => (
              <div
                key={`assoc-${index}`}
                className="border border-zinc-300 bg-white"
              >
                <div className="border-b border-zinc-300 bg-zinc-50 px-2 py-2 text-sm font-medium text-zinc-800">
                  {getSectionTitle(assoc, `Asociación ${index + 1}`)}
                </div>
                <div className="p-3">
                  <KeyValueTable entries={normalizeScalarEntries(assoc)} />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ) : null}
      </div>
    </section>
  );
}