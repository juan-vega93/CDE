# BIM CORE — checkpoint 3F / evidencia BIMcollab

```yaml
FRONT: BIM CORE
PHASE: 3F — consolidación almacenada y selección lógica
BRANCH: feat/bim-frag-pipeline
BASE: 8c46104caca5c4224709bacc06ed281e393337eb
HEAD: 8c46104caca5c4224709bacc06ed281e393337eb (padre verificado antes de este checkpoint)
STATUS: COMPLETE
IMPLEMENTED:
  - stored-authoring-replicas@1 sobre composición corroborada y membresía completa
  - Identidades lógicas independientes de localIds resaltados
  - Tabla/CSV lógicos desde la misma respuesta backend
  - Estados ambiguos explícitos y separación declarada de fuentes
FILES/DOMAINS TOUCHED:
  - BFF BIM reader y ruta aggregate
  - Viewer BIM selección, contador y panel 5D
  - Tests BIM y documentación exclusiva BIM CORE
DATABASE CHANGES: None; generación publicada sin modificaciones
API/CONTRACT CHANGES:
  - Opt-in quantityPolicy + quantitySource en aggregate existente
  - quantity nullable, conteo lógico, raw diagnostics, logicalRows, provenance del mapeo
  - Policy desconocida o fuente incompatible rechazada
  - Metering raw existente preservado como diagnóstico; sin endpoints nuevos
TESTS:
  - Backend BIM + PostgreSQL temporal: 232 pass / 0 fail / 0 skipped
  - Frontend: 65 pass / 0 fail / 0 skipped
  - Visibilidad: 25 pass / 0 fail / 0 skipped
  - Typecheck BFF y frontend: exit 0
  - Build BFF y frontend: exit 0
  - Lint dirigido BFF y módulos nuevos: limpio
  - Canvas: 8 errores / 13 warnings preexistentes, baseline HEAD comparado
  - Diff check y cached check: sin errores
KNOWN RISKS:
  - Aceptación visual final pendiente
  - Origin.source no existe en índice legacy; fuente declarada en mapeo, no certificada por DB
  - Revit de otra revisión; 1842.105 no equivale a validación contractual
  - Consulta real ~6.7 segundos; metadatos proporcionales al índice
  - JS double; CSV limitado a filas recibidas; fases/zonas no mapeadas requieren auditoría separada
DEPENDENCIES:
  - Usuario para aceptación visual de imágenes locales finales
  - Responsable BIM para comparación contractual de misma revisión
  - Consumidores API opt-in deben manejar quantity null
DEFERRED:
  - Árbol AuthoringElement -> IFC/graphical members y selección individual secundaria
  - Matching cross-revision y validación contractual
  - Eliminación visual de bordes internos; no requisito de identidad lógica
WORKING TREE: cambios BIM de este checkpoint; GeoBIM ajeno untracked, intacto y excluido
PUSH STATUS: NOT PUSHED
READY FOR INTEGRATION: NO
```

El commit que incorpora este documento se obtiene sin historial de chat:
`git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3f-bimcollab.md`.
El HEAD anterior se registra literalmente; no se intenta incrustar un hash autorreferencial imposible. COMPLETE significa implementación y pruebas automatizadas completadas; READY FOR INTEGRATION permanece NO hasta aceptación visual.

## Evidencia real

Proyecto AR3173; modelKey `/AR3173/100021-JYS01-000-ZZZ-MBM-OCI-E3-000100.ifc`.
Revision `sha256:6f991deefc1b895555992219490f877930db38fe968efac6e64a350787c01cdd`.
Generación `b400b692-8a10-4896-a871-2d6ef28001cf`: 11362 entidades / 212375 propiedades; 4 jobs ready y 0 activos antes/después del despliegue.
Lectura real con conexión `default_transaction_read_only=on`, usando imagen final.

| Autoría | Revit ID | Sector | IFC / gráficos | Metrado una vez | Bruto replicado |
|---|---:|---|---:|---:|---:|
| aggregate:209862 | 1177591 | A5 | 73 / 72 | 156.616 | 11432.968 |
| aggregate:287548 | 1641726 | A4 | 18 / 17 | 65.641 | 1181.538 |
| aggregate:298783 | 1693619 | A3 | 20 / 19 | 582.668 | 11653.360 |
| entity:289194 | 1685992 | A2 | 1 / 1 | 127.579 | 127.579 |
| entity:294887 | 1693104 | A1 | 1 / 1 | 125.567 | 125.567 |
| entity:296664 | 1693433 | A2 | 1 / 1 | 162.272 | 162.272 |
| entity:301309 | 1698042 | B3 | 1 / 1 | 621.762 | 621.762 |
| Total | 7 AEs | | 115 / 112 | 1842.105 | 25305.046 |

108 observaciones se consideran réplicas; 7 representantes root/standalone, cero conflictos en esta partida.
A5 tiene 73 miembros **semánticos**, pero root 209862 está `geometryStatus=absent`: son 72 gráficos, no 73. No se forzó la expectativa del texto.
A2 contiene dos AEs standalone distintos; sector no se utiliza como identidad. Otros A5 pertenecen a otras partidas/unidades y no se incorporan.
Fixture trazable: `apps/bff/src/services/fixtures/bim-oci-3f-evidence.json` (sin cambios).

Referencia externa Revit 1874.96: diferencia lógica -32.855 (-1.752304%). No implica error de esta política ni equivalencia geométrica entre revisiones.
Por sector, referencia redondeada frente a Metrado lógico: A1 125.34/125.567; A2 292.56/289.851; A3 582.67/582.668; A4 65.64/65.641; A5 188.31/156.616; B3 620.45/621.762. Esas referencias por sector suman 1874.97 por redondeo.

## Semántica y límites

Policy `stored-authoring-replicas@1`, con `quantitySource=stored_parameter`, exige todos los miembros en una misma partición de partida/nombre/unidad, una observación numérica por miembro y valores idénticos sin tolerancia. Composition corroborada o standalone; fallback, root ausente, partición incompleta, propiedades múltiples, unidad ausente o valores distintos quedan pendientes. No usa first/max/min para arbitrar conflictos. Root se usa como representante solamente después de demostrar igualdad de todos los miembros. Igual valor en AEs distintos no se deduplica.

La respuesta conserva rawEntityCount/rawQuantity, contexto exacto, identidad, localIds, representante, réplica count y quantityProvenance (property/unit refs y declaration=mapping). La declaración no sustituye evidencia de origen ausente en el índice legacy. Cambiar propiedad desactiva la consolidación hasta declarar nuevamente la política. No se alimenta de Qto/mesh automáticamente. No cambia las políticas puras previas ni datos persistidos.

Tabla y CSV lógicos usan las mismas logicalRows del aggregate, una fila por AE de cada partición. Cantidades null y motivos se conservan; no se exportan como cero. Paginación visual de 100 filas, CSV de todas las filas recibidas (consulta de hasta 1000 partidas). Raw metering/API/CSV previos siguen disponibles explícitamente como diagnóstico, sin prometer consolidación a consumidores legacy.

Selección: pick → resolver canónico → identidades lógicas + present localIds → Highlighter. 5D hace lo mismo por conjunto de AEs. Hide/isolate/focus reciben mapa completo; propiedades conservan el child primario. Clics consecutivos por los 72 gráficos de A5 dan siempre la misma identidad y conjunto en test con Highlighter real. No showAll adicional ni reconstrucción de meshes. Cambio de modelo/revisión invalida operaciones; selección UI no invalida su propia operación.

API instalada: Highlighter styles usa MaterialDefinition con color, renderedFaces, opacity y transparent; no se encontró control específico para eliminar fronteras internas entre miembros del AE. Se conserva estilo actual. Futuro árbol debe ser AuthoringElement → miembros, sin implementarlo aquí.

## Validaciones reproducibles

- Backend dentro de imagen con PostgreSQL 16 temporal: `npm run typecheck`; `tsx --test --test-concurrency=1 src/db/bim-*.test.ts src/services/bim-*.test.ts src/routes/bim-authoring.routes.integration.test.ts`.
- Frontend: `npm run typecheck`; `node --test src/features/viewer-ifc/lib/logical*.test.mjs src/features/viewer-ifc/lib/cost-authoring-selection.test.mjs src/features/viewer-ifc/lib/viewer-bim-context.test.mjs src/features/viewer-ifc/lib/parameter-graphics.test.mjs src/features/viewer-ifc/lib/bim-index-polling.test.mjs`.
- Host Node24: `npm run test:visibility -w frontend`.
- `docker compose -f docker-compose.portal.yml build cde-portal-bff cde-portal-frontend`; despliegue local solo de ambos servicios, sin jobs activos. Health BFF 200; frontend 307 hacia acceso.
- Lint dirigido a los 13 archivos de código/tests del checkpoint; canvas comparado con `git show HEAD:.../ifc-viewer-canvas.tsx`, misma deuda por regla/mensaje.
- Sin npm audit fix, cambios de schema, reindexación ni push. GeoBIM no leído/modificado/stageado.

## Aceptación visual pendiente

Recargar MBM y abrir 5D con Metrado/unidad mapeados y política de parámetro almacenado. Filtrar partida 0.2.1.3: 7 elementos, 112 gráficos, 1842.105 m3. Seleccionar cualquier pieza A5: 1 elemento / 72 gráficos; probar hide/isolate/focus y ocultaciones previas. Verificar tabla lógica y CSV: A5 156.616 una vez. Referencia Revit externa sigue separada.

Gates automatizados: cualquier gráfico A5 → misma autoría/conjunto SÍ; contador lógico único SÍ; Metrado replicado contabilizado una vez SÍ. No se declara validación visual realizada.
