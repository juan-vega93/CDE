# BIM CORE

Updated: 2026-10-02 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: b9a324fd427e07a6f8c36ca1f80505183ff64297 (entrada de Fase 3D; no merge-base)
HEAD: commit que introduce el checkpoint 3D; resolver con `git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3d.md`.

Código y checkpoint comparten commit; la referencia evita autorreferencia del hash.

## Current phase

Fase 3D — Property coverage del índice persistente. NO quantity semantics.

## Status

COMPLETE para corrección y pruebas backend de Fase 3D. No representa validación visual del incidente manual ni auditoría OCI.

## Completed

- Causa reproducida antes de corregir: cortes de 64 sets/120 properties en flattening; 11 propiedades perdidas en fixture IFC válida.
- Eliminados cortes del índice y del fallback expandido. Recorrido de hojas escalares anidadas y soporte NumberValue; sin hardcode de Psets.
- Misma unicidad legacy con Set para evitar comparaciones cuadráticas al ampliar cobertura.
- Fixture: 195 properties/quantities observables; antes 184 indexadas + 2 atributos sintéticos; después 195 + 2, cero faltantes.
- Consultas reales de catálogo, filtros SmartView, QA y lookup 5D verificadas con PostgreSQL temporal.
- QuantityObservation, extracción 3C y políticas 3B intactas y con regresión conforme.

## In progress

None. Siguiente fase no autorizada.

## Blocked

None para el alcance backend probado. La causa exacta de la sesión manual requiere modelo/localId, revisión y origen DB/runtime usado por el inspector; no se afirma reproducida esa sesión.

## Decisions

- El índice persistente no debe aplicar límites de presentación a sets/properties consultables.
- Propiedades de instancia y tipo se siguen leyendo en el mismo modelo abierto mediante readAdaptiveIfcPropertySets; sin nueva extracción global ni reemplazo por provenance.
- Hojas de complejos conservan el set propietario; no se convierten atributos generales en Psets.
- Se conserva normalización/unicidad y exclusión de placeholders legacy; provenance mantiene ocurrencias por separado.
- Sin schema ni cambios de consultas/agregación. BIM_INDEX_SCHEMA_VERSION permanece 5; no activar reindexaciones por cambio de versión.

## Dependencies

- SmartViews/QA/5D consumen tablas existentes y queries genéricas; sin cambios frontend ni reglas funcionales.
- Modelos ya indexados requieren reindexación controlada para incorporar cobertura nueva; NO ejecutada. Snapshots/caches previos pueden seguir mostrando datos antiguos.
- Documents/Platform/viewer/FRAG: sin modificaciones ni acciones externas en esta fase.
- CONTROL TOWER debe revisar evidencia y compatibilidad de integración; sin merge ni push.

## Contracts / API changes

Sin API pública nueva/modificada. Export interno de extractPropertiesFromSets para tests; mayor cobertura aditiva de properties. No cambia QuantityObservation ni policies.

## Database changes

None. Se usan cde_bim_property_sets, cde_bim_properties y cde_bim_property_values. SQL existente aplicado sólo en PostgreSQL efímero para tests; sin backfill o DB real.

## Tests / Evidence

- Reproducción antes del fix: 11 faltantes; fallaban catálogo/filtro/QA/lookup 5D; provenance ya conservaba las observaciones.
- Suite unitaria/regresión: 132 correctas, 0 fallidas, 0 skipped (indexer 9, extraction 13, provenance 24, policy 32, resolver 32, revision 10, model 12).
- PostgreSQL real temporal: 19 correctas, 0 fallidas, 0 skipped (coverage 7, authoring pipeline 10, DB BIM 2).
- Coverage compara category/set/name/value: 195 observables, 197 filas indexadas; extras explicados IFC Class y Express ID. No medición de UI/browser.
- 1 OpenModel por procesamiento verificado; invariantes 3C siguen pasando.
- npm run typecheck BFF: exit 0. ESLint dirigido a cuatro archivos TypeScript: 0 errores, 0 warnings.
- Docker local, src readonly, DB tmpfs sin puertos/volúmenes productivos; contenedor eliminado.
- Branch/HEAD/working tree y diff revisados antes de checkpoint/commit; staging explícito.

## Risks

- No se confirma que los límites causaron el incidente manual específico; también existen fallback runtime, modelos no-ready y snapshots/caches antiguos.
- Se conserva el contrato legacy: vacíos, '-', 'sin valor', 'null' y 'undefined' no son valores consultables; dedup insensible a mayúsculas para set/name/value. No es provenance.
- Inspector runtime muestra Tag/ObjectType y otros atributos que no forman parte de un catálogo completo de atributos SQL. Se conservan columnas existentes y sólo IFC Class/Express ID como atributos sintéticos indexados.
- Lists/enumerations/rangos conservan representación textual legacy; referencias u objetos sin campo de valor reconocido no se vuelven parámetros escalares.
- Catálogo limita ejemplos de valores por propiedad; consultas mantienen sus límites de resultados. No confundir muestreo con pérdida del Pset persistido.
- Más filas implica mayor coste de memoria/DB. Se evita O(P²) en dedup; no se midió rendimiento OCI real.
- No se valida ni corrige 34249.502; política contractual sigue pendiente.

## Next milestone

Revisar cobertura y definir siguiente fase. Reindexación de modelos reales y auditoría OCI sólo con autorización explícita.

## Last checkpoint

Commit: el que introduce el checkpoint, resoluble por el comando HEAD anterior.
Checkpoint document: [2026-10-02-fase-3d.md](../checkpoints/bim-core/2026-10-02-fase-3d.md)

Sin push. Documento GeoBIM ajeno continúa untracked, intacto, sin abrir ni stagear.
