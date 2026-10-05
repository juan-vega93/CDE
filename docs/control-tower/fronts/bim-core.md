# BIM CORE

Updated: 2026-10-05 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: c4eb1b5701cefd2a8c5e23a0e0cca2afd729bc30
HEAD: commit que contiene este estado; resolver con `git log -1 --format=%H -- docs/control-tower/fronts/bim-core.md`. HEAD comprobado antes del checkpoint: 33d0bb92e112aad7dd092c3bb0920ce4aaec3ad5.

## Current phase

3J — estabilidad de presentación, árbol lógico y Schedule BIM paginado.

## Status

READY FOR CHECKPOINT

## Completed

- Ghost derivado de intención, selección gráfica vigente y visibilidad canónica. Escrituras de materiales serializadas; invalidación explícita de los IDs afectados por Highlighter, sin reset global ni showAll.
- Adaptador de opacidad reutiliza definiciones de Fragments y conserva colores originales y estilos activos; evita el agotamiento de IDs Uint16 causado por setOpacity/resetOpacity con preserveOriginalMaterial.
- Árbol espacial proyectado con AuthoringElement root/members; selección lógica sincronizada, reveal visual al cambiar selección, inspección individual del child y preferencias de collapse prioritarias. Una lectura batch por revisión; DOM de members sólo al expandir y properties bajo demanda.
- Metrados es Schedule independiente de Partida: columnas del catálogo, filtros modelo/clase lógica/nivel/sector/tipo/partida/búsqueda/sin partida; una fila por AE. Conflictos visibles. Checkbox raw retirado de UI normal; backend diagnóstico conservado.
- COUNT + página SQL estable y snapshot de publicación. JS recibe sólo la página; no recalcula Partidas/catálogo por cambio de página. CSV utiliza configuración idéntica y rechaza publicaciones mezcladas.
- Runtime frontend reconstruido/desplegado: BUILD_ID `6ggt3mdDkfWhwhyWUZD3K`; imagen `sha256:85f3f3af71042b44398ea27767169afbd81d1b9fd1d856c0eb1df5f82e861594`. Hashes de canvas, Schedule y adaptador coinciden con workspace. BFF también reconstruido/desplegado.

## In progress

Cierre de evidencia de descarga CSV real: botón termina sin error, pero el navegador integrado no entrega evento/archivo descargado a la automatización. Contrato y generación Blob sí verificados en tests del componente real. No declarar descarga inspeccionada.

## Blocked

Validación del archivo CSV descargado: falta acceso al artefacto entregado por el navegador o confirmación manual del usuario. No bloquea la implementación ni las pruebas independientes.

## Decisions

- Mantener `stored-authoring-replicas@1` y 1842.105; Schedule muestra propiedades, no introduce una suma alternativa de cantidades.
- API legacy logical-metering permanece para compatibilidad/auditoría, con su coste anterior; la UI normal utiliza Schedule paginado. No duplicar la policy contractual en SQL.
- Clases de composición provienen del root; standalone usa su entidad. QTO avanzado requiere source/set/quantity/type/role explícitos y queda diferido.
- Context por selección sigue opt-in de 5D/Schedule. Viewport/árbol: highlight-only; contexto manual separado.

## Dependencies

- CONTROL TOWER/usuario: revisión del checkpoint y comprobación del CSV descargado. Sin push/merge.
- Documents/operación: dependencia previa de entrada requireFrag frente a entorno mock; validado IFC directo existente. No se alteró Documents.
- Fragments instalado: integración depende de semántica de materiales 3.4, protegida con prueba de compatibilidad del allocator real.

## Contracts / API changes

- GET `/api/bim-index/authoring/tree?projectCode&modelKey&revisionId`: composiciones de revisión publicada, root y arrays de members/graphical IDs en batch.
- POST `/api/bim-index/schedule/rows`: columnas stored_parameter, filtros, offset/limit; total, publication, filas con contexto canónico y celdas resolved/multiple/ambiguous/missing. Máximo 24 columnas y 500 filas/página.
- Configuración Schedule serializable version 1; sin persistencia de plantillas. Sin cambios a APIs existentes.

## Database changes

None en schema/producción. Sólo lecturas de generación publicada. Sin reindex/backfill/migración. Pruebas PostgreSQL ejecutadas en contenedor temporal aislado.

## Tests / Evidence

- BFF typecheck/build PASS; `tsx --test --test-concurrency=1 src/db/bim-*.test.ts src/services/bim-*.test.ts src/routes/bim-authoring.routes.integration.test.ts`: 245 PASS, 0 fail/skipped, PostgreSQL real aislado.
- Frontend typecheck/build PASS. Selección/Inspector/cost/árbol-render/Schedule/CSV/opacidad/contexto BIM/graphics/polling: 82 PASS, 0 fail/skipped. Node24: context/materials/tree/CSV 11 PASS. `npm run test:visibility -w frontend`: 25 PASS.
- Fixture 7100 AE: páginas 1/30/70, dos consultas/página, 100 filas llegan a JS; conflictos, sin partida, columnas dinámicas y aislamiento generacional verificados.
- OCI navegador: A5→A4→A3→A5 con ghost; viewport retira ghost; SmartView→Schedule; Roof 2161482 seleccionado/revelado, collapse persiste, child #389463 muestra IfcSlab. Schedule total 10953, Sin Partida 8560, IfcRoof sin Partida 5. Navegación mantiene filas durante carga.
- Latencia backend anterior 9427/10582/10679 ms; Schedule 1081/904/778/764 ms, offsets 0/100/2900/6900. SQL 1059/902/776/762 ms; payload 84186/80383/82673/77706 bytes con una columna Metrado. Detalle en checkpoint.
- Navegador páginas 2/3: HTTP+parse 782.6/786.7 ms; respuesta→commit React 4.2/8.6 ms (no CPU render aislado).
- Lint BFF y nuevos módulos limpios. Canvas conserva 7 errores/13 warnings previos (baseline 8/13). Diff checks PASS.

## Risks

- CSV descargado pendiente de inspección manual; tests verifican misma semántica y columnas/filtros.
- COUNT/filtros todavía examinan metadatos del scope en PostgreSQL; SQL paginado no significa O(page) de lectura física. Exportación acumula filas en navegador.
- Tree conserva límites de la jerarquía espacial existente. Members se descargan en batch de IDs; sólo DOM/properties son lazy. Estado de configuración Schedule no persistente.
- QTO avanzado, plantillas guardadas y filtro de clase lógica en otros módulos diferidos; sin cambios SmartView semánticos.
- Deuda lint preexistente y revisión necesaria del adaptador al actualizar Fragments.

## Next milestone

Revisión humana del checkpoint 3J y verificación del CSV descargado. No iniciar otra fase automáticamente.

## Last checkpoint

Commit: commit que introduce `2026-10-05-fase-3j.md`; obtener con `git log -1 --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-05-fase-3j.md`.
Checkpoint document: [2026-10-05-fase-3j.md](../checkpoints/bim-core/2026-10-05-fase-3j.md)
