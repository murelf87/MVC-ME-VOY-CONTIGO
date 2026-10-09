# Contrato API — módulo `trips` (be-trips)

Pantallas servidas: **09** Inicio mapa · **10** Define tu recorrido · **11** Resultados · **12** Detalle de viaje · **13a/13b** Punto de recogida ·
**14a/14b** Tu plaza semanal · **15a/15b** Revisa tu solicitud · **16a/16b** Estado y pago (solo estado de la solicitud + cuenta atrás del *hold*; el pago es el módulo `money`) ·
**17** Tu vehículo · **18** Publica tu ruta · **19** Paradas y recorrido · **20** Solicitudes · **30** Mis viajes · **31** Favoritos y rutina.

Tipos TypeScript equivalentes: [`mobile/src/api/types/trips.ts`](../../mobile/src/api/types/trips.ts) (usa `Money`, `PublicUser`, `Page`, `GeoPoint`… de `common.ts`;
espejo backend en `src/lib/dto.ts`). Los *schemas* Fastify de `src/modules/trips/**` producen exactamente estas formas.
Estado de verificación de cada endpoint: ver «Estado de implementación» al final.

Datos de los ejemplos: **lunes 5 de octubre de 2026**, «ahora» = `2026-10-05T05:58:00Z` (07:58 Europe/Madrid, CEST = UTC+2). Personajes de las láminas:
Ana García López (conductora, Seat Arona gris), Miguel Torres, Laura. Los UUID de los ejemplos son ficticios y legibles.

---

## 0. Convenciones transversales

| Tema | Regla |
|---|---|
| Base | `/v1/...`. Autenticación `Authorization: Bearer mvc_sess_…` (token opaco). «**opcional**» = funciona sin sesión (modo invitado) y personaliza si hay sesión. |
| Error | `{ "error": { "code": "MAYUSCULAS_SNAKE", "message": "texto en español", "details": … }, "requestId": "…" }`. Los códigos son estables; el `message` de los endpoints nuevos está en español y es seguro mostrarlo (los errores heredados del backend 0.14 siguen en inglés: la app mapea por `code`). |
| Validación | Entrada inválida → `400 VALIDATION_ERROR` (`details` = errores de schema); cursor corrupto → `400 INVALID_CURSOR`. Exceso de peticiones → `429 RATE_LIMITED`. El módulo registra su propio manejador de errores (el global de `app.ts` convertiría 400 y 429 en 500; ver §16, punto 14). |
| Fechas | Instantes `IsoDateTime` UTC con milisegundos. Fechas de calendario `YYYY-MM-DD` (Europe/Madrid). Horas de reloj para pintar: `LocalTime` `"HH:mm"` (Europe/Madrid) — el servidor las calcula con la zona correcta, la app no debe convertir. |
| Dinero | Siempre `Money {cents, currency:"EUR", status}`; céntimos enteros. **No hay tarifa aprobada** → todo importe derivado es `{cents:null,status:"pending_definition"}` («Por definir»). Este módulo nunca emite `"illustrative"`. |
| Paginación | `Page<T> = { items, nextCursor }`; query `cursor` (opaco; no lo interpretes) y `limit`. En búsquedas el cursor es un desplazamiento sobre un resultado recalculado: pueden cambiar entre páginas. |
| Idempotencia | `POST` que crean (`/trips/:id/requests`, `/trips/:id/weekly-requests`, `/me/routes`) aceptan `Idempotency-Key: <uuid>`. Misma clave + mismo cuerpo → se **repite la respuesta original** (misma `status`, cabecera `Idempotency-Replayed: true`). Misma clave + cuerpo distinto → `422 IDEMPOTENCY_KEY_REUSED`. Las claves caducan a las 24 h. Si no se envía, la petición no se deduplica (solo la regla de dominio «una solicitud abierta por rango»). |
| Limitación | Búsqueda 30/min, mapa 60/min, planificador de rutas 20/min (por IP; configurable). |
| Privacidad | Ver §13. Posición **aproximada** para quien no participa; **precisa** solo para el conductor y para pasajeros con solicitud aceptada/confirmada. Matrícula completa solo para conductor y pasajeros con reserva confirmada. |
| Autorización | Por recurso. Leer una solicitud/reserva/viaje-borrador ajeno → `404` (no se revela su existencia). Rol insuficiente → `403 AUTH_FORBIDDEN`. |

Errores comunes a todos los endpoints con `bearerAuth`: `401 AUTH_REQUIRED | AUTH_INVALID | AUTH_INVALID_OR_EXPIRED`, `403 ACCOUNT_NOT_ACTIVE | AUTH_FORBIDDEN`, `400 VALIDATION_ERROR`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`.

---

## 1. Índice de endpoints

| # | Método y ruta | Auth | Pantallas | Resumen |
|---|---|---|---|---|
| 1 | `GET /v1/trip-categories` | pública | 09, 10, 18 | Categorías (Trabajo, Universidad, FP, Hospital, Deporte, Otros) |
| 2 | `GET /v1/trips/map` | opcional | 09 | Coches de la provincia con posición **aproximada** y plazas («2 plazas», «Completo») |
| 3 | `GET /v1/search/trips` | opcional | 10, 11 | Búsqueda por hora de llegada, semanal/puntual, días, categoría, con plazas |
| 4 | `GET /v1/trips/:tripId` | opcional | 12 | Detalle: conductor, vehículo, ruta simplificada, paradas con hora, totales, precio |
| 5 | `GET /v1/trips/:tripId/pickup-points` | requerida | 13 | Propuestas A/B de punto de recogida con minutos a pie y desvío |
| 6 | `POST /v1/trips/:tripId/quote` | opcional | 12, 15 | Aportación («Ver desglose») sin crear nada |
| 7 | `POST /v1/trips/:tripId/requests` | pasajero | 15 | Enviar solicitud (extiende el endpoint 0.14) |
| 8 | `GET /v1/ride-requests/:requestId` | pasajero titular o conductor | 16 | Estado, *stepper*, cuenta atrás del hold, próxima acción |
| 9 | `POST /v1/ride-requests/:requestId/withdraw` | pasajero titular | 16, 30 | Retirar una solicitud **pendiente** |
| 10 | `POST /v1/ride-requests/:requestId/decision` | conductor | 20 | Aceptar (crea hold) / rechazar (extiende el endpoint 0.14) |
| 11 | `POST /v1/trips/:tripId/weekly-requests/preview` | pasajero | 14, 15 | Ocurrencias, disponibilidad por día, importe semanal (sin crear) |
| 12 | `POST /v1/trips/:tripId/weekly-requests` | pasajero | 14, 15 | Crear reserva semanal (una solicitud por ocurrencia) |
| 13 | `GET /v1/weekly-reservations/:id` | pasajero titular o conductor | 16, 30 | Reserva semanal con estado agregado y ocurrencias |
| 14 | `POST /v1/weekly-reservations/:id/decision` | conductor | 20 | Aceptar/rechazar toda la reserva semanal |
| 15 | `POST /v1/weekly-reservations/:id/withdraw` | pasajero titular | 30 | Retirar las ocurrencias pendientes |
| 16 | `GET /v1/me/driver/requests` | conductor | 20 | Bandeja de solicitudes con ocupación por tramo y desvío |
| 17 | `GET /v1/me/driver/readiness` | conductor | 17 | Requisitos para publicar (foto, identidad, vehículo, seguro…) |
| 18 | `POST /v1/me/routes/plan` | conductor | 18, 19 | Calcular ruta y verificar provincia **por parada** (sin efectos) |
| 19 | `POST /v1/me/routes` | conductor | 19 | «Guardar ruta»: crea y publica viaje puntual o serie semanal |
| 20 | `GET /v1/me/trips/overview` | sesión | 30 | Próximos / En curso / Historial (pasajero o conductor) |
| 21 | `GET /v1/me/favorites` | sesión | 31 | Mis destinos |
| 22 | `POST /v1/me/favorites` | sesión | 31 | Añadir destino |
| 23 | `PATCH /v1/me/favorites/:favoriteId` | sesión | 31 | Editar destino |
| 24 | `DELETE /v1/me/favorites/:favoriteId` | sesión | 31 | Eliminar destino |
| 25 | `GET /v1/me/routine` | sesión | 31 | Rutina semanal + suspensión + plaza semanal ofrecida |
| 26 | `POST /v1/me/routine/entries` | sesión | 31 | Añadir filas de rutina (una por día) |
| 27 | `PATCH /v1/me/routine/entries/:entryId` | sesión | 31 | Editar/activar-desactivar una fila |
| 28 | `DELETE /v1/me/routine/entries/:entryId` | sesión | 31 | Eliminar una fila |
| 29 | `POST /v1/me/routine/suspensions` | sesión | 31 | «Suspender próxima semana» |
| 30 | `DELETE /v1/me/routine/suspensions/:weekStart` | sesión | 31 | Reanudar una semana suspendida |
| 31 | `PUT /v1/me/routine/weekly-offer` | conductor | 31 | «Plaza disponible (semanal)» |

**Endpoints existentes que se reutilizan sin cambiar su forma:** `GET /v1/provinces`, `GET /v1/provinces/resolve`, `GET /v1/maps/geocode`, `GET /v1/maps/reverse` (resolver sitios/`placeId` → coordenadas **en el cliente** antes de buscar),
`POST /v1/me/uploads/intents` + `POST /v1/me/uploads/:id/complete` (foto/seguro del vehículo), `GET /v1/me/documents`, `POST /v1/me/trips/:id/start|complete`, `GET /v1/trips/:id/location`, chat y código de recogida.

**Endpoints existentes ampliados:**
* `POST /v1/me/vehicles` y `PUT /v1/me/vehicles/:vehicleId`: campo opcional `color` (máx. 40) → aparece en `GET /v1/me/vehicles` (`color`). Pantalla 12 «Seat Arona · Gris».
* `POST /v1/trips/:tripId/requests` y `POST /v1/ride-requests/:requestId/decision`: cuerpo ampliado y respuesta **camelCase** (ver §7 y §8).
* La publicación heredada `POST /v1/me/trips` + `/publish` **sigue existiendo** (viajes puntuales sin etiquetas); las pantallas 18/19 usan `POST /v1/me/routes`.

---

## 2. Catálogo

### 2.1 `GET /v1/trip-categories` — pública
```json
{ "items": [
  { "id": "work", "label": "Trabajo" },
  { "id": "university", "label": "Universidad" },
  { "id": "fp_academies", "label": "FP" },
  { "id": "hospital", "label": "Hospital" },
  { "id": "sport", "label": "Deporte" },
  { "id": "other", "label": "Otros" }
] }
```

---

## 3. Mapa de inicio — pantalla 09

### 3.1 `GET /v1/trips/map` — auth opcional · 60/min
Query: `provinceId` (uuid, **obligatorio**), `category?`, `onlyWithSeats?` (bool, def. `false`), `withinHours?` (1–48, def. 12), `limit?` (1–200, def. 100).

Qué devuelve: viajes `published` que salen en las próximas `withinHours` horas y viajes `active` (en curso) de la provincia.
* Viaje en curso con GPS: `position.source="live_gps"`, cuadrícula de 0,01° (≈1,1 km), `stale=true` si la última posición tiene > 60 s (la UI no la muestra «en directo»).
* Viaje no iniciado (o sin GPS): `position.source="origin"`, origen aproximado a la misma cuadrícula.
* `seatsAvailable` = **máximo** de plazas libres en cualquier tramo; `full=true` si es 0 (pin gris «Completo»).

Errores: `404 PROVINCE_NOT_FOUND`.
```json
{
  "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001",
  "generatedAt": "2026-10-05T05:58:00.000Z",
  "truncated": false,
  "cars": [
    { "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330001", "category": "university", "state": "scheduled",
      "position": { "lat": 37.33, "lng": -5.94, "precision": "approximate", "source": "origin", "recordedAt": null, "stale": false, "ageSeconds": null },
      "seatsAvailable": 2, "seatsOffered": 3, "full": false,
      "departureAt": "2026-10-05T06:05:00.000Z", "originLabel": "Montequinto", "destinationLabel": "Universidad de Sevilla" },
    { "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330009", "category": "work", "state": "live",
      "position": { "lat": 37.35, "lng": -6.06, "precision": "approximate", "source": "live_gps", "recordedAt": "2026-10-05T05:57:41.000Z", "stale": false, "ageSeconds": 19 },
      "seatsAvailable": 1, "seatsOffered": 3, "full": false,
      "departureAt": "2026-10-05T05:40:00.000Z", "originLabel": "Mairena del Aljarafe", "destinationLabel": "Sevilla (Trabajo)" },
    { "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330010", "category": "work", "state": "scheduled",
      "position": { "lat": 37.36, "lng": -5.99, "precision": "approximate", "source": "origin", "recordedAt": null, "stale": false, "ageSeconds": null },
      "seatsAvailable": 0, "seatsOffered": 2, "full": true,
      "departureAt": "2026-10-05T06:30:00.000Z", "originLabel": "San Juan de Aznalfarache", "destinationLabel": "Sevilla (Trabajo)" }
  ]
}
```

---

## 4. Búsqueda — pantallas 10 y 11

### 4.1 `GET /v1/search/trips` — auth opcional · 30/min
Query (todo plano; las etiquetas/`placeId` se resuelven **en el cliente** con `GET /v1/maps/geocode`):

| Param | Notas |
|---|---|
| `provinceId`, `originLat`, `originLng`, `destLat`, `destLng` | obligatorios. Origen y destino **deben estar dentro de la provincia** (`422 ORIGIN_OUTSIDE_PROVINCE` «Origen fuera de provincia», `422 DESTINATION_OUTSIDE_PROVINCE` «Destino fuera de provincia»). |
| `arriveBy` | `HH:mm` «Llegada al destino» (08:30). Coincide si la llegada prevista a **tu parada de bajada** está en `[arriveBy−tol, arriveBy+tol]`. |
| `returnAt?` | `HH:mm` «Regreso (opcional)»: solo informa `return.matchesRequested`. |
| `mode` | `weekly` («Semanal») \| `one_off` («Puntual», requiere `date`). |
| `weekdays?` | CSV `mon,tue,wed,thu,fri` (def. lunes–viernes) para `weekly`. Se incluyen viajes que cubran **al menos un** día pedido (`recurrence.fullMatch` si cubren todos). |
| `category?`, `onlyWithSeats?` (def. `true`), `toleranceMinutes?` (def. 20, máx. 90), `radiusM?` (def. 2000; 200–10000), `cursor?`, `limit?` (def. 20, máx. 50) | |

Coincidencia geométrica (sin línea recta para precio/tiempo): el origen debe estar a ≤ `radiusM` de una **parada declarada** o —si el conductor activó «Recoger en ruta»— de la **ruta** (proyección sobre la polilínea); el destino a ≤ `radiusM` de una parada **posterior**.
`roadDistanceM`/`durationMinutes` se calculan sobre la ruta real entre tu recogida y tu bajada (interpolando por tramos del proveedor de rutas). Orden: cercanía de la llegada a `arriveBy`, luego distancia a pie, luego salida.
**Privacidad de la lista:** `pickup.location` y `dropoff.location` salen SIEMPRE con `precision:"approximate"` (3 decimales ≈ 110 m), también para usuarios con sesión; el punto exacto de encuentro se obtiene con `GET /v1/trips/:tripId/pickup-points` (requiere sesión). `vehicle.plate` es `null` y `vehicle.id` es `null` para quien no participa (solo `plateHint`). Los resultados no incluyen viajes `draft`/`cancelled` ni de otra provincia. Límite 30/min por IP (`429 RATE_LIMITED`).
`suggestions` rellena la tarjeta «Sin coincidencias · Prueba a ampliar el horario o más días.» (se calcula reejecutando con tolerancia +30 min / todos los días / radio ×2 cuando hay < 3 resultados).

Errores: `404 PROVINCE_NOT_FOUND`, `422 ORIGIN_OUTSIDE_PROVINCE`, `422 DESTINATION_OUTSIDE_PROVINCE`, `422 SEARCH_DATE_REQUIRED`, `422 INVALID_SEARCH_WEEKDAYS`.

Ejemplo — `?provinceId=5e2c…0001&originLat=37.3425&originLng=-5.9460&destLat=37.3825&destLng=-5.9919&arriveBy=08:30&returnAt=18:00&mode=weekly&weekdays=mon,tue,wed,thu,fri`:
```json
{
  "items": [
    {
      "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330001",
      "seriesId": "51e7a000-6c1b-4d2e-9f3a-0b1c2d3e4f01",
      "leg": "outbound", "category": "university",
      "driver": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa01", "displayName": "Ana García López", "firstName": "Ana",
                  "photoUrl": "https://media.mvc.example/p/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32 },
      "vehicle": { "id": null, "make": "SEAT", "model": "Arona", "color": "Gris", "displayName": "SEAT Arona",
                   "plateHint": "LKM", "plate": null, "passengerSeats": 3 },
      "recurrence": { "weekdays": ["mon","tue","wed","thu","fri"], "matchedWeekdays": ["mon","tue","wed","thu","fri"], "fullMatch": true },
      "departureAt": "2026-10-05T06:05:00.000Z",
      "seatsAvailable": 2, "seatsOffered": 3,
      "pickup": { "label": "Montequinto", "location": { "lat": 37.332, "lng": -5.937, "precision": "approximate" },
                  "pickupAt": "2026-10-05T06:05:00.000Z", "pickupAtLocal": "08:05", "minutesFromNow": 7,
                  "walkDistanceM": 1210, "walkMinutes": 21, "onRoute": false, "stopSeq": 0 },
      "dropoff": { "label": "Universidad de Sevilla", "location": { "lat": 37.383, "lng": -5.992, "precision": "approximate" },
                   "arriveAt": "2026-10-05T06:28:00.000Z", "arriveAtLocal": "08:28", "walkDistanceM": 40, "walkMinutes": 1, "stopSeq": 2 },
      "fromSegmentSeq": 0, "toSegmentSeq": 2,
      "roadDistanceM": 24000, "durationMinutes": 23,
      "price": { "cents": null, "currency": "EUR", "status": "pending_definition" },
      "return": { "available": true, "departsLocal": "18:00", "matchesRequested": true }
    },
    {
      "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330002",
      "seriesId": "51e7a000-6c1b-4d2e-9f3a-0b1c2d3e4f02",
      "leg": "outbound", "category": "university",
      "driver": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa02", "displayName": "Miguel Torres", "firstName": "Miguel",
                  "photoUrl": null, "ratingAverage": 4.9, "ratingCount": 18 },
      "vehicle": { "id": null, "make": "Seat", "model": "León", "color": "Azul", "displayName": "Seat León",
                   "plateHint": "TRM", "plate": null, "passengerSeats": 4 },
      "recurrence": { "weekdays": ["mon","tue","wed","thu","fri"], "matchedWeekdays": ["mon","tue","wed","thu","fri"], "fullMatch": true },
      "departureAt": "2026-10-05T06:03:00.000Z",
      "seatsAvailable": 1, "seatsOffered": 3,
      "pickup": { "label": "Mairena del Aljarafe", "location": { "lat": 37.345, "lng": -6.061, "precision": "approximate" },
                  "pickupAt": "2026-10-05T06:03:00.000Z", "pickupAtLocal": "08:03", "minutesFromNow": 5,
                  "walkDistanceM": 800, "walkMinutes": 14, "onRoute": false, "stopSeq": 0 },
      "dropoff": { "label": "Universidad de Sevilla", "location": { "lat": 37.383, "lng": -5.992, "precision": "approximate" },
                   "arriveAt": "2026-10-05T06:32:00.000Z", "arriveAtLocal": "08:32", "walkDistanceM": 40, "walkMinutes": 1, "stopSeq": 1 },
      "fromSegmentSeq": 0, "toSegmentSeq": 1,
      "roadDistanceM": 21500, "durationMinutes": 29,
      "price": { "cents": null, "currency": "EUR", "status": "pending_definition" },
      "return": { "available": false, "departsLocal": null, "matchesRequested": false }
    }
  ],
  "nextCursor": null,
  "suggestions": [
    { "kind": "widen_time", "message": "Prueba a ampliar el horario ±30 min: aparecerían 2 coches más.", "wouldMatch": 2,
      "apply": { "toleranceMinutes": 50 } }
  ],
  "criteria": { "mode": "weekly", "arriveBy": "08:30", "toleranceMinutes": 20, "weekdays": ["mon","tue","wed","thu","fri"],
                "date": null, "radiusM": 2000, "originLabel": "Montequinto", "destLabel": "Universidad de Sevilla" }
}
```

---

## 5. Detalle de viaje — pantalla 12

### 5.1 `GET /v1/trips/:tripId` — auth opcional
Query (contexto de búsqueda, opcional): `pickupLat`, `pickupLng` (se proyecta sobre la ruta → «Tú te subes aquí»), `dropoffStopSeq`.
Visibilidad: viajes `published|active|completed` son públicos (coordenadas aproximadas); `draft|cancelled` solo para su conductor (otros: `404 TRIP_NOT_FOUND`).
`price` es `pending_definition` mientras no haya tarifa aprobada; «Ver desglose» → `POST /v1/trips/:tripId/quote`.
Errores: `404 TRIP_NOT_FOUND`.
```json
{
  "id": "9f0e1d2c-4b3a-4a59-8877-665544330001", "seriesId": "51e7a000-6c1b-4d2e-9f3a-0b1c2d3e4f01",
  "status": "published", "kind": "recurring", "leg": "outbound", "category": "university",
  "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "provinceName": "Sevilla",
  "driver": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa01", "displayName": "Ana García López", "firstName": "Ana",
              "photoUrl": "https://media.mvc.example/p/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32 },
  "vehicle": { "id": null, "make": "SEAT", "model": "Arona", "color": "Gris", "displayName": "SEAT Arona",
               "plateHint": "LKM", "plate": null, "passengerSeats": 3 },
  "departureAt": "2026-10-05T06:05:00.000Z", "flexibilityMinutes": 10,
  "recurrence": { "weekdays": ["mon","tue","wed","thu","fri"], "outboundLocal": "08:05", "returnLocal": "18:00" },
  "pickupPolicy": { "onRoute": false, "maxDetourMinutes": 5 },
  "seats": { "offered": 3, "available": 2, "perSegment": [
    { "seq": 0, "fromStopSeq": 0, "toStopSeq": 1, "capacity": 3, "occupied": 1, "free": 2, "distanceM": 9000, "durationMinutes": 10 },
    { "seq": 1, "fromStopSeq": 1, "toStopSeq": 2, "capacity": 3, "occupied": 1, "free": 2, "distanceM": 15000, "durationMinutes": 13 } ] },
  "route": { "distanceM": 24000, "durationMinutes": 23,
             "geometry": { "type": "LineString", "precision": "approximate",
               "coordinates": [[-5.937,37.332],[-5.934,37.311],[-5.921,37.283],[-5.960,37.335],[-5.992,37.382]] } },
  "stops": [
    { "seq": 0, "kind": "origin", "label": "Montequinto", "location": { "lat": 37.332, "lng": -5.937, "precision": "approximate" },
      "etaAt": "2026-10-05T06:05:00.000Z", "etaLocal": "08:05", "optional": false, "detourMinutes": null,
      "isYourPickup": true, "isYourDropoff": false, "canBoard": true, "canAlight": false },
    { "seq": 1, "kind": "stop", "label": "Dos Hermanas", "location": { "lat": 37.283, "lng": -5.921, "precision": "approximate" },
      "etaAt": "2026-10-05T06:15:00.000Z", "etaLocal": "08:15", "optional": true, "detourMinutes": 5,
      "isYourPickup": false, "isYourDropoff": false, "canBoard": true, "canAlight": true },
    { "seq": 2, "kind": "destination", "label": "Sevilla – Universidad", "location": { "lat": 37.383, "lng": -5.992, "precision": "approximate" },
      "etaAt": "2026-10-05T06:28:00.000Z", "etaLocal": "08:28", "optional": false, "detourMinutes": null,
      "isYourPickup": false, "isYourDropoff": true, "canBoard": false, "canAlight": true } ],
  "totals": { "roadDistanceM": 24000, "durationMinutes": 23, "detourMinutes": 5 },
  "price": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "breakdownAvailable": true,
  "viewer": { "relation": "public", "precision": "approximate", "openRequest": null },
  "owner": null,
  "canRequest": true, "cannotRequestReason": null
}
```
`viewer.relation`: `public` (invitado u otro usuario) · `requester` (tiene una solicitud abierta: `pending` → coordenadas aproximadas; **aceptada con hold activo (`payment_pending`) → coordenadas precisas**, pero aún sin matrícula completa) · `passenger` (reserva confirmada: coordenadas **precisas**, `vehicle.plate` completa, `vehicle.id` null) · `driver` (propietario: coordenadas precisas, matrícula completa y `owner` con `pendingRequests` y `confirmedPassengers`).

---

## 6. Punto de recogida — pantalla 13

### 6.1 `GET /v1/trips/:tripId/pickup-points` — auth requerida
Query: `lat`, `lng` (obligatorios, posición del pasajero), `dropoffStopSeq?` (def. destino), `limit?` (1–4, def. 2).

Generación de propuestas (todas **dentro de la provincia** y **sobre/cerca de la ruta**):
1. paradas **declaradas** por el conductor anteriores a la bajada (`source:"driver_stop"`, desvío = el de la parada, 0 si es obligatoria);
2. si el conductor activó «Recoger en ruta», el **punto de la ruta más cercano** al pasajero (`source:"route_projection"`), solo si su desvío estimado ≤ `maxDetourMinutes` del viaje.
Se ordenan por distancia a pie (la primera es `recommended`). Nombre/dirección (`name`/`address`) salen de la geocodificación inversa **solo si hay proveedor configurado**; si no, `null` y la app muestra «Punto A».
`walk.*` y `detour.*` son estimaciones (línea recta ×1,3 a 4,5 km/h; desvío = 1 min de parada + 2×distancia a la ruta a 30 km/h) salvo `detour.source:"stop"|"routed"`. `proposals` puede ser `[]` («Este viaje no pasa cerca de ti»).
`id` es **opaco** (prefijo `pp1_` = versión del formato; la app **no** lo interpreta): se reenvía tal cual en `pickupPointId`; el servidor decodifica y **revalida todo** (provincia, distancia a la ruta, desvío, orden respecto a la bajada). Para las propuestas basadas en una parada declarada el servidor **ignora** las coordenadas codificadas y usa las de la parada; un identificador manipulado se rechaza (`422 PICKUP_POINT_INVALID`, `PICKUP_POINT_OUTSIDE_PROVINCE`, `PICKUP_NOT_ON_ROUTE`, `PICKUP_DETOUR_TOO_LARGE`) y nunca se acepta una recogida fuera de la provincia o de la ruta. El punto elegido queda guardado en la solicitud (no puede modificarse después).

Errores: `404 TRIP_NOT_FOUND`, `409 TRIP_NOT_BOOKABLE`, `409 DRIVER_CANNOT_REQUEST_OWN_TRIP`, `422 DROPOFF_STOP_INVALID`.
```json
{
  "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330001",
  "origin": { "lat": 37.3790, "lng": -5.9900 },
  "dropoff": { "stopSeq": 2, "label": "Sevilla – Universidad", "location": { "lat": 37.3825, "lng": -5.9919, "precision": "precise" } },
  "proposals": [
    { "id": "pp1_WzEsIjlmMGUxZDJjLTRiM2EtNGE1OS04ODc3LTY2NTU0NDMzMDAwMSIsMzcuMzcyLC01Ljk4NixudWxsLDRd", "code": "A",
      "name": "Aparcamiento público", "address": "Av. Manuel Siurot",
      "location": { "lat": 37.372, "lng": -5.986, "precision": "precise" }, "source": "route_projection",
      "walk": { "minutes": 4, "distanceM": 215, "estimated": true }, "detour": { "minutes": 2, "source": "estimate" },
      "fromSegmentSeq": 1, "boardsAt": "2026-10-05T06:20:00.000Z", "boardsAtLocal": "08:20",
      "distanceToDropoffM": 6000, "recommended": true },
    { "id": "pp1_WzEsIjlmMGUxZDJjLTRiM2EtNGE1OS04ODc3LTY2NTU0NDMzMDAwMSIsMzcuMzgxLC01Ljk3OCxudWxsLDZd", "code": "B",
      "name": "Av. de la Buhaira (Frente al centro deportivo)", "address": "Av. de la Buhaira",
      "location": { "lat": 37.381, "lng": -5.978, "precision": "precise" }, "source": "route_projection",
      "walk": { "minutes": 6, "distanceM": 330, "estimated": true }, "detour": { "minutes": 3, "source": "estimate" },
      "fromSegmentSeq": 1, "boardsAt": "2026-10-05T06:22:00.000Z", "boardsAtLocal": "08:22",
      "distanceToDropoffM": 4200, "recommended": false }
  ],
  "safetyNotice": "Comprueba que el punto permite una parada segura y legal."
}
```

---

## 7. Presupuesto y solicitud — pantallas 12 («Ver desglose»), 15, 16

### 7.1 `POST /v1/trips/:tripId/quote` — auth opcional · sin efectos
Cuerpo: `{ pickupPointId? , fromSegmentSeq?, toSegmentSeq?, dropoffStopSeq? }` (si no se envía nada: tramo completo del viaje).
Calcula la aportación **sobre km de carretera** del tramo del pasajero (`ride_requests` → `quote_snapshots` cuando exista tarifa aprobada). Reglas:

* Se lee la última fila `tariff_versions` con `status='approved'` y `effective_from ≤ ahora`. **Este módulo nunca aprueba ni activa una tarifa.** Sin fila aprobada → `state:"pending_definition"`, `tariff.state:"none_approved"` y los tres importes `pending_definition`.
* Con tarifa aprobada: `contribution = round_half_up(km × tarifa)` (`src/domain/money.ts`), con tope `shared_cost_cap_cents` si existe (por trayecto y pasajero; **decisión pendiente de negocio**). `managementFee` solo es `defined` si la tarifa define `passenger_commission_bps`; `total` es `defined` solo si todos sus componentes lo son (por eso la lámina 15 puede mostrar aportación y «Por definir» a la vez).
* Ida y vuelta se calculan por separado (cada pierna con su distancia).

Respuesta (sin tarifa aprobada — **caso real hoy**):
```json
{
  "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330001",
  "quote": {
    "state": "pending_definition",
    "tariff": { "state": "none_approved", "version": null },
    "basis": { "roadDistanceM": 24000, "rateMicrosPerKm": null },
    "contribution": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "managementFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "total": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "weekly": null,
    "lockedAt": null
  },
  "pickup": { "label": "Montequinto", "address": null, "location": { "lat": 37.3317, "lng": -5.9365, "precision": "precise" },
              "at": "2026-10-05T06:05:00.000Z", "atLocal": "08:05", "walkMinutes": null, "detourMinutes": 0 },
  "dropoff": { "label": "Sevilla – Universidad", "address": null, "location": { "lat": 37.3825, "lng": -5.9919, "precision": "precise" },
               "at": "2026-10-05T06:28:00.000Z", "atLocal": "08:28", "walkMinutes": null, "detourMinutes": null },
  "seatsAvailable": 2, "roadDistanceM": 24000, "canRequest": true, "cannotRequestReason": null
}
```
Forma de `quote` cuando **exista** una tarifa aprobada. Es una ilustración de la FORMA con **valores ficticios de prueba** (`rateMicrosPerKm: 100000`, 6 km, comisión de pasajero definida a 0 bps): **no es la tarifa del producto**, que hoy no existe ni este módulo puede crear:
```json
{ "state": "defined", "tariff": { "state": "approved", "version": 3 }, "basis": { "roadDistanceM": 6000, "rateMicrosPerKm": 100000 },
  "contribution": { "cents": 60, "currency": "EUR", "status": "defined" },
  "managementFee": { "cents": 0, "currency": "EUR", "status": "defined" },
  "total": { "cents": 60, "currency": "EUR", "status": "defined" },
  "weekly": { "weekdays": ["mon","tue","wed","thu","fri"], "legsPerDay": 2, "tripsPerWeek": 10,
              "contributionPerWeek": { "cents": 600, "currency": "EUR", "status": "defined" },
              "totalPerWeek": { "cents": 600, "currency": "EUR", "status": "defined" } },
  "lockedAt": null }
```
`contribution = round_half_up(roadDistanceM × rateMicrosPerKm / 10 000 000)` (céntimos enteros). El módulo solo escribe `quote_snapshots` (`lockedAt`) cuando el presupuesto está **completamente definido**.
Errores: `404 TRIP_NOT_FOUND`, `409 TRIP_NOT_BOOKABLE`, `422 INVALID_REQUEST_SHAPE` (mezclar `pickupPointId` con tramos), `422 INVALID_SEGMENT_RANGE`, `422 PICKUP_POINT_INVALID`, `422 DROPOFF_STOP_INVALID`, `422 DROPOFF_BEFORE_PICKUP`.

### 7.2 `POST /v1/trips/:tripId/requests` — pasajero · cabecera `Idempotency-Key`
Cuerpo: exactamente **una** forma de tramo — `pickupPointId` (+ `dropoffStopSeq?`) **o** `fromSegmentSeq`+`toSegmentSeq` (heredado 0.14) — y `message?` (≤ 300).
Reglas (en una transacción, con bloqueo de viaje y tramos: **comprobación de capacidad por tramo** como en 0.14):
* Viaje `published|active`; el conductor no puede solicitar su propio viaje; sin solicitud abierta **solapada** del mismo pasajero en el mismo viaje (`DUPLICATE_OPEN_REQUEST`).
* El punto de recogida se revalida (provincia + distancia a la ruta + desvío + orden). Se guardan en la solicitud: punto, minutos a pie, desvío, tramo, distancia de carretera, mensaje.
* Una solicitud **pendiente no reserva plaza**: la capacidad se bloquea al aceptar (hold). La aceptación del conductor ≠ reserva confirmada.
* Se notifica al conductor (`notify` categoría `trip`, `kind:"request_received"`).

Respuesta `201` = `RideRequestDetail` (§7.3). Ejemplo (Miguel pide plaza a Ana con el punto A):
```json
{
  "id": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c01", "status": "pending",
  "trip": { "id": "9f0e1d2c-4b3a-4a59-8877-665544330001", "leg": "outbound", "category": "university",
            "departureAt": "2026-10-05T06:05:00.000Z", "originLabel": "Montequinto", "destinationLabel": "Sevilla – Universidad",
            "driver": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa01", "displayName": "Ana García López", "firstName": "Ana",
                        "photoUrl": "https://media.mvc.example/p/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32 },
            "vehicle": { "id": null, "make": "SEAT", "model": "Arona", "color": "Gris", "displayName": "SEAT Arona",
                         "plateHint": "LKM", "plate": null, "passengerSeats": 3 } },
  "passenger": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa02", "displayName": "Miguel Torres", "firstName": "Miguel",
                 "photoUrl": null, "ratingAverage": 4.8, "ratingCount": 12 },
  "pickup": { "label": "Aparcamiento público", "address": "Av. Manuel Siurot", "location": { "lat": 37.372, "lng": -5.986, "precision": "precise" },
              "at": "2026-10-05T06:20:00.000Z", "atLocal": "08:20", "walkMinutes": 4, "detourMinutes": 2 },
  "dropoff": { "label": "Sevilla – Universidad", "address": null, "location": { "lat": 37.3825, "lng": -5.9919, "precision": "precise" },
               "at": "2026-10-05T06:28:00.000Z", "atLocal": "08:28", "walkMinutes": null, "detourMinutes": null },
  "fromSegmentSeq": 1, "toSegmentSeq": 2, "roadDistanceM": 6000, "message": "Voy con una maleta pequeña.",
  "stepper": { "steps": [ { "key": "requested", "state": "current" }, { "key": "accepted", "state": "pending" },
                           { "key": "payment", "state": "pending" }, { "key": "confirmed", "state": "pending" } ],
               "current": "requested", "terminal": null },
  "hold": null,
  "quote": { "state": "pending_definition", "tariff": { "state": "none_approved", "version": null },
             "basis": { "roadDistanceM": 6000, "rateMicrosPerKm": null },
             "contribution": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "managementFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "total": { "cents": null, "currency": "EUR", "status": "pending_definition" }, "weekly": null, "lockedAt": null },
  "nextAction": { "kind": "wait_for_driver", "deadlineAt": null },
  "booking": null, "weekly": null,
  "requestedAt": "2026-10-05T05:58:12.000Z", "updatedAt": "2026-10-05T05:58:12.000Z"
}
```
Errores: `404 TRIP_NOT_FOUND`, `409 TRIP_NOT_BOOKABLE`, `409 DRIVER_CANNOT_REQUEST_OWN_TRIP`, `409 NO_CAPACITY_ON_SEGMENT`, `409 DUPLICATE_OPEN_REQUEST`, `422 INVALID_REQUEST_SHAPE`, `422 INVALID_SEGMENT_RANGE`, `422 PICKUP_POINT_INVALID`, `422 PICKUP_POINT_OUTSIDE_PROVINCE`, `422 PICKUP_NOT_ON_ROUTE`, `422 PICKUP_DETOUR_TOO_LARGE`, `422 DROPOFF_STOP_INVALID`, `422 DROPOFF_BEFORE_PICKUP`, `422 IDEMPOTENCY_KEY_REUSED`.

### 7.3 `GET /v1/ride-requests/:requestId` — pasajero titular o conductor del viaje
Es la fuente de la pantalla 16 (**solo estado**; el pago es `money`). `404 REQUEST_NOT_FOUND` para cualquier otro usuario.
`stepper` (Solicitud → Aceptada → Pago → Confirmada) y `nextAction` se derivan de `status`:

| `status` | `stepper.current` | pasos | `nextAction.kind` |
|---|---|---|---|
| `pending` | requested | requested=current | `wait_for_driver` |
| `payment_pending` (hold activo) | accepted | requested=done, accepted=current, payment/confirmed=pending | `pay` (`deadlineAt` = fin del hold) |
| `confirmed` | confirmed | todo `done` | `view_booking` |
| `rejected` / `expired` / `cancelled` / `payment_late` | último alcanzado | el siguiente paso `failed`; `terminal` informado | `search_again` |

`hold.remainingSeconds` lo calcula el servidor en cada lectura (cuenta atrás **14:52** = 892 s). El hold dura **15 min** desde la aceptación (`TRIPS_SEAT_HOLD_TTL_SECONDS`, def. 900). Si caduca, la lectura (o el barrido periódico, cada `TRIPS_SWEEP_INTERVAL_SECONDS`, def. 30) pasa la solicitud a `expired`, libera el hold (`seat_holds.status='released'`), devuelve la plaza y avisa al pasajero una sola vez (`request_expired`). Tras caducar, `hold` se sigue informando con `active:false` y `remainingSeconds:0`, `stepper.terminal:"expired"` y `nextAction.kind:"search_again"`. Un pago tardío **no** crea reserva (`confirmProviderPayment` → `payment_late` + compensación; módulo `money`).
Ejemplo tras aceptar Ana (a los 8 s):
```json
{
  "id": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c01", "status": "payment_pending",
  "trip": { "id": "9f0e1d2c-4b3a-4a59-8877-665544330001", "leg": "outbound", "category": "university",
            "departureAt": "2026-10-05T06:05:00.000Z", "originLabel": "Montequinto", "destinationLabel": "Sevilla – Universidad",
            "driver": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa01", "displayName": "Ana García López", "firstName": "Ana",
                        "photoUrl": "https://media.mvc.example/p/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32 },
            "vehicle": { "id": null, "make": "SEAT", "model": "Arona", "color": "Gris", "displayName": "SEAT Arona",
                         "plateHint": "LKM", "plate": null, "passengerSeats": 3 } },
  "passenger": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa02", "displayName": "Miguel Torres", "firstName": "Miguel",
                 "photoUrl": null, "ratingAverage": 4.8, "ratingCount": 12 },
  "pickup": { "label": "Aparcamiento público", "address": "Av. Manuel Siurot", "location": { "lat": 37.372, "lng": -5.986, "precision": "precise" },
              "at": "2026-10-05T06:20:00.000Z", "atLocal": "08:20", "walkMinutes": 4, "detourMinutes": 2 },
  "dropoff": { "label": "Sevilla – Universidad", "address": null, "location": { "lat": 37.3825, "lng": -5.9919, "precision": "precise" },
               "at": "2026-10-05T06:28:00.000Z", "atLocal": "08:28", "walkMinutes": null, "detourMinutes": null },
  "fromSegmentSeq": 1, "toSegmentSeq": 2, "roadDistanceM": 6000, "message": null,
  "stepper": { "steps": [ { "key": "requested", "state": "done" }, { "key": "accepted", "state": "current" },
                           { "key": "payment", "state": "pending" }, { "key": "confirmed", "state": "pending" } ],
               "current": "accepted", "terminal": null },
  "hold": { "expiresAt": "2026-10-05T06:13:12.000Z", "remainingSeconds": 892, "active": true },
  "quote": { "state": "pending_definition", "tariff": { "state": "none_approved", "version": null },
             "basis": { "roadDistanceM": 6000, "rateMicrosPerKm": null },
             "contribution": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "managementFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "total": { "cents": null, "currency": "EUR", "status": "pending_definition" }, "weekly": null, "lockedAt": null },
  "nextAction": { "kind": "pay", "deadlineAt": "2026-10-05T06:13:12.000Z" },
  "booking": null, "weekly": null,
  "requestedAt": "2026-10-05T05:58:12.000Z", "updatedAt": "2026-10-05T05:58:20.000Z"
}
```

### 7.4 `POST /v1/ride-requests/:requestId/withdraw` — pasajero titular
Retira una solicitud **solo en `pending`** (sin hold ni dinero de por medio) → `cancelled`. Para `payment_pending`/`confirmed` la cancelación pertenece a `money` (pantalla «Cancelar reserva»).
Respuesta `200` = `RideRequestDetail` con `status:"cancelled"`. Errores: `404 REQUEST_NOT_FOUND`, `409 REQUEST_NOT_WITHDRAWABLE` (details `{status}`).

### 7.5 `POST /v1/ride-requests/:requestId/decision` — conductor del viaje
Cuerpo `{ "decision": "accept" | "reject" }`. Aceptar crea el *hold* en la misma transacción (`pending → payment_pending`; **aceptada ≠ confirmada**) y exige capacidad en todos los tramos; rechazar → `rejected`. Se notifica al pasajero (`request_accepted` / `request_rejected`).
```json
{ "id": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c01", "kind": "single", "status": "payment_pending",
  "hold": { "id": "b7a6c5d4-e3f2-4a1b-8c9d-0e1f2a3b4c5d", "expiresAt": "2026-10-05T06:13:12.000Z" },
  "requestIds": ["2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c01"] }
```
Errores: `404 REQUEST_NOT_FOUND`, `403 TRIP_NOT_OWNED` (cualquier usuario que no sea el conductor del viaje, **sea cual sea el estado de la solicitud**: así un tercero no averigua el estado), `409 REQUEST_IN_WEEKLY_RESERVATION` (la solicitud forma parte de una reserva semanal: se decide con §8.4; `details.reservationId`, solo se revela al conductor), `409 REQUEST_NOT_PENDING`, `409 TRIP_NOT_BOOKABLE`, `409 NO_CAPACITY_ON_SEGMENT`.

---

## 8. Reserva semanal — pantallas 14, 15, 16b

Modelo: el conductor publica una **serie** (`trip_series`: días, hora de ida, hora de vuelta opcional, plantilla de paradas/ruta). El servidor **materializa ocurrencias** (un `trips` real por día y sentido, `kind:"recurring"`, `status:"published"`) en una ventana móvil de 28 días; así cada ocurrencia tiene **sus propios tramos y capacidad** y reutilizan búsqueda, hold, reserva y GPS. `:tripId` de los endpoints semanales es **cualquier ocurrencia** de la serie (p. ej. la que devolvió la búsqueda).
La **vuelta** es el sentido contrario de las mismas paradas: el pasajero que sube en el tramo `k` y baja en la parada `m` de la ida ocupa en la vuelta el rango simétrico `[n−1−m, n−1−k)` (`n` = nº de paradas).

### 8.1 `POST /v1/trips/:tripId/weekly-requests/preview` — pasajero · sin efectos
Cuerpo `WeeklyRequestBody`: `pickupPointId` (obligatorio), `dropoffStopSeq?`, `weekdays[]`, `legs?` (def. `["outbound"]`), `startDate`, `weeks?` (1–4, def. 1), `exceptionDates?[]`, `cancellationPolicyVersion?` (string o `null` si no hay política aprobada), `allowPartial?`, `message?`.
Respuesta: `legs` (para pintar «Ida (mañana) 08:00 · Desde punto de recogida A hasta Universidad»), `occurrences[]` con `state` por día, `quote` semanal y `canSubmit`.
```json
{
  "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330001", "seriesId": "51e7a000-6c1b-4d2e-9f3a-0b1c2d3e4f01",
  "legs": [
    { "leg": "outbound", "label": "Ida (mañana)", "fromLabel": "Aparcamiento público", "toLabel": "Sevilla – Universidad", "boardsAtLocal": "08:20", "arrivesAtLocal": "08:28" },
    { "leg": "return", "label": "Vuelta (tarde)", "fromLabel": "Sevilla – Universidad", "toLabel": "Aparcamiento público", "boardsAtLocal": "18:00", "arrivesAtLocal": "18:12" } ],
  "occurrences": [
    { "date": "2026-10-05", "weekday": "mon", "leg": "outbound", "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330001", "boardsAtLocal": "08:20", "arrivesAtLocal": "08:28", "state": "available", "seatsAvailable": 2, "requestId": null, "requestStatus": null },
    { "date": "2026-10-05", "weekday": "mon", "leg": "return", "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330101", "boardsAtLocal": "18:00", "arrivesAtLocal": "18:12", "state": "available", "seatsAvailable": 3, "requestId": null, "requestStatus": null },
    { "date": "2026-10-08", "weekday": "thu", "leg": "outbound", "tripId": null, "boardsAtLocal": null, "arrivesAtLocal": null, "state": "skipped_exception", "seatsAvailable": null, "requestId": null, "requestStatus": null },
    { "date": "2026-10-09", "weekday": "fri", "leg": "outbound", "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330005", "boardsAtLocal": "08:20", "arrivesAtLocal": "08:28", "state": "skipped_full", "seatsAvailable": 0, "requestId": null, "requestStatus": null } ],
  "quote": { "state": "pending_definition", "tariff": { "state": "none_approved", "version": null },
             "basis": { "roadDistanceM": 6000, "rateMicrosPerKm": null },
             "contribution": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "managementFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "total": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "weekly": { "weekdays": ["mon","tue","wed","thu","fri"], "legsPerDay": 2, "tripsPerWeek": 10,
                         "contributionPerWeek": { "cents": null, "currency": "EUR", "status": "pending_definition" },
                         "totalPerWeek": { "cents": null, "currency": "EUR", "status": "pending_definition" } },
             "lockedAt": null },
  "canSubmit": false,
  "issues": [ { "code": "WEEKLY_OCCURRENCE_UNAVAILABLE", "message": "El viernes 9 de octubre no quedan plazas en ese tramo.", "date": "2026-10-09" } ]
}
```
(Los días de la lámina 14 omiten sábado y domingo; las ocurrencias solo existen en los días en que el conductor circula.)

### 8.2 `POST /v1/trips/:tripId/weekly-requests` — pasajero · `Idempotency-Key`
Mismo cuerpo. En **una transacción** y con bloqueo de cada viaje-ocurrencia (en orden `departure_at,id`, sin interbloqueos): comprueba capacidad por ocurrencia (misma comprobación que una solicitud simple) y crea **una `ride_request` `pending` por ocurrencia** + una `weekly_reservations`. Sin dobles reservas (índice único por viaje/pasajero/rango y comprobación de solape). Si una ocurrencia no tiene plaza o el pasajero ya tiene una solicitud abierta ese día: `409 WEEKLY_OCCURRENCE_UNAVAILABLE` (details `{dates}`) y **no se crea nada**, salvo `allowPartial:true` (se omiten esos días). En la respuesta `201` (y en su repetición idempotente) los días omitidos **por falta de plaza** se devuelven dentro de `occurrences` con `state:"skipped_full"`; las lecturas posteriores (`GET`) solo listan las solicitudes creadas, que son lo único que existe en base de datos.
Dos envíos simultáneos sin `Idempotency-Key` crean una sola reserva (el otro recibe `409`). Respuesta `201` = `WeeklyReservation` (§8.3). Se notifica al conductor una sola vez (`weekly_request_received`).
Errores: `404 TRIP_NOT_FOUND`, `409 TRIP_NOT_RECURRING`, `409 SERIES_HAS_NO_RETURN`, `409 TRIP_NOT_BOOKABLE` (serie pausada o vehículo no reservable), `409 WEEKLY_OCCURRENCE_UNAVAILABLE`, `409 DRIVER_CANNOT_REQUEST_OWN_TRIP`, `422 WEEKLY_WEEKDAY_NOT_OFFERED` (`details.weekdays`), `422 WEEKLY_NO_OCCURRENCES` (ningún día disponible con esos criterios o fuera de los 90 días de antelación), `422 WEEKLY_START_DATE_IN_PAST`, `422 PICKUP_POINT_INVALID`, `422 INVALID_CANCELLATION_POLICY_VERSION`, `422 IDEMPOTENCY_KEY_REUSED`.
En la vista previa, `issues[].code` puede ser `WEEKLY_OCCURRENCE_UNAVAILABLE` (sin plaza), `DUPLICATE_OPEN_REQUEST` (ya tienes una solicitud abierta ese día) o `WEEKLY_NO_OCCURRENCE` (en singular: ese día el conductor no tiene viaje materializado); no confundir con el **error** `WEEKLY_NO_OCCURRENCES`. Más allá de la ventana de 28 días la serie se amplía bajo demanda (hasta 90 días).

### 8.3 `GET /v1/weekly-reservations/:id` — pasajero titular o conductor
`status` agregado: `pending` (todas pendientes) · `payment_pending` (aceptadas, hold activo; `hold` = **menor** caducidad) · `confirmed` · `partially_confirmed` · `rejected` · `cancelled` · `expired`. La **confirmación** es por ocurrencia y la hace `money` (pago semanal → una reserva por solicitud).
```json
{
  "id": "6c5b4a39-2817-4f06-95e4-d3c2b1a09f01", "seriesId": "51e7a000-6c1b-4d2e-9f3a-0b1c2d3e4f01",
  "status": "payment_pending",
  "passenger": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa02", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null, "ratingAverage": 4.8, "ratingCount": 12 },
  "driver": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa01", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": "https://media.mvc.example/p/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32 },
  "category": "university", "weekdays": ["mon","tue","wed","thu","fri"],
  "legs": [ { "leg": "outbound", "label": "Ida (mañana)", "fromLabel": "Aparcamiento público", "toLabel": "Sevilla – Universidad", "boardsAtLocal": "08:20", "arrivesAtLocal": "08:28" } ],
  "startDate": "2026-10-05", "weeks": 1, "exceptionDates": ["2026-10-08"],
  "cancellationPolicyVersion": null,
  "occurrences": [ { "date": "2026-10-05", "weekday": "mon", "leg": "outbound", "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330001", "boardsAtLocal": "08:20", "arrivesAtLocal": "08:28", "state": "requested", "seatsAvailable": null, "requestId": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c01", "requestStatus": "payment_pending" } ],
  "hold": { "expiresAt": "2026-10-05T06:13:12.000Z", "remainingSeconds": 892, "active": true },
  "quote": { "state": "pending_definition", "tariff": { "state": "none_approved", "version": null }, "basis": { "roadDistanceM": 6000, "rateMicrosPerKm": null },
             "contribution": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "managementFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "total": { "cents": null, "currency": "EUR", "status": "pending_definition" },
             "weekly": { "weekdays": ["mon","tue","wed","thu","fri"], "legsPerDay": 1, "tripsPerWeek": 4,
                         "contributionPerWeek": { "cents": null, "currency": "EUR", "status": "pending_definition" },
                         "totalPerWeek": { "cents": null, "currency": "EUR", "status": "pending_definition" } }, "lockedAt": null },
  "nextAction": { "kind": "pay", "deadlineAt": "2026-10-05T06:13:12.000Z" },
  "createdAt": "2026-10-05T05:58:12.000Z"
}
```
Errores: `404 WEEKLY_RESERVATION_NOT_FOUND`.

### 8.4 `POST /v1/weekly-reservations/:id/decision` — conductor de la serie
Cuerpo `{decision}`. `accept` es **todo o nada**: bloquea capacidad de **todas** las ocurrencias pendientes (un hold por ocurrencia, misma caducidad); si alguna ya no tiene plaza → `409 NO_CAPACITY_ON_SEGMENT` con `details.dates` y no cambia nada. `reject` rechaza todas. Respuesta `DecideRequestResponse` con `kind:"weekly"`, `requestIds` de todas las ocurrencias.
### 8.5 `POST /v1/weekly-reservations/:id/withdraw` — pasajero titular
Retira las ocurrencias **pendientes** (las ya aceptadas/confirmadas siguen el flujo de cancelación de `money`). `409 REQUEST_NOT_WITHDRAWABLE` si no queda ninguna pendiente. Respuesta `WeeklyReservation`.

---

## 9. Bandeja del conductor — pantalla 20

### 9.1 `GET /v1/me/driver/requests` — conductor
Query: `status?` (`pending` def. · `open` = pending+payment_pending · `all`), `tripId?`, `cursor?`, `limit?` (def. 20, máx. 50). Solo solicitudes de **sus** viajes. Las reservas semanales aparecen **una vez** (`kind:"weekly"`, `id` = reserva semanal, decisión en §8.4). Orden: con `pending`/`open`, primero la salida más próxima y, a igualdad, la solicitud más antigua; con `all`, la solicitud más reciente primero. Antes de listar se caducan los holds vencidos (no se muestra una aceptación ya caducada). `canAccept=false` con `blockedReason` si ya no queda plaza en el tramo o el viaje dejó de ser reservable.
`occupancy.occupiedSeats/totalSeats` = «1 / 3 plazas» en el tramo más cargado del rango pedido **sin contar esta solicitud**; `perSegment` dibuja los puntos. `detourMinutes` = desvío de la recogida elegida (la «Desvío estimado +2 min»). «Ver perfil y hablar»: el chat actual solo admite reserva confirmada (ver «Decisiones pendientes»).
```json
{
  "items": [
    { "id": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c01", "kind": "single", "status": "pending",
      "passenger": { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa02", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null, "ratingAverage": 4.8, "ratingCount": 12 },
      "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330020", "leg": "outbound", "category": "work", "departureAt": "2026-10-05T05:00:00.000Z",
      "from": { "label": "Mairena del Aljarafe", "at": "2026-10-05T05:17:00.000Z", "atLocal": "07:17" },
      "to": { "label": "Sevilla (Trabajo)", "at": "2026-10-05T05:25:00.000Z", "atLocal": "07:25" },
      "detourMinutes": 2,
      "occupancy": { "occupiedSeats": 1, "totalSeats": 3, "perSegment": [
        { "seq": 0, "fromLabel": "Palomares del Río", "toLabel": "Mairena del Aljarafe", "occupied": 0, "capacity": 3, "inRequestedRange": false },
        { "seq": 1, "fromLabel": "Mairena del Aljarafe", "toLabel": "Sevilla (Trabajo)", "occupied": 1, "capacity": 3, "inRequestedRange": true } ] },
      "message": null, "weekly": null, "canAccept": true, "blockedReason": null, "requestedAt": "2026-10-05T05:10:00.000Z" }
  ],
  "nextCursor": null
}
```

---

## 10. Lado conductor — pantallas 17, 18, 19

### 10.1 `GET /v1/me/driver/readiness` — conductor
Resume lo que hoy exige el backend para publicar (`publishTrip` + `assertVehicleCanDrive`): foto pública aprobada, identidad verificada, vehículo y documentación aprobados, foto del vehículo aprobada, seguro aprobado y vigente. El **permiso de conducir** se informa (`blocking:false`) pero la política aún no lo exige. Para subir/cambiar foto o seguro se usan los endpoints existentes de subida privada. Se evalúa el vehículo más reciente del conductor (`vehicle:null` si no tiene).
```json
{
  "canPublish": true,
  "vehicle": { "id": "c3d2e1f0-1a2b-4c3d-8e4f-5a6b7c8d0001", "displayName": "SEAT Arona", "plate": "1234 MBC", "color": "Gris", "passengerSeats": 3 },
  "items": [
    { "key": "public_photo", "label": "Foto pública", "state": "approved", "blocking": true, "detail": null, "expiresOn": null },
    { "key": "identity", "label": "Identidad", "state": "approved", "blocking": true, "detail": null, "expiresOn": null },
    { "key": "vehicle", "label": "Vehículo", "state": "approved", "blocking": true, "detail": null, "expiresOn": null },
    { "key": "vehicle_documents", "label": "Documentación del vehículo", "state": "approved", "blocking": true, "detail": null, "expiresOn": null },
    { "key": "vehicle_photo", "label": "Foto del vehículo", "state": "approved", "blocking": true, "detail": null, "expiresOn": null },
    { "key": "insurance", "label": "Seguro (uso particular)", "state": "approved", "blocking": true, "detail": "Documento subido", "expiresOn": "2027-03-01" },
    { "key": "driver_license", "label": "Permiso de conducir", "state": "approved", "blocking": false, "detail": "Documento subido", "expiresOn": null } ],
  "blockers": []
}
```
`state`: `approved` · `in_review` (subido, pendiente de revisión) · `missing` · `rejected` · `expired`.

### 10.2 `POST /v1/me/routes/plan` — conductor · 20/min · sin efectos
Cuerpo `RoutePlanBody` (`origin`, `destination`, `stops[]` en orden, `departureLocal?`). Cada edición/reordenación de paradas se reenvía completa. Pasos del servidor:
1. Cada punto se comprueba **individualmente** contra el polígono de la provincia (`ST_CoveredBy`). Los que caen fuera → `verdict:"outside_province"`, mensaje «Esta parada no está en la provincia de Sevilla.» y `alternatives` (geocodificación acotada a la provincia **si hay proveedor**; si no, `[]`). Entonces `route:null`, `canSave:false`, `blockingMessage:"Corrige los puntos fuera de la provincia para guardar."`. No se llama al proveedor de rutas.
2. Si todos están dentro: ruta real por carretera tramo a tramo con alternativas (`computeProvinceCompliantSegmentPlan`) y comprobación de **geometría completa** dentro de la provincia. Si ninguna alternativa cabe → `canSave:false` + incidencia `ROUTE_LEAVES_PROVINCE`.
3. Horas de paso = salida + duración acumulada (`etaLocal`, `offsetMinutes`); paradas `optional` llevan `detourMinutes` calculado con el proveedor (ruta sin la parada).
Sin proveedor configurado y todos dentro → `503 MAPS_PROVIDER_UNAVAILABLE`.

Caso OK (lámina 19: Palomares del Río → Mairena del Aljarafe → Sevilla, salida 07:00):
```json
{
  "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "provinceName": "Sevilla",
  "canSave": true, "headline": "Toda la ruta está dentro de la provincia de Sevilla.", "blockingMessage": null, "issues": [],
  "stops": [
    { "index": 0, "kind": "origin", "label": "Palomares del Río", "location": { "lat": 37.3133, "lng": -6.0504 }, "optional": false,
      "inProvince": true, "verdict": "ok", "message": null, "etaLocal": "07:00", "offsetMinutes": 0, "detourMinutes": null, "alternatives": [] },
    { "index": 1, "kind": "stop", "label": "Mairena del Aljarafe", "location": { "lat": 37.3446, "lng": -6.0614 }, "optional": false,
      "inProvince": true, "verdict": "ok", "message": null, "etaLocal": "07:17", "offsetMinutes": 17, "detourMinutes": null, "alternatives": [] },
    { "index": 2, "kind": "destination", "label": "Sevilla", "location": { "lat": 37.3891, "lng": -5.9845 }, "optional": false,
      "inProvince": true, "verdict": "ok", "message": null, "etaLocal": "07:25", "offsetMinutes": 25, "detourMinutes": null, "alternatives": [] } ],
  "route": { "distanceM": 21800, "durationMinutes": 25, "provider": "google",
             "providerRef": "google-routes-segments-sha256:3f2a…",
             "geometry": { "type": "LineString", "coordinates": [[-6.0504,37.3133],[-6.0614,37.3446],[-5.9845,37.3891]] } },
  "computedAt": "2026-10-05T05:17:00.000Z"
}
```
Caso con parada fuera de provincia (lámina 19, «Huelva (sugerida) · Fuera de provincia»):
```json
{
  "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "provinceName": "Sevilla",
  "canSave": false, "headline": null, "blockingMessage": "Corrige los puntos fuera de la provincia para guardar.",
  "issues": [ { "code": "STOP_OUTSIDE_PROVINCE", "severity": "error", "stopIndex": 1, "message": "Huelva (sugerida) está fuera de la provincia de Sevilla." } ],
  "stops": [
    { "index": 0, "kind": "origin", "label": "Palomares del Río", "location": { "lat": 37.3133, "lng": -6.0504 }, "optional": false, "inProvince": true, "verdict": "ok", "message": null, "etaLocal": null, "offsetMinutes": null, "detourMinutes": null, "alternatives": [] },
    { "index": 1, "kind": "stop", "label": "Huelva (sugerida)", "location": { "lat": 37.2614, "lng": -6.9447 }, "optional": false, "inProvince": false, "verdict": "outside_province",
      "message": "Esta parada no está en la provincia de Sevilla.", "etaLocal": null, "offsetMinutes": null, "detourMinutes": null,
      "alternatives": [ { "label": "Aznalcóllar", "location": { "lat": 37.5336, "lng": -6.2744 } } ] },
    { "index": 2, "kind": "destination", "label": "Sevilla", "location": { "lat": 37.3891, "lng": -5.9845 }, "optional": false, "inProvince": true, "verdict": "ok", "message": null, "etaLocal": null, "offsetMinutes": null, "detourMinutes": null, "alternatives": [] } ],
  "route": null, "computedAt": "2026-10-05T05:17:00.000Z"
}
```
Errores: `404 PROVINCE_NOT_FOUND`, `422 TOO_MANY_STOPS` (> 10 paradas intermedias), `422 ROUTE_TOO_SHORT` (origen y destino casi iguales), `503 MAPS_PROVIDER_UNAVAILABLE` (sin proveedor de rutas), y los heredados del proveedor de mapas: `502 ROUTING_PROVIDER_ERROR`, `502 ROUTING_PROVIDER_BAD_RESPONSE`, `429 ROUTING_PROVIDER_RATE_LIMITED` (mensajes en inglés; la app mapea por `code`). Un punto fuera de la provincia **no** es un error: es un `verdict` por parada con `200`.

### 10.3 `POST /v1/me/routes` — conductor · `Idempotency-Key`
«Guardar ruta». **Recalcula todo en el servidor** (nunca confía en un plan previo) y aplica la **puerta de publicación**: foto pública aprobada, identidad verificada, vehículo propio con documentación, foto y seguro aprobados y vigentes, plazas ≤ plazas del vehículo, todas las paradas y la geometría completa dentro de la provincia (también la **vuelta**, calculada independientemente).
* `frequency:"one_off"`: crea 1 viaje `kind:"single"` (+ 1 de vuelta si hay `returnLocal`) en `startDate`, `status:"published"`.
* `frequency:"daily_workdays"`: crea la **serie**; materializa ocurrencias (ida y, si procede, vuelta) para `weekdays` (def. lunes–viernes) desde `startDate` hasta 28 días vista. El servidor amplía la ventana periódicamente (barrido interno) y antes de cada reserva semanal.
* No se publican ocurrencias ya pasadas.
Auditoría: `route.published` (conductor, serie/viajes, distancia, nº ocurrencias).
```json
{
  "vehicleId": "c3d2e1f0-1a2b-4c3d-8e4f-5a6b7c8d0001", "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "category": "work",
  "origin": { "lat": 37.3133, "lng": -6.0504, "label": "Palomares del Río" },
  "destination": { "lat": 37.3891, "lng": -5.9845, "label": "Sevilla (Trabajo)" },
  "stops": [ { "lat": 37.3446, "lng": -6.0614, "label": "Mairena del Aljarafe" } ],
  "frequency": "daily_workdays", "outboundLocal": "07:00", "returnLocal": "15:00", "startDate": "2026-10-06",
  "seats": 3, "maxDetourMinutes": 5, "pickupOnRoute": true
}
```
Respuesta `201`:
```json
{
  "seriesId": "51e7a000-6c1b-4d2e-9f3a-0b1c2d3e4f07", "frequency": "daily_workdays",
  "trips": [
    { "id": "9f0e1d2c-4b3a-4a59-8877-665544330201", "leg": "outbound", "departureAt": "2026-10-06T05:00:00.000Z", "status": "published" },
    { "id": "9f0e1d2c-4b3a-4a59-8877-665544330202", "leg": "return", "departureAt": "2026-10-06T13:00:00.000Z", "status": "published" } ],
  "occurrencesCreated": 40, "horizonUntil": "2026-11-02",
  "route": { "distanceM": 21800, "durationMinutes": 25, "provider": "google", "providerRef": "google-routes-segments-sha256:3f2a…",
             "geometry": { "type": "LineString", "coordinates": [[-6.0504,37.3133],[-6.0614,37.3446],[-5.9845,37.3891]] } }
}
```
Errores: `409 DRIVER_NOT_READY` (details `{blockers:[…]}`), `404 VEHICLE_NOT_FOUND`, `403 VEHICLE_NOT_OWNED`, `422 OFFERED_SEATS_EXCEED_VEHICLE`, `422 ROUTE_POINT_OUTSIDE_PROVINCE` (details `{pointIndex}`), `422 NO_ROUTE_WITHIN_PROVINCE`, `422 PUBLISH_START_DATE_IN_PAST`, `422 ONE_OFF_DATE_REQUIRED`, `422 INVALID_DATE_RANGE` (fecha de inicio/fin no válida o con > 90 días de antelación, fin anterior al inicio, viaje puntual con fecha de fin, sin días), `422 INVALID_TIME`, `422 TOO_MANY_STOPS`, `422 ROUTE_TOO_SHORT`, `503 MAPS_PROVIDER_UNAVAILABLE`, `502/429` del proveedor de mapas (como §10.2), `422 IDEMPOTENCY_KEY_REUSED`.
Limitación conocida: la publicación mantiene una transacción abierta mientras se consulta al proveedor de rutas (ver §16).

### 10.4 Vehículo (pantalla 17) — endpoints existentes
`GET/POST /v1/me/vehicles`, `PUT /v1/me/vehicles/:vehicleId`: cuerpo `{ make, model, plate, passengerSeats, color? }`. Cambiar marca/modelo/matrícula/plazas/color **reinicia la revisión** (comportamiento 0.14). «Plazas disponibles» (− 3 +) ≤ `passengerSeats` se valida de nuevo al publicar.

---

## 11. Mis viajes — pantalla 30

### 11.1 `GET /v1/me/trips/overview` — sesión
Query: `role` (`passenger`|`driver`, **obligatorio**), `section?` (`all` def. · `upcoming` · `in_progress` · `history`), `cursor?` (solo historial), `limit?` (def. 10 para historial).
* **Pasajero** — próximos: reservas semanales abiertas (**una** tarjeta `weekly_reservation` por reserva, con estado agregado, aunque tenga 10 solicitudes) y solicitudes/reservas puntuales futuras (`pending`, `payment_pending`, `confirmed`), ordenadas por salida con las semanales primero; en curso: reservas confirmadas de viajes `active`; historial: reservas `completed|no_show|cancelled|driver_cancelled` y solicitudes `rejected|expired|cancelled`. Las solicitudes semanales retiradas (p. ej. por «Suspender próxima semana») **no** ensucian el historial. Antes de pintar se caducan los holds vencidos del pasajero (no se muestra un «Pago pendiente» ya caducado).
* **Conductor** — próximos: sus series activas (`weekly_reservation` con `id`=`seriesId`, `reservationId:null`) y sus viajes `published` que no salieron hace más de 2 h (las ocurrencias de una serie solo aparecen como viaje suelto cuando salen en las próximas 24 h: antes las representa la tarjeta de la serie); en curso: viajes `active`; historial: `completed|cancelled` y publicados cuya salida pasó hace más de 2 h sin iniciarse (`status.code:"expired"`). Los borradores no se listan.
* `riders`: otros participantes **confirmados** (avatares), solo visibles para quien participa. `occupancy` = plazas ocupadas / ofrecidas (máx. de los tramos).
* `liveEta` («El conductor llegará en unos 10 min»): solo si el viaje está `active`, el pasajero tiene reserva confirmada y hay posición **fresca** (< 60 s). Se calcula por la ruta (posición proyectada → parada de recogida con las duraciones por tramo del proveedor); si el coche ya pasó, `null`.
* `startsInMinutes` («En 12 min»): minutos hasta la recogida (pasajero) o salida (conductor); `null` si faltan > 3 h.
```json
{
  "role": "passenger", "generatedAt": "2026-10-05T05:18:00.000Z",
  "counts": { "upcoming": 2, "inProgress": 1, "history": 14 },
  "upcoming": [
    { "kind": "weekly_reservation", "id": "6c5b4a39-2817-4f06-95e4-d3c2b1a09f02", "seriesId": "51e7a000-6c1b-4d2e-9f3a-0b1c2d3e4f03", "reservationId": "6c5b4a39-2817-4f06-95e4-d3c2b1a09f02",
      "category": "university", "title": "Universidad",
      "from": { "label": "Sevilla (Los Bermejales)", "timeLocal": "07:30" }, "to": { "label": "U. Pablo de Olavide", "timeLocal": "07:50" },
      "riders": [ { "id": "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa03", "displayName": "Laura Sánchez", "firstName": "Laura", "photoUrl": null, "ratingAverage": 4.7, "ratingCount": 9 } ],
      "occupancy": { "occupied": 3, "total": 4 }, "status": { "code": "confirmed", "label": "Confirmada" },
      "recurrence": { "weekdays": ["mon","tue","wed","thu","fri"], "recurring": true, "label": "Lun - Vie · Recurrente" } },
    { "kind": "trip", "id": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c09", "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330031", "requestId": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c09",
      "bookingId": "e8f7a6b5-c4d3-4e2f-81a0-9b8c7d6e5f01", "role": "passenger", "leg": "outbound", "departureAt": "2026-10-05T05:30:00.000Z",
      "category": "university", "title": "Campus – U. Pablo de Olavide",
      "from": { "label": "Sevilla (Los Bermejales)", "timeLocal": "07:30" }, "to": { "label": "U. Pablo de Olavide", "timeLocal": "07:50" },
      "riders": [], "occupancy": { "occupied": 3, "total": 4 }, "status": { "code": "confirmed", "label": "Confirmada" },
      "startsInMinutes": 12, "phase": "scheduled", "liveEta": null }
  ],
  "inProgress": [
    { "kind": "trip", "id": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c10", "tripId": "9f0e1d2c-4b3a-4a59-8877-665544330032", "requestId": "2d3c4b5a-6978-4a8b-9c0d-1e2f3a4b5c10",
      "bookingId": "e8f7a6b5-c4d3-4e2f-81a0-9b8c7d6e5f02", "role": "passenger", "leg": "outbound", "departureAt": "2026-10-05T05:10:00.000Z",
      "category": "university", "title": "Campus – U. Pablo de Olavide",
      "from": { "label": "Sevilla (Los Bermejales)", "timeLocal": "07:30" }, "to": { "label": "U. Pablo de Olavide", "timeLocal": "07:50" },
      "riders": [], "occupancy": { "occupied": 3, "total": 4 }, "status": { "code": "live", "label": "En curso" },
      "startsInMinutes": null, "phase": "live", "liveEta": { "minutes": 10, "phrase": "El conductor llegará en unos 10 min", "stale": false } }
  ],
  "history": { "items": [], "nextCursor": "eyJvIjoxMH0" }
}
```
Errores: `403 AUTH_FORBIDDEN` (`role:"driver"` sin rol de conductor o `role:"passenger"` sin rol de pasajero), `400 VALIDATION_ERROR` (falta `role`, `limit` fuera de 1–50, `section` desconocida), `400 INVALID_CURSOR`. `counts` no depende de `section`. `liveEta` es **solo del pasajero** (el conductor siempre `null`); con posición de más de 60 s (`TRIPS_LIVE_STALE_SECONDS`) o con el coche ya pasado por la recogida es `null`, nunca una cifra inventada. Si faltan menos de ~1 min, `phrase` es «El conductor está a punto de llegar».

---

## 12. Favoritos y rutina — pantalla 31

Todos los recursos son **del propio usuario** (`404` si el id es ajeno). Máx. 20 destinos y 40 filas de rutina por usuario (`409 FAVORITES_LIMIT_REACHED` / `ROUTINE_LIMIT_REACHED`).

### 12.1 Destinos
* `GET /v1/me/favorites` → `Page<FavoritePlace>` (orden de creación; `cursor`/`limit` 1–50, def. 20).
* `POST /v1/me/favorites` `{kind, name (1–60), address (1–200), lat, lng}` → `201 FavoritePlace` (espacios normalizados; auditoría `favorite.created`). El punto debe estar en una provincia conocida (`provinceId` se rellena; fuera de cualquier provincia → `422 FAVORITE_OUTSIDE_PROVINCES`, sin guardar nada). Máx. 20 por usuario, también con altas simultáneas (`409 FAVORITES_LIMIT_REACHED`).
* `PATCH /v1/me/favorites/:favoriteId` (≥ 1 campo, si no `400`; para mover el lugar, `lat` **y** `lng` juntas, si no `422 INVALID_REQUEST_SHAPE`) → `FavoritePlace`. Ajeno o inexistente → `404 FAVORITE_NOT_FOUND`.
* `DELETE /v1/me/favorites/:favoriteId` → `204` (auditoría `favorite.deleted`). Si lo usa una fila de rutina → `409 FAVORITE_IN_USE` (details `{entryIds}`) y no se borra.
```json
{ "items": [
  { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e501", "kind": "work", "name": "Trabajo", "address": "Torre Sevilla, Sevilla",
    "location": { "lat": 37.4048, "lng": -6.0016 }, "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "createdAt": "2026-09-20T08:00:00.000Z" },
  { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e502", "kind": "campus", "name": "Campus", "address": "U. Pablo de Olavide, Sevilla",
    "location": { "lat": 37.3547, "lng": -5.9364 }, "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "createdAt": "2026-09-20T08:01:00.000Z" },
  { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e503", "kind": "home", "name": "Casa", "address": "Sevilla (Nervión)",
    "location": { "lat": 37.3836, "lng": -5.9700 }, "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "createdAt": "2026-09-20T08:02:00.000Z" } ],
  "nextCursor": null }
```

### 12.2 Rutina semanal
* `GET /v1/me/routine` → `RoutineResponse` (`places` = **todos** tus destinos —sirven de selector—, `entries` ordenadas lunes→domingo y por hora, `suspensions` futuras, `nextWeek` = próxima semana lun–dom y si está suspendida, `weeklyOffer`).
* `POST /v1/me/routine/entries` `{weekdays[], time, fromPlaceId, toPlaceId, enabled?}` → `201 RoutineEntriesResponse { items: RoutineEntry[] }` (una fila por día; un día solo puede tener una fila con la misma hora y trayecto → `409 ROUTINE_ENTRY_EXISTS` con `details.weekdays`, y no se crea ninguna). `fromPlaceId ≠ toPlaceId` (`422 ROUTINE_SAME_PLACE`). Origen/destino ajenos o inexistentes → `404 FAVORITE_NOT_FOUND`. Hora no `HH:mm` → `400`. Máx. 40 filas (`409 ROUTINE_LIMIT_REACHED`).
* `PATCH /v1/me/routine/entries/:entryId` `{time?, fromPlaceId?, toPlaceId?, enabled?}` (≥ 1 campo, si no `400`) → `RoutineEntry` (casilla ✓/☐ = `enabled`; el día no cambia). `409 ROUTINE_ENTRY_EXISTS`, `422 ROUTINE_SAME_PLACE`, `404 ROUTINE_ENTRY_NOT_FOUND`.
* `DELETE /v1/me/routine/entries/:entryId` → `204` (`404 ROUTINE_ENTRY_NOT_FOUND` si no existe o es ajena).
* `POST /v1/me/routine/suspensions` `{weekStart?}` → `CreateRoutineSuspensionResponse { weekStart, weekEnd, withdrawnRequests, keptRequests }`: **`201`** al crear, **`200`** si ya existía (idempotente). Sin `weekStart` = lunes de la **próxima semana**; debe ser lunes, no pasado y a ≤ 365 días (`422 INVALID_WEEK_START`). **Efecto real:** la semana se excluye de la rutina y se **retiran las solicitudes semanales aún `pending`** de esa semana (`withdrawnRequests`; pasan a `cancelled` con auditoría `ride_request.withdrawn`); las ya aceptadas o confirmadas **no se tocan** (`keptRequests`: su cancelación sigue la política de `money`), para que la app ofrezca «Cancelar reservas confirmadas». Repetir reintenta retirar lo que siga pendiente.
* `DELETE /v1/me/routine/suspensions/:weekStart` → `204` siempre (idempotente; reanuda; no restaura las solicitudes ya retiradas). `weekStart` que no sea lunes → `422 INVALID_WEEK_START`.
* `PUT /v1/me/routine/weekly-offer` `{enabled, seats (1–8)}` (rol conductor, si no `403`) → `WeeklySeatOffer`. Es una **preferencia** («Ofrezco 1 plaza de lunes a viernes»); no publica nada por sí misma: `weekdays` sale de las filas **activas** de la rutina (sin rutina: lunes a viernes) y `prefill` entrega el cuerpo para abrir «Publica tu ruta» desde el trayecto de la rutina que más días se repite (`null` si no hay rutina). El precio es «Propuesta» (`pending_definition`).
```json
{
  "places": [ { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e502", "kind": "campus", "name": "Campus", "address": "U. Pablo de Olavide, Sevilla", "location": { "lat": 37.3547, "lng": -5.9364 }, "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "createdAt": "2026-09-20T08:01:00.000Z" },
              { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e503", "kind": "home", "name": "Casa", "address": "Sevilla (Nervión)", "location": { "lat": 37.3836, "lng": -5.9700 }, "provinceId": "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", "createdAt": "2026-09-20T08:02:00.000Z" } ],
  "entries": [
    { "id": "f0e1d2c3-b4a5-4968-8776-655443322101", "weekday": "mon", "time": "07:30", "fromPlace": { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e503", "kind": "home", "name": "Casa" }, "toPlace": { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e502", "kind": "campus", "name": "Campus" }, "enabled": true },
    { "id": "f0e1d2c3-b4a5-4968-8776-655443322102", "weekday": "tue", "time": "07:30", "fromPlace": { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e503", "kind": "home", "name": "Casa" }, "toPlace": { "id": "d1e2f3a4-b5c6-4d7e-8f90-a1b2c3d4e502", "kind": "campus", "name": "Campus" }, "enabled": true } ],
  "suspensions": [],
  "nextWeek": { "weekStart": "2026-10-12", "weekEnd": "2026-10-18", "suspended": false },
  "weeklyOffer": { "enabled": true, "seats": 1, "weekdays": ["mon","tue","wed","thu","fri"],
                   "conditions": { "label": "Propuesta", "price": { "cents": null, "currency": "EUR", "status": "pending_definition" } },
                   "prefill": { "frequency": "daily_workdays", "outboundLocal": "07:30", "weekdays": ["mon","tue","wed","thu","fri"], "seats": 1,
                                "origin": { "lat": 37.3836, "lng": -5.9700, "label": "Casa" }, "destination": { "lat": 37.3547, "lng": -5.9364, "label": "Campus" } } }
}
```

---

## 13. Privacidad y autorización (resumen)

| Dato | Público/invitado | Usuario con sesión | Solicitante (pendiente) | Pasajero confirmado | Conductor |
|---|---|---|---|---|---|
| Mapa de coches | cuadrícula 0,01° (≈1,1 km), nunca la posición precisa | igual | igual | `GET /v1/trips/:id/location` (módulo existente) | – |
| Paradas del detalle de viaje | 3 decimales (≈110 m), etiqueta de zona | igual | igual | **precisas** | precisas |
| Resultados de búsqueda (`pickup`/`dropoff`) | 3 decimales | 3 decimales | 3 decimales | – | – |
| Puntos de recogida propuestos | – (requiere sesión) | precisos (son puntos de encuentro públicos sobre la ruta) | – | – | – |
| Matrícula | últimos 3 caracteres (`plateHint`) | igual | igual | **completa** | completa |
| Datos de solicitudes/reservas | – | solo las **propias** (`404` ajenas) | propia | propia | de **sus** viajes |
| Avatares de otros pasajeros (Mis viajes) | – | – | – | solo confirmados del mismo viaje | solo confirmados de su viaje |
| Borradores de viaje | `404` | `404` | – | – | propietario |

Matices: (1) un solicitante cuya solicitud ya fue **aceptada** (`payment_pending`, hold activo) recibe coordenadas precisas en el detalle, aunque todavía no la matrícula completa (solo con reserva confirmada). (2) `GET /v1/ride-requests/:id`, que solo pueden leer su titular y el conductor, devuelve recogida/bajada precisas (el pasajero eligió el punto y el conductor lo necesita). (3) En las reservas semanales el conductor ve a cada pasajero una vez (`kind:"weekly"`). (4) Los avatares de Mis viajes salen solo de reservas **confirmadas** y solo para quien participa en ese viaje; una solicitud pendiente no ve a los confirmados.

`PublicUser` nunca incluye teléfono ni identidad; `photoUrl` solo si la foto pública está **aprobada** y hay base de medios pública configurada (`PUBLIC_MEDIA_BASE_URL`).
Auditoría (`audit_events`): `ride_request.created`, `ride_request.withdrawn`, `ride_request.rejected|accepted_with_hold` (existentes), `weekly_request.created`, `weekly_request.decided`, `route.published`, `favorite.created|deleted`, `routine.suspended`.

## 14. Máquinas de estado (este módulo)

**Solicitud** (`ride_requests.status`; ver `docs/STATE_MACHINES.md`):
```
pending ──accept (driver, tx con hold)──► payment_pending ──pago confirmado (money)──► confirmed
   │                                          │ └─ hold caducado + pago tardío (money) ─► payment_late (+ compensación)
   ├─ reject (driver) ─► rejected             └─ hold caducado (barrido/lectura) ─► expired   (hold released)
   └─ withdraw (passenger, solo pending) ─► cancelled
```
`accepted` es transitorio (misma transacción que la creación del hold). Cancelar `payment_pending`/`confirmed` = módulo `money`.

**Serie y ocurrencias:** `trip_series.status`: `active` → `paused|ended`. Cada ocurrencia es un `trips` con `series_id`, `service_date` (día Madrid) y `leg`; índice único `(series_id, leg, service_date)` → la materialización es idempotente y segura en concurrencia. `draft → published → active → completed|cancelled` como en `docs/STATE_MACHINES.md`.

**Reserva semanal:** agregado de sus solicitudes (§8.3). Aceptación y retirada son todo-o-nada por conjunto de ocurrencias abiertas.

## 15. Integración con otros módulos

* **money** — usar `quoteForRequest(db, requestId)` y `computeQuote(...)` de `src/modules/trips/quote-service.ts` para el importe; guarda `quote_snapshots` con `request_id` al solicitar y al aceptar **solo** cuando hay tarifa aprobada. Reserva semanal: `ride_requests.weekly_reservation_id` agrupa las solicitudes de un pago semanal (`select … where weekly_reservation_id=$1 and status='payment_pending'`); `confirmProviderPayment` (0.14) sigue siendo **por solicitud**.
* **live** — las ocurrencias son `trips` normales: `start/complete`, GPS y chat funcionan por ocurrencia. `trips.service_date`, `trips.series_id` y `trips.leg` identifican el servicio.
* **comms** — este módulo escribe `notifications` (categoría `trip`) con `kind`: `request_received` (conductor), `request_accepted`, `request_rejected`, `request_expired`, `request_withdrawn` (conductor) y `weekly_request_received`; `data` = `{requestId|reservationId, tripId}`.
* **ratings** — `PublicUser.ratingAverage/ratingCount` salen de un *resolver* inyectable (`registerRatingSummaryProvider` en `src/modules/trips/public-user.ts`); sin proveedor registrado devuelven `null`/`0`.

## 16. Decisiones pendientes y límites conocidos

1. **Economía**: sin tarifa aprobada todo es «Por definir». El tope `shared_cost_cap_cents` (por pasajero y trayecto) y la comisión de pasajero son supuestos hasta que negocio decida.
2. **Política de cancelación**: `cancellationPolicyVersion` es solo un texto aceptado y guardado; el motor es de `money`.
3. **Chat previo a la reserva** (pantalla 20 «Ver perfil y hablar»): `chat-service` solo permite conductor ↔ pasajero con reserva confirmada. Hace falta decisión de `comms`.
4. **Punto de recogida**: sin base de POI verificados; los nombres vienen de geocodificación inversa **solo si hay proveedor**. Minutos a pie y desvío son estimaciones etiquetadas (`estimated`/`source`).
5. **Recogida a mitad de tramo**: la capacidad se cuenta por tramos completos desde el tramo que contiene el punto (conservador: nunca sobrevende).
6. **Barrido de caducidad y ampliación de series** corren dentro del proceso (temporizador interno, `unref`); en despliegue multi-instancia son idempotentes pero conviene un *scheduler* externo (**No implementado**).
7. **Viaje en curso + solicitudes** (PROMPT §12), cambios de ruta y consenso: módulo `live`.
8. Rutas que se cruzan a sí mismas pueden proyectar mal un punto sobre la polilínea (limitación de `ST_LineLocatePoint`).
9. **Privacidad del origen del conductor**: el servidor redondea a 3 decimales (≈ 110 m) las coordenadas de paradas, origen y destino para quien no participa, pero son las que declara el conductor: si marca su domicilio exacto como origen, ≈ 110 m puede seguir identificando su calle. La app debe pedir un **punto de encuentro público** (el campo `label` del schema ya lo indica) y producto debe decidir si el ORIGEN se redondea a 2 decimales (≈ 1,1 km) para el público. Hoy: **no resuelto en servidor**.
10. **Foto pública del pasajero**: la puerta de publicación la exige al conductor, pero `POST /v1/trips/:id/requests` no la exige al pasajero (las láminas muestran avatares de pasajeros). Decisión de producto pendiente.
11. **Publicación y proveedor de rutas**: `POST /v1/me/routes` calcula las rutas con el proveedor mientras mantiene abierta la transacción de idempotencia (ocupa una conexión del *pool* durante la llamada). Habría que sacar el cálculo de la transacción si el proveedor tarda mucho.
12. **Valoraciones** (`PublicUser.ratingAverage/ratingCount`): se leen de `profiles.rating_sum/rating_count` si existen (migración 030 de `live`) o de un proveedor registrado; no hay cálculo propio.
13. **Variables de entorno propias del módulo** (leídas dentro de `settings.ts`, no en `src/config.ts`; el orquestador decide si las añade a `.env.example`): `TRIPS_SEAT_HOLD_TTL_SECONDS` (900), `TRIPS_SERIES_HORIZON_DAYS` (28), `TRIPS_SWEEP_INTERVAL_SECONDS` (30; 0 = sin barrido), `TRIPS_LIVE_STALE_SECONDS` (60), `TRIPS_RATE_SEARCH_PER_MINUTE` (30), `TRIPS_RATE_MAP_PER_MINUTE` (60), `TRIPS_RATE_PLAN_PER_MINUTE` (20), `TRIPS_IDEMPOTENCY_TTL_HOURS` (24), `PUBLIC_MEDIA_BASE_URL` / `PUBLIC_PHOTO_BASE_URL`.
14. **Manejador de errores del módulo**: el `setErrorHandler` global de `app.ts` convierte los errores de validación (400) y de límite de peticiones (429) en `500`; el módulo registra el suyo en su ámbito encapsulado y responde 400/429 correctamente. Conviene corregir el global (fuera del alcance de este módulo).

## 17. Estado de implementación

Última verificación: **2026-10-09**, contra PostgreSQL 16 + PostGIS local, en dos bases privadas del módulo: `mvc_trips` (migraciones 001–029) y `mvc_trips_full` (orden completo 001–083, con las migraciones de `live`, `money`, `comms` y `trust`).
**Todo se probó con proveedores de rutas y de geocodificación de PRUEBA** (`FakeRouteProvider`, `FakeGeocoder`, deterministas): no se ha llamado a ningún proveedor externo real. Las pruebas con precio siembran una fila `tariff_versions` aprobada **solo en la base de datos de pruebas** y con un valor ficticio; el módulo nunca crea, aprueba ni activa tarifas. La economía **no está activada**: sin tarifa aprobada todo importe es «Por definir».

Etiquetas: **Implementado y probado** (prueba de integración automatizada que pasa) · **Implementado, pendiente de verificar** · **Bloqueado** · **No implementado**.

### 17.1 Estado por área

| Área (n.º del índice §1) | Estado | Evidencia |
|---|---|---|
| Categorías (1) | Implementado y probado | `trips-search` |
| Mapa de inicio (2) | Implementado y probado | `trips-search`: cuadrícula de 0,01°, «Completo» y `onlyWithSeats`, ventana de horas, otras provincias y borradores fuera, posición en directo aproximada y `stale`, 400/404 |
| Búsqueda (3) | Implementado y probado | `trips-search`: conductor `PublicUser`, vehículo sin matrícula completa, plazas libres por tramo, hold activo frente a caducado, tolerancia de la hora de llegada y sugerencias, modo semanal, aislamiento de provincia, 429 `RATE_LIMITED` |
| Detalle del viaje (4) | Implementado y probado | `trips-search`: invitado, conductor y pasajero confirmado (coordenadas y matrícula), 404 de borradores y cancelados, contexto de búsqueda, 401 con sesión inválida |
| Puntos de recogida A/B (5) | Implementado y probado con geocodificador de prueba; nombres de calle reales: pendiente de verificar | `trips-search`: paradas declaradas, «Recoger en ruta», sin propuestas lejos de la ruta, id manipulado revalidado en servidor |
| Presupuesto (6) | Implementado y probado | `trips-search`: sin tarifa aprobada → `pending_definition` (borrador o retirada no cuentan); con tarifa de prueba: km × tarifa con redondeo *half-up*, tramo parcial, tope, comisión sin definir → total «Por definir» |
| Solicitud, estado, retirada y decisión (7–10) | Implementado y probado | `trips-requests`: tramo y capacidad (las pendientes no reservan), idempotencia (también concurrente), hold de 15 min con cuenta atrás, caducidad por lectura y por barrido, última plaza con aceptaciones simultáneas, autorización por recurso, avisos y auditoría |
| Reserva semanal (11–15) | Implementado y probado | `trips-weekly`: vista previa, capacidad por ocurrencia, `allowPartial`, idempotencia, aceptar/rechazar/retirar todo-o-nada, última plaza entre dos reservas semanales y entre una semanal y una puntual, una sola tarjeta en la bandeja |
| Bandeja del conductor (16), requisitos (17), planificador por parada (18), «Guardar ruta» (19) | Implementado y probado con proveedor de rutas de PRUEBA; con el proveedor real: pendiente de verificar | `trips-driver`: bloqueos concretos, veredicto por parada fuera de provincia, `ROUTE_LEAVES_PROVINCE`, desvío de parada opcional, viaje puntual con vuelta, serie con ocurrencias reales por día, ampliación incremental e idempotente, `DRIVER_NOT_READY`, bandeja con ocupación por tramo |
| Mis viajes (20) | Implementado y probado | `trips-overview`: próximos / en curso / historial, avatares solo de confirmados, caducidad al abrir, ETA solo con posición fresca, una tarjeta por reserva semanal y por serie, paginación |
| Favoritos, rutina, suspensión y plaza semanal (21–31) | Implementado y probado | `trips-overview`: CRUD con auditoría, límites 20/40, `FAVORITE_IN_USE`, suspensión idempotente con efecto real sobre solicitudes pendientes, plaza semanal solo para conductores |
| Contrato HTTP | Implementado y probado | `trips-contract`: exactamente 31 operaciones, resumen en español, seguridad, 429 y descripciones de error, parámetros de ruta, `Idempotency-Key` solo en las tres creaciones, índice de este documento = código, y la forma que devuelve cada servicio es la que sale por HTTP (sin y con tarifa de prueba); `trips-contract-sync`: tipos del móvil = tipos del backend |
| Barrido de caducidad y ampliación de series | `runTripsSweep`: Implementado y probado · temporizador interno (`startTripsSweeper`): Implementado, pendiente de verificar (las pruebas lo desactivan con `TRIPS_SWEEP_INTERVAL_SECONDS=0`) · *scheduler* externo: **No implementado** | `trips-requests`, `trips-driver` |
| Chat antes de la reserva («Ver perfil y hablar», pantalla 20) | **Bloqueado**: `chat-service` solo permite conductor ↔ pasajero con reserva confirmada; decisión de `comms` | §16.3 |
| Foto pública obligatoria del pasajero al solicitar | **No implementado** (decisión de producto) | §16.10 |
| Aviso al conductor al suspender una semana de la rutina | **No implementado** (retira las pendientes sin avisar) | `trips-overview` comprueba el efecto, no un aviso |
| Pago, devolución y cancelación de `payment_pending`/`confirmed` | Fuera de este módulo (`money`) | §15 |

### 17.2 Resultados de la última ejecución

| Base | Pruebas | Resultado |
|---|---|---|
| `mvc_trips` (001–029) | siete suites en una sola ejecución: `trips-search` 31 · `trips-requests` 27 · `trips-weekly` 19 · `trips-driver` 21 · `trips-overview` 17 · `trips-contract` 5 · `trips-contract-sync` 1 | 121 de 121 (62 s) |
| `mvc_trips_full` (001–083, 34 migraciones en orden) | las mismas siete suites en una sola ejecución | 121 de 121 (107 s) |
| `mvc_trips` | pruebas del backend heredado que tocan código ampliado (`request-flow`, `trip-search`, `trip-draft`, `profile-vehicle`, `core`, `vehicle-compliance`, `geocoding-routes`, `route-provider`, `trip-execution`) | 45 de 45 |
| sin base de datos | `vehicle`, `maps`, `insurance-expiry`, `auth` (unitarias del código heredado) | 13 de 13 |
| repositorio completo | `npm run typecheck` (`tsc -p tsconfig.json --noEmit`, TypeScript estricto) | sin errores |
| tipos de la app | `tsc --noEmit --strict --exactOptionalPropertyTypes --noUncheckedIndexedAccess` sobre `mobile/src/api/types/index.ts` (reexporta los tipos de todos los módulos: sin nombres duplicados) | sin errores |

### 17.3 Lo que NO está demostrado

1. Ninguna llamada a Google Directions/Geocoding ni a otro proveedor real; la forma de sus respuestas se asume por los adaptadores existentes de `src/maps/*`.
2. Sin pruebas de carga: la búsqueda y el mapa usan los índices GiST/B-tree de las migraciones 007 y 020, pero no se ha medido con un volumen realista.
3. Multi-instancia: la capacidad se protege con bloqueos de fila (viaje → tramos; solicitud → viaje) y con índices únicos (ocurrencias, claves de idempotencia), y el barrido es idempotente, pero solo se ha probado en un proceso.
4. Las migraciones aplican limpias sobre una base vacía en orden completo; no se ha probado una actualización sobre una base con datos reales.
5. Ningún cliente real (iOS, Android ni el visor web de la app) se ha ejecutado contra este módulo en esta verificación.

### 17.4 Cómo reproducirlo

```bash
export DATABASE_URL=postgres://mvc:mvc_local_test@127.0.0.1:5432/mvc_trips      # base privada del módulo
MIGRATIONS_EXCLUDE="030-099" npm run db:migrate                                   # solo 001–029
node --import tsx --test --test-concurrency=1 \
  tests/trips-search.integration.test.ts tests/trips-requests.integration.test.ts \
  tests/trips-weekly.integration.test.ts tests/trips-driver.integration.test.ts \
  tests/trips-overview.integration.test.ts tests/trips-contract.integration.test.ts \
  tests/unit/trips-contract-sync.test.ts
npm run typecheck
# Orden completo: otra base vacía (p. ej. mvc_trips_full) y `npm run db:migrate` sin exclusión; las mismas pruebas.
```

Las pruebas rechazan cualquier base que no sea `mvc_trips` o `mvc_trips_full`. La referencia de rutas registradas es `docs/openapi.json` (`npm run openapi:export`, a cargo del orquestador; esta verificación no la regenera).
