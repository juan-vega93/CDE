# BIM CORE

Updated: 2026-10-02 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: bb680b175e0aa9432b47c9b281a0f3ea70500a22
HEAD: commit que añade checkpoints/bim-core/2026-10-02-fase-3d2b-3e.md; resolver con git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3d2b-3e.md

## Current phase

3D.2B / 3E — Reindex controlado y corrección de Parámetros/reconciliación. Cierre parcial; cantidades y selección 5D canónica bloqueadas.

## Status

BLOCKED

## Completed

- Única reindexación MBM autorizada en desarrollo local. Generación b400b692-8a10-4896-a871-2d6ef28001cf publicada: 11362 entidades / 212375 properties; readers sin mezcla legacy. SHA esperado verificado.
- Auditoría real de partida 0.2.1.3: 115 entidades / 7 AuthoringElements / 112 graphical-present. Snapshot por entidad y test diagnóstico persistentes.
- Sin valor incluido en color; color/visibilidad/selección de bucket usan la misma intersección gráfica exacta. Contadores semánticos y gráficos separados.
- Polling cada 3 s, 200 intentos / 10 minutos máximo; terminal actualiza overview, invalida índice local y recarga catálogo una vez. Cancelación y stale responses cubiertos.
- Backend 216 tests, frontend 46, visibilidad 25: todos correctos, sin skips. Typecheck BFF/frontend y build frontend correctos.

## In progress

Validación visual manual pendiente sobre frontend reconstruido localmente. No iniciar automáticamente otra fase ni reindexar de nuevo.

## Blocked

- Cantidades 5D: ENTITY_SUM 25305.046; ROOT_ONLY diagnóstico 1842.105; referencia Revit 1874.96. A5 almacenado 156.616 frente a referencia 188.31. Falta contrato de cantidades para esta revisión; no está demostrada una policy de producción inequívoca.
- Selección 5D canónica: viewer-source local mock devuelve IFC sin bimContext; no existe evidencia runtime de revisión para mapear. Requiere transporte verificable autorizado, no aliases inventados.

## Decisions

- Semántica 5D de producción intacta. Replicación demostrada no basta para declarar ROOT_ONLY contractual.
- Modelo/revisión exactos; cantidades stored_parameter, ifc_quantity y viewer_geometry independientes.
- Buckets se proyectan por intersección con geometrías disponibles; no heredan descendientes espaciales.
- Sin cambios a picking lógico existente; fallback sin contexto sigue siendo explícito.

## Dependencies

- Contrato de cantidades y referencia de la misma revisión IFC para decidir policy con responsable BIM.
- Provenance runtime verificada para selección 5D; no modificar Documents/Platform en esta fase.
- Usuario: validación visual en navegador. CONTROL TOWER: checkpoint parcial, no listo para integración global.

## Contracts / API changes

Ningún endpoint/payload nuevo. UI Parámetros distingue elementos y geometrías. Sin cambios a IFC/Authoring identity ni a cantidades 5D.

## Database changes

Sin schema nuevo. Aplicadas migraciones ya versionadas en bb680b1 al desarrollo local y publicada una generación del MBM. Legacy conservado, sin reindexar otros modelos. PostgreSQL temporal usado exclusivamente para tests y descartado después.

## Tests / Evidence

- Suites BIM PostgreSQL temporal: 216 pass / 0 fail / 0 skipped.
- Frontend gráficos/polling/selección lógica: 46 pass / 0 fail / 0 skipped.
- Visibilidad Node 24.19: 25 pass / 0 fail / 0 skipped.
- Typecheck BFF/frontend y build frontend: exit 0.
- Lint módulos/tests nuevos: exit 0. Canvas dirigido: 8 errores / 13 warnings preexistentes (baseline 10 / 13); sin ampliar refactor.
- git diff --check y cached --check comprobados antes del commit.
- Evidencia por entidad: apps/bff/src/services/fixtures/bim-oci-3d2b-evidence.json.
- Catálogo real contiene Datos_Partida.Metrado; 4 jobs ready. Sin valor para esa property: 7878 semánticos con geometría indexada; cantidad gráfica runtime/visual no certificada.

## Risks

5D continúa sumando por entidad. Diferencias entre revisión IFC y Revit impiden declarar total contractual correcto. Runtime IFC mock carece de bimContext. Validación visual pendiente; tests no prueban píxeles. Resúmenes pueden truncar otros buckets; el contador gráfico describe IDs disponibles, no geometrías omitidas por límites del catálogo. Legacy/staging siguen ocupando almacenamiento.

## Next milestone

Revisar checkpoint parcial y validar Sin valor/visibilidad manualmente. Resolver dependencia contractual y provenance runtime antes de autorizar cambios 5D. Sin push ni nueva fase automática.

## Last checkpoint

Commit: commit que añade el documento siguiente (resolver como se indica en HEAD).
Checkpoint document: [2026-10-02-fase-3d2b-3e.md](../checkpoints/bim-core/2026-10-02-fase-3d2b-3e.md)

Checkpoints anteriores preservados. Documento GeoBIM ajeno untracked, nunca abierto/modificado/stageado.