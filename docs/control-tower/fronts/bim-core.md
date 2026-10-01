# BIM CORE

Updated: 2026-10-01 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: b9d95de84f1098b3e7cd30f24ae389d93877acb8 (entrada de Fase 3C; no merge-base)
HEAD: commit que introduce el checkpoint 3C; resolver con `git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-01-fase-3c.md`.

Código y checkpoint comparten commit; la referencia Git evita autorreferencia del hash.

## Current phase

Fase 3C — Extracción real de QuantityObservation durante el procesamiento IFC existente.

## Status

COMPLETE para Fase 3C. No implica validación de cantidades OCI ni elección de política contractual.

## Completed

- Extractor separado del aplanado legacy, sobre web-ifc ya abierto; asignaciones por entidad y tipo, incluidos componentes anidados.
- Stored parameters escalares y siete subtipos simples de quantity de los schemas instalados; IDs nativos, raw disponible, occurrence y unidad explícita o unknown.
- Enriquecimiento en memoria desde el único resultado del resolver; entidades no representadas conservan observaciones sin authoring.
- Resultado interno quantityObservations + quantityExtractionDiagnostics; sin persistencia ni propagación pública.
- Fixture IFC4/IFC4X3 sintética; homónimos preservados, legado idéntico y políticas 3B comparadas sin cambiar su semántica.

## In progress

None. Fase cerrada; siguiente fase no autorizada.

## Blocked

None para este alcance. Falta procesar el IFC OCI real autorizado para auditar sus cantidades completas.

## Decisions

- Leer relaciones directamente, sin deduplicación, límites de presentación ni normalización legacy.
- Cada ocurrencia produce observación; contador por entidad en orden estable de relaciones, targets y miembros IFC. No deduplicar valores, sets ni relaciones distintas.
- Native IDs y occurrence son locales a revisión. Usar prepared.context directamente; builder 3A conserva su snapshot inmutable sin reconstruir identidades.
- Role deriva de resolutionMethod/rootLocalId/membership; singleton_fallback conserva rol standalone sin afirmar composición corroborada.
- Defecto de cobertura demostrado: web-ifc soporta IfcQuantityNumber en IFC4X3. Unión 3A ampliada sólo con ese subtipo; políticas v1 sin cambios.
- Unidades desde Unit explícito: etiquetas IFC, prefijo y descripción estructural de derivadas; sin conversiones ni herencia de unidades del proyecto.
- Propiedades no escalares y tipos no soportados generan diagnósticos. Referencias ilegibles/ciclos impiden completar extracción.

## Dependencies

- AuthoringElement: reutiliza resolver y contexto existentes, sin DB para enrichment.
- Quantity Provenance 3A y políticas 3B: contratos internos; ampliación aditiva IfcQuantityNumber.
- Documents/Platform/viewer/FRAG: sin cambios; consumidores existentes no exponen el resultado interno nuevo.
- 5D: permanece legacy. Auditoría OCI y política contractual requieren autorización posterior; no bloquean 3C.
- CONTROL TOWER: revisar evidencia y compatibilidad con destino antes de integrar; sin merge ni push.

## Contracts / API changes

Internos: extractIfcQuantityObservations y QuantityExtractionDiagnostic; indexBimPropertiesFromBuffer/indexPreparedBimProperties devuelven quantityObservations y quantityExtractionDiagnostics. QuantityOrigin admite IfcQuantityNumber. Sin API pública modificada.

## Database changes

None. Sin schema, tablas de cantidades, JSONB adicional, reindexación ni backfill. Migraciones existentes ejecutadas sólo en PostgreSQL desechable para tests.

## Tests / Evidence

- `tsx --test --test-reporter=spec` sobre extraction, provenance, policy, property-indexer, authoring-resolver, revision-identity y model-identity: 128/128, 0 fallidas, 0 skipped.
- Extracción: 13 tests contabilizados, web-ifc real; 1 open / 1 SHA-256 / 1 resolver / 1 extracción. Legacy comparado íntegramente contra ejecución con observer deshabilitado.
- `tsx --test --test-reporter=spec src/services/bim-authoring-pipeline.integration.test.ts`: 10/10, PostgreSQL 16 real desechable, 0 skipped; fixture quantities y regresión persistencia/rollback/revisiones.
- `npm run typecheck` BFF: exit 0. ESLint dirigido a seis archivos TypeScript, preset eslint-config-next/typescript: 0 errores y 0 warnings.
- Docker local, src readonly. PostgreSQL aislado con tmpfs, sin puertos/volúmenes productivos; contenedor eliminado.
- Branch/HEAD/working tree comprobados; revisión de diff y staging explícito, git diff --check antes de commit.

## Risks

- Fixtures sintéticas no validan totales OCI 34249.502 ni 2010.568. No existe política contractual elegida.
- Properties: IfcPropertySingleValue, también anidado. Listas, enumeraciones, rangos y referencias no se aplanan como observaciones escalares; revisar diagnósticos para evaluar cobertura.
- Etiquetas de unidades no prueban equivalencia dimensional; derivadas conservan orden estructural. No se ejecutan ConversionFactor/ConversionOffset ni matching de unidades.
- IDs nativos localizan evidencia; no se retiene árbol completo ni literal STEP original. Raw corresponde al valor disponible en web-ifc, con reglas numéricas 3A.
- Memoria adicional proporcional a observaciones/metadatos, miembros y relaciones; sin geometría. Peak RSS/latencia sobre OCI real aún no medidos.
- Test de aislamiento de stores usa cargador CJS dentro del test; integración PostgreSQL real también cubre pipeline sin ese aislamiento.
- Integración con destino no evaluada; validación visual 2C.1 previamente pendiente no bloquea esta fase backend.

## Next milestone

Revisar evidencia y definir siguiente fase. No persistir cantidades, crear API ni conectar políticas a 5D sin autorización.

## Last checkpoint

Commit: el que introduce el checkpoint, resoluble por el comando HEAD anterior.
Checkpoint document: [2026-10-01-fase-3c.md](../checkpoints/bim-core/2026-10-01-fase-3c.md)

Sin push. Documento GeoBIM ajeno continúa untracked, sin abrir, modificar ni incluir.
