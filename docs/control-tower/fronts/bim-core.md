# BIM CORE

Updated: 2026-10-05 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 28d996a820bfb6866bc38982006372f89d3e211c
HEAD: commit portador de este documento; obtener con `git log -1 --format=%H -- docs/control-tower/fronts/bim-core.md`. HEAD previo verificado: 28d996a820bfb6866bc38982006372f89d3e211c.

## Current phase

3K — reconciliación de piezas exportadas del mismo elemento de autoría. Implementación y validación aislada completas; no desplegada ni reindexada en producción.

## Status

COMPLETE

## Completed

- Auditoría READ-ONLY del MBM OCI publicado: 11362 entidades, 10953 AE; 200 IDs personalizados asociados a varios AE. Siete splits corroborados (40 entidades → 7 AE); 193 grupos con identidades nativas distintas conservados. Evidencia completa de los 200 grupos en fixture 3K.
- Resolver authoring-v2: método corroborated_export_split con evidencia nativa conjunta, nunca cantidad ni ID aislados. Caso 1020025: piezas #173301/#173302 → export-split:173301; representante explícito, root IFC ausente.
- Persistencia/API/árbol/Schedule aceptan composición sin root nativo. Ninguna geometría fusionada. La política stored-authoring-replicas@1 conserva igualdad exacta, membresía completa y rechazo de conflictos; adaptación limitada a reconocer la nueva identidad y representante.
- IFC real SHA-256 6f991deefc1b895555992219490f877930db38fe968efac6e64a350787c01cdd procesado en PostgreSQL temporal: 10920 AE / 11362 members. 0.2.1.8 = 1255.662 m2 en 5D y Schedule; 0.2.1.3 = 1842.105 m3 sin cambio.
- 3J preservado: ghost por origen, inspección individual, árbol/collapse, Schedule independiente de Partida, paginación SQL y columnas configurables.

## In progress

None dentro de 3K. Pendiente operativo: despliegue y reindexación controlada, con autorización futura.

## Blocked

Evidencia manual heredada de 3J: el navegador integrado vuelve a agotar waitForEvent(download); no se obtuvo archivo CSV real para inspección. Requiere archivo descargado accesible o validación manual del usuario. No bloquea la corrección 3K ni sus pruebas independientes.

## Decisions

- Sin IfcRelAggregates/IfcRelNests no se inventa root. representativeLocalId vive en evidencia JSON; los dos miembros son piezas de composición lógica.
- Corroboración exige Tag=ID, contenedor, Name base y sufijos consecutivos, misma clase/tipo/placement relativo/spatial containment, GlobalIds y Representations distintos, geometría presente, ausencia de composición/fallback previa.
- La regla es conservadora y acotada a exportaciones Floor/IfcSlab/FLOOR; ausencia o contradicción conserva identidades separadas. Identidad persistente sigue acotada por project/model/revision.
- QTO sólo corroboración QA; cantidades originales preservadas. 0.2.1.7 mantiene total null por tres fallbacks previos; no presentar subtotal como total válido.

## Dependencies

- CONTROL TOWER/usuario: revisar checkpoint y autorizar despliegue/reindexación posteriores. No push/merge.
- Operación/DB: aplicar constraint authoring aditivo antes del nuevo resolver. Producción observada carece de cde_bim_quantity_observations; revisar estado de migraciones ya existentes antes de cualquier despliegue/reindexado. No se modificó producción.
- Validación manual CSV 3J pendiente de acceso al archivo; Documents, Platform y SmartView sin responsabilidades nuevas.

## Contracts / API changes

Método adicional corroborated_export_split; representativeLocalId opcional en resolve/tree, rootLocalId puede faltar/null para composición sin root nativo. Sin endpoints nuevos. Semántica original IFC preservada.

## Database changes

Sólo constraint de métodos permitidos de cde_bim_authoring_elements; evidencia/representante en JSON existente. Sin columnas/tablas nuevas ni cambio Quantity Provenance/publicación. Migración probada sólo en PostgreSQL temporal.

## Tests / Evidence

- IFC real: 11362 entidades, 212375 propiedades, 191481 observaciones persistidas. APIs resolve/tree devuelven un AE y ambas geometrías.
- Suite BIM con PostgreSQL temporal vacío: 268 PASS, 0 fail, 1 skip condicionado OCI. Caso real + regresiones split: 25 PASS, 0 fail/skipped (23 se solapan con suite BIM).
- Frontend selección/tree-render/Schedule: 62 PASS; contexto/opacidad/graphics/polling: 25 PASS; export final: 8 PASS; Node24 tree/context/materials/CSV: 12 PASS; visibility: 25 PASS.
- CSV del componente: 7100 filas desde páginas 1/20/70; filtros activos con 237/4784 filas; ninguna dependencia de página actual. No equivale a inspección del download real.
- BFF/frontend typecheck y build PASS; lint dirigido PASS; diff checks PASS al cierre.
- Suite BFF global: 299 PASS / 2 fallos administrativos 403≠200, reproducidos sin cambios 3K en imagen anterior (29/31 PASS). Un intento secuencial con toda la BD OCI excedió timeout 60s de generación; repetición en BD vacía pasó sin aumentar timeout ni cambiar tests.

## Risks

- Producción todavía contiene 10953 AE y 1371.738 m2 para 0.2.1.8 hasta reindexación controlada.
- Convención de exportación específica; no regla universal por Tag/ID, cantidades o tolerancia. Sin matching entre revisiones.
- Tres fallbacks en 0.2.1.7 y Zona TERCERA ETAPA vs partida ETAPA 2 en 1020025 son datos existentes, no corregidos.
- Web-IFC emite avisos de triangulación en otras piezas del IFC real; pipeline completó. La inferencia exige geometría presente y no intenta reparar el IFC.
- CSV real pendiente; fallos de seguridad baseline ajenos al frente.

## Next milestone

Revisión de 3K, autorización operativa para migración/despliegue/reindexación controlada y cierre manual CSV 3J. No iniciar otra fase automáticamente.

## Last checkpoint

Commit: commit que introduce 2026-10-05-fase-3k.md; obtener con `git log -1 --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-05-fase-3k.md`.
Checkpoint document: [2026-10-05-fase-3k.md](../checkpoints/bim-core/2026-10-05-fase-3k.md)
