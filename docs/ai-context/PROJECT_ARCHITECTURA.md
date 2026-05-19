# PROJECT_ARCHITECTURA

## Visión general del monorepo

Este repositorio es un monorepo npm con workspaces configurados en el archivo `package.json` raíz.

- Raíz: `cde-portal`
- Workspaces:
  - `apps/frontend`
  - `apps/bff`

No existen paquetes internos adicionales con su propio package.json fuera de los workspaces principales.

## Apps

### apps/frontend

Aplicación principal de usuario construida con:

- Next.js 16 (App Router)
- React 19
- TypeScript 5
- Tailwind CSS v4
- NextAuth para autenticación

Funciones clave:

- Interfaz de login con Keycloak
- Navegación de documentos
- Visor federado IFC/BIM
- Panel de administración de usuarios
- Manejo de BCF / topics de revisión
- Servicios cliente para conectar con el BFF

### apps/bff

Backend ligero en Express + TypeScript que actúa como capa de integración:

- Express 4
- TypeScript 5.8
- `tsx` en desarrollo
- Rutas REST para documentos, BCF, integraciones y administración

Funciones clave:

- Proxy / adaptador a Nextcloud (WebDAV + OCS)
- Adaptador a OpenProject
- Administración de usuarios en Keycloak
- Persistencia simple de topics BCF en JSON local
- Endpoints de debug e integración

## Dependencias

### Dependencias principales

- `@thatopen/components`
- `@thatopen/components-front`
- `@thatopen/fragments`
- `@thatopen/ui`
- `@thatopen/ui-obc`
- `three`
- `web-ifc`
- `next` / `react` / `react-dom`
- `next-auth`
- `express`
- `cors`
- `dotenv`
- `multer`

### Dependencias dev

- `typescript`
- `eslint`
- `eslint-config-next`
- `@types/*`
- `@tailwindcss/postcss`
- `tsx`

## Integraciones externas

### Keycloak

- Autenticación del frontend con NextAuth y proveedor Keycloak.
- Gestión de sesión con JWT.
- Provisionamiento de usuarios, grupos y roles en el backend mediante Keycloak Admin API.
- Uso de credenciales de administración para sincronizar identidad.

### Nextcloud

- Exploración de documentos y carpetas mediante WebDAV.
- Almacenamiento de archivos, snapshots y attachments BCF.
- Servicios de provisión de usuarios y grupos con OCS API.
- Mapeo de rutas entre Nextcloud y el portal.

### OpenProject

- Creación y lectura de work packages a través de API REST.
- Sincronización de miembros y roles de proyecto.
- Endpoints de prueba para validar conexión.
- Uso de API Key y project/type IDs configurables.

### Viewer BIM

- Módulo principal en `apps/frontend/src/features/viewer-ifc`.
- Usa `@thatopen/ui` y `@thatopen/components` para construir el visor.
- Renderiza modelos federados IFC/FRAG con Three.js y `web-ifc`.
- Funcionalidades de selección, aislamiento, clipping, sección, colores y anotaciones.
- Soporta viewpoints y snapshots de la vista.

## APIs

### Endpoints BFF principales

- `/api/folders`
- `/api/documents`
- `/api/bcf`
- `/api/viewpoints`
- `/api/integrations`
- `/api/openproject-debug`
- `/api/openproject-admin`
- `/api/admin/users`

### Endpoints frontend

- `/api/auth/[...nextauth]` → login Keycloak

### Servicios de cliente

- `apps/frontend/src/services/admin-users.service.ts`
- `apps/frontend/src/services/bcf.service.ts`
- `apps/frontend/src/services/documents.service.ts`
- `apps/frontend/src/services/viewpoints.service.ts`

## Variables de entorno críticas

### Frontend

- `NEXT_PUBLIC_BFF_URL`
- `NEXT_PUBLIC_KEYCLOAK_URL`
- `NEXT_PUBLIC_KEYCLOAK_REALM`
- `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`
- `KEYCLOAK_CLIENT_SECRET`
- `NEXTAUTH_SECRET`

### BFF

- `OPENPROJECT_BASE_URL`
- `OPENPROJECT_API_KEY`
- `OPENPROJECT_PROJECT_ID`
- `OPENPROJECT_TYPE_ID`
- `OPENPROJECT_DEFAULT_PROJECT_ID`
- `USE_OPENPROJECT_MOCK`
- `NEXTCLOUD_BASE_URL`
- `NEXTCLOUD_USERNAME`
- `NEXTCLOUD_PASSWORD`
- `NEXTCLOUD_ROOT_PATH`
- `NEXTCLOUD_ADMIN_USERNAME`
- `NEXTCLOUD_ADMIN_PASSWORD`
- `KEYCLOAK_BASE_URL`
- `KEYCLOAK_REALM`
- `KEYCLOAK_ADMIN_REALM`
- `KEYCLOAK_ADMIN_CLIENT_ID`
- `KEYCLOAK_ADMIN_USERNAME`
- `KEYCLOAK_ADMIN_PASSWORD`
- `BFF_PUBLIC_URL`
- `USE_NEXTCLOUD_MOCK`

## Estado actual de funcionalidades

### Implementado

- Login de usuario con Keycloak
- Provisionamiento de usuarios con sincronización Keycloak / Nextcloud / OpenProject
- Exploración y gestión de documentos en Nextcloud
- Carga y descarga de archivos
- Soporte de armado de FRAG para IFC
- Visor IFC/BIM federado con selección, clipping, vistas y anotaciones
- BCF topics persistidos en backend local
- Snapshot y viewpoints por documento
- Pruebas de conexión para integraciones externas

### Limitaciones y alcance

- No hay configuración de Docker en el repositorio
- Persistencia BCF basada en JSON local, no en base de datos
- Adaptadores OpenProject dependen de campos custom fijos
- El BFF es un backend de orquestación, no un almacenamiento de dominio completo

## Observaciones de arquitectura

- La arquitectura actual es de frontend rico + backend de integración.
- El código está separado en capas: adapters, services, routes, features, components.
- La integración BIM y BCF está centrada en el frontend, apoyada por servicios del BFF.
- La plataforma debe evolucionar priorizando estabilidad de integraciones antes de introducir nuevas capas complejas.
