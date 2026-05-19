# MVP_ROADMAP

## Objetivo MVP

Entregar una plataforma CDE que permita la colaboración BIM básica desde la web con:
- Autenticación corporativa y provisión de usuarios.
- Visualización de modelos IFC/FRAG.
- Gestión de documentos en Nextcloud.
- Sincronización con OpenProject para el trazo de trabajo.
- Soporte inicial de BCF para topics y viewpoints.

## Fases del roadmap

### Fase 1: Fundamento técnico y entregables mínimos

- Configuración e integración estable de la monorepo.
- Login y sesión autenticada con Keycloak.
- Rutas BFF para integraciones externas.
- Exploración y visualización de documentos IFC.
- Interfaz básica de administración de usuarios.
- Dashboard inicial con acceso a documentos y visor.

### Fase 2: Documentos y viewer

- Navegación de carpetas y documentos almacenados en Nextcloud.
- Carga y descarga de archivos.
- Renderizado federado de IFC + FRAG.
- Viewpoints guardados y restauración de cámara.
- Compatibilidad con selección y aislamiento de elementos.

### Fase 3: BCF y colaboración

- CRUD de topics BCF en el BFF.
- Visualización de topics en el visor.
- Attachments de snapshots y comentarios.
- Sincronización de estados de topics con workflows existentes.

### Fase 4: Provisión y sincronización de sistemas

- Provisionamiento de usuarios y grupos en Keycloak.
- Sincronización de membresías y roles en OpenProject.
- Creación de cuentas o habilitación en Nextcloud.
- Endpoint de integraciones y pruebas de conexión.

## Prioridades técnicas

1. Seguridad.
   - Autenticación funcionando en el frontend y el BFF.
   - Roles claros para administración y usuarios.

2. Estabilidad de integraciones.
   - OpenProject y Nextcloud con adaptadores robustos.
   - Manejo de errores y fallos transitorios.

3. Calidad del visor.
   - Performance aceptable para archivos IFC moderados.
   - Control de cámara y selección con experiencia fluida.

4. Persistencia de la colaboración.
   - Guardar viewpoints y topics fuera del navegador.
   - Asegurar consistencia en el BFF.

5. Expansión futura.
   - Diseño modular para incorporar nuevos servicios BIM.
   - API abierta para nuevas funciones y componentes.

## Dependencias clave

- Keycloak: autenticación y gestión de usuarios.
- Nextcloud: almacenamiento y gestión documental.
- OpenProject: seguimiento de trabajo y miembros.
- BCF: topics, comentarios, snapshots.
- That Open Company UI: visor y componentes BIM.

## Riesgos y mitigaciones

- Riesgo: integraciones inestables entre servicios.
  - Mitigación: centralizar lógica en adaptadores y pruebas de conectividad.

- Riesgo: experiencia de usuario lenta en visor IFC.
  - Mitigación: usar streaming eficiente, pre-carga y optimizar clippers.

- Riesgo: inconsistencias de permisos.
  - Mitigación: validar roles en el BFF y limitar accesos en el frontend.

- Riesgo: complejidad de provisión inicial.
  - Mitigación: implementar endpoints de diagnóstico y debug.

## Hitos de entrega

- Hito 1: Login, BFF básico, exploración de documentos.
- Hito 2: Visualización IFC/FRAG y viewpoints.
- Hito 3: BCF topics y comentarios.
- Hito 4: Provisionamiento y sincronización con OpenProject/Nextcloud.
- Hito 5: Revisión y estabilización para despliegue MVP.
