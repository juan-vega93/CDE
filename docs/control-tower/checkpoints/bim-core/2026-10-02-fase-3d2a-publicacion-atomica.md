FRONT: BIM CORE
PHASE: 3D.2A — Publicación atómica del Property Index
BRANCH: feat/bim-frag-pipeline
BASE: de474d7e91588b76040477b32085fd77116aa2fa
HEAD: commit que añade este checkpoint; resolver mediante git log -1 --diff-filter=A --format=%H -- docs/control-tower/checkpoints/bim-core/2026-10-02-fase-3d2a-publicacion-atomica.md

STATUS: COMPLETE

IMPLEMENTED:
  - Generaciones staging con revisión canónica existente, publicación DB atómica y protección de writer antiguo.
  - Bridge legacy opaco; lectores comunes de published, sin fabricar revisiones legacy.
  - Pipeline IFC/FRAG, aislamiento de batches/definitions, coordinación de metadata/jobs y rechazo del bulk legacy en scopes generacionales.
  - Validación de conteos y mismo contexto/memberships Authoring antes de publicar.

FILES/DOMAINS TOUCHED:
  - apps/bff/src/db/bim-index-generations.sql: schema aditivo, índices, views y trigger de integridad.
  - apps/bff/src/db/bim-index-generations.ts: create/fail/publish/resolver, lock y snapshot de lectura.
  - apps/bff/src/db/bim-index-generations.integration.test.ts: PostgreSQL real, HTTP bulk, legacy y concurrencia.
  - apps/bff/src/db/bim-index-store.ts: writers, jobs/recovery, lectores, snapshots legacy y counts.
  - apps/bff/src/db/migrate.ts: incorpora nuevo SQL.
  - apps/bff/src/routes/bim-index.routes.ts: respuesta bulk 409.
  - apps/bff/src/services/bim-property-indexer.service.ts: integración generacional sin segundo parse/hash.
  - apps/bff/src/services/bim-authoring-pipeline.integration.test.ts: A persiste ante fallo real Authoring y metadata de revisión.
  - apps/bff/src/services/bim-quantity-extraction.test.ts: mock de nueva frontera de persistencia en prueba de extracción existente.
  - apps/bff/src/services/documents.service.ts: preservar metadata publicada al registrar candidato; retirar import sin uso ya existente detectado por lint.
  - docs/control-tower/fronts/bim-core.md: estado vivo compacto, referencias a historial preservado.
  - Checkpoints previos pendientes 2026-10-02-fase-3d2.md y 2026-10-02-fase-3d2a.md: preservados sin modificación e incluidos.
  - Este checkpoint nuevo e inmutable.

DATABASE CHANGES:
  - cde_bim_index_scopes: identidad project_code + canonical_model_key con COLLATE C y UNIQUE.
  - cde_bim_index_generations: UUID por intento, scope/model FKs, revision_id validada sha256, secuencia DB, estado, counts, metadata y timestamps.
  - UNIQUE parcial published por scope. Estados building/published/failed/superseded.
  - generation_id nullable en elements/sets/jobs. NULL conserva significado legacy, sin backfill.
  - Se sustituyen UNIQUE originales elements(model,localId) y sets(model,name) por equivalentes parciales legacy y por generación; sin borrar filas.
  - Definitions son por set generacional; values heredan generación del elemento. Trigger impide enlazar valores con definitions de otro modelo/generación.
  - Función común published, views visible_elements/visible_models; lookup documental sin case folding.
  - Sin cambios Authoring schema ni persistencia QuantityObservation. DB productiva no consultada/modificada.

API/CONTRACT CHANGES:
  - Sin endpoints nuevos. Bulk sin generation context: compatible legacy, 409 GENERATION_CONTEXT_REQUIRED desde que existe un intento canónico para el scope.
  - Registro de modelos y jobs no puede invalidar metadata publicada durante un nuevo intento. Tokens de jobs impiden sobrescritura por un intento antiguo.
  - Metadata publicada añade bimRevisionId/propertyIndexGenerationId; source_hash y source_version no se reinterpretan como revisión.
  - Snapshots legacy de proyecto se omiten cuando existe alguna publicación canónica; no pueden sobreponerse al índice publicado.

TESTS:
  - PostgreSQL 16 temporal con --network none y --tmpfs /var/lib/postgresql/data; BFF de test comparte únicamente su namespace de red.
  - Schema/source del workspace montados en el contenedor de test. No se validó contra código de una imagen antigua.
  - tsx src/db/migrate.ts dos veces: correctos. Test adicional crea schema anterior con filas y ejecuta nueva migración dos veces sin pérdida/backfill.
  - npm run typecheck: exit 0.
  - npm run build: exit 0, artefactos en contenedor descartable.
  - tsx --test --test-concurrency=1 src/db/bim-*.test.ts src/services/bim-*.test.ts src/routes/bim-authoring.routes.integration.test.ts: 213 correctos, 0 fallidos, 0 skipped, 0 cancelled (130 tests top-level, incluidos subtests en total).
  - Incluye generation/publication, index-store (SmartView/QA/5D), coverage, indexer, Authoring pipeline/store/API/resolver, Provenance 3A, Policies 3B, Extraction 3C, modelo/revisión y derivado provenance.
  - ESLint recomendado TypeScript dirigido a los nueve TS modificados: exit 0. Sin lint global.
  - git diff --check y git diff --cached --check: correctos antes del checkpoint; staging explícito y nueva comprobación antes del commit.
  - Iteraciones corregidas: expectativa anterior model failed sustituyó a ready publicado conservado; replaceAll de test incompatible con target sustituido por regex; import previo sin uso retirado. No quedan fallos abiertos.

KNOWN RISKS:
  - Legacy mantiene su estado opaco, incluidas contradicciones, hasta nueva publicación.
  - Deploy coordinado schema+BFF necesario; binarios antiguos no filtran por generación y sus UPSERT antiguos no son compatibles con los índices parciales nuevos. No ejecutado aquí.
  - Generaciones failed/superseded se retienen; crece almacenamiento y falta housekeeping deliberadamente.
  - No benchmark/reindex MBM real. Trigger y filtros añaden lecturas indexadas; no se afirma latencia productiva.
  - Respuestas individuales tienen snapshot REPEATABLE READ; dos requests independientes a ambos lados de un publish pueden legítimamente reflejar A y B respectivamente. No mezclan generaciones dentro de la misma respuesta.
  - Fallo de actualización del job después de commit de publicación deja el índice válido publicado; no se revierte. Conciliación operativa/frontend pertenece a fase posterior.

DEPENDENCIES:
  - Operación: despliegue coordinado y reindex controlado posterior, sujetos a autorización.
  - CONTROL TOWER: revisar checkpoint local; sin push.
  - Frontend 3D.2B, auditoría 5D y verificación selección lógica: diferidas. No cambios en Platform ni responsabilidades de otros frentes.

DEFERRED:
  - Reindex AR3173/MBM; 404; frontend reconciliation; limpieza programada; Quantity policies; auditoría total 5D; selección; rediseño FRAG; 3E.

WORKING TREE:
  Antes de implementación: solo fronts/bim-core.md modificado, checkpoints 3D.2/3D.2A untracked y documento GeoBIM ajeno untracked.
  Scope de commit: diez archivos BFF y cuatro documentos BIM CORE; GeoBIM excluido.
  Branch/HEAD verificados antes del checkpoint: feat/bim-frag-pipeline / de474d7e91588b76040477b32085fd77116aa2fa.

PUSH STATUS: NO PUSH. Un único commit local autorizado tras validaciones.

READY FOR INTEGRATION: YES

## Contrato de publicación y evidencia

legacy = opaque fallback
canonical generation = authoritative once published

No se infiere cuál fila legacy es correcta y no se fabrica un snapshot compuesto. Los elementos legacy conservan generation_id NULL. Mientras la función de publicación devuelve NULL, las vistas preservan las filas legacy y el filtrado previo de cada reader. Tras publish, solo pasan filas de la generación canónica activa y su modelo asociado; los demás modelos legacy no compiten por updated_at.

Cada intento nuevo tiene UUID DB independiente del BimRevisionId que procede del BimProcessingContext de los mismos bytes. Dos intentos de idéntica revisión pueden coexistir físicamente; el índice parcial permite solo uno publicado por modelo lógico. Retry del batch dentro del mismo intento mantiene UNIQUE(generation_id,local_id); retry del publish ya publicado es idempotente.

create toma row lock del scope y asigna secuencia DB. publish toma ese mismo lock, bloquea la generación, comprueba scope/revisión/estado, jobs activos si existen, conteos de filas, contexto Authoring exacto y correspondencia de memberships. Después supersede anterior, publica nueva y actualiza counts/metadata del modelo en UNA transacción. Un fallo del trigger de prueba después de supersede y antes de publicar se revierte por completo.

Regla stale: B no publica si ya existe una generación published de secuencia superior. C aún building no impide por sí sola publicar B completa. Prueba B/C utiliza conexiones PostgreSQL independientes y confirma wait_event_type=Lock; C publica y B obtiene STALE_GENERATION. El job de C no queda sobrescrito por el fallo tardío de B. Otro modelo con diferencia de mayúsculas publica bajo su lock independiente.

Las definiciones actuales mutan value_type; por eso sets/definitions deben estar aislados por generación. No se duplican por entidad. Durante B con tipo cambiado, A permanece exactamente igual. El trigger de values evita referencias a definitions de otra generación/modelo.

Todos los readers enumerados usan las mismas vistas y transacción REPEATABLE READ por respuesta: catálogo, índice, resumen, SmartView, QA, 5D aggregate, 5D metering y element-properties. List/overview y lookup documental reflejan el modelo publicado. El resolver interno y las views comparten la función SQL de publicación.

Pruebas: A[1,2,3] → B[2,3,4], valores10 →20, GlobalId X local118 →126, contradicciones legacy, failures de batch/Authoring/publication, conteos, bulk HTTP409, legacy updated_at más reciente irrelevante, eliminación cascade de superseded y snapshot lector mientras otra conexión publica. La prueba real de pipeline sigue confirmando una apertura IFC y un SHA-256; extracción/resolver no se duplican.

## Referencia externa para próxima auditoría 5D — NO resuelta aquí

Modelo indicado por el usuario: /AR3173/100021-JYS01-000-ZZZ-MBM-OCI-E3-000100.ifc
BimRevisionId conocido suministrado: sha256:6f991deefc1b895555992219490f877930db38fe968efac6e64a350787c01cdd
No se reindexó ni se recalculó ese digest en esta fase.

Partida: 0.2.1.3 — DEMOLICION DE PAVIMENTO EXISTENTE - ETAPA 1.
Referencia Revit suministrada: A1 125.34, A2 292.56, A3 582.67, A4 65.64, A5 188.31, B3 620.45 m3; total comunicado 1874.96 m3.
CDE observado comunicado: aproximadamente 25303.05 m3, 1115 elementos / 115 geométricos.

Estos valores son referencia externa pendiente, no resultados medidos aquí. Revit e IFC pueden ser revisiones distintas. No se fuerza coincidencia, no se adopta ROOT_ONLY ni otra policy. La futura verificación debe separar almacenado/Qto/geometría y comprobar AuthoringElement → graphical memberships sin convertir triángulos en elementos conceptuales.

## Gates

A: SÍ — B puede construirse/fallar sin alterar A/legacy.
B: SÍ — publicación atómica sustituye completamente el universo visible.
C: NO — B stale no puede reemplazar C ya publicada de secuencia superior.
D: SÍ — readers comparten la misma regla canónica y snapshot por respuesta.

controlled reindex required for MBM = YES; no ejecutado.
5D aggregation changed = NO
Quantity policies changed = NO
QuantityObservation semantics changed = NO
frontend changed = NO
automatic reindex = NO
production DB changed = NO

No merge/rebase/cherry-pick, push, npm audit fix ni docker compose down -v. PostgreSQL efímero eliminado tras validación.
