# Plantilla de carpetas de proyecto

El portal crea una estructura base de carpetas al crear o reparar un proyecto. La operacion es idempotente: crea las rutas faltantes y no elimina ni mueve contenido existente.

## Plantilla por defecto

```text
1-DATA
  1-1-CONT
  1-2-COMM
  1-3-EXTD
2-PLAN
  2-1-QPLA
  2-2-PROG
  2-3-DLIST
3-WIPR
  3-1-NOGR
  3-2-GRPH
4-SHRD
  4-1-INFO
  4-2-COOR
5-PUBL
  5-1-DEL-1
6-JPRO
  6-1-ARCH
```

## Configuracion por ambiente

Para cambiar la estructura sin tocar codigo, define `PROJECT_FOLDER_TEMPLATE_JSON` en `apps/bff/.env`.

Ejemplo minimo:

```env
PROJECT_FOLDER_TEMPLATE_JSON=[{"name":"1-DATA","children":[{"name":"1-1-CONT"}]},{"name":"3-WIPR","children":[{"name":"3-1-NOGR"},{"name":"3-2-GRPH"}]}]
```

Formato esperado:

```json
[
  {
    "name": "1-DATA",
    "children": [
      { "name": "1-1-CONT" },
      { "name": "1-2-COMM" }
    ]
  }
]
```

## Proyectos existentes

Si el proyecto ya existe, usa la accion de reparacion/provisionamiento del proyecto. El backend volvera a revisar la estructura y creara solo las carpetas faltantes.

## Excel o plantillas externas

La ruta recomendada es convertir el Excel a este JSON antes de pegarlo en `PROJECT_FOLDER_TEMPLATE_JSON`. El siguiente paso natural es agregar una pantalla de configuracion para cargar Excel/JSON por proyecto y guardar esa plantilla en base de datos.