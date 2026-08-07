# ADR-001 - Autoridad de identidad y autorizacion del BFF

## Contexto

Keycloak emite identidades para el portal CDE. El frontend no es una fuente confiable de autorizacion porque cualquier cliente puede llamar directamente al BFF si tiene acceso de red. El BFF es la frontera que protege documentos, BCF, Project Cards, integraciones y administracion. Los proyectos son limites de aislamiento: un usuario autorizado en un proyecto no debe acceder a otro por manipular path, query o body.

## Decision

El BFF valida JWT emitidos por Keycloak mediante JWKS cacheado, aceptando solo RS256 y comprobando issuer, audience, exp y nbf. Keycloak es la autoridad de identidad; el BFF es la autoridad de autorizacion. La autorizacion usa denegacion por defecto, politicas centralizadas y validacion de acceso por proyecto antes de llamar a Nextcloud, OpenProject o servicios funcionales. El unico endpoint publico es `GET /health`.

La precedencia de autorizacion por proyecto es:

1. Rol global de administrador reconocido por el BFF.
2. Grupo Keycloak de proyecto con el patron existente `PROJECT_ROLE`.
3. Miembro activo en `project-members.json`, usando `username` o `email`.

## Alternativas Consideradas

Confiar en VPN se rechaza porque la red no prueba identidad ni pertenencia al proyecto. Confiar en el frontend se rechaza porque el cliente puede manipular rutas, query y body. Validar solo existencia de token se rechaza porque no verifica firma, issuer ni audience. Consultar Keycloak en cada request se rechaza por latencia y dependencia operacional innecesaria; JWKS cacheado soporta rotacion por `kid`. Aplicar roles directamente en cada ruta se rechaza porque duplicaria reglas y haria mas probable una ruta permisiva por error.

## Consecuencias

La seguridad aumenta y el BFF queda preparado para operar fuera de una VPN. La configuracion de Keycloak debe ser correcta y obligatoria al arranque. El mapping de roles y grupos debe mantenerse alineado con provisionamiento. Hay un coste menor de validacion JWT, amortiguado por cache JWKS. Las pruebas de aislamiento entre proyectos pasan a ser obligatorias para evitar regresiones.
