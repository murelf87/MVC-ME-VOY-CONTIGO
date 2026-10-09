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

### Planificador por parada (módulo `trips`)
`POST /v1/me/routes/plan` aplica esta guardia punto por punto y devuelve un veredicto por parada («Huelva (sugerida): fuera de provincia») con alternativas geocodificadas DENTRO de la provincia (solo si hay proveedor); mientras haya un punto fuera no se llama al proveedor de rutas. Con todos los puntos dentro calcula la ruta real tramo a tramo y comprueba la geometría completa (`ROUTE_LEAVES_PROVINCE` si ninguna alternativa cabe). Las horas de paso salen de la duración acumulada del proveedor y el desvío de una parada opcional es «ruta con la parada − ruta sin ella». `POST /v1/me/routes` repite TODO el cálculo en el servidor (no confía en un plan anterior) y la vuelta se calcula aparte con los puntos invertidos. La geometría que se enseña en pantalla se simplifica con `ST_SimplifyPreserveTopology`; la guardada para cálculos es la completa.

### Estimaciones que no son rutas
Los minutos a pie hasta un punto de recogida (línea recta × 1,3 a 4,5 km/h) y el desvío estimado de un punto en ruta (1 min + 2 × distancia a la ruta a 30 km/h) son ESTIMACIONES y la API las marca (`walk.estimated`, `detour.source`); nunca se usan para precios. Los precios y las horas de llegada usan siempre la distancia y la duración por carretera del proveedor.

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
