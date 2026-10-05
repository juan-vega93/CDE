# BIM CORE

Updated: 2026-10-05 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 2ae2454351d76b01759c8d99d4fae7c0307dc8a4
HEAD: commit que incorpora este estado; resolver con git log -1 --format=%H -- docs/control-tower/fronts/bim-core.md. Base verificada antes del cierre.

## Current phase

3I.2 — ghost según intención explícita de selección.

## Status

COMPLETE

## Completed

- Selección lógica, Inspector root/member, Metrados y quantities de 3I conservados.
- Viewport, selección manual y llamadas programáticas por defecto: highlight-only. Metrados/Partidas solicitan context explícitamente al mismo adaptador serializado.
- Intención viaja con la operación asíncrona y su token; resultado obsoleto no reactiva ghost. Clear retira sólo la capa de selección.
- Contexto manual permanece independiente. Ghost usa el controlador existente y deltas de opacidad, sin nuevas llamadas showAll ni cambios de visibilidad.
- Recorrido 5D legacy/raw usa el mismo commit de selección/contexto; deja de escribir ghost en la capa manual.
- Frontend reconstruido y desplegado localmente: BUILD_ID 5bNlQ_oy3686chCHblyhJ. BFF/DB sin cambios ni reinicio en esta fase.
- Validación OCI en navegador: click normal sin ghost; A5 72 geometrías con ghost; A5 -> viewport #185053 retira ghost y mantiene nueva selección; Partida 7/112 con ghost; SmartView 2161482 conserva color/filtro y catálogo 52 sin ghost automático. Metrados mantiene 7 filas/1842.105.

## In progress

None. No iniciar otra fase automáticamente.

## Blocked

None para IFC directo. Sigue pendiente la dependencia de entrada desde Documentos: requireFrag frente a entorno mock, registrada en 3I.1. No modificada aquí.

## Decisions

- SelectionPresentation = highlight-only | context; opt-in explícito, nunca deducido de logicalSelection.
- Estado de datasets/autoría no depende de presentación; identidad y properties mantienen contrato previo.
- Operaciones serializadas mantienen el ghost anterior hasta commit; A -> B aplica sólo delta. Capa manual no se limpia con selección normal.
- Sin cambios en stored-authoring-replicas@1, Quantity Provenance, generación ni fuentes/unidades.

## Dependencies

- CONTROL TOWER/usuario: revisión del checkpoint y aceptación visual adicional. No merge ni push.
- Documents/operación: entrada normal a IFC requiere resolver FRAG/mock; validación por ifcUrl directo existente. Ninguna responsabilidad ajena modificada.
- Futuro workspace 5D puede reutilizar selección con intención y tabla lógica sin cambiar identidad.

## Contracts / API changes

Sin cambios HTTP/BFF. Contrato interno opcional en selectMember/selectLogical y callback de commit: SelectionPresentation, default highlight-only. Sólo handlers 5D pasan context. Contexto/Isolate explícitos permanecen separados.

## Database changes

None. Sin reindex, backfill, migraciones ni modificaciones de DB.

## Tests / Evidence

- Imagen frontend final: 75 tests logical*/cost-authoring-selection/viewer-bim-context/parameter-graphics/bim-index-polling PASS, 0 fail/skipped.
- npm run test:visibility -w frontend: 25 PASS. selection-context.test.mjs: 4 PASS.
- Pruebas nuevas: viewport/manual cero writes de opacidad; Metrados/Partidas context explícito; 5D->viewport->5D; A->B sin reset del fondo compartido entre lotes; resultado tardío ignorado; contexto manual/hidden/isolate/federación preservados. Wiring real de modules/index.ts y Highlighter real ejecutados.
- npx tsc --noEmit y npm run build frontend PASS. Docker Compose build frontend PASS; runtime hashes del adaptador y wiring iguales al workspace.
- ESLint dirigido: seis archivos limpios; canvas conserva 8 errores/13 advertencias preexistentes. No deuda nueva ni refactor para corregirla.
- git diff --check y git diff --cached --check PASS antes de commit.
- Checkpoint 3I.1 previamente untracked se incorpora intacto para trazabilidad del despliegue anterior.

## Risks

- Ghost enumera geometrías y aplica lotes; no benchmark de latencia ni grabación exhaustiva de frames. Tests verifican estados intermedios de opacidad.
- 5D raw ahora destaca el mapa completo por el mismo adaptador que 5D lógico, en lugar del cutoff legacy que sólo aplicaba contexto manual; selecciones raw masivas pueden tener mayor coste de highlight. No afecta política/cantidades.
- Deuda lint del canvas y dependencia Documents/FRAG siguen abiertas fuera del alcance.

## Next milestone

Revisión de Fase 3I.2. No continuar hacia otros cambios BIM automáticamente.

## Last checkpoint

Commit: commit que introduce 2026-10-05-fase-3i2.md; obtener con git log -1 --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-05-fase-3i2.md.
Checkpoint document: [2026-10-05-fase-3i2.md](../checkpoints/bim-core/2026-10-05-fase-3i2.md)
