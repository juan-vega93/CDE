# BIM CORE

Updated: 2026-10-02 (America/Lima)
Branch: feat/bim-frag-pipeline
Base: 8c46104caca5c4224709bacc06ed281e393337eb
HEAD: checkpoint que añade 2026-10-02-fase-3f-bimcollab.md; resolver con git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3f-bimcollab.md

## Current phase

3F — Consolidación de Metrado replicado y selección lógica, ampliada con evidencia BIMcollab. Implementación y validación automatizada completadas; aceptación visual pendiente.

## Status

COMPLETE

## Completed

- Política opt-in stored-authoring-replicas@1: parámetros almacenados idénticos dentro de composición corroborada, membresía completa y unidad declarada. Conserva observaciones IFC originales; no sustituye Metrado por NetVolume.
- Read real OCI: 115 entidades → 7 AuthoringElements → 112 gráficos; raw 25305.046 → lógico 1842.105 m3; 108 réplicas. A5: 73 miembros semánticos / 72 gráficos / 156.616 una vez.
- Selección separa identities canónicas y mapa gráfico. UI cuenta autoría; click y 5D resaltan conjuntos completos. Hide/isolate/focus consumen ese mapa. Propiedades puntuales conservan child primario.
- Tabla lógica paginada y CSV comparten logicalRows del backend y su trazabilidad. Modo raw disponible explícitamente para diagnóstico.
- Modelos/revisiones invalidan operaciones; cambios React de isSelected/expanded no las cancelan.
- Backend 232, frontend 65, visibilidad 25 tests correctos; typecheck/build BFF/frontend correctos. Imágenes finales desplegadas localmente; BFF health 200, frontend 307 acceso.
- SmartView Sin valor conserva regresiones; cierre visual anterior del usuario preservado.

## In progress

Aceptación visual del usuario sobre las imágenes locales actualizadas. No se inició otra fase.

## Blocked

None. Diferencias frente a Revit de otra revisión NO bloquean eliminar replicación IFC.

## Decisions

- Cantidad lógica almacenada NO significa cantidad contractual verificada frente a Revit.
- Sin DISTINCT(value), factores, agrupación por sector/Tag aislado ni mesh merge. Igual valor entre AEs distintos se suma por separado.
- Conflictos, unidades ausentes, observaciones múltiples, composición sin corroborar o membresía dividida entre partidas/unidades: quantity=null, motivo explícito; no cero ni root escogido silenciosamente.
- Política requiere quantitySource=stored_parameter. Rechaza ifc_quantity/viewer_geometry. sourceProperty y unitProperty quedan en respuesta/CSV; declaration=mapping indica evidencia declarativa, no origen extraído del índice legacy.
- Cambiar propiedad de cantidad vuelve al modo diagnóstico hasta declarar otra vez la política. El mapeo inicial de Metrado usa la declaración autorizada por el usuario.
- Futuro árbol: AuthoringElement → IFC/graphical members; selección individual de pieza como interacción secundaria. Árbol no implementado.

## Dependencies

- Usuario BIM: aceptar visualmente click A5, selección 5D 7/112, visibilidad y metrado lógico. No hay bloqueo de implementación.
- Datos/modelado: significado contractual y comparación entre revisiones requieren evidencia de la misma revisión; no hacer matching automático.
- Consumidores API BIM: optar explícitamente por policy/source y manejar cantidades null. Contrato raw existente permanece disponible.
- CONTROL TOWER: integración global pendiente de aceptación visual; no merge/push. Ninguna responsabilidad de otros frentes modificada.

## Contracts / API changes

POST /api/bim-index/cost5d/aggregate acepta quantityPolicy=stored-authoring-replicas@1 y quantitySource=stored_parameter. Bajo esta política devuelve quantity nullable, elementCount lógico, rawEntityCount/rawQuantity, logicalRows (context, identityKey, representante, miembros, gráficos, réplicas, status/reason), quantityProvenance y errores. Total mixto por unidades queda null. Policy desconocida/fuente incompatible: HTTP 400. Sin policy conserva semántica raw. Los endpoints metering-rows/CSV previos permanecen diagnósticos; la tabla/CSV lógicos consumen el mismo aggregate. Sin endpoints nuevos.

## Database changes

None. No migraciones, reindex, backfill ni modificación de IFC. Generación b400b692-8a10-4896-a871-2d6ef28001cf intacta: 11362 entidades / 212375 propiedades, 4 jobs ready / 0 activos. Tests PostgreSQL 16 aislado temporal.

## Tests / Evidence

- tsx --test --test-concurrency=1 src/db/bim-*.test.ts src/services/bim-*.test.ts src/routes/bim-authoring.routes.integration.test.ts: 232 pass, 0 fail, 0 skipped, PostgreSQL real temporal.
- node --test logical*.test.mjs cost-authoring-selection.test.mjs viewer-bim-context.test.mjs parameter-graphics.test.mjs bim-index-polling.test.mjs (directorio lib viewer): 65 pass, 0 fail, 0 skipped.
- npm run test:visibility -w frontend: 25 pass, 0 fail, 0 skipped.
- npm run typecheck BFF/frontend: exit 0. docker compose -f docker-compose.portal.yml build cde-portal-bff cde-portal-frontend: exit 0.
- Lint dirigido BFF y nuevos módulos frontend limpio. Canvas: 8 errores / 13 warnings, idénticos por regla/mensaje al HEAD base; no se declara lint global limpio.
- Read-only contra DB real con imagen final: 1842.1049999999998 (presentación 1842.105), raw 25305.046000000013; consulta ~6.7 s.
- Fixture existente bim-oci-3f-evidence.json; regresión recorre consecutivamente los 72 miembros gráficos de A5 con Highlighter real.
- git diff --check y cached --check sin errores antes del checkpoint.

## Risks

- Validación visual pendiente. Pruebas de Highlighter/handlers no certifican píxeles.
- Índice legacy no conserva origin.source: la política valida declaración de mapeo, no certifica que una propiedad arbitraria sea realmente stored_parameter. Mapeo incorrecto sigue siendo riesgo; cambio de propiedad desactiva consolidación automática.
- Igualdad numérica exacta y cobertura completa son conservadoras: discrepancias legítimas quedan pendientes. Fases/zonas no mapeadas no tienen validación contractual automática.
- JS usa double; no redondeo antes de consolidar. Tabla muestra 3 decimales. Sin normalización/conversión de unidades.
- Consulta agrega metadata proporcional a entidades y membresías; no N+1 ni nueva apertura IFC. ~6.7 s reales; no se certifica rendimiento interactivo universal.
- CSV lógico exporta todas las filas recibidas (hasta el límite de partidas de la consulta), no todo el proyecto ilimitadamente.
- API instalada Highlighter permite material/color/opacidad/caras; no se encontró opción de eliminar fronteras internas de la composición. No se cambió geometría ni estilo.

## Next milestone

Aceptación visual y revisión del checkpoint. No continuar automáticamente árbol, matching entre revisiones ni otra fase.

## Last checkpoint

Commit: commit que añade el documento siguiente (resolución indicada en HEAD).
Checkpoint document: [2026-10-02-fase-3f-bimcollab.md](../checkpoints/bim-core/2026-10-02-fase-3f-bimcollab.md)

Checkpoints anteriores inmutables. GeoBIM ajeno permanece untracked, nunca abierto/modificado/stageado. Sin push.
