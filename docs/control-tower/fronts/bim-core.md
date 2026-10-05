# BIM CORE

Updated: 2026-10-05 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 540efc542a9cddd821f50bba62853a8468b100b1
HEAD: commit que contiene este estado; resolver con `git log -1 --format=%H -- docs/control-tower/fronts/bim-core.md`. Base verificada antes del cierre.

## Current phase

3I — estabilidad de selección, contexto/ghost, Metrados lógicos e Inspector root/member.

## Status

COMPLETE

## Completed

- Selección resuelta antes de reemplazar highlight; clear interno no publica selección vacía en React. Estado de modelos/datasets separado de selección. Refresh de Partidas conserva datos anteriores.
- Contexto automático mediante opacidad Fragments, deltas serializados y capas selección/contexto manual. Respeta hidden, SmartView, isolate y modelos federados; sin nuevas llamadas showAll.
- Inspector presenta root lógico primero y miembro clicado separado, incluyendo root sin geometría. No mezcla propiedades ni asociaciones del child con root.
- Metrados usa la consolidación existente, filtros Partida/Sector/clase lógica/búsqueda, páginas de 100 y CSV lógico filtrado. Tabla desacoplada del layout.
- Fixture OCI: 115 entidades, 7 AE, 112 gráficos, 1842.105; A5: 1 AE, 72 gráficos, 156.616. Roof #389468 frente a Slab #389463: identidad primaria IfcRoof.
- Quantity Provenance, stored-authoring-replicas@1 y publicación generacional preservadas.

## In progress

None. Implementación y validación automática cerradas. Validación visual OCI pendiente de QA; no ejecutada ni afirmada como evidencia.

## Blocked

None.

## Decisions

- Dataset, selección, presentación ghost e identidad de Inspector tienen estados separados.
- Resolución asíncrona conserva selección anterior; intención vigente controla el reemplazo. Errores/404 conservan datasets y permiten fallback a miembro.
- Ghost usa setOpacity/resetOpacity por delta y nunca representa hidden.
- Metrados reutiliza Partidas, consolida miembros completos antes de filtrar/paginar y conserva errores explícitos; no segunda política de cantidades.
- Clase lógica deriva del representante root o standalone; Sector ambiguo/ausente queda null. Tipo usa propiedad inequívoca o Name como fallback.

## Dependencies

- QA/operación BIM: desplegar BFF y frontend juntos y ejecutar pasos visuales del checkpoint sobre OCI real. No despliegue ni reindex realizados aquí.
- CONTROL TOWER: revisión del checkpoint 3I antes de integración. No merge/rebase/cherry-pick ni push.
- 5D Workspace: puede reutilizar tabla data/actions y endpoint. Filtro clase lógica SmartView/Partidas queda diferido; no bloquea Metrados.
- Sin cambios en responsabilidades Documents, Platform, GeoBIM, BCF/PDF/GIS.

## Contracts / API changes

POST /api/bim-index/cost5d/logical-metering-rows: mapping stored-authoring-replicas@1/stored_parameter, scope proyecto/modelos, filtros partida/sector/logicalIfcClass/search, offset/limit y exportAll. Retorna filas lógicas, total, suma o null, opciones y errores; contexto canónico/revisión en cada fila. Snapshot publicado compartido con consolidación Partidas. No QuantityObservations masivas al frontend.

## Database changes

None en 3I. Se conserva schema de 3H.1, sin migración nueva, DB real modificada, backfill ni reindex.

## Tests / Evidence

- BFF: tsx --test --test-concurrency=1 src/db/bim-*.test.ts src/services/bim-*.test.ts src/routes/bim-authoring.routes.integration.test.ts: 244 pass, 0 fail, 0 skipped. PostgreSQL 16 temporal real aislado.
- Frontend logical*.test.mjs + cost-authoring-selection/viewer-bim-context/parameter-graphics/bim-index-polling: 70 pass, 0 fail, 0 skipped; incluye Highlighter real, handlers canvas, SSR Inspector/Metrados y fixture OCI.
- node --test apps/frontend/src/features/viewer-ifc/lib/selection-context.test.mjs: 4 pass. npm run test:visibility -w frontend: 25 pass. Sin fallos/skipped.
- BFF npm run typecheck/build y frontend npx tsc --noEmit/npm run build: PASS en contenedores con fuentes montadas read-only; no deployment.
- Lint BFF dirigido: PASS. Frontend dirigido: 8 errores y 14 warnings preexistentes (canvas 8/13; Inspector 0/1), baseline HEAD comprobado; otros 11 archivos frontend limpios. No corrección de deuda ajena.
- git diff --check y git diff --cached --check requeridos antes de commit; resultado final registrado en checkpoint.

## Risks

- QA visual OCI pendiente: los tests no sustituyen validación de apariencia/rendimiento del renderer real.
- Una request por página/filtro/export, tres lecturas SQL batch constantes más control transaccional, no N+1. Consolidación completa del scope antes de paginar: coste backend/memoria proporcional al scope; no benchmark producción.
- Ghost recorre universo gráfico federado; lotes 450 y deltas, latencia en modelos grandes pendiente de medición real.
- Metadata Sector/Tipo depende de propiedades del representante; missing/ambiguous no se rellena desde child.
- Deuda de lint frontend preexistente permanece; no nuevos diagnósticos.

## Next milestone

Validación visual de los seis pasos OCI del checkpoint y revisión de integración. No iniciar nueva fase automáticamente.

## Last checkpoint

Commit: commit que introduce 2026-10-05-fase-3i.md; resolver con `git log -1 --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-05-fase-3i.md`.
Checkpoint document: [2026-10-05-fase-3i.md](../checkpoints/bim-core/2026-10-05-fase-3i.md)
