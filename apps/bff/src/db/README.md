# CDE metadata database

This folder defines the PostgreSQL metadata layer. The runtime uses PostgreSQL
when `DATABASE_URL` is configured and falls back to JSON stores when it is not,
so local development can keep working during the migration.

## Migration scope

The first database-backed scope is issues/incidencias:

- `cde_issues`: canonical issue/workflow record.
- `cde_issue_models`: model/document context for federated issues.
- `cde_issue_selections`: linked BIM elements by model and Express ID.
- `cde_issue_comments`: discussion history.
- `cde_issue_attachments`: metadata for files stored in Nextcloud.

Nextcloud remains the binary store for IFC, PDFs, snapshots and attachments.
OpenProject remains an external workflow integration, not the source of truth.

The BIM index schema prepares the next step of the viewer migration:

- `cde_bim_models`: one canonical row per project model/version.
- `cde_bim_derivatives`: FRAG, thumbnails and future derivatives.
- `cde_bim_elements`: IFC elements with class, level and spatial context.
- `cde_bim_property_sets`, `cde_bim_properties`, `cde_bim_property_values`:
  searchable BIM parameters for SmartViews, audits and 5D.
- `cde_bim_index_jobs`: background index/conversion job tracking.
- `cde_project_modules`: project-scoped feature modules, for example PMA,
  4D, 5D or GIS dashboards enabled only where needed.

## Local Docker database

From the repository root:

```bash
docker compose -f docker-compose.portal.yml up -d cde-portal-db
```

For a BFF running directly from VS Code/Node, configure:

```env
DATABASE_URL=postgresql://cde_portal:cde_portal_dev@localhost:5433/cde_portal
```

Then apply the schema:

```bash
npm run db:migrate -w apps/bff
```

The migration is idempotent. It can be run again after pulling new changes.

To import existing local JSON BCF topics and PDF annotations into PostgreSQL:

```bash
npm run db:backfill -w apps/bff
```

Run the backfill after `db:migrate` and before validating Workflows. BCF topics
without `projectCode` are skipped to avoid cross-project contamination.

For the BFF running inside `docker-compose.portal.yml`, use the service DNS:

```env
DATABASE_URL=postgresql://cde_portal:cde_portal_dev@cde-portal-db:5432/cde_portal
```

In production/server Docker, replace the password and keep the named volume
`cde-portal-db-data` or bind it to a managed disk/backed-up volume.

## BIM index API

The first API layer for database-backed viewer metadata is available under
`/api/bim-index` and is always project-authorized:

- `GET /api/bim-index/models?projectCode=AR3173`: list indexed models.
- `GET /api/bim-index/models?projectCode=AR3173&documentPath=/AR3173/.../model.ifc`:
  find the current model index for a document path and optional `sourceHash`.
- `PUT /api/bim-index/models`: upsert one model/version row.
- `POST /api/bim-index/models/:modelId/elements/bulk`: persist a bounded batch
  of element/property rows.
- `GET /api/bim-index/properties?projectCode=AR3173`: return property sets,
  properties and capped value lists for SmartViews, audits, 5D and PMA modules.

This is an intermediate cache contract. The viewer can still extract properties
client-side, but the extracted index can now be stored once per model/version.
The next step is moving extraction to a backend worker so federation opens by
querying PostgreSQL instead of re-indexing every browser session.
## Migration path

1. Keep existing `/api/bcf/topics` and document annotation contracts.
2. Use `cde_issues` as the canonical workflow index.
3. Synchronize PDF annotations and BCF topics into `cde_issues`.
4. Use Workflows against `/api/issues` first.
5. Backfill existing JSON data with `npm run db:backfill -w apps/bff`.
6. Store BIM model/version/index metadata in PostgreSQL.
7. Move SmartViews, 5D mappings, PMA mappings and audit results to
   project-scoped tables/modules.
8. Move remaining source stores progressively from JSON to PostgreSQL tables.

## Server deployment flow

On a company server, the expected flow is:

1. Clone or pull the GitHub repository.
2. Create production `.env` files for BFF and frontend.
3. Start PostgreSQL with `docker-compose.portal.yml`.
4. Run `npm run db:migrate -w apps/bff` against the server `DATABASE_URL`.
5. Run `npm run db:backfill -w apps/bff` only when migrating existing JSON data.
6. Build and start BFF/frontend containers.
7. Validate `/api/health`, login, project isolation, workflows and BIM viewer.

Do not copy the local database by hand unless the server is meant to receive
test data. For production, restore from a PostgreSQL dump or start with an
empty schema and let the app index project data again.


### Cache de propiedades BIM para el visor

El visor puede guardar un snapshot JSON del indice de propiedades por `projectCode + signature` en `cde_bim_property_index_snapshots`.

Flujo actual:

1. El primer uso de SmartView/Parametros/Auditoria/5D indexa en el navegador como fallback.
2. Al terminar, el frontend intenta guardar el snapshot en `/api/bim-index/properties/snapshot`.
3. Al volver a abrir el mismo conjunto de modelos, el frontend consulta ese snapshot y evita reindexar si la firma coincide.
4. Si `DATABASE_URL` no esta configurado, la respuesta es 503 y el visor continua con indexacion local.
5. Si el snapshot supera el limite seguro del cliente, se omite para no saturar el BFF.

Para activar en local:

```powershell
docker compose -f docker-compose.portal.yml up -d cde-portal-db
$env:DATABASE_URL="postgresql://cde_portal:cde_portal_dev@localhost:5433/cde_portal"
npm run db:migrate -w apps/bff
```

Despues reinicia el BFF para que tome `DATABASE_URL`.
### Persistencia granular BIM

Al ejecutar **Cargar parametros** en el visor, el frontend registra cada modelo en `/api/bim-index/models` y persiste los elementos indexados por lotes en `/api/bim-index/models/:modelId/elements/bulk`. Esto prepara consultas posteriores de SmartViews, 5D, auditorias y modulos especificos de proyecto sin reindexar todo el IFC en el navegador cada vez.

La primera indexacion sigue dependiendo del navegador porque las propiedades salen del runtime de That Open. La base de datos empieza a mejorar desde la segunda carga y permite mover gradualmente el analisis pesado al BFF o a un worker.
## Estado operativo del indice BIM

Con `DATABASE_URL` activo, el BFF expone endpoints para auditar si un proyecto ya tiene modelos indexados y snapshots reutilizables:

```http
GET /api/bim-index/overview?projectCode=AR3173
GET /api/bim-index/jobs?projectCode=AR3173
GET /api/bim-index/jobs?projectCode=AR3173&status=failed
```

El contrato de jobs queda preparado para un worker externo o proceso Docker dedicado:

```http
PUT /api/bim-index/jobs
Content-Type: application/json

{
  "projectCode": "AR3173",
  "documentPath": "/AR3173/3-WIPR/model.ifc",
  "status": "processing",
  "stats": { "stage": "indexing" }
}
```

Estados validos: `pending`, `processing`, `ready`, `failed`, `cancelled`.

Lectura esperada del flujo actual:

1. Primer uso: el navegador puede seguir indexando propiedades si no existe snapshot ni indice normalizado.
2. Durante ese primer uso: el frontend persiste modelos, elementos y propiedades por lotes en PostgreSQL.
3. Siguientes usos: el visor consulta primero snapshot y luego tablas normalizadas, evitando recorrer otra vez todo el modelo en cliente.
4. Siguiente fase: mover la extraccion de propiedades a un worker backend para que el navegador solo consuma indices ya preparados.
## Root DB scripts

From the repository root you can now use these shortcuts:

```powershell
npm run db:migrate
npm run db:check
npm run db:backfill
```

`db:check` is read-only. It validates `DATABASE_URL`, confirms the required
PostgreSQL tables exist and prints basic row counts for issues, BIM models,
properties, snapshots and jobs. Use it after migrations and after moving the
app to a server.

## Indicador visible en el visor

El visor muestra una tarjeta compacta de **Indice BIM** en los paneles de
Parametros y 5D. Esa tarjeta lee `/api/bim-index/overview` y permite validar:

- modelos listos frente a modelos registrados;
- cantidad de elementos persistidos en PostgreSQL;
- jobs en proceso;
- fallos de indexacion.

Si el visor muestra `Indice BIM no consultado`, normalmente falta
`projectCode` o el BFF no tiene `DATABASE_URL`. Si muestra cero elementos
tras haber cargado parametros, ejecuta:

```powershell
npm run db:check
```

Luego vuelve a pulsar **Cargar parametros** en el visor. La primera carga puede
seguir tardando porque aun extrae propiedades desde That Open en el navegador;
las siguientes cargas deben aprovechar snapshots o tablas normalizadas.
## Catalogo liviano de propiedades BIM

Para modulos como 5D, PMA y validaciones configurables no siempre conviene
pedir el indice completo con localIds. El BFF expone una lectura agregada:

```http
GET /api/bim-index/properties/catalog?projectCode=AR3173
GET /api/bim-index/properties/catalog?projectCode=AR3173&modelKeys=model-a,model-b&maxValuesPerProperty=100
```

Esta respuesta incluye conjuntos, parametros, valores disponibles y conteos,
pero no incluye geometria ni listas de elementos. Debe usarse para llenar
selectores y pantallas de configuracion; las operaciones que necesitan resaltar
elementos siguen usando snapshots o `/api/bim-index/properties`.


## Modulos por proyecto y PMA

Los modulos especiales no deben activarse globalmente por defecto. La tabla
`cde_project_modules` controla que un proyecto tenga, por ejemplo, PMA, GIS,
4D o dashboards especificos sin contaminar otros proyectos.

Endpoints iniciales:

```http
GET /api/project-modules?projectCode=AR3173
PUT /api/project-modules/pma
Content-Type: application/json

{
  "projectCode": "AR3173",
  "enabled": true,
  "config": {
    "roomSet": "Habitaciones",
    "roomNameProperty": "Nombre_PMA",
    "areaProperty": "Area"
  }
}
```

Para preparar el dashboard PMA se registran fuentes normativas por proyecto:

```http
GET /api/project-modules/pma/sources?projectCode=AR3173
PUT /api/project-modules/pma/sources
Content-Type: application/json

{
  "projectCode": "AR3173",
  "name": "PMA IREN SUR v1",
  "sourceDocumentPath": "/AR3173/1-DATA/PMA.xlsx",
  "status": "draft",
  "config": {
    "sheetName": "PMA",
    "pmaNameColumn": "PMA_Excel",
    "normativeAreaColumn": "PMA_NTS_m2"
  }
}
```

Autorizacion: `GET` requiere `project:read`; cambios `PUT` requieren
`project:write`. La importacion real de Excel y comparacion contra rooms BIM se
implementara sobre estas tablas, usando el indice BIM ya persistido.

## Agregados 5D desde PostgreSQL

El BFF tambien expone agregacion server-side para partidas 5D:

```http
POST /api/bim-index/cost5d/aggregate
Content-Type: application/json

{
  "projectCode": "AR3173",
  "modelKeys": ["100021-JYS01-103-YYY-IFC-EST-E3-000001.ifc"],
  "itemId": { "setName": "Datos de actividad", "propertyName": "ID Partida N?01" },
  "itemName": { "setName": "Datos de actividad", "propertyName": "Nombre Partida N?01" },
  "itemUnit": { "setName": "Datos_Partida", "propertyName": "Unidad Medida N?01" },
  "quantity": { "setName": "Datos_Partida", "propertyName": "METRADO" },
  "limit": 1000
}
```

La consulta usa una sola coincidencia por propiedad y elemento para evitar el
error de multiplicar cantidades cuando un elemento tiene varios parametros. Si
`quantity` no se informa o no es numerico, el resultado usa conteo de elementos
como fallback. En el visor, este endpoint se usa cuando aun no esta cargado el
indice local completo; si necesitas resaltar localIds exactos, pulsa **Cargar
parametros** para traer el indice detallado.
