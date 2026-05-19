# IMPLEMENTATION_RULES

## Patrones de arquitectura recomendados

1. Capa de presentación separada de la capa de integración.
   - `apps/frontend` debe contener UI, hooks, servicios cliente y componentes.
   - `apps/bff` debe contener rutas, servicios y adaptadores para terceros.

2. Adapters + Services.
   - Adaptadores (`apps/bff/src/adapters`) encapsulan los protocolos externos: OpenProject, Nextcloud.
   - Servicios (`apps/bff/src/services`) contienen lógica de negocio, orquestación y reintentos.

3. Componentización y feature folders.
   - `apps/frontend/src/features/viewer-ifc` debe contener todos los componentes, tipos y utilidades del visor.
   - Reutilizar los componentes oficiales de That Open Company siempre que sea posible.

4. Interfaces y tipos.
   - Definir contratos claros entre frontend, BFF y servicios externos.
   - Evitar `any`; usar tipos fuertes y DTOs explícitos.

5. Boundary de errores.
   - Cada ruta debe manejar errores internos y devolver mensajes claros.
   - No exponer stack traces a usuarios finales.

## Restricciones

- No reiniciar el proyecto.
  - Evitar propuestas que requieran reestructuración total del pipeline de desarrollo.
  - Mantener el flujo actual de `next dev` y `tsx watch src/index.ts`.

- No romper funcionalidades existentes.
  - Cualquier cambio debe preservar los flujos de login, visor, documentos y provisión.
  - Las mejoras deben ser incrementales y seguras.

- Reutilizar componentes oficiales de That Open Company.
   - Usar `@thatopen/components`, `@thatopen/components-front`, `@thatopen/ui` y `@thatopen/ui-obc` cuando cubran el caso de uso.

- Mantener Clean Architecture.
   - Separar capas de presentación, dominio e infraestructura.
   - Evitar lógica de negocio en los controladores de rutas.

- SOLID.
   - Single Responsibility: cada módulo debe tener una única razón para cambiar.
   - Open/Closed: extender sin modificar lo existente.
   - Liskov: respetar contratos y subtipos.
   - Interface Segregation: usar tipos específicos y no enormes interfaces únicas.
   - Dependency Inversion: los servicios deben depender de abstracciones cuando sea necesario.

- Modularidad.
   - Cada feature debe poder desarrollarse y probarse de forma aislada.
   - Evitar piezas monolíticas en el frontend y el backend.

- Escalabilidad.
   - Diseñar el BFF como un orquestador sin almacenar datos críticos de negocio.
   - Mantener la UI preparada para futuras extensiones de workflows BIM / CDE.

## Prioridades MVP

1. Estabilidad de autenticación y autorización.
   - Keycloak en frontend y BFF.
   - Roles y permisos mínimos para la administración.

2. Gestión de documentos.
   - Browse, view, upload, rename, move, delete y download desde Nextcloud.
   - Soporte IFC/FRAG para el visor.

3. Visualización BIM.
   - Visor federado con selección, aislamiento, clipping y snapshots.
   - Viewpoints y guardado de estado.

4. Integración BCF.
   - Creación y edición de topics.
   - Persistencia de topics y attachments.

5. Sincronización externa.
   - Provisionamiento de usuarios en Keycloak, OpenProject y Nextcloud.
   - Pruebas de conectividad y debug.

## Buenas prácticas

- Validar variables de entorno en tiempo de arranque.
- Mantener la lógica de negocio fuera de las rutas HTTP.
- Usar logs estructurados y mensajes consistentes.
- Documentar las dependencias y los contratos API.
- Evitar hardcodear IDs y mappings en el dominio de negocio.
- Centralizar los adaptadores de terceros para facilitar el testing.
- Agregar comentarios técnicos en áreas críticas: Keycloak, Nextcloud, OpenProject y viewer BIM.
- Preservar la experiencia de usuario frente a fallos parciales.
- Usar `requestAnimationFrame` y refactorizar la lógica de render en el visor para evitar sobrecarga.

## Recomendaciones de diseño

- Preferir funciones puras y hooks declarativos en el frontend.
- Definir tipos `ViewerViewpoint`, `BcfTopic`, `DocumentItem` y `WorkPackage` como contratos compartidos.
- Evitar dependencias de estado global innecesarias.
- Implementar feedback de estado en cada acción de usuario.
- Mantener la capa de persistencia de BCF desacoplada de la UI.
