# Límites provinciales oficiales — MVC

## Fuente seleccionada
**Instituto Geográfico Nacional / Centro Nacional de Información Geográfica (IGN/CNIG)**  
Producto: **Límites municipales, provinciales y autonómicos — Límites y Unidades Administrativas Actuales (BDLJE)**.

La aplicación debe usar los **recintos provinciales** de ese producto para validar origen, destino, paradas y geometría completa de cada ruta.

## Publicación vigente consultada el 4 de octubre de 2026
El Centro de Descargas del CNIG publica:
- SHAPEFILE `LINEAS_LIMITE.ZIP`: fecha 28/07/2026, escala 1:25.000.
- GML actual: fecha de descarga 10/08/2026.
- ETRS89 para península, Illes Balears, Ceuta y Melilla.
- REGCAN95 para Canarias.
- Coordenadas geográficas longitud/latitud.
- Ambos sistemas se describen como compatibles con WGS84.

El CNIG anunció el 18/08/2026 una nueva versión del producto frente a la versión de febrero de 2026.

## Licencia
Las condiciones del CNIG indican licencia compatible con **CC-BY 4.0** bajo la Orden FOM/2807/2015 y obligan a reconocer origen y propiedad.

Para una geometría procesada por MVC se conservará la atribución:
`Obra derivada de BDLJE CC-BY 4.0 ign.es`.

## Importación
MVC no debe copiar geometrías desde repositorios de terceros.

Flujo:
1. Descargar el producto oficial del CNIG aceptando sus condiciones.
2. Extraer la capa de recintos provinciales correspondiente.
3. Convertirla a GeoJSON sin simplificar los límites.
4. Conservar el fichero fuente/derivado y calcular SHA-256.
5. Ejecutar `npm run provinces:import -- /ruta/provinces.geojson` con metadatos de fuente.
6. El importador valida Polygon/MultiPolygon, ejecuta `ST_MakeValid`, fuerza MultiPolygon/SRID 4326, registra el hash y activa la nueva versión dentro de una transacción.

Variables requeridas:
- `PROVINCE_SOURCE_NAME`
- `PROVINCE_SOURCE_URL`
- `PROVINCE_SOURCE_DATE`
- `PROVINCE_SOURCE_LICENSE`
- `PROVINCE_CODE_FIELD`
- `PROVINCE_NAME_FIELD`
- opcional: `PROVINCE_SOURCE_VERSION`

Los nombres de campos se pasan explícitamente para no asumir silenciosamente un esquema que pueda cambiar entre publicaciones. En datos BDLJE se han observado atributos como `NAMEUNIT` y `NATCODE`, pero la importación operativa debe confirmar los campos en el fichero oficial descargado.

## Seguridad y trazabilidad
- Un SHA-256 ya importado no puede activarse dos veces.
- Un código provincial duplicado hace fallar todo el lote.
- La activación es transaccional.
- Cada provincia referencia el `dataset_import_id` que originó su geometría.
- La versión anterior queda marcada como `superseded`.
- Se genera un evento de auditoría de activación.

## Estado
El importador y la trazabilidad pueden probarse con geometrías sintéticas. Eso **no significa** que el dataset oficial esté cargado en producción; la carga oficial requiere el fichero descargado desde CNIG y validado.
