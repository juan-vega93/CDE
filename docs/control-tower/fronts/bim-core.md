# BIM CORE

Updated: 2026-10-02 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: de474d7e91588b76040477b32085fd77116aa2fa
HEAD: commit que incorpora el checkpoint 2026-10-02-fase-3d2a-publicacion-atomica.md; resolver con git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3d2a-publicacion-atomica.md

## Current phase

Fase 3D.2A — Property Index generacional con publicación atómica. Implementada y validada en PostgreSQL temporal; sin despliegue ni reindexación real.

## Status

COMPLETE

## Completed

- Staging aislado por generación y revisión; publicación transaccional con lock PostgreSQL por modelo exacto y secuencia DB contra stale writers.
- Bridge legacy opaco hasta primera publicación canónica; después todos los readers comparten la generación publicada, con snapshot transaccional por respuesta.
- Pipeline IFC y ruta posterior a FRAG integrados; bulk legacy rechazado con 409 cuando existe contexto generacional. Authoring validado por revisión y memberships antes de publicar.
- 213 pruebas correctas, cero fallos/skipped; typecheck, build, lint dirigido y migración idempotente correctos.
- Bloqueos anteriores 3D.2/3D.2A resueltos por la autorización explícita del bridge. Sus checkpoints pendientes se preservan sin modificación y se incorporan al mismo checkpoint Git.

## In progress

None. Fase cerrada; no iniciar 3D.2B automáticamente.

## Blocked

None para esta fase. Operación real y siguientes auditorías requieren autorización posterior.

## Decisions

- legacy = opaque fallback; canonical generation = authoritative once published.
- UUID identifica intento DB; BimRevisionId existente identifica bytes IFC. No reinterpretar source_hash ni inferir revisión desde timestamps.
- Definitions por generación porque value_type es mutable; valores heredan scope mediante elemento, con trigger contra referencias cruzadas.
- B más antigua no sustituye C ya publicada. C más nueva todavía building no invalida por sí sola una publicación completa anterior.
- Cantidades almacenadas, Qto y geometría siguen separadas. ROOT_ONLY no adoptado.

## Dependencies

- Operación/despliegue: aplicar schema y BFF coordinadamente, retirar procesos de la versión anterior antes de activar escritores nuevos; no ejecutado aquí.
- CONTROL TOWER: checkpoint disponible para revisión, sin push.
- Frontend: reconciliación 3D.2B diferida. 5D y selección Authoring requieren validación posterior con índice limpio. Sin acciones nuevas en Platform.

## Contracts / API changes

Endpoints y payloads principales conservados. Bulk legacy devuelve 409 GENERATION_CONTEXT_REQUIRED en scopes generacionales, incluso building/failed. Snapshots legacy de proyecto no se sirven después de publicación canónica. Metadata del modelo publicado incorpora bimRevisionId y propertyIndexGenerationId. Sin endpoints nuevos.

## Database changes

bim-index-generations.sql: scopes/generations, generation_id en elements/sets/jobs, unicidad parcial legacy y por generación, published único por scope, vistas compartidas de lectura y validación de scope de valores. Sin backfill ni borrado de datos legacy. Authoring y QuantityObservation sin schema nuevo.

## Tests / Evidence

- tsx --test --test-concurrency=1 src/db/bim-*.test.ts src/services/bim-*.test.ts src/routes/bim-authoring.routes.integration.test.ts: 213/213, fallidos 0, skipped 0, PostgreSQL 16 temporal real.
- npm run typecheck y npm run build (BFF): exit 0.
- ESLint dirigido sobre nueve TypeScript modificados: exit 0.
- tsx src/db/migrate.ts dos veces: exit 0; además test de schema legacy preexistente.
- git diff --check y git diff --cached --check verificados antes del checkpoint; verificación del staging antes del commit.

## Risks

Legacy conserva anomalías hasta publicación canónica. Staging/superseded aumentan almacenamiento; sin scheduler de limpieza. Rendimiento MBM no medido en esta fase. Despliegue requiere coordinación con schema: binarios antiguos no son consumidores generation-aware. Fallo después del publish y antes de job-ready no revierte una publicación válida; reconciliación operativa pendiente de 3D.2B.

Referencia externa suministrada, no recalculada: partida 0.2.1.3; Revit 1874.96 m3; CDE observado aproximadamente 25303.05 m3, 1115 elementos / 115 geométricos. Revisiones pueden diferir; no es prueba de una policy correcta.

## Next milestone

Revisión del checkpoint; autorizar después despliegue/reindexación controlada MBM. Posteriormente auditar 5D y selección de membresías gráficas. No ejecutado ni iniciado.

## Last checkpoint

Commit: commit que añade el documento siguiente (resolución git indicada en HEAD; evita autorreferencia imposible del hash dentro del propio commit).
Checkpoint document: [2026-10-02-fase-3d2a-publicacion-atomica.md](../checkpoints/bim-core/2026-10-02-fase-3d2a-publicacion-atomica.md)

Historial preservado: [3D.2](../checkpoints/bim-core/2026-10-02-fase-3d2.md), [bloqueo inicial 3D.2A](../checkpoints/bim-core/2026-10-02-fase-3d2a.md), [3D.1](../checkpoints/bim-core/2026-10-02-fase-3d1.md). 3E no retomada. Documento GeoBIM ajeno no abierto/tocado/stageado.
