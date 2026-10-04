# Routing y geocodificación

## Proveedor implementado
El backend incluye un adaptador para:
- **Google Maps Routes API** (`ComputeRoutes`).
- **Google Geocoding API v4**.

No se activa sin una clave real de Google Maps Platform.

## Routing
Se solicita:
- modo `DRIVE`;
- `TRAFFIC_AWARE`;
- unidades métricas;
- polilínea `GEO_JSON_LINESTRING`;
- calidad `HIGH_QUALITY`;
- distancia;
- duración;
- etiquetas de ruta.

Sin puntos intermedios se solicitan rutas alternativas. Google puede devolver la ruta principal y hasta tres alternativas.

Con puntos intermedios Google no admite rutas alternativas en una sola llamada. Si la ruta completa abandona la provincia, MVC calcula cada tramo entre paradas solicitando alternativas y solo acepta una combinación cuya geometría completa quede cubierta por el polígono provincial.

## Guardia provincial
Antes de llamar al proveedor:
1. origen dentro de provincia;
2. destino dentro de provincia;
3. todas las paradas dentro de provincia.

Después:
1. cada candidato se convierte a `LineString` SRID 4326;
2. PostGIS valida la geometría;
3. `ST_CoveredBy(route, province)` debe ser verdadero;
4. se escoge el primer candidato válido en el orden del proveedor;
5. si ninguno cumple, se devuelve `NO_ROUTE_WITHIN_PROVINCE`.

No se usa distancia en línea recta para precios ni ETA.

## Geocodificación
El adaptador soporta:
- dirección -> coordenadas;
- coordenadas -> dirección;
- resultados con `placeId`, dirección formateada, tipos y lat/lng.

La región se sesga a España (`regionCode=es`) y el idioma a español.

## Credenciales
Configuración prevista:
- `MAPS_PROVIDER=disabled|google`
- `GOOGLE_MAPS_API_KEY`

La clave no debe incluirse en Git, app móvil ni logs.

## Estado
El adaptador y la lógica provincial pueden probarse con un proveedor de test dentro de CI. Las llamadas reales a Google quedan bloqueadas hasta que MVC disponga de proyecto, facturación, APIs habilitadas, clave restringida y aceptación de las condiciones aplicables.
