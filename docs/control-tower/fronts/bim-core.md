# BIM CORE

Updated: 2026-10-02 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 1a8ef2459b8df3ddf3aaec437a726c11ab1c24c0
HEAD: checkpoint commit containing this document; pre-commit HEAD verified as Base. Resolve with `git log -1 --format=%H -- docs/control-tower/fronts/bim-core.md`.

## Current phase

3H.1 — Quantity Provenance persistente y comparación geométrica interna, backend only.

## Status

COMPLETE

## Completed

- Persistencia normalizada por generation/localId/occurrence del extractor, con source, native IDs, tipo IFC, raw/numeric, unidad y enrichment de autoría. No deduplicación por AE.
- Pipeline reutiliza las observaciones ya extraídas y las persiste antes de publicar. Nuevas generaciones del pipeline requieren completitud de provenance. Una apertura IFC, hash, resolver y extracción; sin segunda descarga.
- Consulta interna batch de AEs en una sentencia y snapshot publicado; distingue root, clicked primary, children y standalone. Estadísticas completas y evidencia acotada por rol, con auditTruncated explícito.
- Evaluador puro: selector set/name/type/role explícito; ambas fuentes conservadas; tolerancias solo suministradas por caller. Unidad desconocida impide conformidad, pero conserva delta numérico diagnóstico.
- Roof #389468 / Slab #389463 y native quantities reales conservados. A5: stored 156.616 vs root NetVolume 188.05910326170218; sin cambiar stored 5D.
- 5D permanece en 1842.105 con stored-authoring-replicas@1. La explicación Dynamo desactualizado proviene del usuario, no de una inferencia automática del software.

## In progress

None. Fase finalizada; no comenzar siguiente fase automáticamente.

## Blocked

None para el alcance backend. La comparación contractual de quantities Unit=$ necesita evidencia/configuración de unidades futura; ahora se informa unit_incompatible sin inferencia.

## Decisions

- Propiedad normal y quantity IFC se distinguen por extracción tipada, nunca por prefijo Qto.
- Se reutiliza publicación 3D.2A, no otro puntero. Generaciones históricas sin provenance continúan legibles, sin backfill.
- La observación pertenece a generación y entidad; autoría es enrichment, no FK a UUID reemplazable del AE.
- Primary/clicked es entrada de consulta validada contra miembros, no identidad persistente del AE.
- Los detalles de auditoría son muestras acotadas, no candidatos completos si auditTruncated=true. El evaluador admite esa señal y rechaza decisión por evidencia incompleta.
- Sin política universal de unidades, tolerancias, source, role o quantity contractual.

## Dependencies

- CONTROL TOWER: integrar checkpoint 3H.1 y preservar evidencia histórica 3H.
- Operación BIM: aplicar migración aditiva al desplegar BFF antes de procesar nuevos IFC. Migración validada solo en PostgreSQL temporal; no desplegada a DB real en esta fase.
- Producto/QA: definir configuración de comparación y evidencias de unidades; no bloquea almacenamiento ni diagnóstico numérico.
- Futuro frontend 5D/Inspector consumirá contrato interno; requiere fase autorizada. No cambios Documents, Platform ni GeoBIM.

## Contracts / API changes

Sin endpoints públicos nuevos. Internos: replaceGenerationQuantityObservations, queryAuthoringQuantitySummaries y compareStoredToIfcQuantity. Query por contexto canónico/revisión y generación publicada opcionalmente fijada; selector source/set/name/type/role. Root y primary conservan localId/class/GlobalId independientes. Audit limitado a 256 por rol por defecto (máximo configurable 2000), conteos/min/max sobre todos los registros.

## Database changes

Nueva cde_bim_quantity_observations con FK generation y borrado en cascada, PK generation/localId/occurrence e índice de lookup por AE/source/set/name/type. Escritura en transacción y lotes de 2000. Metadata generation registra quantityProvenanceRequired/quantityObservationCount. Sin cambios de tablas Authoring ni Property Index; sin reindex/backfill ni cambios a DB real.

## Tests / Evidence

- PostgreSQL 16 temporal real: suite BIM BFF 244 pass / 0 fail / 0 skipped; incluye publicación, pipeline, resolver, property index, revision/model identity, API Authoring y 5D OCI.
- Regresión frontend selección/5D/contexto/parámetros/polling: 65 pass / 0 fail / 0 skipped.
- npm run test:visibility -w frontend: 25 pass / 0 fail / 0 skipped.
- BFF npm run typecheck y npm run build: PASS. ESLint dirigido: PASS (0 errores/advertencias).
- Fixture sintética de escala: 191481 observations, 96 INSERT batch, escritura 4405.02 ms, consulta 611.82 ms; RSS final 484225024 bytes. No benchmark de producción.
- Evidencia real por miembro/native IDs de 3H preservada sin modificaciones en checkpoints/bim-core/2026-10-02-fase-3h-evidence.json.

## Risks

- RSS material: fixture +169672704 bytes; escritura +206020608 bytes (asignación/GC incluidas, no heap vivo). Consulta acotada evita transportar 191k objetos; escala real distribuida debe monitorearse al operar.
- Generaciones históricas permanecen sin estas observaciones hasta procesamiento explícito autorizado.
- Despliegue debe aplicar migración antes de usar código nuevo. Sin deployment ni reindex en esta fase.
- Unit=$ permanece unknown; no se puede declarar mismatch contractual A5 con unidades no corroboradas.
- Retención de generaciones superseded conserva también sus observations; política de limpieza futura fuera de este alcance.

## Next milestone

Revisión del checkpoint. Futuro 5D Workspace como módulo principal, no panel inferior permanente: Schedule por AE, filtro partida, stored/QTO/delta/QA, selección sincronizada, members expandibles, gráficos/resumen, CSV, ancho suficiente, responsive y contexto 3D preservado. Viewer/5D/Quality/Coordination son posibilidades; navegación final no decidida. Futuro Inspector separará elemento lógico (autoría/root IFC class/members) de elemento clicado (IFC class/localId/GlobalId). No implementados.

## Last checkpoint

Commit: commit que introduce 2026-10-02-fase-3h1.md; resolver con git log -1 --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3h1.md.
Checkpoint document: [2026-10-02-fase-3h1.md](../checkpoints/bim-core/2026-10-02-fase-3h1.md)

Documentos 3H preservados e incluidos con este cierre. GeoBIM permanece ajeno y untracked. No push.
