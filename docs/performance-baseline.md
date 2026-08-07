# Performance baseline CDE

## Objetivo

Medir si los cambios de latencia son efectivos con datos repetibles, no por percepción visual.

## Variables

BFF:

```env
NEXTCLOUD_PROPFIND_CACHE_TTL_MS=5000
BFF_SLOW_REQUEST_MS=1000
BFF_PERF_LOGS=false
```

Frontend:

```env
NEXT_PUBLIC_PERF_LOGS=true
```

Con `BFF_PERF_LOGS=false`, el BFF solo imprime llamadas lentas según `BFF_SLOW_REQUEST_MS`.
Con `NEXT_PUBLIC_PERF_LOGS=true`, el navegador imprime cada llamada `bffFetch` en consola.

## Cómo medir navegación entre carpetas

1. Reiniciar BFF y frontend después de cambiar variables.
2. Abrir Chrome DevTools en la pestaña `Network`.
3. Activar `Disable cache`.
4. Entrar a un proyecto.
5. Navegar entre las mismas 5 carpetas dos veces.
6. Registrar para cada llamada `/api/documents/explorer`:
   - `Duration` en DevTools.
   - Header `X-Response-Time-Ms`.
   - Header `Server-Timing`.
   - Log `[BFF_CLIENT_PERF]` en consola si está activo.

## Interpretación

- `Duration` alto y `X-Response-Time-Ms` bajo: el problema está entre navegador y BFF, proxy, VPN o frontend.
- `X-Response-Time-Ms` alto y `nextcloud.propfind` alto: el cuello de botella está en Nextcloud/WebDAV.
- `X-Response-Time-Ms` alto y `nextcloud.propfind_cache` aparece: el cuello está en lógica BFF/frontend, no en Nextcloud.
- Primera entrada lenta y segunda rápida: el cache corto está funcionando.
- Todas lentas, incluso repetidas: Nextcloud, red o parseo XML siguen dominando.

## Umbrales iniciales

Para una experiencia tipo CDE moderno:

- Navegar carpeta vacía o pequeña: menor a 500 ms local, menor a 1500 ms por VPN.
- Carpeta con 100-300 elementos: menor a 1500 ms local, menor a 3000 ms por VPN.
- Subida de archivo pequeño menor a 5 MB: menor a 3000 ms local, sin conversión BIM síncrona.
- Abrir visor con FRAG ya generado: menor a 3000 ms hasta primer render.

## Próximas métricas necesarias

- Tiempo de `PUT` a Nextcloud.
- Tiempo de descarga IFC/FRAG.
- Tiempo de conversión IFC a FRAG.
- Tiempo hasta primer render del visor BIM.
- Tamaño de respuesta de carpetas y modelos.
- Conteo de llamadas por acción de usuario.
