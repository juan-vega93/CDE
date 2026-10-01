# BIM CORE

Updated: 2026-10-01 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 8e4a48a06adb8dd4c1d7baa40eac5aea18a43d88 (entrada de Fase 3B; no merge-base)
HEAD: commit que introduce el checkpoint 3B; resolver con `git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-01-fase-3b.md`.

Código y checkpoint se entregan en un único commit; la referencia Git evita autorreferencia del hash.

## Current phase

Fase 3B — Motor puro y versionado de políticas diagnósticas de cantidades. No conectado a producción.

## Status

COMPLETE

Corresponde sólo al alcance de Fase 3B.

## Completed

- evaluateQuantityPolicy con tres políticas v1: ENTITY_SUM, AUTHORING_ROOT_ONLY y AUTHORING_SINGLE_OBSERVATION; ninguna es política contractual OCI.
- Filtrado por source e identidad estructural exactos; numericValue finito, sin volver a interpretar raw.
- Unidades exactas o uniformes; unknown sólo si todas son unknown y se permite explícitamente. Sin conversión.
- Un único contexto por evaluación; trazabilidad de toda key, incluidos rechazos y bloqueos; resultados resolved/ambiguous/not_evaluable.
- Orden canónico para resultados deterministas; keys duplicadas generan ambigüedad, no deduplicación.
- QuantityObservation 3A, AuthoringElement, selección y 5D productivo permanecen sin modificar.

## In progress

None. Siguiente fase sin definir ni autorizar.

## Blocked

None para el motor puro. No hay cantidades OCI reales completas en la fixture; los ejemplos de reglas son sintéticos y no validan totales reales.

## Decisions

- policyId cerrado + version=1 + purpose=diagnostic; nueva semántica requerirá nueva versión. Configuración completa devuelta en el resultado.
- ENTITY_SUM suma toda observación elegible, incluso valores iguales o varias observaciones de una entidad.
- ROOT_ONLY exige exactamente una observación root o standalone elegible por grupo observado. Children quedan excluidos; no hay fallback al child.
- SINGLE_OBSERVATION exige exactamente una elegible por grupo, independientemente del rol.
- Cero candidatas por grupo es not_evaluable; varias candidatas o roles contradictorios son ambiguous. Si también hay un bloqueo, prevalece not_evaluable y se conservan todos los diagnósticos.
- Unidades se comprueban antes de seleccionar por rol, incluidos children. Un conflicto bloquea el resultado completo: nunca se publica un subtotal como resultado resuelto.
- El universo de grupos procede de observaciones que coinciden con el target, incluidas no numéricas; no se infieren grupos ausentes de la entrada.
- Checkpoints previos inmutables; este estado se actualiza sólo en hitos.

## Dependencies

- QuantityObservation/BimProcessingContext: consumo de contratos 3A existentes, sin cambiarlos.
- AuthoringElement: las políticas authoring requieren enriquecimiento externo dentro del mismo contexto. Si falta, diagnóstico; no DB ni inferencia.
- Extractor: futura alimentación aún requiere preservar procedencia antes del aplanado; fuera del scope actual.
- 5D: ninguna integración. Definir/aprobar política contractual y alimentación real requiere una fase posterior.
- Viewer/Documents/Platform/FRAG: sin cambios ni acciones externas necesarias para esta fase.
- CONTROL TOWER: revisar evidencias y evaluar integración con rama destino; no se ha realizado merge ni push.

## Contracts / API changes

Nuevo contrato interno en `apps/bff/src/services/bim-quantity-policy.ts`: QuantityTarget, QuantityPolicy, QuantityEvaluation y evaluateQuantityPolicy. Sin endpoints ni consumidores productivos nuevos.

## Database changes

None. Sin tablas, migraciones, persistencia, reindexación o backfill.

## Tests / Evidence

- `tsx --test --test-reporter=spec src/services/bim-quantity-policy.test.ts src/services/bim-quantity-provenance.test.ts`: 56/56 (32 motor + 24 de 3A), 0 fallidas, 0 skipped.
- `npm run typecheck` en BFF: exit 0.
- ESLint dirigido a los dos archivos nuevos con preset TypeScript instalado: 0 errores y 0 warnings.
- Docker local sin red, src readonly; tests/typecheck en cde-cde-portal-bff, cwd /app/apps/bff; lint en imagen frontend usando herramientas, sin modificar frontend.
- Branch/HEAD/working tree comprobados; git diff --check y staged diff revisados antes del commit.
- Sin tipos compartidos modificados; no suites PostgreSQL ni frontend necesarias para esta fase.

## Risks

- No se ha validado 34249.502 ni 2010.568 como total correcto; fixture OCI usada sólo para IDs/estructura con cantidades sintéticas.
- Validación/enriquecimiento de entradas debe garantizar pertenencia real al AuthoringElement. El motor no la demuestra ni consulta persistencia.
- Ausencia total de observaciones de un grupo no es detectable sin un universo externo; no inventar cobertura completa.
- Suma JS determinista mediante orden canónico; sin aritmética decimal exacta ni redondeo de negocio. Overflow bloquea resultado.
- ENTITY_SUM puede resolver con observaciones no numéricas excluidas: la traza y contadores explican esa elegibilidad, no certifican completitud contractual.
- Integración con rama destino no evaluada. Validación visual previa de 2C.1 sigue pendiente, sin bloquear este motor puro.

## Next milestone

Revisar reglas y evidencia; definir explícitamente siguiente fase. No conectar a 5D ni seleccionar una política contractual automáticamente.

## Last checkpoint

Commit: el que introduce el checkpoint, resoluble por el comando HEAD anterior.
Checkpoint document: [2026-10-01-fase-3b.md](../checkpoints/bim-core/2026-10-01-fase-3b.md)

Sin push. `docs/diagnostico-integracion-avance-geobim.md` sigue untracked y fuera del carril, sin abrir ni modificar.
