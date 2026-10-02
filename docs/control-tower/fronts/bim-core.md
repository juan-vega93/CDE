# BIM CORE

Updated: 2026-10-02 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 6f956117b396f9f362e256f3c5d700a938b25c51
HEAD: commit que añade checkpoints/bim-core/2026-10-02-fase-3f.md; resolver con git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3f.md

## Current phase

3F — Selección lógica 5D y provenance IFC directo implementadas. Consolidación contractual de cantidades bloqueada por STOP CONDITIONS.

## Status

BLOCKED

## Completed

- SmartView Sin valor validado visualmente por usuario y cerrado; sin cambios de producción en esta fase.
- Descarga IFC exact-content → SHA/backend context → mismos bytes al IfcLoader → registro runtime verificado. Sin hashing frontend ni latest revision por path.
- Aggregate 5D devuelve Authoring memberships de generación publicada; selección por contexto exacto, todos los miembros present, sin expansión espacial ni cambios de visibilidad.
- Reader real: 115 entidades / 7 AEs / 112 gráficos / 0 memberships sin resolver, SHA esperado. Generación previa intacta; ninguna reindexación.
- Auditoría A5/A2 persistida por member, método, cantidades y unidades. A5 tiene un AE de la partida; A2 tiene dos standalone.
- Tests: backend 220, frontend 60, visibilidad 25; todos correctos, cero skipped. Typecheck y builds BFF/frontend correctos. Imágenes desplegadas localmente.

## In progress

Validación visual de nueva selección 5D pendiente del usuario. No continuar otra fase ni reindexar automáticamente.

## Blocked

Cantidad contractual: A5 Metrado 156.616 vs Revit 188.31; no hay otro AE de la partida A5 que aporte la diferencia. A2 tiene dos instancias, 289.851 almacenado vs 292.56 referencia. Falta schedule itemizado de la misma revisión y contrato de Metrado; no adoptar ROOT_ONLY ni sustituir por NetVolume.

## Decisions

- Cantidades/dashboard/metering/CSV conservan semántica raw; ningún total lógico de producción inventado.
- IFC entity → AuthoringElement → partida; agrupación de schedule separada, Sector no es identidad.
- La selección canónica exige un runtime único con proyecto/modelKey/revisión exactos y todos los IDs gráficos disponibles. Contexto o geometría incompletos fallan explícitamente.
- Descarga IFC calcula digest sobre su buffer adquirido; datos/headers sin caché. FRAG guardado y selección simple previa preservados.

## Dependencies

- Responsable BIM: schedule Revit de misma revisión con IDs/grupos y significado contractual de Datos_Partida.Metrado, especialmente A5.
- Usuario: reload del modelo y aceptación visual 7 AEs / 112 geometrías, conservando ocultaciones.
- CONTROL TOWER: cierre parcial; integración global no certificada. Transporte Documents/content y proxy solo extendidos para provenance BIM autorizado, sin cambios de workflow/Platform.

## Contracts / API changes

X-Bim-Context URI-encoded JSON en respuesta IFC de /api/documents/content, no-store; CORS/proxy lo transportan. Payload aggregate 5D añade selection v1 con context, authoringElements, memberCount, graphicalLocalIds y unresolvedEntityCount. Sin nuevos endpoints ni cambios de Quantity Policies v1, Authoring identity, cantidades o CSV.

## Database changes

None. Solo lecturas del modelo real. Misma generación b400b692-8a10-4896-a871-2d6ef28001cf, 11362 entidades / 212375 properties. Tests PostgreSQL temporal aislado, eliminado después.

## Tests / Evidence

- Backend BIM suites + API: 220 pass / 0 fail / 0 skipped, PostgreSQL 16 temporal.
- Frontend selección/provenance/SmartView/polling: 60 pass / 0 fail / 0 skipped.
- Visibilidad Node 24: 25 pass / 0 fail / 0 skipped.
- Typecheck/build ambos: exit 0. Lint archivos nuevos limpio; deuda preexistente canvas 8 errores/13 warnings y ruta Documents 3 errores, baselines comparados.
- git diff --check y cached --check antes del commit.
- apps/bff/src/services/fixtures/bim-oci-3f-evidence.json: siete AEs, 115 members, propiedades/volúmenes y otros elementos A5 excluidos por partida/unidad.
- Raw 25305.046; ROOT_ONLY solo diagnóstico 1842.105; referencia externa 1874.96; delta -32.855 (-1.752304%). Filas Revit redondeadas suman 1874.97.

## Risks

Cantidad 5D aún inflada por replicación. Referencia Revit de otra revisión/no verificada. Selección rechaza contextos duplicados, revisiones distintas o geometrías ausentes en lugar de éxito parcial. SHA añade O(bytes) por descarga IFC; metadata/consulta de members aumenta payload proporcionalmente. Validación visual pendiente; pruebas no certifican píxeles.

## Next milestone

Validar selección en MBM recargado sin reindexar. Resolver evidencia contractual y revisión antes de definir consolidación, metering lógico y CSV. Sin push ni siguiente fase automática.

## Last checkpoint

Commit: commit que añade el documento siguiente (resolución indicada en HEAD).
Checkpoint document: [2026-10-02-fase-3f.md](../checkpoints/bim-core/2026-10-02-fase-3f.md)

Checkpoints anteriores preservados. GeoBIM ajeno untracked, nunca abierto/modificado/stageado.