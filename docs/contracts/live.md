# Contrato del módulo `live` — viaje en directo, cambio de ruta, fin de viaje

Propietario: agente `be-live`. Tipos para la app: `mobile/src/api/types/live.ts` (los schemas Fastify de
`src/modules/live/**` producen exactamente esas formas). Pantallas servidas: **21** Esperando el coche, **22** Cambio de ruta,
**23** En el coche, **24** Viaje terminado y la **consola del conductor**.

Datos de ejemplo: Sevilla; Ana (conductora, Seat León blanco, `1234 LBC`), Miguel (pasajero), Laura (copasajera). Hora de
la lámina 07:17 (Europe/Madrid, CEST = UTC+2) → los instantes viajan en UTC: 07:25 = `05:25:00.000Z`, 08:05 = `06:05:00.000Z`,
08:20 = `06:20:00.000Z`.

## 0. Convenciones

- Base `/v1`, `Authorization: Bearer mvc_sess_…` (sesión opaca), salvo `GET /v1/shared-trips/{token}` (público, limitado por tasa).
- Error: `{ "error": { "code": "MAYUSCULAS_SNAKE", "message": "…", "details"?: … }, "requestId": "…" }`. Los códigos son estables.
- Fechas ISO-8601 UTC con milisegundos. Dinero: `Money` (`{cents,currency:"EUR",status}`); **mientras no exista tarifa aprobada el
  backend devuelve `{"cents":null,"currency":"EUR","status":"pending_definition"}` y la UI dice «Por definir»**. El backend nunca emite `illustrative`
  (solo la vista previa).
- `Idempotency-Key: <clave>` (8–80 caracteres `[A-Za-z0-9_.:-]`, p. ej. un UUID; opcional pero recomendado) en `POST /v1/trips/{tripId}/route-changes` y
  `POST /v1/incident-reports`: un reintento con la misma clave devuelve la misma entidad (HTTP 200 en vez de 201). La misma clave para otro viaje →
  `409 IDEMPOTENCY_KEY_REUSED`.
- Validación de entrada: `400 VALIDATION_ERROR` con `details:[{path,message}]` (identificadores que no son UUID, cuerpos incorrectos, `Idempotency-Key` mal
  formada, cursor/`limit` fuera de rango). Exceso de peticiones: `429 RATE_LIMITED`. Todas las respuestas del módulo llevan `Cache-Control: no-store`.
- **Acceso por recurso**: las rutas `/v1/bookings/{bookingId}/…` solo responden al pasajero titular de esa reserva; cualquier otra persona (conductor
  incluido, otro pasajero, desconocido) recibe **404 `BOOKING_NOT_FOUND`** (no se revela si existe). La consola solo responde al conductor propietario
  (`403 TRIP_NOT_OWNED`).
- **Privacidad de ubicación**: posición precisa solo para el conductor y para el pasajero con reserva `confirmed` de un viaje `active`. El mapa
  público existente (`GET /v1/live/map`) sigue siendo aproximado. El enlace compartido es aproximado (~1 km).
  **«Compartir ubicación en viaje» (Ajustes, módulo `comms`)**: si el conductor lo desactiva, los pasajeros reciben su posición con
  `position.precision:"approximate"` (cuadrícula de ~1 km, sin rumbo ni velocidad, `accuracyM:1000`) y la distancia restante en metros (`eta.distanceM`, `remaining.distanceM`) pasa a `null`
  (con la ruta revelaría el punto exacto); la hora y los minutos de llegada no cambian. Ver §3.1.
- **Nunca «en directo» con posición vieja**: `signal` = `live` (≤ `staleAfterSeconds`, 60 s por defecto), `stale` (hay última posición pero es vieja:
  «Sin señal · Última posición: hace 2 min») o `none`. Con señal no viva, `arrival.warning/arrived` son siempre `false` y `eta.approximate = true`.
- **Dinero y cambios de ruta**: el tráfico cambia la ETA, nunca el precio. No existe «recargo por molestias» automático (`surcharge: "none"`).
  El precio solo varía por kilómetros reales por carretera entre recogida y destino del pasajero.

### Configuración (módulo `live`, opcional, valores por defecto entre paréntesis)

| Variable | Significado |
|---|---|
| `LIVE_STALE_AFTER_SECONDS` (60) | Umbral de posición obsoleta |
| `LIVE_ARRIVAL_WARNING_SECONDS` (300) | Aviso «llega en ~5 min» |
| `LIVE_ARRIVED_DISTANCE_M` (100) | Distancia a la que se considera «ha llegado» |
| `LIVE_STOP_DWELL_SECONDS` (60) | Tiempo de parada por recogida/bajada en cada parada intermedia |
| `LIVE_OFF_ROUTE_M` (300) | Desviación de la ruta guardada a partir de la cual la ETA es aproximada |
| `LIVE_MATERIAL_SCHEDULE_DELTA_S` (180) | Retraso mínimo para considerar material un cambio de horario (se usa `max(este valor, flexibilidad del viaje)`) |
| `LIVE_ROUTE_CHANGE_TTL_SECONDS` (300) | Vigencia de una propuesta de cambio de ruta pendiente |
| `LIVE_RATING_WINDOW_DAYS` (14) | Plazo para valorar tras el fin de viaje |
| `PUBLIC_PHOTO_BASE_URL` (sin definir → `photoUrl: null`) | Base pública de fotos aprobadas |
| `PUBLIC_SHARE_BASE_URL` (sin definir → `url: null`) | Base del enlace «Compartir viaje» |

## 1. Índice de endpoints

| Método | Ruta | Auth | Para |
|---|---|---|---|
| GET | `/v1/bookings/{bookingId}/live` | pasajero titular | 21 estado en directo |
| GET | `/v1/bookings/{bookingId}/in-car` | pasajero titular | 23 En el coche |
| GET | `/v1/bookings/{bookingId}/summary` | pasajero titular | 24 Viaje terminado |
| POST | `/v1/trips/{tripId}/route-changes` | conductor propietario | proponer nueva parada |
| GET | `/v1/route-changes/{proposalId}` | conductor o pasajero afectado | 22 detalle |
| POST | `/v1/route-changes/{proposalId}/respond` | pasajero afectado | 22 Aceptar / Rechazar |
| POST | `/v1/route-changes/{proposalId}/cancel` | conductor propietario | retirar propuesta |
| POST | `/v1/trips/{tripId}/ratings` | participante | 24 valorar |
| POST | `/v1/incident-reports` | participante | 24 Reportar incidencia |
| GET | `/v1/me/incident-reports` | sesión | mis incidencias (paginado) |
| GET | `/v1/me/incident-reports/{reportId}` | autor | detalle |
| POST | `/v1/incident-reports/{reportId}/attachments` | autor | intención de subida privada |
| POST | `/v1/incident-reports/{reportId}/attachments/{attachmentId}/complete` | autor | confirmar subida |
| POST | `/v1/bookings/{bookingId}/share` | pasajero titular | 23 Compartir viaje (privado) |
| GET | `/v1/bookings/{bookingId}/share` | pasajero titular | estado del enlace |
| DELETE | `/v1/bookings/{bookingId}/share` | pasajero titular | revocar |
| GET | `/v1/shared-trips/{token}` | público (rate-limit) | vista del enlace |
| GET | `/v1/me/trips/{tripId}/console` | conductor propietario | consola en directo |
| GET | `/v1/me/live-privacy` | sesión | preferencia de privacidad |
| PUT | `/v1/me/live-privacy` | sesión | cambiar preferencia |

Endpoints **existentes** que usan estas pantallas (sin cambios): `POST /v1/bookings/{id}/pickup-code`, `POST /v1/bookings/{id}/pickup-verify`,
`POST /v1/me/trips/{id}/start`, `POST /v1/me/trips/{id}/complete`, `POST|GET /v1/trips/{id}/location`, `GET /v1/live/map?provinceId=`,
`POST|GET /v1/trips/{id}/chat/{peerUserId}/messages` (ver §6).

## 2. Máquinas de estado

**Fase del pasajero (`phase`)** — derivada, no almacenada:
`scheduled` (viaje `published`) → `driver_en_route` (viaje `active`) → `arriving` (≤ 5 min, señal viva) → `at_pickup` (≤ 100 m, señal viva) →
`in_vehicle` (código verificado) → `completed`. `cancelled` desde cualquier punto si la reserva o el viaje se cancelan.

**Cambio de ruta** (`route_change_proposals.status`): `pending → accepted | rejected | expired | cancelled`.
- Se crea `pending` si algún pasajero afectado tiene un cambio **material** (retraso ≥ umbral o variación de precio). Debe aceptar **cada** pasajero que lo requiere.
- Si **nadie** lo requiere (cambio no material) se aplica al crearla: `accepted` + `autoApplied: true`, y se notifica a los afectados.
- Cualquier rechazo → `rejected` (no se aplica nada). Todas las aceptaciones → se aplica en la misma transacción → `accepted` (`all_accepted`).
- Sin respuesta antes de `expiresAt` → `expired` (no se aplica). El conductor puede `cancel` mientras esté `pending`.
- Solo hay **una** propuesta `pending` por viaje. Si cambió la versión de ruta o se perdió capacidad antes de aplicar → `cancelled` (`superseded` / `capacity_lost`).
- Aceptar/rechazar es idempotente (repetir la misma decisión devuelve la propuesta; la contraria → `409 ROUTE_CHANGE_ALREADY_DECIDED`).
- Aplicar = insertar la parada, partir el tramo en dos (capacidad heredada), desplazar los `seq` posteriores y los rangos de solicitudes/reservas,
  nueva geometría/distancia/duración y `route_version + 1`. Todo validado de nuevo dentro de la provincia por el trigger de base de datos.

**Código de recogida** (`pickupCode.status`): `not_generated → active → verified`; `active → locked` al agotar intentos; generar de nuevo vuelve a `active`.

**Enlace compartido**: `active → revoked | expired`. Un solo enlace activo por reserva (crear otro revoca el anterior).

**Incidencia**: `open → in_review → resolved | dismissed` (las transiciones las hace `trust`; el usuario solo crea y consulta).

**Valoración**: una por (viaje, quien valora, valorado), solo con el viaje `completed`, dentro de `LIVE_RATING_WINDOW_DAYS`.

---

## 3. Pasajero en directo

### 3.1 `GET /v1/bookings/{bookingId}/live` — 21 Esperando el coche

Sondeo recomendado cada 5–10 s mientras `phase` ∈ {`driver_en_route`, `arriving`, `at_pickup`}. Errores: `401 AUTH_*`, `404 BOOKING_NOT_FOUND`.

```json
{
  "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88",
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "phase": "driver_en_route",
  "tripStatus": "active",
  "bookingStatus": "confirmed",
  "serverTime": "2026-10-05T05:17:00.000Z",
  "driver": {
    "id": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f",
    "displayName": "Ana García López",
    "firstName": "Ana",
    "photoUrl": "https://cdn.example.test/profiles/ana.jpg",
    "ratingAverage": 4.8,
    "ratingCount": 32
  },
  "vehicle": { "make": "Seat", "model": "León", "color": "Blanco", "plate": "1234 LBC" },
  "pickup": {
    "seq": 0,
    "label": "C. Luis Montoto",
    "location": { "lat": 37.3849, "lng": -5.9738 },
    "plannedAt": "2026-10-05T05:25:00.000Z"
  },
  "dropoff": {
    "seq": 2,
    "label": "Universidad de Sevilla",
    "location": { "lat": 37.3589, "lng": -5.9865 },
    "plannedAt": "2026-10-05T06:20:00.000Z"
  },
  "etaTarget": "pickup",
  "eta": { "at": "2026-10-05T05:25:00.000Z", "minutes": 8, "distanceM": 2400, "source": "live_route", "approximate": false },
  "signal": "live",
  "lastUpdateAt": "2026-10-05T05:16:55.000Z",
  "lastUpdateAgeSeconds": 5,
  "staleAfterSeconds": 60,
  "position": {
    "location": { "lat": 37.3878, "lng": -5.9811 },
    "headingDegrees": 128.5,
    "speedMps": 9.4,
    "accuracyM": 7,
    "recordedAt": "2026-10-05T05:16:55.000Z",
    "receivedAt": "2026-10-05T05:16:56.000Z",
    "ageSeconds": 5,
    "stale": false,
    "precision": "precise"
  },
  "arrival": { "warning": false, "arrived": false, "warningThresholdSeconds": 300 },
  "chat": { "peerUserId": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f", "available": true },
  "pendingRouteChange": null
}
```

Cuando hay una propuesta que me afecta: `"pendingRouteChange": { "proposalId": "2b6f8d10-7c3e-4a95-8e14-d0c9b8a76543", "expiresAt": "2026-10-05T05:22:00.000Z", "awaitingMyDecision": true }`
→ la app abre la pantalla 22.

Sin señal (banner «Sin señal · Última posición: hace 2 min»): `"signal":"stale"`, `"lastUpdateAgeSeconds":120`, `"position":{…,"ageSeconds":120,"stale":true}`,
`"eta":{…,"approximate":true}`, `"arrival":{"warning":false,"arrived":false,…}`. Viaje sin iniciar: `"phase":"scheduled"`, `"position":null`, `"signal":"none"`,
`"eta":{"source":"schedule","approximate":true,…}`.

**Conductor con «Compartir ubicación en viaje» desactivado** (ajuste de `comms`: `user_settings.share_live_location_in_trip`, regla de producto en
`docs/contracts/comms.md` §5). El ajuste es del CONDUCTOR y vale para todos sus pasajeros; se lee en cada petición (activarlo de nuevo devuelve la posición precisa).
La posición llega aproximada y la UI debe dibujar una ZONA (círculo de radio `accuracyM`), no un coche que se mueve ni una trayectoria:

```json
"position": {
  "location": { "lat": 37.39, "lng": -5.98 },
  "headingDegrees": null,
  "speedMps": null,
  "accuracyM": 1000,
  "recordedAt": "2026-10-05T05:16:55.000Z",
  "receivedAt": "2026-10-05T05:16:56.000Z",
  "ageSeconds": 5,
  "stale": false,
  "precision": "approximate"
}
```

`signal`, `lastUpdateAt`, `stale`, `arrival` y `phase` NO cambian, ni la hora y los minutos de `eta` («llega en 4 min», «el coche está en la recogida» se siguen mostrando).
Lo que SÍ cambia: `eta.distanceM` pasa a `null` (también `etaAtDestination.distanceM` y `remaining.distanceM` en §3.2), porque una distancia exacta por la ruta revelaría
el punto exacto que el ajuste protege; la UI debe pintar el ETA solo con `minutes`. Sin fila de ajuste, o sin la tabla de `comms`, vale el valor por defecto: compartir. La consola del
conductor (§7) siempre muestra su propia posición precisa (`precision:"precise"`).

### 3.2 `GET /v1/bookings/{bookingId}/in-car` — 23 En el coche

Sondeo recomendado cada 15–30 s. Errores: `404 BOOKING_NOT_FOUND`. El código en claro **no** viaja aquí: la app lo obtiene al generarlo
(`POST /v1/bookings/{bookingId}/pickup-code` → `{"bookingId","code":"741695","generatedAt"}`, genera uno nuevo e invalida el anterior) y lo conserva en memoria.
Si `pickupCode.status` es `active` pero la app perdió el código, ofrece «Generar código nuevo».

> Desviación con la lámina: la lámina dibuja 4 casillas («7416»); el backend existente emite **6 dígitos** (`codeLength`). La app debe pintar `codeLength` casillas.

```json
{
  "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88",
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "phase": "at_pickup",
  "tripStatus": "active",
  "serverTime": "2026-10-05T05:25:00.000Z",
  "driver": {
    "id": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f",
    "displayName": "Ana García López",
    "firstName": "Ana",
    "photoUrl": "https://cdn.example.test/profiles/ana.jpg",
    "ratingAverage": 4.8,
    "ratingCount": 32
  },
  "vehicle": { "make": "Seat", "model": "León", "color": "Blanco", "plate": "1234 LBC" },
  "pickupCode": {
    "status": "active",
    "codeLength": 6,
    "generatedAt": "2026-10-05T05:23:10.000Z",
    "verifiedAt": null,
    "attemptsRemaining": 5
  },
  "occupancy": {
    "occupied": 2,
    "capacity": 3,
    "members": [
      {
        "role": "driver", "isYou": false,
        "user": { "id": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": "https://cdn.example.test/profiles/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32 }
      },
      {
        "role": "passenger", "isYou": true,
        "user": { "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": "https://cdn.example.test/profiles/miguel.jpg", "ratingAverage": 4.8, "ratingCount": 12 }
      },
      { "role": "passenger", "isYou": false, "user": null }
    ]
  },
  "timeline": [
    { "seq": 0, "label": "C. Luis Montoto", "location": { "lat": 37.3849, "lng": -5.9738 }, "role": "pickup", "eta": "2026-10-05T05:25:00.000Z", "state": "current" },
    { "seq": 1, "label": "C. Kansas City", "location": { "lat": 37.3869, "lng": -5.9664 }, "role": "stop", "eta": "2026-10-05T06:05:00.000Z", "state": "next" },
    { "seq": 2, "label": "Universidad de Sevilla", "location": { "lat": 37.3589, "lng": -5.9865 }, "role": "dropoff", "eta": "2026-10-05T06:20:00.000Z", "state": "next" }
  ],
  "etaAtDestination": { "at": "2026-10-05T06:20:00.000Z", "minutes": 55, "distanceM": 12600, "source": "live_route", "approximate": false },
  "remaining": { "minutes": 55, "distanceM": 12600 },
  "signal": "live",
  "lastUpdateAt": "2026-10-05T05:24:57.000Z",
  "share": { "active": false, "expiresAt": null },
  "chat": { "peerUserId": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f", "available": true },
  "pendingRouteChange": null
}
```

Ya en marcha (08:05, tras verificar el código): `phase:"in_vehicle"`, `pickupCode.status:"verified"` (con `verifiedAt`), primera parada `state:"done"`,
`remaining:{"minutes":15,"distanceM":6800}` («Faltan 15 min · 6,8 km»). `members[].user = null` para copasajeros que no activaron
`showProfileToCoPassengers` (por defecto nadie lo hace).

### 3.3 `GET /v1/bookings/{bookingId}/summary` — 24 Viaje terminado

Errores: `404 BOOKING_NOT_FOUND`. Disponible también con el viaje en curso (`arrived:false`).

```json
{
  "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88",
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "tripStatus": "completed",
  "bookingStatus": "completed",
  "arrived": true,
  "pickup": { "seq": 0, "label": "C. Luis Montoto", "location": { "lat": 37.3849, "lng": -5.9738 }, "at": "2026-10-05T05:25:12.000Z" },
  "dropoff": { "seq": 2, "label": "Universidad de Sevilla", "location": { "lat": 37.3589, "lng": -5.9865 }, "at": "2026-10-05T06:20:00.000Z" },
  "path": [ { "lat": 37.3849, "lng": -5.9738 }, { "lat": 37.3869, "lng": -5.9664 }, { "lat": 37.3589, "lng": -5.9865 } ],
  "duration": { "seconds": 3288, "source": "actual" },
  "distance": { "meters": 12600, "basis": "planned_road_route" },
  "passengers": { "count": 2, "capacity": 3 },
  "driver": {
    "id": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f", "displayName": "Ana García López", "firstName": "Ana",
    "photoUrl": "https://cdn.example.test/profiles/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32
  },
  "vehicle": { "make": "Seat", "model": "León", "color": "Blanco", "plate": "1234 LBC" },
  "payment": { "status": "pending_definition", "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" } },
  "rating": {
    "canRate": true,
    "reason": null,
    "rateeUserId": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f",
    "windowEndsAt": "2026-10-19T06:20:00.000Z",
    "mine": null
  },
  "incidents": { "canReport": true, "mineCount": 0 }
}
```

`duration.source:"actual"` = de la recogida verificada al fin de viaje; `"planned"` si faltan esas marcas. `distance` es la distancia por carretera de
los tramos planificados del pasajero (no una traza GPS). `payment.status:"confirmed"` solo cuando la reserva tiene un pago del proveedor registrado, con
`amount:{"cents":400,"currency":"EUR","status":"defined"}`. `rating.reason` ∈ `trip_not_completed | booking_not_completed | already_rated | window_closed`.

---

## 4. Cambio de ruta (22)

### 4.1 `POST /v1/trips/{tripId}/route-changes` — el conductor propone una nueva parada

Requiere rol `driver`, propietario del viaje (`published` o `active`) y proveedor de rutas configurado (`MAPS_PROVIDER`). Recalcula de forma determinista con rutas
reales por carretera: tramo `parada k → nueva` y `nueva → parada k+1`; comprueba provincia, desvío máximo del viaje (`max_detour_m`), capacidad por tramo
afectado (si se enlaza `requestId`), y calcula por pasajero el impacto de horario y precio (motor de dinero; `pending_definition` sin tarifa).

Petición (cabecera opcional `Idempotency-Key`; `label`, `afterStopSeq` y `requestId` son opcionales):

```json
{
  "stop": { "location": { "lat": 37.3869, "lng": -5.9664 }, "label": "C. Kansas City" },
  "afterStopSeq": 0,
  "requestId": "a4c5d6e7-f8a9-4b0c-9d1e-2f3a4b5c6d7e"
}
```

**Dónde se inserta la parada.** Sin `afterStopSeq`, el servidor proyecta la ubicación sobre la ruta guardada del viaje y la inserta tras la última parada anterior a
ese punto (`newStop.afterStopSeq` devuelve el resultado). Con `afterStopSeq` se usa tal cual (de 0 al número de tramos − 1). Con el viaje activo la nueva parada
no puede quedar detrás del coche. Si se enlaza `requestId` (solicitud pendiente de un pasajero nuevo), ese pasajero subirá en la parada nueva al aplicarse el cambio.

**Qué es «material» para un pasajero.** Le afecta quien baja después del punto de inserción. El cambio es material para él si el retraso de su llegada (o de su
recogida, si sube después del desvío) es ≥ `max(LIVE_MATERIAL_SCHEDULE_DELTA_S, flexibilidad del viaje)` o si su precio varía (kilómetros reales por carretera ×
tarifa de su presupuesto aceptado; nunca por tráfico). Quien no tiene un cambio material solo recibe un aviso informativo y no decide.

Respuesta `201` (`200` si es un reintento idempotente): `LiveRouteChange` con `role:"driver"` (ver 4.2). Errores:
`401/403 AUTH_*`, `403 TRIP_NOT_OWNED`, `404 TRIP_NOT_FOUND`, `400 INVALID_ROUTE_CHANGE_STOP` (coordenadas), `409 IDEMPOTENCY_KEY_REUSED`,
`409 TRIP_ROUTE_DATA_MISSING`, `409 ROUTE_CHANGE_TRIP_NOT_CHANGEABLE`, `409 ROUTE_CHANGE_ALREADY_PENDING`,
`409 DRIVER_POSITION_UNAVAILABLE` (viaje activo sin GPS), `409 ROUTE_CHANGE_ROUTE_STALE` (la ruta cambió mientras se calculaba; reintentar),
`409 NO_CAPACITY_ON_SEGMENT`, `422 ROUTE_CHANGE_STOP_OUTSIDE_PROVINCE`, `422 NO_ROUTE_WITHIN_PROVINCE`, `422 ROUTE_CHANGE_DETOUR_TOO_LARGE`
(`details:{addedDistanceM,maxDetourM}`), `422 ROUTE_CHANGE_STOP_BEHIND_VEHICLE`, `422 ROUTE_CHANGE_INVALID_STOP_INDEX`,
`422 ROUTE_CHANGE_REQUEST_INVALID`, `422 ROUTE_CHANGE_STOP_TOO_CLOSE` (la parada coincide con otra), `503 MAPS_PROVIDER_UNAVAILABLE`.

### 4.2 `GET /v1/route-changes/{proposalId}` — 22 Cambio de ruta

Lo ve el conductor creador y los pasajeros afectados; cualquier otra persona recibe `404 ROUTE_CHANGE_NOT_FOUND`. Una propuesta `pending` cuyo plazo venció se
marca `expired` al leerla. Vista del **pasajero** (pantalla 22):

```json
{
  "id": "2b6f8d10-7c3e-4a95-8e14-d0c9b8a76543",
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "kind": "new_stop",
  "status": "pending",
  "resolution": null,
  "autoApplied": false,
  "role": "passenger",
  "createdAt": "2026-10-05T05:17:00.000Z",
  "expiresAt": "2026-10-05T05:22:00.000Z",
  "resolvedAt": null,
  "driver": {
    "id": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f", "displayName": "Ana García López", "firstName": "Ana",
    "photoUrl": "https://cdn.example.test/profiles/ana.jpg", "ratingAverage": 4.8, "ratingCount": 32
  },
  "newStop": {
    "label": "C. Kansas City",
    "location": { "lat": 37.3869, "lng": -5.9664 },
    "afterStopSeq": 0,
    "plannedArrivalAt": "2026-10-05T06:05:00.000Z",
    "seq": null
  },
  "detour": { "addedDistanceM": 1100, "addedDurationSeconds": 300, "maxDetourM": 3000 },
  "path": {
    "before": [ { "lat": 37.3849, "lng": -5.9738 }, { "lat": 37.3589, "lng": -5.9865 } ],
    "after": [ { "lat": 37.3849, "lng": -5.9738 }, { "lat": 37.3869, "lng": -5.9664 }, { "lat": 37.3589, "lng": -5.9865 } ]
  },
  "stops": {
    "pickup": { "seq": 0, "label": "C. Luis Montoto", "location": { "lat": 37.3849, "lng": -5.9738 } },
    "dropoff": { "seq": 1, "label": "Universidad de Sevilla", "location": { "lat": 37.3589, "lng": -5.9865 } }
  },
  "myImpact": {
    "pickup": { "beforeAt": "2026-10-05T05:25:00.000Z", "afterAt": "2026-10-05T05:25:00.000Z", "deltaSeconds": 0, "material": false },
    "dropoff": { "beforeAt": "2026-10-05T06:15:00.000Z", "afterAt": "2026-10-05T06:20:00.000Z", "deltaSeconds": 300, "material": true },
    "price": {
      "before": { "cents": 400, "currency": "EUR", "status": "defined" },
      "after": { "cents": 400, "currency": "EUR", "status": "defined" },
      "delta": { "cents": 0, "currency": "EUR", "status": "defined" },
      "changed": false,
      "material": false
    },
    "requiresAcceptance": true
  },
  "myDecision": null,
  "counts": { "required": 2, "accepted": 0, "rejected": 0, "pending": 2 },
  "participants": null,
  "driverSignal": { "state": "stale", "lastUpdateAt": "2026-10-05T05:15:00.000Z", "ageSeconds": 120 },
  "surcharge": "none",
  "linkedRequestId": null
}
```

Importes sin tarifa aprobada: `before/after/delta` = `{"cents":null,"currency":"EUR","status":"pending_definition"}` y `changed:false`. En la vista del
**conductor**: `role:"driver"`, `myImpact:null`, `participants:[{ "bookingId", "passenger": PublicUser, "requiresAcceptance":true, "decision":null|"accepted"|"rejected", "deltaSeconds":300, "priceDelta": Money }]`,
`stops:{pickup:null,dropoff:null}`, `linkedRequestId` con la solicitud enlazada. Tras aplicarse: `status:"accepted"`, `resolution:"all_accepted"|"auto_applied"`,
`resolvedAt`, `newStop.seq` con el `seq` definitivo.

Errores: `404 ROUTE_CHANGE_NOT_FOUND`.

### 4.3 `POST /v1/route-changes/{proposalId}/respond` — Aceptar / Rechazar

Solo un pasajero afectado que deba aceptar. Idempotente por decisión. Quien cierra la votación (última aceptación o un rechazo) ve el resultado en la propia
respuesta; el resto de pasajeros y el conductor lo reciben como notificación (4.4).

```json
{ "decision": "accept" }
```

Respuesta `200`: `LiveRouteChange` actualizado (`myDecision:"accepted"`; si fue la última aceptación requerida: `status:"accepted"`, `resolution:"all_accepted"`;
si es un rechazo: `status:"rejected"`, `resolution:"rejected_by_passenger"`). Errores: `404 ROUTE_CHANGE_NOT_FOUND`, `409 ROUTE_CHANGE_NOT_PENDING`,
`409 ROUTE_CHANGE_EXPIRED`, `409 ROUTE_CHANGE_ALREADY_DECIDED`, `409 ROUTE_CHANGE_ACCEPTANCE_NOT_REQUIRED`.

### 4.4 `POST /v1/route-changes/{proposalId}/cancel` — el conductor retira la propuesta

Sin cuerpo. `200` → `LiveRouteChange` con `status:"cancelled"`, `resolution:"cancelled_by_driver"`. Errores: `403 TRIP_NOT_OWNED`, `404 ROUTE_CHANGE_NOT_FOUND`, `409 ROUTE_CHANGE_NOT_PENDING`.

Notificaciones (`notifications`, categoría `trip`, `data:{proposalId,tripId,bookingId?}`):
- `route_change_proposed`: a cada pasajero que debe aceptar (con su variación de horario y, si la hay, de importe).
- `route_change_applied`: a los afectados sin obligación de aceptar (aviso informativo) y a quienes aceptaron y esperaban al resto (salvo quien cerró la votación).
- `route_change_accepted`: al conductor cuando el cambio se aplica (también si fue automático).
- `route_change_rejected`: al conductor cuando un pasajero rechaza.
- `route_change_expired`: al conductor y a todos los pasajeros que debían decidir cuando vence el plazo sin aplicarse.
- `route_change_cancelled`: a los pasajeros que debían decidir (menos quien actuó) si el conductor retira la propuesta, si un rechazo la cierra o si no puede aplicarse
  (`superseded` / `capacity_lost`); al conductor en este último caso.

---

## 5. Fin de viaje

### 5.1 `POST /v1/trips/{tripId}/ratings` — valoración

Solo con el viaje `completed`. El pasajero valora al **conductor**; el conductor valora a cada pasajero con reserva `completed`. Una por (viaje, quien valora, valorado).
El agregado alimenta `PublicUser.ratingAverage/ratingCount` (columnas `profiles.rating_sum/rating_count`).

```json
{ "rateeUserId": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f", "stars": 5, "comment": "Puntual y muy amable." }
```

`201`:

```json
{
  "id": "3e4f5a6b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "raterUserId": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  "rateeUserId": "5f0c1d7e-3a4b-4c8d-9e21-6a7b8c9d0e1f",
  "stars": 5,
  "comment": "Puntual y muy amable.",
  "createdAt": "2026-10-05T06:22:00.000Z"
}
```

Errores: `404 TRIP_NOT_FOUND`, `403 RATING_NOT_PARTICIPANT`, `409 RATING_TRIP_NOT_COMPLETED`, `409 RATING_BOOKING_NOT_COMPLETED` (el pasajero no completó el viaje),
`422 RATING_INVALID_RATEE`, `409 RATING_ALREADY_SUBMITTED`, `409 RATING_WINDOW_CLOSED` (`details:{windowEndsAt}`), `400 RATING_INVALID_STARS` (`stars` entero 1–5),
`400 RATING_COMMENT_TOO_LONG` (`comment` ≤ 500; un comentario en blanco se guarda como `null`).

### 5.2 `POST /v1/incident-reports` — Reportar incidencia

Cabecera opcional `Idempotency-Key`. El autor debe ser participante del viaje (conductor o pasajero con reserva). `201` (`200` si reintento):

```json
{ "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10", "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88", "category": "route_or_schedule", "description": "La parada extra no estaba acordada y llegué 5 minutos tarde." }
```

```json
{
  "id": "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f",
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88",
  "category": "route_or_schedule",
  "description": "La parada extra no estaba acordada y llegué 5 minutos tarde.",
  "status": "open",
  "reporterRole": "passenger",
  "createdAt": "2026-10-05T06:25:00.000Z",
  "updatedAt": "2026-10-05T06:25:00.000Z",
  "attachments": []
}
```

Categorías: `safety, driver_behavior, passenger_behavior, vehicle, route_or_schedule, payment, lost_item, other`. `bookingId` es opcional (un pasajero usa su reserva;
el conductor puede indicar una de su viaje). Errores: `404 TRIP_NOT_FOUND`, `403 INCIDENT_NOT_PARTICIPANT`, `422 INCIDENT_BOOKING_MISMATCH`,
`400 INCIDENT_DESCRIPTION_INVALID` (`description` 10–2000 tras recortar espacios), `409 IDEMPOTENCY_KEY_REUSED`.

### 5.3 `GET /v1/me/incident-reports?cursor=&limit=` y `GET /v1/me/incident-reports/{reportId}`

`Page<LiveIncidentReport>` (`limit` 1–50, por defecto 20; orden más reciente primero; cursor opaco):

```json
{ "items": [ { "id": "8c9d0e1f-2a3b-4c4d-8e5f-6a7b8c9d0e1f", "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10", "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88", "category": "route_or_schedule", "description": "La parada extra no estaba acordada y llegué 5 minutos tarde.", "status": "open", "reporterRole": "passenger", "createdAt": "2026-10-05T06:25:00.000Z", "updatedAt": "2026-10-05T06:25:00.000Z", "attachments": [] } ], "nextCursor": null }
```

Errores: `400 INVALID_CURSOR` (cursor manipulado), detalle `404 INCIDENT_NOT_FOUND` (también para incidencias ajenas).

### 5.4 Adjuntos privados de una incidencia (opcional)

Reutiliza el almacenamiento privado (`PRIVATE_STORAGE_PROVIDER`; sin configurar → `503 PRIVATE_STORAGE_NOT_CONFIGURED`). Máx. 5 por incidencia, imágenes ≤ 10 MiB.

`POST /v1/incident-reports/{reportId}/attachments` → `201`:

```json
{ "contentType": "image/jpeg", "sizeBytes": 482113 }
```
```json
{ "attachmentId": "f0a1b2c3-d4e5-4f60-8a7b-9c0d1e2f3a4b", "uploadUrl": "https://storage.example.test/incidents/…?X-Amz-Signature=…", "headers": { "content-type": "image/jpeg" }, "expiresAt": "2026-10-05T06:35:00.000Z" }
```

La app sube con `PUT uploadUrl` y después `POST /v1/incident-reports/{reportId}/attachments/{attachmentId}/complete` (sin cuerpo) → `200` `LiveIncidentAttachment`
(`status:"uploaded"`). Errores: `404 INCIDENT_NOT_FOUND`, `409 INCIDENT_ATTACHMENT_LIMIT`, `422 INCIDENT_ATTACHMENT_TYPE`, `422 INCIDENT_ATTACHMENT_SIZE`,
`404 INCIDENT_ATTACHMENT_NOT_FOUND`, `410 INCIDENT_ATTACHMENT_EXPIRED`, `422 INCIDENT_ATTACHMENT_MISMATCH` (tamaño/tipo distintos de lo declarado o archivo aún no subido),
`409 INCIDENT_CLOSED` (incidencia resuelta o descartada), `503 PRIVATE_STORAGE_NOT_CONFIGURED`. Los adjuntos pendientes cuya URL caducó dejan de contar para el límite.

---

## 6. Compartir viaje (privado)

### 6.1 `POST /v1/bookings/{bookingId}/share`

Reserva `confirmed` con viaje `published|active`. Crea el enlace y **revoca** el anterior de esa reserva. El token solo se devuelve aquí; el servidor guarda
únicamente su huella. El cuerpo es opcional (sin él: 6 h, sin matrícula); `expiresInMinutes` de 15 a 1440. `201`:

```json
{ "includePlate": false, "expiresInMinutes": 360 }
```
```json
{
  "id": "d7e8f9a0-b1c2-4d3e-9f4a-5b6c7d8e9f0a",
  "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88",
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "includePlate": false,
  "status": "active",
  "createdAt": "2026-10-05T05:25:30.000Z",
  "expiresAt": "2026-10-05T11:25:30.000Z",
  "revokedAt": null,
  "lastViewedAt": null,
  "viewCount": 0,
  "token": "mvc_share_Zk3o1B0wq7bX2m9sJt5vYh8uRn4cLd6pAe1fGi7TzQw",
  "url": "https://mevoycontigo.example/s/mvc_share_Zk3o1B0wq7bX2m9sJt5vYh8uRn4cLd6pAe1fGi7TzQw"
}
```

Errores: `404 BOOKING_NOT_FOUND`, `409 SHARE_NOT_ALLOWED`, `400 SHARE_INVALID_DURATION` (`details:{min,max}`). `url` es `null` si el servidor no tiene `PUBLIC_SHARE_BASE_URL` (la app compone el enlace con su dominio).
**No hay página web que consuma el enlace todavía** (ver Bloqueos).

### 6.2 `GET /v1/bookings/{bookingId}/share` / `DELETE /v1/bookings/{bookingId}/share`

`GET` → `{ "share": LiveShare | null }` (el enlace activo si existe; sin `token`). `DELETE` → `204` (idempotente: sin enlace activo también `204`).

### 6.3 `GET /v1/shared-trips/{token}` — vista pública (sin sesión, limitada a 30 peticiones/min)

Sin teléfono, sin matrícula (salvo `includePlate`), sin posición precisa y sin distancia restante (`eta.distanceM` es siempre `null`: con la ruta revelaría el punto exacto). Con el viaje terminado/cancelado se oculta posición y ETA. Errores: `404 SHARE_NOT_FOUND`,
`410 SHARE_REVOKED`, `410 SHARE_EXPIRED`, `429`.

```json
{
  "phase": "driver_en_route",
  "serverTime": "2026-10-05T05:17:00.000Z",
  "expiresAt": "2026-10-05T11:25:30.000Z",
  "passengerFirstName": "Miguel",
  "driverFirstName": "Ana",
  "vehicle": { "make": "Seat", "model": "León", "color": "Blanco", "plate": null },
  "route": { "originLabel": "C. Luis Montoto", "destinationLabel": "Universidad de Sevilla" },
  "plannedDepartureAt": "2026-10-05T05:25:00.000Z",
  "eta": { "at": "2026-10-05T06:20:00.000Z", "minutes": 63, "distanceM": null, "source": "live_route", "approximate": false },
  "signal": "live",
  "position": { "location": { "lat": 37.39, "lng": -5.98 }, "recordedAt": "2026-10-05T05:16:55.000Z", "ageSeconds": 5, "stale": false, "precision": "approximate" }
}
```

---

## 7. Consola del conductor

### 7.1 `GET /v1/me/trips/{tripId}/console`

Rol `driver`, propietario. Sondeo recomendado cada 10 s con el viaje activo. Errores: `403 AUTH_FORBIDDEN` (sin rol de conductor), `403 TRIP_NOT_OWNED`,
`404 TRIP_NOT_FOUND`, `409 CONSOLE_TRIP_NOT_PUBLISHED` (borrador). Las acciones usan los endpoints
existentes: `start`, `complete`, `pickup-verify` (el conductor teclea el código que le dice el pasajero) y la propuesta de cambio de ruta (4.1).

```json
{
  "tripId": "c3f1a9d2-5b7e-4c1a-9f3d-2a6e8b4c7d10",
  "status": "active",
  "serverTime": "2026-10-05T05:17:00.000Z",
  "departureAt": "2026-10-05T05:10:00.000Z",
  "startedAt": "2026-10-05T05:11:00.000Z",
  "completedAt": null,
  "vehicle": { "make": "Seat", "model": "León", "color": "Blanco", "plate": "1234 LBC" },
  "seats": { "offered": 3, "occupied": 2 },
  "signal": "live",
  "position": {
    "location": { "lat": 37.3878, "lng": -5.9811 }, "headingDegrees": 128.5, "speedMps": 9.4, "accuracyM": 7,
    "recordedAt": "2026-10-05T05:16:55.000Z", "receivedAt": "2026-10-05T05:16:56.000Z", "ageSeconds": 5, "stale": false
  },
  "next": {
    "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88",
    "passenger": { "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": "https://cdn.example.test/profiles/miguel.jpg", "ratingAverage": 4.8, "ratingCount": 12 },
    "pickup": { "seq": 0, "label": "C. Luis Montoto", "location": { "lat": 37.3849, "lng": -5.9738 } },
    "etaToPickup": { "at": "2026-10-05T05:25:00.000Z", "minutes": 8, "distanceM": 2400, "source": "live_route", "approximate": false }
  },
  "passengers": [
    {
      "bookingId": "7d9e2c41-8a3f-4b65-b1d0-5e4a9c3f2b88",
      "passenger": { "id": "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": "https://cdn.example.test/profiles/miguel.jpg", "ratingAverage": 4.8, "ratingCount": 12 },
      "bookingStatus": "confirmed",
      "pickup": { "seq": 0, "label": "C. Luis Montoto", "location": { "lat": 37.3849, "lng": -5.9738 } },
      "dropoff": { "seq": 2, "label": "Universidad de Sevilla", "location": { "lat": 37.3589, "lng": -5.9865 } },
      "pickedUp": false,
      "pickedUpAt": null,
      "code": { "status": "active", "attemptsRemaining": 5 },
      "etaToPickup": { "at": "2026-10-05T05:25:00.000Z", "minutes": 8, "distanceM": 2400, "source": "live_route", "approximate": false },
      "ratedByMe": false
    }
  ],
  "counts": { "total": 2, "verified": 0, "pending": 2 },
  "pendingRouteChange": null,
  "actions": { "canStart": false, "canComplete": true, "canProposeRouteChange": true, "willMarkNoShow": 2 }
}
```

---

## 8. Preferencia de privacidad

`GET /v1/me/live-privacy` → `{ "showProfileToCoPassengers": false, "updatedAt": null }`.
`PUT /v1/me/live-privacy` con `{ "showProfileToCoPassengers": true }` → `200 { "showProfileToCoPassengers": true, "updatedAt": "2026-10-05T05:00:00.000Z" }`.

---

## 9. Endpoints existentes (formas reales hoy)

| Endpoint | Cuerpo / respuesta | Errores clave |
|---|---|---|
| `POST /v1/bookings/{id}/pickup-code` (pasajero) | `200 {bookingId, code:"741695", generatedAt}` | `403 BOOKING_NOT_OWNED`, `409 BOOKING_NOT_PICKUP_ELIGIBLE`, `409 TRIP_NOT_LIVE` |
| `POST /v1/bookings/{id}/pickup-verify` (conductor) | body `{code:"741695"}` → `200 {bookingId, pickedUpAt, alreadyVerified}` | `401 PICKUP_CODE_INVALID` (`details:{attempts,maxAttempts}`), `429 PICKUP_ATTEMPTS_EXCEEDED`, `409 PICKUP_CODE_NOT_GENERATED`, `403 TRIP_NOT_OWNED` |
| `POST /v1/me/trips/{id}/start` | `200 {id, status:"active", started_at}` (fila SQL, snake_case) | `409 TRIP_NOT_STARTABLE`, `403 TRIP_NOT_OWNED`, errores de cumplimiento del vehículo |
| `POST /v1/me/trips/{id}/complete` | `200 {id, status:"completed", completed_at}`; recogidos → `completed`, no recogidos → `no_show` | `409 TRIP_NOT_COMPLETABLE` |
| `POST /v1/trips/{id}/location` | body `LivePostLocationBody` → `{eventRowId, duplicate, acceptedAsCurrent}` | `403 LOCATION_FORBIDDEN`, `409 TRIP_NOT_LIVE`, `422 LOCATION_EVENT_FROM_FUTURE|TOO_OLD` |
| `GET /v1/trips/{id}/location` | `{ location: {…precision, stale, ageSeconds…} \| null }` | `404 TRIP_NOT_FOUND` |
| `GET /v1/live/map?provinceId=` | `{ trips: [{tripId, latitude, longitude, recordedAt, stale, ageSeconds}] }` (aproximado) | — |

## 10. Tablas que comparte este módulo con otros (para `trust` / `money`)

- `incident_reports(id, reporter_user_id, reporter_role, trip_id, booking_id, category, description, status, context jsonb, idempotency_key, created_at, updated_at, resolved_at, resolution_note)`;
  `incident_attachments(id, report_id, owner_user_id, storage_provider, storage_key, content_type, expected_size_bytes, size_bytes, sha256, status, expires_at, created_at, completed_at)`.
  `trust` lee y actualiza `status/resolution_note/resolved_at` (valores de `status`: `open, in_review, resolved, dismissed`).
- `trip_ratings(id, trip_id, booking_id, rater_user_id, ratee_user_id, rater_role, stars, comment, created_at)`; agregados en `profiles.rating_sum` y `profiles.rating_count`
  (media = `round(rating_sum::numeric / rating_count, 1)`; otros módulos deben leer estos agregados, no la tabla).
- `vehicles.color` (texto, nullable, añadido por la migración 030; la 020 de `trips` lo declara igual con `add column if not exists`): lo escriben los formularios de vehículo
  (`POST/PATCH /v1/me/vehicles`, campo `color`).
- `route_change_proposals / route_change_acceptances / route_change_impacts`: estado del consenso (ver §2).
- **Lee de `comms`** (solo lectura): `user_settings.share_live_location_in_trip` (migración 063) para la precisión de la posición del conductor (§3.1). Y se conecta a su
  registro público (`src/modules/comms/public.ts`) para la exportación y la eliminación de cuenta (§12).

## 11. Bloqueos y límites conocidos (honestidad)

- **Proveedor de rutas** (`MAPS_PROVIDER=google` + clave): sin él `POST …/route-changes` responde `503 MAPS_PROVIDER_UNAVAILABLE`. La ETA en directo no usa tráfico real: se proyecta la
  posición sobre la ruta por carretera guardada y se escalan los tramos planificados (`source:"live_route"`); con señal obsoleta o fuera de ruta es `approximate`.
- **Push** («llega en ~5 min», propuesta de cambio de ruta): la notificación in-app se crea; el envío push lo gestiona `comms` (proveedor pendiente). El aviso de llegada se
  calcula al sondear `/live`; disparar push en segundo plano exigiría un hook en la ruta de escritura GPS existente. Si se añade, debe usar `kind` `arrival_*` (aviso opcional
  que `comms` permite silenciar); los avisos de cambio de ruta (`route_change_*`, categoría `trip`) son esenciales y nunca se suprimen.
- **Enlace compartido**: no existe aún una página web que consuma `GET /v1/shared-trips/{token}` ni dominio público configurado.
- **Almacenamiento privado** de adjuntos: desactivado hasta configurar `PRIVATE_STORAGE_PROVIDER=s3`.
- **Código de recogida**: 6 dígitos en el servidor frente a 4 casillas en la lámina; no recuperable tras perder el código (se genera uno nuevo).
- **Pasajero nuevo enlazado a una parada** (`requestId`): al aplicarse el cambio sube en la parada nueva, pero su presupuesto no se recalcula aquí (lo gestiona el flujo normal de
  solicitudes/pagos); los pasajeros ya confirmados sí ven su variación de precio por kilómetros.
- **Pago en «Viaje terminado»**: `payment.status` solo se deriva de la reserva (`amount_cents` + pago registrado); el cobro real y el desglose pertenecen a `money`.
- **Sesión y roles**: `resolveSession` (núcleo) devuelve `roles` como texto de Postgres (`{driver,passenger}`); el módulo lo normaliza al autenticar. Conviene corregirlo en el núcleo
  (`array_agg(ur.role::text)`).
- **Errores de validación**: el manejador de errores global de `app.ts` convierte los errores de validación de Fastify y los 429 del límite de tasa en 500; este módulo los
  devuelve bien (`400 VALIDATION_ERROR`, `429 RATE_LIMITED`) con su propio manejador encapsulado.
- **Caducidad de propuestas**: además de la caducidad perezosa, `expirePendingRouteChanges(pool)` (exportada por el módulo) debe ejecutarse periódicamente (p. ej. cada minuto) para
  avisar aunque nadie abra la app; no hay planificador en este repositorio.
- **Posición aproximada (ajuste del conductor)**: desdibuja las COORDENADAS y oculta la distancia restante en metros. El ETA (hora y minutos) y el aviso «el coche está en la recogida» se calculan con la
  posición real, porque son la función principal de «Esperando el coche»; no se ofrece un modo que los oculte.

## 12. Derechos sobre los datos (RGPD): exportación y eliminación de cuenta

`registerLiveModule` registra en `comms` (`registerExportContributor` y `registerErasureStep`, nombre `"live"`; registrar de nuevo sustituye, no duplica). Si la API pública de `comms` no
se puede cargar, el arranque continúa y se avisa en el registro (`warn`). Código: `src/modules/live/data-rights.ts`.

**Exportación** (`modules.live` del archivo de exportación; `GET/POST /v1/me/data-exports` de `comms`). Solo datos de la propia persona; listas de hasta 1000 filas (`truncated:true` si se supera):

```json
{
  "ratingSummary": { "average": 4.8, "count": 13 },
  "ratingsGiven":    [ { "tripId": "…", "asRole": "passenger", "stars": 5, "comment": "Muy puntual y amable", "createdAt": "…" } ],
  "ratingsReceived": [ { "tripId": "…", "stars": 4, "comment": "Pasajero correcto", "createdAt": "…" } ],
  "incidentReports": [ { "id": "…", "tripId": "…", "bookingId": "…", "asRole": "passenger", "category": "vehicle", "description": "…", "status": "open",
                         "createdAt": "…", "resolvedAt": null,
                         "attachments": [ { "id": "…", "contentType": "image/jpeg", "sizeBytes": 2048, "status": "uploaded", "createdAt": "…" } ] } ],
  "sharedTripLinks": [ { "id": "…", "bookingId": "…", "tripId": "…", "includePlate": false, "createdAt": "…", "expiresAt": "…", "revokedAt": null, "lastViewedAt": null, "viewCount": 0 } ],
  "routeChanges": {
    "proposedByYou": [ { "id": "…", "tripId": "…", "status": "rejected", "resolution": "rejected_by_passenger", "newStopLabel": "Plaza de la Encarnación", "createdAt": "…", "resolvedAt": "…" } ],
    "decisionsByYou": [ { "proposalId": "…", "tripId": "…", "decision": "rejected", "decidedAt": "…" } ]
  },
  "privacy": { "showProfileToCoPassengers": true, "updatedAt": "…" },
  "truncated": false
}
```

No se exporta: quién te valoró (las valoraciones recibidas no identifican a la otra persona), el token ni el hash de los enlaces, las claves de almacenamiento ni el archivo de las fotos
(solo sus metadatos), ni `incident_reports.resolution_note` (nota interna del personal, igual que `user_reports` en `comms`).

**Eliminación de cuenta** (dentro de la transacción de `comms`; si cualquier paso de cualquier módulo falla, TODO se deshace y se reintenta):

| Dato | Tratamiento | Clave del resumen (`erasure_summary`) |
|---|---|---|
| Enlaces de «Compartir viaje (privado)» creados por la persona | se borran (quedan invalidados) | `live.tripSharesDeleted` |
| Preferencia de privacidad en el coche | se borra | `live.privacyPreferencesDeleted` |
| Valoraciones RECIBIDAS | se borran | `live.ratingsReceivedDeleted` |
| Valoraciones DADAS | se conservan sin el texto (sus estrellas ya forman parte de la media de otra persona) | `live.ratingCommentsErased` |
| Agregados `profiles.rating_sum/rating_count` | a 0 | `live.ratingAggregatesReset` |
| Incidencias presentadas y sus fotos | **se conservan** (seguridad de las personas y defensa de reclamaciones; la cuenta queda anonimizada) | — |
| Propuestas y decisiones de cambio de ruta | se conservan con el viaje (el histórico de viajes se conserva sin vincularlo a la persona) | — |

El plazo de conservación de las incidencias está **por definir** (validación jurídica pendiente, igual que el de las denuncias de `comms`: «hasta 3 años desde su cierre» es una propuesta) y no
existe tarea de purga; hasta decidirlo, sus fotos no se borran del almacenamiento privado. `live` no registra bloqueos de eliminación: `comms` ya comprueba viajes y reservas activos.

## 13. Cómo ejecutar las pruebas del módulo

Necesitan PostgreSQL con PostGIS y las migraciones base (001–012), las de `live` (030–033) y las de `comms` (060–064: `user_settings` para «Compartir ubicación en viaje» y el registro de
derechos sobre los datos). También pasan sobre una base con TODAS las migraciones (001–083).

```bash
export DATABASE_URL=postgres://mvc:mvc_local_test@127.0.0.1:5432/mvc_live
MIGRATIONS_EXCLUDE="020-029,040-059,065-099" npm run db:migrate
node --import tsx --test --test-concurrency=1 tests/live-*.integration.test.ts tests/unit/live-*.test.ts
npm run typecheck
```

`tests/unit/live-contract-sync.test.ts` vigila que `src/modules/live/types.ts` sea espejo exacto de `mobile/src/api/types/live.ts`, que las rutas registradas (y su OpenAPI) coincidan
con el índice de §1 y que los códigos de error documentados sean los que el código emite.

