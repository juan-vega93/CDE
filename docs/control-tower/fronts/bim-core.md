# BIM CORE

Updated: 2026-10-01 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 67c7758636282bbfdba0884d7802143e198419f8 (entrada de Fase 3A; no merge-base)
HEAD: commit que introduce el checkpoint 3A; resolver con `git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-01-fase-3a.md`.

Código y estado se entregan en un único commit. La referencia anterior obtiene su hash sin autorreferencia en el contenido del commit.

## Current phase

Fase 3A — Modelo puro de Quantity Provenance. Sin conexión a consumidores de producción.

## Status

COMPLETE

Corresponde a Fase 3A, no a todo el programa BIM Core.

## Completed

- QuantityObservation puro con BimProcessingContext canónico, localId y sources cerradas stored_parameter / ifc_quantity / viewer_geometry.
- Identidad estructural de property/quantity, raw preservado, numeric opcional conservador y unidad explícita con evidencia o unknown.
- Observaciones repetidas conservadas, incluidas root/children; asociación AuthoringElement opcional sin consolidar.
- 24 pruebas nuevas y 59 de regresión BIM correctas; typecheck BFF y lint dirigido correctos.
- Fase 2C.1 permanece cerrada; su checkpoint se conserva intacto.

## In progress

None. Sin siguiente fase de implementación autorizada.

## Blocked

None para el modelo puro. La fixture OCI excluye cantidades: no permite afirmar que los valores del test son Metrados reales. Es una limitación de evidencia, no un bloqueo del contrato.

## Decisions

- La entidad IFC es dueña original de la observación; AuthoringElement sólo puede enriquecerla en el mismo contexto.
- Clave por contexto, localId, source, locator estructural y occurrenceIndex de entrada. Sin value como identidad, GUID inventado ni matching cross-revision.
- Numeric sólo para números JS finitos o strings decimales simples. Locale/comma, unidades embebidas y otros casos ambiguos permanecen raw sin numeric.
- No inferir unidades ni herencia del modelo. Explicit exige referencia a property o unidad IFC; sin evidencia, unknown.
- Sin prioridades entre fuentes, sumas ni deduplicación. El builder no recupera datos ya perdidos por extracción.
- Actualizar este archivo en hitos; checkpoints inmutables. Correcciones posteriores requieren otra instantánea.

## Dependencies

- Identidades BIM Core: reutiliza BimProcessingContext; no reconstruye modelKey/revisionId.
- Extractor/property indexer: futura alimentación requiere conservar tipo IFC, ocurrencia y unidad antes del aplanado. No se modifica ni se solicita implementación en esta fase.
- Viewer: getItemsVolume ya calcula volumen, pero no entrega QuantityObservation por entidad; aquí sólo se representa la categoría, sin cambiar el viewer.
- 5D: sigue consumiendo índice y reglas actuales. Cualquier consolidación necesita alcance posterior explícito.
- Documents/Platform/FRAG: sin cambios ni acción pendiente para esta fase.
- CONTROL TOWER: revisión del checkpoint y evaluación de integración con rama destino pendientes.

## Contracts / API changes

Contrato interno nuevo en `apps/bff/src/services/bim-quantity-provenance.ts`: tipos, normalizeQuantityNumericValue y createQuantityObservation. Sin API pública nueva ni modificada; ningún consumidor de producción conectado.

## Database changes

None. Sin tablas, migraciones, persistencia, reindexación ni backfill.

## Tests / Evidence

Ejecutados el 2026-10-01 antes del commit:

- `tsx --test src/services/bim-quantity-provenance.test.ts` → 24/24.
- `tsx --test src/services/bim-quantity-provenance.test.ts src/services/bim-authoring-resolver.test.ts src/services/bim-property-indexer.service.test.ts src/services/bim-model-identity.test.ts src/services/bim-revision-identity.test.ts` → 83/83, 0 failed, 0 skipped.
- `npm run typecheck` en BFF → exit 0.
- ESLint dirigido sobre ambos archivos nuevos, preset instalado eslint-config-next/typescript → 0 errores/0 warnings. BFF no tiene configuración ESLint propia; su script lint ejecuta tsc.
- Tests/tipos: imagen cde-cde-portal-bff, src readonly, cwd /app/apps/bff, network none; tsx en /app/node_modules/.bin/tsx. Lint: imagen frontend con src BFF readonly, sin cambiar configuración.
- Branch, HEAD y working tree verificados; diff/check y staged diff revisados antes del commit. No suites DB ni frontend repetidas: no cambian sus consumidores.
- OCI: 187 IDs reales con valor/contexto SINTÉTICOS. Roots y children se preservan como 187 observaciones; no se demuestra una suma OCI real.

## Risks

- El índice plano pierde tipo, unidad, raw original y multiplicidad; no reclasificarlo por nombre/valor como ifc_quantity.
- occurrenceIndex requiere procedencia conservada; no promete estabilidad entre extracciones reordenadas.
- El modelo puro recibe contexto tipado/evidencia extraída; no sustituye validación de inputs HTTP no confiables.
- No hay evidencia nueva sobre 34249.502 ni se declara 2010.568 correcto.
- Integración con rama destino no evaluada; validación visual de 2C.1 sigue pendiente, sin bloquear esta fase pura.

## Next milestone

Revisión del contrato y definición explícita de la siguiente fase. No iniciar automáticamente alimentación, persistencia, consolidación ni corrección 5D.

## Last checkpoint

Commit: el que introduce el checkpoint; resoluble mediante el comando HEAD anterior.
Checkpoint document: [2026-10-01-fase-3a.md](../checkpoints/bim-core/2026-10-01-fase-3a.md)

Sin push. `docs/diagnostico-integracion-avance-geobim.md` permanece untracked, sin abrir ni modificar.
