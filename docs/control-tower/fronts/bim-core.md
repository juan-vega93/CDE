# BIM CORE

## Estado vigente — Fase 3D.1 (2026-10-02)

**COMPLETE**. IFCLOGICAL corregido; MBM real validado mediante indexación limpia en PostgreSQL temporal. 11.362 entidades, 212.375 propiedades y 191.481 observaciones; cero diagnósticos de extracción. Dos custom properties en dos muros verificadas hasta SmartView, QA y lookup/discovery 5D. Causa del incidente: **STALE_INDEX**, con localIds de otra exportación en el índice real marcado ready. Necesita despliegue del código actualizado y reindexación controlada posterior del MBM; NO ejecutados. No hay evidencia de STALE_CACHE.

158 pruebas automatizadas finales correctas, cero fallidas/skipped; auditoría MBM completada, typecheck y lint dirigido conformes. Código productivo modificado sólo en extracción lógica; sin schema, frontend, políticas ni agregación 5D.

Último checkpoint vigente: [2026-10-02-fase-3d1.md](../checkpoints/bim-core/2026-10-02-fase-3d1.md). HEAD del checkpoint: commit que introduce ese archivo (`git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3d1.md`). Base: 5f02e7ae1dfa3ec34f23e6bcded54934b51a068a.

Dependencias: operación controlada de despliegue/reindexación y refresco de sesión para actualizar la instancia; no cambios de responsabilidades de otros frentes. Siguiente hito: revisión del resultado por CONTROL TOWER. No retomar 3E ni iniciar otra fase.

Se conserva íntegramente debajo el estado previo solicitado de 3E y su checkpoint inmutable. Su error del extractor está corregido por 3D.1; **la auditoría 3E permanece sin completar ni repetir**. La preservación explícita de este bloque responde a la instrucción de no sobrescribir la trazabilidad previa.

Updated: 2026-10-02 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 5f02e7ae1dfa3ec34f23e6bcded54934b51a068a (entrada Fase 3E)
HEAD: 5f02e7ae1dfa3ec34f23e6bcded54934b51a068a

## Current phase

Fase 3E — Auditoría Quantity Provenance del IFC OCI real. Detenida por condición de parada explícita.

## Status

BLOCKED

## Completed

- Fase 3D cerrada en HEAD: cobertura del Property Index y 151 pruebas documentadas en su checkpoint. Evidencia histórica, no extrapolable a OCI.
- IFC original E4 verificado: 50.201.895 bytes, SHA-256 120e9127c5be1cb11541f458968448d7031fcd63b72709af3cf276d6c3b9733c.
- Pipeline actual ejecutado en contenedor sin red y persistencia interceptada en memoria. Recorrido 9114/9114; extracción Quantity Provenance abortada.
- Causa localizada: #558365, Pset_BuildingStoreyCommon.AboveGround = IFCLOGICAL(.U.). No corregida ni omitida.
- Cero cambios funcionales, DB real, reindexación, FRAG, commit o push. PostgreSQL efímero eliminado sin ejecutar baseline.

## In progress

None. Sin procesos de auditoría pendientes.

## Blocked

extractIfcQuantityObservations lanza Unsupported scalar at IFC observation 558365 (bim-quantity-extraction.ts:110). Impide completar el pipeline global y obtener resultados verificables del universo, baseline y policies. Necesita autorización de fase correctiva BIM CORE y repetición posterior de 3E; no depende de otro frente.

## Decisions

- No cambiar 5D ni decidir política contractual en fase diagnóstica.
- No reemplazar IFC por fixtures ni usar DB legacy como fuente de verdad.
- No omitir propiedades ni limitar extractor para eludir la condición de parada.
- BASELINE_NOT_REPRODUCED provisional significa resultado incompleto, no cardinalidad distinta demostrada.
- Stored parameter, IFC quantity y viewer geometry siguen separados.

## Dependencies

- BIM CORE: autorización de corrección del extractor antes de repetir 3E.
- 5D/semántica contractual: pendiente evidencia real; consumidores sin cambios.
- Documents, Platform, viewer y FRAG: sin acciones requeridas.
- CONTROL TOWER: checkpoint de bloqueo disponible, no listo para integración.

## Contracts / API changes

None en 3E.

## Database changes

None. Stores del runner interceptados en memoria; DB productiva no utilizada.

## Tests / Evidence

- tsx audit-runner.ts: 1 ejecución real, 0 completadas, 1 fallida, exit 1; progreso 9114/9114 antes del error.
- IFC #558365 -> Pset #558366 -> relación #558367 -> IfcBuildingStorey #46. Registro original y stack conservados en checkpoint.
- Web-ifc emitió Invalid IFC Line y No basis found for brep; impacto en partida no verificado.
- Baseline SQL, policies, matriz y comparación 64/120 no completados. No se ejecutaron suites nuevas.
- Branch, HEAD, working tree y diff checks verificados antes del checkpoint.

## Risks

- Un valor no soportado en un nivel del modelo aborta la extracción global aunque sea ajeno a la partida.
- No verificados en 3E: 187 elementos, 9 AuthoringElements, 34249.502, 2010.568 ni efecto real 64/120.

## Next milestone

Revisar bloqueo y autorizar corrección separada; repetir auditoría después. No iniciar otra fase automáticamente.

## Last checkpoint

Commit: 5f02e7ae1dfa3ec34f23e6bcded54934b51a068a (código auditado; docs 3E sin commit).
Checkpoint document: [2026-10-02-fase-3e.md](../checkpoints/bim-core/2026-10-02-fase-3e.md)

Documento GeoBIM ajeno permanece untracked, sin abrir, modificar ni stagear.
