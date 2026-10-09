# Contrato del módulo `comms`

Notificaciones · mensajes (directos y grupos de ruta) · bloqueos y denuncias · centro de ayuda · ajustes · derechos sobre los datos.

- Código: `src/modules/comms/**` · migraciones `060–064` · pruebas `tests/comms-*.integration.test.ts` (base de datos propia `mvc_comms`).
- Tipos para la app (idénticos a los schemas Fastify, y una prueba lo comprueba tipo a tipo en los 39 endpoints): `mobile/src/api/types/comms.ts`.
- **39 endpoints** (lista completa en §15).
- Pantallas que sirve: **25** Mensajes · **26** Chat de reserva · **27** Notificaciones · **34** Ajustes · **35** Centro de ayuda
  (y las pantallas derivadas: Privacidad y datos, Eliminar cuenta, Bloqueados, Denunciar).
- Estado honesto de cada pieza: ver §12 (Implementado / Bloqueado / No implementado).

## 0. Convenciones

| Tema | Regla |
|---|---|
| Base | Todo bajo `/v1/...`. Autenticación `Authorization: Bearer mvc_sess_…` (sesión opaca del módulo `auth`). Todos los endpoints de este módulo exigen sesión de usuario activo; **ninguno** es de personal (el lado admin vive en `trust`). |
| Sesión | Se exige **antes de validar** la petición: sin sesión siempre es `401` (`AUTH_REQUIRED` · `AUTH_INVALID` · `AUTH_INVALID_OR_EXPIRED`), nunca detalles de validación; cuenta suspendida o eliminada → `403 ACCOUNT_NOT_ACTIVE` / `401`. Al completarse la eliminación de una cuenta se revocan todas sus sesiones. |
| Errores | `{ "error": { "code": "MAYUSCULAS_SNAKE", "message": "texto en español para mostrar", "details"?: … }, "requestId": "…" }`. El módulo instala su **propio manejador de errores** (el global de `app.ts` convertiría estos casos en 500): esquema inválido → `400 VALIDATION_ERROR` (`details` = `[{ path, message }]`; Ajv se detiene en el primer fallo); JSON mal formado o con `__proto__`/`constructor` → `400 VALIDATION_ERROR`; tipo de contenido no admitido → `415 UNSUPPORTED_MEDIA_TYPE`; cuerpo > 1 MiB → `413 PAYLOAD_TOO_LARGE`; límite de peticiones → `429 RATE_LIMITED` con `Retry-After` (segundos). Un 500 nunca lleva trazas. |
| Caché | Todas las respuestas llevan `Cache-Control: no-store` (datos privados). |
| Cuerpos vacíos | Un `POST` sin cuerpo pero con `Content-Type: application/json` (lo que envían muchos clientes HTTP) se acepta en las rutas sin cuerpo (`read-all`, `…/read`, `…/cancel`, `…/close`, `POST /v1/me/data-exports`) y se interpreta como «sin cuerpo». En las rutas con cuerpo obligatorio responde `400 VALIDATION_ERROR`. |
| Autorización por recurso | Nadie lee conversaciones, notificaciones, tickets, denuncias ni exportaciones ajenos. Un recurso ajeno responde **404** (`*_NOT_FOUND`), nunca 403, para no revelar su existencia. Los 403 solo aparecen cuando la persona sí es parte pero ya no tiene acceso (reserva cancelada, bloqueo). |
| Paginación | `limit` (1–50, por defecto 20) y `cursor` opaco → `Page<T> = { items, nextCursor }`. Un cursor mal formado → `400 INVALID_CURSOR`. Orden estable y sin duplicados entre páginas. |
| Fechas | ISO-8601 UTC con milisegundos (`2026-10-05T05:25:00.000Z`). La app convierte a Europe/Madrid. |
| Idempotencia | `POST /v1/me/support/tickets`, `POST /v1/me/reports` y `POST /v1/me/data-exports` aceptan cabecera `Idempotency-Key: <uuid>`: repetir la misma clave devuelve el mismo recurso (200) en vez de crear otro. Los mensajes de chat usan `clientMessageId` (uuid) con la misma finalidad. |
| Campos desconocidos | El cuerpo de las peticiones se valida con `additionalProperties: false`; Fastify **descarta** (no rechaza) campos extra. La app debe ignorar también campos nuevos en las respuestas. |
| Límites de frecuencia (HTTP) | Por **ruta y sesión** (hash del token; sin token con forma válida, por IP), para no penalizar a quien comparte IP (NAT del operador móvil, wifi de campus): lecturas 120/min · mensajes de chat, marcar leído, preferencias, ajustes, cerrar consulta y baja de dispositivo 60/min · tokens push, subida de adjuntos y `call-contact` 30/h · consultas y respuestas de ayuda, denuncias, exportación (solicitud y descarga) y eliminación de cuenta 10/h. Superarlo → `429 RATE_LIMITED` + `Retry-After`. Además hay topes de dominio **en la base de datos** (10 consultas abiertas, 10 denuncias/día, 1 exportación/24 h…) con su código propio, que no se esquivan cambiando de sesión. |
| Idioma | Los `message` de error y los textos generados por el servidor (títulos de notificaciones, vista previa de mensajes, plan de eliminación) están en es-ES. |

### Mapa pantalla → endpoints

| Pantalla | Elemento | Endpoint |
|---|---|---|
| 25 Mensajes | lista, búsqueda «Buscar mensajes…», pestañas Todos / Mis reservas / Grupos, insignias rojas | `GET /v1/conversations` |
| 25 Mensajes | estado vacío «Aún no tienes más mensajes» | `GET /v1/conversations` → `items: []` |
| 26 Chat de reserva | cabecera (Ana · Conductora · Hoy · ruta · horas), tarjetas «Tu reserva confirmada», «Punto de recogida», «Aporte del viaje» | `GET /v1/conversations/:id` |
| 26 Chat de reserva | burbujas con ticks, tarjeta de ubicación, enviar, adjuntar → ubicación | `GET/POST /v1/conversations/:id/messages`, `POST …/read` |
| 26 Chat de reserva | «Llamar a Ana» | `GET /v1/conversations/:id/call-contact` |
| 26 Chat de reserva | menú ⋮: denunciar mensaje / bloquear | `POST …/messages/:id/report`, `PUT /v1/me/blocks/:userId` (existente) |
| 27 Notificaciones | filtros Todas / Viajes / Mensajes / Pagos, lista, marcar leído | `GET /v1/notifications`, `POST …/:id/read`, `POST …/read-all`, `GET …/unread-count` |
| 27 Notificaciones | «Avisos esenciales del viaje» / «Avisos opcionales de llegada» | `GET/PATCH /v1/me/notification-preferences` |
| 34 Ajustes | cabecera de perfil, «Mi móvil», «Compartir ubicación en viaje», «Tamaño de letra» | `GET/PATCH /v1/me/settings` |
| 34 Ajustes | Notificaciones | pantalla 27 + preferencias |
| 34 Ajustes | Privacidad y datos | `POST/GET /v1/me/data-exports…`, `GET /v1/me/blocks`, `GET/POST /v1/me/account-deletion…` |
| 34 Ajustes | Eliminar cuenta + explicación | `GET/POST /v1/me/account-deletion`, `POST …/cancel` |
| 34 Ajustes | Cerrar sesión | `POST /v1/auth/logout` (auth) + `DELETE /v1/me/push-tokens/:id` |
| 35 Centro de ayuda | tres categorías, «Selecciona un viaje», «Escribe tu consulta» 0/500, «Adjuntar imágenes», «Enviar consulta» | `GET /v1/me/support/trips`, `POST /v1/me/support/uploads/intents`, `POST …/complete`, `POST /v1/me/support/tickets` |
| 35 Centro de ayuda | historial de consultas y respuestas (derivado) | `GET /v1/me/support/tickets`, `GET …/:id`, `POST …/:id/replies`, `POST …/:id/close` |

---

## 1. Notificaciones (pantalla 27)

La tabla `notifications` (migración 012) la escriben **todos los módulos** con `notify()`; `comms` la lee y gestiona.
Los avisos suprimidos por las preferencias del usuario (ver §1.3) **no se listan ni cuentan** y nunca generan push.

Categorías: `trip` (Viajes) · `message` (Mensajes) · `payment` (Pagos) · `system` (soporte, cuenta, privacidad; solo en «Todas»).

### 1.1 `GET /v1/notifications` — Listar notificaciones
Auth: sesión. Query: `category?` (`trip|message|payment|system`; omitir = Todas) · `unread?` (`true` → solo no leídas) · `limit?` · `cursor?`.
Orden: más recientes primero. Respuesta `200 NotificationPage`.

```json
{
  "items": [
    {
      "id": "5e0f4a1c-2b7d-4c3e-9a10-0d1e2f3a4b01",
      "category": "trip",
      "kind": "pickup_soon",
      "title": "Tu recogida en 5 min",
      "body": "Ana está de camino. Llegará sobre las 07:25 al aparcamiento P1.",
      "data": { "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001", "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7001" },
      "essential": true,
      "read": false,
      "readAt": null,
      "createdAt": "2026-10-05T05:20:00.000Z"
    },
    {
      "id": "5e0f4a1c-2b7d-4c3e-9a10-0d1e2f3a4b02",
      "category": "trip",
      "kind": "eta_changed",
      "title": "Ha cambiado la hora estimada",
      "body": "Nueva hora de recogida: 07:30 (antes 07:25). Ana te ha enviado un mensaje.",
      "data": { "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001", "conversationId": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001" },
      "essential": true,
      "read": false,
      "readAt": null,
      "createdAt": "2026-10-05T05:05:00.000Z"
    },
    {
      "id": "5e0f4a1c-2b7d-4c3e-9a10-0d1e2f3a4b03",
      "category": "trip",
      "kind": "request_accepted",
      "title": "Tu solicitud ha sido aceptada",
      "body": "Ana ha confirmado tu reserva para hoy. ¡Buen viaje!",
      "data": { "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001", "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7001" },
      "essential": true,
      "read": true,
      "readAt": "2026-10-04T16:40:00.000Z",
      "createdAt": "2026-10-04T16:02:00.000Z"
    },
    {
      "id": "5e0f4a1c-2b7d-4c3e-9a10-0d1e2f3a4b04",
      "category": "payment",
      "kind": "payment_completed",
      "title": "Pago del viaje completado",
      "body": "Gracias por viajar con MVC.",
      "data": { "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7001" },
      "essential": true,
      "read": true,
      "readAt": "2026-10-04T16:45:00.000Z",
      "createdAt": "2026-10-04T16:03:00.000Z"
    }
  ],
  "nextCursor": null,
  "unreadCount": 2
}
```
Errores: `400 INVALID_CURSOR`, `400 VALIDATION_ERROR`, `401 AUTH_*`.

### 1.2 `GET /v1/notifications/unread-count` — Contadores
Auth: sesión. `200`:
```json
{ "total": 2, "byCategory": { "trip": 2, "message": 0, "payment": 0, "system": 0 } }
```

### 1.3 `POST /v1/notifications/:notificationId/read` — Marcar una como leída
Auth: sesión. Sin cuerpo. Idempotente. `200 AppNotification` con `read: true`. Errores: `404 NOTIFICATION_NOT_FOUND` (inexistente **o ajena**).

### 1.4 `POST /v1/notifications/read-all` — Marcar todas como leídas
Auth: sesión. Cuerpo opcional `{ "category": "trip" }` (sin cuerpo = todas, aunque el cliente envíe `Content-Type: application/json` vacío). `200 { "updated": 2 }`.

### 1.5 `GET /v1/me/notification-preferences` · `PATCH /v1/me/notification-preferences`
Pantalla 27, bloque «Tipos de notificaciones».

| Campo | Tipo | Reglas |
|---|---|---|
| `essentialTripNotices` | `true` | «Avisos esenciales del viaje» (cambios de hora, recogida, aceptaciones, cancelaciones; además pagos y seguridad). **No se puede desactivar**: `PATCH` con `false` → `422 ESSENTIAL_NOTICES_LOCKED`. Tres capas: validación del servicio, restricción `CHECK` en base de datos y el filtro de entrega, que **nunca** suprime avisos esenciales. La app lo pinta como interruptor activado y bloqueado. |
| `arrivalAlerts` | boolean (por defecto `true`) | «Avisos opcionales de llegada (recomendado)»: avisos de tipo `arrival_*` («Ana está cerca de tu punto»). Desactivado → no se crean para el usuario (se marcan `suppressed`). |
| `messages` | boolean (por defecto `true`) | Avisos de mensajes nuevos del chat. El chat y las insignias de la bandeja **no** se ven afectados. |
| `push` | objeto (solo lectura) | `{ available:false, provider:"disabled", reason:"PROVIDER_DISABLED", registeredDevices }` mientras no haya proveedor push (ver §12). |

`PATCH` body (todos opcionales): `{ "arrivalAlerts": false }` → `200 NotificationPreferences`:
```json
{
  "essentialTripNotices": true,
  "arrivalAlerts": false,
  "messages": true,
  "push": { "available": false, "provider": "disabled", "reason": "PROVIDER_DISABLED", "registeredDevices": 1 },
  "updatedAt": "2026-10-05T05:17:00.000Z"
}
```
`PATCH { "essentialTripNotices": false }` → `422`:
```json
{ "error": { "code": "ESSENTIAL_NOTICES_LOCKED", "message": "Los avisos esenciales del viaje no se pueden desactivar." }, "requestId": "req-7" }
```

### 1.6 Registro de dispositivos push
- `POST /v1/me/push-tokens` — body `PushTokenRegistration` `{ "token": "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]", "platform": "ios", "provider": "expo", "deviceId": "6f9c…", "appVersion": "1.0.0", "locale": "es-ES" }` → `201 PushTokenInfo` (nuevo) o `200` (ya existía: refresca `lastSeenAt`). Un mismo token solo puede pertenecer a **un** usuario: si otra cuenta lo tenía (dispositivo prestado/ cierre de sesión sin baja), pasa a la persona que lo registra. Errores: `422 PUSH_TOKEN_INVALID` (longitud 16–4096 caracteres, formato `ExponentPushToken[...]` si `provider = "expo"`).
- `GET /v1/me/push-tokens` → `Page<PushTokenInfo>` (sin el token en claro).
- `DELETE /v1/me/push-tokens/:tokenId` → `204`. Ajeno/inexistente → `404 PUSH_TOKEN_NOT_FOUND`. La app lo llama al cerrar sesión.

```json
{ "id": "b41c0d2e-7a5f-4e8b-9c3a-1d2e3f4a5b01", "platform": "ios", "provider": "expo", "deviceId": "6f9c2f4e-1a6b-4c8d-9e0f-2b3c4d5e6f70", "appVersion": "1.0.0", "createdAt": "2026-10-05T05:10:00.000Z", "lastSeenAt": "2026-10-05T05:10:00.000Z" }
```

### 1.7 Tipos de aviso («kinds») y quién los emite
`essential` se calcula así: **opcional** (`false`) = `kind` que empieza por `arrival_` **o** categoría `message`; todo lo demás es esencial. Cualquier módulo debe usar `notify()` (`src/lib/notify.ts`); el filtrado por preferencias es automático (disparador en base de datos, §10).

`kind` es una cadena abierta (la app debe tolerar valores que no conozca y mostrar `title`/`body` tal cual). Esto es lo que **se emite hoy** en el árbol (extraído de las llamadas a `notify()`; puede crecer):

| kind | categoría | esencial | emite |
|---|---|---|---|
| `request_received`, `request_withdrawn`, `request_expired`, `request_accepted`, `request_rejected`, `weekly_request_received` | `trip` | sí | trips |
| `booking_confirmed`, `booking_cancelled`, `booking_cancelled_by_driver` | `trip` | sí | money |
| `route_change_proposed`, `route_change_accepted`, `route_change_rejected`, `route_change_applied`, `route_change_cancelled`, `route_change_expired` | `trip` | sí | live |
| `payment_confirmed`, `payment_failed`, `payment_under_review`, `payment_late_refund_pending`, `payout_paid`, `refund_proposal_created`, `refund_approved`, `refund_rejected`, `refund_completed` | `payment` | sí | money |
| `identity_check_completed` y el resto de avisos de revisión de identidad (`kind` = estado o decisión), `profile_photo_approved`, `profile_photo_rejected` | `system` | sí | trust |
| `chat_message` | `message` | no | comms (se agrupan por conversación: un solo aviso no leído por chat, con `data.count`) |
| `support_reply`, `report_update`, `data_export_ready`, `account_deletion_scheduled`, `account_deletion_cancelled`, `account_deletion_blocked`, `account_deletion_completed` | `system` | sí | comms |

**Reservados, sin emisor todavía:** cualquier `arrival_*` (p. ej. `arrival_driver_near`, `arrival_driver_arrived`; categoría `trip`, **opcional**) y los avisos previos a la recogida (`pickup_soon`, `eta_changed`, `pickup_changed`, `trip_cancelled`). Hasta que `live` emita `arrival_*`, el interruptor «Avisos de llegada» se guarda y se aplica (disparador) pero no tiene efecto visible, porque no hay avisos de ese tipo que suprimir.

---

## 2. Mensajes (pantallas 25 y 26)

### 2.1 Modelo
- **Conversación directa** (`kind:"direct"`): una por (viaje, pasajero). Participantes: el conductor del viaje y un pasajero con **reserva confirmada o completada** (`ride_requests.status='confirmed'` y `bookings.status in ('confirmed','completed')`). Es la regla ya vigente del chat 1:1; se aplica en cada lectura y cada envío.
- **Grupo de ruta** (`kind:"group"`): para el conductor y los pasajeros de una **ruta recurrente** (`trips.kind='recurring'`). Una ruta = mismo conductor + provincia + categoría + sentido (`leg`) + origen y destino (redondeados a ~100 m). Título: «Ruta {provincia} · {categoría}» → «Ruta Sevilla · Trabajo».
  - **Pertenencia derivada, nunca almacenada**: el conductor (si hay ≥ 1 pasajero) y cada pasajero con una reserva `confirmed` en un viaje `published|active` de esa ruta. Se calcula en cada petición; cancelar la reserva o un bloqueo conductor↔pasajero **expulsa al instante** (la conversación desaparece de la bandeja y el acceso devuelve 403/404).
  - Bloqueo entre dos pasajeros: siguen en el grupo, pero **no ven los mensajes del otro** (en ambos sentidos).
  - Un pasajero solo ve los mensajes posteriores a su primera reserva en la ruta.
- **Tipos de mensaje**: `text` y `location` (punto de recogida o coordenadas). Imágenes/adjuntos en el chat y notas de voz: **No implementado** (§12).
- **Acuses**: `sent` (guardado) → `delivered` (la app del destinatario consultó la bandeja/mensajes/contadores) → `read` (el destinatario llamó a `…/read` o abrió el chat). En grupos: entregado/leído cuando **todos** los demás miembros actuales lo han recibido/leído; `receipt` trae los contadores.
- Se conserva la compatibilidad con los endpoints antiguos `POST/GET /v1/trips/:tripId/chat/:peerUserId/messages` (misma tabla `trip_direct_messages`); sus mensajes aparecen aquí como `text`.

### 2.2 `GET /v1/conversations` — Bandeja (pantalla 25)
Auth: sesión. Query: `filter?` = `all` (por defecto) | `bookings` (chats directos de reserva) | `groups`; `q?` (2–60 caracteres; busca por nombre de la persona, título del grupo y texto de los mensajes visibles); `limit?` (1–50, 20); `cursor?`.
Orden: `lastActivityAt` descendente. Solo aparecen conversaciones **accesibles ahora** (reserva vigente, sin bloqueo). Una reserva recién confirmada ya aparece (sin mensajes) — «Cuando reserves… aparecerán aquí».
Respuesta `200 ConversationPage`:

```json
{
  "items": [
    {
      "id": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
      "kind": "direct",
      "title": "Ana",
      "subtitle": "Ruta al trabajo · Sevilla",
      "peer": { "id": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
      "memberCount": null,
      "myRole": "passenger",
      "category": "work",
      "provinceName": "Sevilla",
      "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001",
      "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7001",
      "lastMessage": { "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e001", "kind": "text", "preview": "Perfecto, nos vemos en el aparcamiento.", "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001", "mine": false, "createdAt": "2026-10-05T05:12:00.000Z" },
      "unreadCount": 2,
      "lastActivityAt": "2026-10-05T05:12:00.000Z"
    },
    {
      "id": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f002",
      "kind": "group",
      "title": "Ruta Sevilla · Trabajo",
      "subtitle": null,
      "peer": null,
      "memberCount": 4,
      "myRole": "passenger",
      "category": "work",
      "provinceName": "Sevilla",
      "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001",
      "bookingId": null,
      "lastMessage": { "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e002", "kind": "text", "preview": "Ana: Salgo en 5 min. Nos vemos en P1.", "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001", "mine": false, "createdAt": "2026-10-05T04:58:00.000Z" },
      "unreadCount": 3,
      "lastActivityAt": "2026-10-05T04:58:00.000Z"
    },
    {
      "id": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f003",
      "kind": "direct",
      "title": "Miguel",
      "subtitle": "Universidad · Sevilla",
      "peer": { "id": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1002", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
      "memberCount": null,
      "myRole": "driver",
      "category": "university",
      "provinceName": "Sevilla",
      "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2002",
      "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7002",
      "lastMessage": { "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e003", "kind": "text", "preview": "Genial, gracias por la info.", "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1002", "mine": false, "createdAt": "2026-10-04T16:30:00.000Z" },
      "unreadCount": 0,
      "lastActivityAt": "2026-10-04T16:30:00.000Z"
    }
  ],
  "nextCursor": null,
  "unreadTotal": 5
}
```
Sin conversaciones → `{ "items": [], "nextCursor": null, "unreadTotal": 0 }` (la app muestra «Aún no tienes más mensajes»).

### 2.3 `GET /v1/conversations/unread-count`
`200 { "total": 5, "direct": 2, "groups": 3, "conversationsWithUnread": 2 }`. Es el endpoint que la app **sondea** para la insignia de «Mensajes», por eso es ligero: calcula solo no leídos y último `seq` por conversación (no arma vistas previas ni perfiles) y respeta los mismos permisos que la bandeja (reserva vigente, sin bloqueo, mensajes retirados fuera). Consultarlo marca como **entregados** los mensajes recibidos.

### 2.4 `POST /v1/conversations/direct` — Abrir (o recuperar) el chat de una reserva
Body `{ "tripId": "…", "peerUserId": "…" }`. Para botones «Escribir a Ana» fuera de la bandeja. Idempotente: `201` si se crea, `200` si ya existía. Respuesta `ConversationDetail`.
Errores: `400 CHAT_SELF_FORBIDDEN` · `404 TRIP_NOT_FOUND` · `403 CHAT_FORBIDDEN` (no hay reserva confirmada entre ambos) · `403 CHAT_BLOCKED`.

### 2.5 `GET /v1/conversations/:conversationId` — Cabecera del chat (pantalla 26)
Respuesta `200 ConversationDetail` (para directos, desde el punto de vista de quien consulta):

```json
{
  "id": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
  "kind": "direct",
  "title": "Ana",
  "subtitle": "Ruta al trabajo · Sevilla",
  "peer": { "id": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
  "memberCount": null,
  "myRole": "passenger",
  "category": "work",
  "provinceName": "Sevilla",
  "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001",
  "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7001",
  "lastMessage": { "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e005", "kind": "text", "preview": "Perfecto, nos vemos allí.", "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001", "mine": false, "createdAt": "2026-10-05T05:21:00.000Z" },
  "unreadCount": 0,
  "lastActivityAt": "2026-10-05T05:21:00.000Z",
  "trip": {
    "id": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001",
    "status": "published",
    "departureAt": "2026-10-05T05:25:00.000Z",
    "arrivalEstimateAt": "2026-10-05T05:45:00.000Z",
    "originLabel": "Sevilla Centro",
    "destinationLabel": "Isla Mágica"
  },
  "booking": { "id": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7001", "status": "confirmed", "seats": 1 },
  "pickupPoint": { "label": "Aparcamiento P1 · Isla Mágica", "lat": 37.4167, "lng": -6.0027 },
  "contribution": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "routeLabel": null,
  "members": null
}
```
- `contribution` = «Aporte del viaje (por definir)»: `status:"defined"` solo si existe una cotización (`quote_snapshots`) ligada a una tarifa **aprobada**; si no, `pending_definition` (la app muestra «Por definir»). La vista previa puede devolver `illustrative` («Propuesta: 4,00 €»).
- `pickupPoint` sale de la parada de la solicitud (`trip_stops` vía `trip_segments`).
- En grupos: `trip`, `booking`, `pickupPoint`, `contribution` = `null`; `routeLabel` = «Sevilla Centro → Isla Mágica»; `members` = `[{ user: PublicUser, role }]`.

Errores: `404 CONVERSATION_NOT_FOUND` (inexistente o ajena) · `403 CHAT_FORBIDDEN` (eras parte pero la reserva ya no está vigente / saliste del grupo) · `403 CHAT_BLOCKED`.

### 2.6 `GET /v1/conversations/:conversationId/messages` — Mensajes
Query: `limit?` (1–100, 30) · `cursor?` (hacia atrás: mensajes más antiguos) · `afterSeq?` (entero ≥ 0; devuelve los posteriores a ese `seq`, para sondeo). `cursor` y `afterSeq` son excluyentes.
Respuesta `200 ChatMessagePage`: `items` en orden **cronológico ascendente**; con `cursor`, `nextCursor` apunta a lo más antiguo (null = no hay más). Marca como **entregados** los mensajes recibidos.

```json
{
  "items": [
    {
      "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e101", "seq": 101, "conversationId": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
      "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001", "senderName": "Ana García López", "mine": false,
      "kind": "text", "body": "Hola Miguel, salgo en 5 min. Nos vemos en el aparcamiento P1 de Isla Mágica, junto a la entrada principal.",
      "location": null, "hidden": false, "receipt": null, "createdAt": "2026-10-05T05:18:00.000Z"
    },
    {
      "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e102", "seq": 102, "conversationId": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
      "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1002", "senderName": "Miguel Torres", "mine": true,
      "kind": "text", "body": "Genial, ahí estaré. Te adjunto mi ubicación exacta.",
      "location": null, "hidden": false,
      "receipt": { "state": "read", "recipientCount": 1, "deliveredCount": 1, "readCount": 1 },
      "createdAt": "2026-10-05T05:20:00.000Z"
    },
    {
      "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e103", "seq": 103, "conversationId": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
      "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1002", "senderName": "Miguel Torres", "mine": true,
      "kind": "location", "body": "Aparcamiento P1 · Isla Mágica",
      "location": { "lat": 37.4167, "lng": -6.0027, "label": "Aparcamiento P1 · Isla Mágica" },
      "hidden": false,
      "receipt": { "state": "delivered", "recipientCount": 1, "deliveredCount": 1, "readCount": 0 },
      "createdAt": "2026-10-05T05:20:30.000Z"
    },
    {
      "id": "e1d2c3b4-a596-4877-8695-a4b3c2d1e104", "seq": 104, "conversationId": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
      "senderId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001", "senderName": "Ana García López", "mine": false,
      "kind": "text", "body": "Perfecto, nos vemos allí.",
      "location": null, "hidden": false, "receipt": null, "createdAt": "2026-10-05T05:21:00.000Z"
    }
  ],
  "nextCursor": null,
  "lastReadSeq": 104
}
```
Mensajes retirados por moderación: `hidden: true`, `body: null`, `location: null`. Errores: como §2.5 + `400 INVALID_CURSOR`.

### 2.7 `POST /v1/conversations/:conversationId/messages` — Enviar
Body `SendChatMessageRequest`:
- texto: `{ "clientMessageId": "6b0c…", "kind": "text", "body": "Estoy en el punto de recogida" }` (1–2000 caracteres tras recortar).
- ubicación: `{ "clientMessageId": "…", "kind": "location", "location": { "lat": 37.4167, "lng": -6.0027, "label": "Aparcamiento P1 · Isla Mágica" } }` (`lat` −90…90, `lng` −180…180, `label` ≤ 200; `body` opcional, por defecto la etiqueta o «Ubicación compartida»).

Respuesta `201 ChatMessage` (mensaje nuevo) o `200` (mismo `clientMessageId` y mismo contenido: reintento idempotente). Genera aviso `chat_message` al destinatario (si no lo ha desactivado).
Errores: `422 INVALID_CHAT_MESSAGE` · `422 INVALID_LOCATION` · `409 CHAT_IDEMPOTENCY_CONFLICT` (mismo `clientMessageId` con otro contenido) · `404 CONVERSATION_NOT_FOUND` · `403 CHAT_FORBIDDEN` · `403 CHAT_BLOCKED`.

### 2.8 `POST /v1/conversations/:conversationId/read` — Marcar leído
Body opcional `{ "upToSeq": 104 }` (por defecto, todo). `200 { "conversationId": "…", "lastReadSeq": 104, "unreadCount": 0 }`. El puntero nunca retrocede.

### 2.9 `GET /v1/conversations/:conversationId/call-contact` — «Llamar a Ana»
Solo conversaciones directas. El teléfono **solo** se entrega a la otra parte de una reserva confirmada, sin bloqueo, y dentro de la ventana del viaje (12 h antes de la salida hasta 3 h después de la llegada estimada o de completarse el viaje; configurable). Cada entrega queda auditada (`chat.peer_call.contact_revealed`).
```json
{ "available": true, "reason": null, "peerFirstName": "Ana", "phoneE164": "+34600111222", "availableFrom": "2026-10-04T17:25:00.000Z", "availableUntil": "2026-10-05T08:45:00.000Z" }
```
Fuera de ventana: `{ "available": false, "reason": "OUTSIDE_TRIP_WINDOW", "peerFirstName": "Ana", "phoneE164": null, "availableFrom": "…", "availableUntil": "…" }`. Desactivado por configuración: `reason: "PEER_CALL_DISABLED"`. Grupos → `400 CALL_NOT_SUPPORTED_FOR_GROUPS`.
> Decisión de privacidad pendiente de validación jurídica (§12): mientras no se apruebe, el servidor puede arrancar con `COMMS_PEER_CALL_ENABLED=false` y la app mostrará el botón desactivado.

### 2.10 `POST /v1/conversations/:conversationId/messages/:messageId/report` — Denunciar un mensaje
Body `ReportMessageRequest` `{ "reason": "harassment", "details": "Insiste después de pedirle que pare." }`. Crea una denuncia contra el autor del mensaje con ese mensaje como prueba (copia literal). `201 UserReport`. No se puede denunciar un mensaje propio (`400 REPORT_SELF_FORBIDDEN`). Errores: `404 MESSAGE_NOT_FOUND` (inexistente, ajeno o no visible), `409 REPORT_ALREADY_FILED`, `429 REPORT_RATE_LIMITED`.

---

## 3. Bloqueos y denuncias

### 3.1 Bloqueos
- `PUT /v1/me/blocks/:userId` y `DELETE /v1/me/blocks/:userId` → `204` (**existentes**, `src/routes/chat-routes.ts`; sin cambios).
- **Nuevo** `GET /v1/me/blocks` → `Page<BlockedUser>` (más recientes primero; `limit` 1–50, `cursor`).
```json
{ "items": [ { "user": { "id": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1004", "displayName": "Carlos Ibáñez", "firstName": "Carlos", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 }, "blockedAt": "2026-10-03T18:22:00.000Z" } ], "nextCursor": null }
```
Efectos del bloqueo (cualquiera de los dos sentidos): se corta el chat directo (403 `CHAT_BLOCKED`, desaparece de la bandeja), el conductor pierde/expulsa a su pasajero del grupo y viceversa; entre pasajeros se ocultan los mensajes mutuamente.

### 3.2 `POST /v1/me/reports` — Denunciar a una persona
Cabecera opcional `Idempotency-Key`. Body `CreateUserReportRequest`:
```json
{
  "reportedUserId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1004",
  "reason": "harassment",
  "details": "Me escribe de forma insistente tras cancelar la reserva.",
  "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001",
  "conversationId": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
  "evidenceMessageIds": ["e1d2c3b4-a596-4877-8695-a4b3c2d1e101"]
}
```
Respuesta `201 UserReport`:
```json
{
  "id": "d7e8f9a0-b1c2-4d3e-8f4a-5b6c7d8e9f01",
  "reportedUser": { "id": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1004", "displayName": "Carlos Ibáñez", "firstName": "Carlos", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
  "reason": "harassment", "details": "Me escribe de forma insistente tras cancelar la reserva.",
  "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2001", "conversationId": "c0a1b2c3-d4e5-4f60-8a71-b2c3d4e5f001",
  "evidenceCount": 1, "status": "open",
  "createdAt": "2026-10-05T05:30:00.000Z", "updatedAt": "2026-10-05T05:30:00.000Z", "resolvedAt": null
}
```
Reglas: solo se denuncia a quien se ha compartido una reserva (conductor↔pasajero o copasajeros de un mismo viaje) o una conversación (`403 REPORT_NOT_RELATED`); `tripId` y `conversationId` deben implicar a ambas personas; hasta 10 mensajes de prueba, todos de esa conversación y visibles para quien denuncia (`422 REPORT_EVIDENCE_INVALID`); no a uno mismo (`400 REPORT_SELF_FORBIDDEN`); misma persona + mismo motivo en 24 h → `409 REPORT_ALREADY_FILED`; máx. 10 denuncias/día → `429 REPORT_RATE_LIMITED`. `details` ≤ 1000. Cada denuncia queda auditada y **no** revela al denunciado quién la presentó.
- `GET /v1/me/reports` → `Page<UserReport>` (solo las propias, recientes primero). El estado (`open|in_review|actioned|dismissed`) lo mueve el personal desde `trust`; al cambiar a `actioned` o `dismissed` se avisa al denunciante con `report_update` («Hemos revisado tu denuncia») sin revelar el resultado.

---

## 4. Centro de ayuda (pantalla 35)

### 4.1 `GET /v1/me/support/trips` — Selector «Selecciona un viaje (opcional)»
Auth: sesión. Query `limit?` (1–50, por defecto 20). `200 Page<SupportTripOption>`: viajes en los que participó el usuario (como conductor o con reserva), de salida más reciente a más antigua; sin borradores. La app formatea «Vie, 16 may · Sevilla → Camas».
```json
{ "items": [ { "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2003", "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7003", "role": "passenger", "departureAt": "2026-05-16T05:30:00.000Z", "originLabel": "Sevilla", "destinationLabel": "Camas", "status": "completed" } ], "nextCursor": null }
```

### 4.2 Adjuntos (imágenes) — mismas garantías que los documentos privados
Almacenamiento privado, subida con URL firmada, comprobación de tamaño/tipo al completar y descarga con URL firmada de 5 min solo para el propietario. **Requiere `PRIVATE_STORAGE_PROVIDER=s3`**; con el proveedor desactivado ambos endpoints responden `503 PRIVATE_STORAGE_NOT_CONFIGURED` y los tickets se pueden enviar igualmente sin imágenes (la app debe ocultar «Subir imagen» o mostrar el aviso).
- `POST /v1/me/support/uploads/intents` — body `{ "contentType": "image/jpeg", "sizeBytes": 482113 }` (jpeg/png/webp/heic/heif, 1 B – 10 MiB) → `201 SupportUploadIntent` `{ intentId, uploadUrl, headers, expiresAt }`. La app hace `PUT uploadUrl` con esas cabeceras.
- `POST /v1/me/support/uploads/:intentId/complete` → `201 SupportAttachment` `{ id, contentType, sizeBytes, createdAt }` (repetir devuelve el mismo, 200). Errores: `404 UPLOAD_INTENT_NOT_FOUND`, `410 UPLOAD_INTENT_EXPIRED`, `409 UPLOAD_OBJECT_MISSING` (el archivo todavía no está en el almacenamiento: repetir la subida), `409 UPLOAD_STORAGE_MISMATCH` (el almacenamiento cambió desde que se preparó la subida), `422 UPLOADED_FILE_SIZE_MISMATCH`, `422 UPLOADED_FILE_TYPE_MISMATCH` (también si el contenido no es una imagen), `503 PRIVATE_STORAGE_NOT_CONFIGURED`. Las subidas abandonadas (24 h) y los adjuntos sin vincular (7 días) los limpia el trabajo periódico.
- `GET /v1/me/support/attachments/:attachmentId/download` → `200 { "url": "https://…", "expiresAt": "…" }` (solo el propietario del ticket; ajeno → `404 SUPPORT_ATTACHMENT_NOT_FOUND`).
- Máximo **4** adjuntos por consulta o respuesta (`422 SUPPORT_ATTACHMENT_LIMIT`).

### 4.3 `POST /v1/me/support/tickets` — «Enviar consulta»
Cabecera opcional `Idempotency-Key`. Body `CreateSupportTicketRequest`:
```json
{
  "category": "trip_issue",
  "body": "El conductor canceló el viaje del viernes sin avisar y no he recibido el reembolso.",
  "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2003",
  "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7003",
  "attachmentIds": ["a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c01"]
}
```
`body` 1–500 caracteres (tras recortar). `tripId`/`bookingId` opcionales: el usuario debe haber participado en ellos (`403 SUPPORT_LINK_FORBIDDEN`); si se da `bookingId` sin `tripId`, se deduce. Los `attachmentIds` deben ser del usuario, estar completados y sin vincular (`422 SUPPORT_ATTACHMENT_INVALID`).
`201 SupportTicketDetail`:
```json
{
  "id": "f1e2d3c4-b5a6-4978-8a9b-0c1d2e3f4a01",
  "reference": "MVC-2026-000123",
  "category": "trip_issue",
  "status": "open",
  "bodyPreview": "El conductor canceló el viaje del viernes sin avisar y no he recibido el reembolso.",
  "tripId": "7d2e5b3a-0c1f-4b7e-9d21-5a3c9e8f2003",
  "bookingId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7003",
  "attachmentCount": 1,
  "hasStaffReply": false,
  "lastActivityAt": "2026-10-05T05:35:00.000Z",
  "createdAt": "2026-10-05T05:35:00.000Z",
  "body": "El conductor canceló el viaje del viernes sin avisar y no he recibido el reembolso.",
  "messages": [
    {
      "id": "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c01", "authorType": "user", "authorName": "Miguel Torres",
      "body": "El conductor canceló el viaje del viernes sin avisar y no he recibido el reembolso.",
      "attachments": [ { "id": "a9b8c7d6-e5f4-4a3b-9c2d-1e0f9a8b7c01", "contentType": "image/jpeg", "sizeBytes": 482113, "createdAt": "2026-10-05T05:34:00.000Z" } ],
      "createdAt": "2026-10-05T05:35:00.000Z"
    }
  ],
  "closedAt": null
}
```
Topes: máx. 10 consultas abiertas por usuario y 5 por día → `429 SUPPORT_TICKET_LIMIT`. Repetir la misma `Idempotency-Key` → `200` con el mismo ticket (si el contenido difiere → `409 SUPPORT_IDEMPOTENCY_CONFLICT`).

### 4.4 Hilo de la consulta
- `GET /v1/me/support/tickets?status=&limit=&cursor=` → `Page<SupportTicketSummary>` (`status` = `open|answered|closed`; recientes primero por `lastActivityAt`).
- `GET /v1/me/support/tickets/:ticketId` → `SupportTicketDetail` (ajeno/inexistente → `404 SUPPORT_TICKET_NOT_FOUND`). Respuesta del equipo = mensaje con `authorType:"staff"`, `authorName:"Equipo MVC"`.
- `POST /v1/me/support/tickets/:ticketId/replies` — body `{ "body": "…", "attachmentIds"?: […] }` (1–1000). `201 SupportTicketDetail`. Si estaba `answered` vuelve a `open`. Cerrada → `409 SUPPORT_TICKET_CLOSED`.
- `POST /v1/me/support/tickets/:ticketId/close` → `200 SupportTicketDetail` con `status:"closed"` (idempotente).

Máquina de estados: `open` → (respuesta del personal) `answered` → (respuesta del usuario) `open` …; `open|answered` → `closed` (usuario o personal). `closed` es final para el usuario.
Texto fijo de la pantalla «Si es urgente… contacta directamente con la otra persona desde el chat del viaje»: lo pinta la app (no depende del servidor).

---

## 5. Ajustes (pantalla 34)

### 5.1 `GET /v1/me/settings`
`200 UserSettings` (valores por defecto si el usuario nunca guardó nada):
```json
{
  "shareLiveLocationInTrip": true,
  "fontScale": "normal",
  "language": "es",
  "updatedAt": null,
  "account": {
    "userId": "3f6b1c1e-9a4a-4f0e-8c59-6f1d2a7b1001",
    "displayName": "Ana García",
    "photoUrl": null,
    "roles": ["driver", "passenger"],
    "phoneE164": "+34600123456",
    "pendingDeletion": null
  }
}
```
### 5.2 `PATCH /v1/me/settings`
Body parcial `{ "fontScale": "large" }`, `{ "shareLiveLocationInTrip": false }`, `{ "language": "es" }`. `200 UserSettings`. Valores fuera del enum → `400 VALIDATION_ERROR`.

**Semántica de `shareLiveLocationInTrip`** (regla de producto: ubicación precisa solo durante el trayecto activo): el módulo `live` debe leerla antes de mostrar la posición precisa de **ese usuario** a otros participantes:
```sql
select coalesce((select share_live_location_in_trip from user_settings where user_id = $1), true);
```
(o `getShareLiveLocationInTrip(db, userId)` de `src/modules/comms/public.ts`). Si es `false` → solo posición aproximada para los demás.

---

## 6. Derechos sobre los datos (RGPD)

### 6.1 Exportación de datos
- `POST /v1/me/data-exports` — `202 DataExportRequest` al crearla (también cuando queda `blocked_storage_disabled`); cabecera opcional `Idempotency-Key`. Si ya hay una `queued|processing` se devuelve esa con `200`. Máx. 1 exportación **completada o en curso** cada 24 h → `429 EXPORT_RATE_LIMITED`; una fallida o bloqueada no cuenta.
  - Con almacenamiento privado activo: el trabajo genera un JSON con **solo los datos del propio usuario**, lo sube a almacenamiento privado (URL firmada, `PUT`) y queda `ready` con caducidad de 7 días (`COMMS_EXPORT_TTL_HOURS`; al caducar el trabajo borra el archivo). Un fallo de subida se reintenta hasta 3 veces y termina en `failed` (se puede pedir otra); un trabajo `processing` abandonado más de 15 min vuelve a la cola.
  - **Sin almacenamiento privado** (`PRIVATE_STORAGE_PROVIDER=disabled`): estado `blocked_storage_disabled` con `errorCode:"PRIVATE_STORAGE_NOT_CONFIGURED"`; no se genera ni se entrega nada. Nada se simula.
- `GET /v1/me/data-exports` → `Page<DataExportRequest>`; `GET /v1/me/data-exports/:exportId` → `DataExportRequest`.
- `GET /v1/me/data-exports/:exportId/download` → `200 DataExportDownload` (`{ url, expiresAt }`, enlace firmado de 5 min; auditado). `409 EXPORT_NOT_READY` · `410 EXPORT_EXPIRED` · `404 EXPORT_NOT_FOUND`.
```json
{ "id": "ab12cd34-ef56-4a78-9b90-c1d2e3f4a501", "status": "ready", "format": "json", "requestedAt": "2026-10-05T05:40:00.000Z", "completedAt": "2026-10-05T05:40:04.000Z", "expiresAt": "2026-10-12T05:40:04.000Z", "sizeBytes": 18432, "downloadable": true, "errorCode": null }
```
Contenido del archivo (`schemaVersion: 1`): `subject` (id, teléfono propio, estado, alta, roles), `profile`, `settings`, `notificationPreferences`, `vehicles` (propios, sin claves de almacenamiento), `documents` (solo metadatos), `tripsAsDriver`, `ridesAsPassenger` (solicitudes + reservas), `driverLocationEvents` (posiciones propias como conductor, máx. 20 000, `truncated`), `conversations` + `messages` (enviados **y** recibidos en conversaciones propias; de la otra persona solo su nombre público), `notifications`, `blocks`, `reportsFiled`, `supportTickets` (hilo y metadatos de adjuntos), `pushDevices` (sin token), `dataExports`, `accountDeletionRequests`, `modules.<nombre>` con la sección que aporta cada módulo que se haya registrado (hoy `trust` y `live`, §11) y `notIncluded` con las secciones de los módulos que aún no se han integrado (hoy `money`: pagos, reembolsos, recibos y liquidaciones; y `trips`: lugares favoritos, rutina y reservas semanales), con el motivo. No incluye datos de terceros (teléfonos, notificaciones o tickets ajenos).

### 6.2 Eliminación de cuenta
Flujo: **comprobar bloqueos → solicitar con confirmación → periodo de gracia (14 días, `COMMS_ACCOUNT_DELETION_GRACE_DAYS`) → ejecución automática → anonimización**. Durante la gracia la cuenta sigue operativa y la persona puede cancelar.
- `GET /v1/me/account-deletion` → `200 AccountDeletionState`:
```json
{
  "eligible": false,
  "blockers": [
    { "code": "UPCOMING_BOOKING_AS_PASSENGER", "message": "Tienes 1 reserva confirmada pendiente de realizar. Cancélala o complétala antes de eliminar la cuenta.", "count": 1 }
  ],
  "graceDays": 14,
  "request": null,
  "plan": {
    "deleted": ["Teléfono y sesiones abiertas", "Foto de perfil, selfie y documentos privados", "Vehículos y sus documentos", "Notificaciones, dispositivos push y ajustes", "Contenido de tus mensajes"],
    "anonymised": ["Tu nombre público pasa a «Usuario eliminado» en viajes y chats de otras personas", "Reservas y viajes pasados (se conservan sin vincularlos a ti)"],
    "retained": [
      { "item": "Registros de pago y facturación", "reason": "Obligación legal (fiscal y contable)", "period": "6 años" },
      { "item": "Denuncias presentadas o recibidas y su prueba", "reason": "Seguridad de las personas usuarias y defensa de reclamaciones", "period": "hasta 3 años desde su cierre" }
    ]
  }
}
```
- `POST /v1/me/account-deletion` — body `{ "confirmation": "ELIMINAR", "reason"?: "…" }` (`reason` ≤ 500) → `201 AccountDeletionState` con `request.status:"scheduled"` y `scheduledFor = ahora + 14 días`; si ya hay una solicitud vigente → `200` con esa. Errores: `422 ACCOUNT_DELETION_CONFIRMATION_REQUIRED` (texto distinto de «ELIMINAR»), **`409 ACCOUNT_DELETION_BLOCKED`** con `details.blockers` (lista de `{code,message,count}`).
- `POST /v1/me/account-deletion/cancel` → `200 AccountDeletionState` con `request.status:"cancelled"`. `404 ACCOUNT_DELETION_NOT_FOUND` si no hay solicitud vigente.
- **Bloqueos** (códigos estables, vuelven a comprobarse al ejecutar; si aparecen nuevos, la solicitud pasa a `blocked` y se avisa a la persona sin perder la solicitud):
  | code | Condición |
  |---|---|
  | `ACTIVE_TRIP_AS_DRIVER` | Es conductor de un viaje `active` o `published` (futuro o sin fecha). |
  | `UPCOMING_BOOKING_AS_PASSENGER` | Tiene reservas `confirmed` en viajes no finalizados. |
  | `OPEN_RIDE_REQUEST` | Tiene solicitudes `pending`, `accepted` o `payment_pending`. |
  | `PENDING_PAYMENT_COMPENSATION` | Tiene compensaciones/reembolsos de pago pendientes (`payment_compensations.status='pending'`). |
  | otros | Los registra cada módulo con `registerDeletionBlocker()` (`src/modules/comms/public.ts`): pagos pendientes, disputas, liquidaciones al conductor… |
- **Ejecución** (`executeDueAccountDeletions`, trabajo periódico con `FOR UPDATE SKIP LOCKED`): revoca sesiones; `app_users.status='deleted'` y `phone_e164=NULL`; `profiles` anonimizado (`display_name`, foto, selfie, estado de presencia a nulo); borra objetos privados (documentos, selfie, adjuntos de soporte, exportaciones) del almacenamiento; borra vehículos del usuario (la matrícula se libera), notificaciones, tokens push, ajustes, preferencias, bloqueos y borra el **contenido** de sus mensajes (`[Mensaje eliminado]`; las filas se conservan para el hilo de la otra persona); cierra tickets abiertos. Se conservan, sin vincular a la persona, reservas/viajes pasados y registros de pago (obligación legal) y las denuncias con su prueba (seguridad). Auditoría: `account.deletion.requested|cancelled|blocked|completed`.
  Todo el borrado de la base de datos va en **una sola transacción**: si falla el borrado de objetos del almacenamiento o un paso de otro módulo, no se anonimiza nada, la solicitud queda `processing` con `last_error` (visible solo para soporte) y se reintenta pasados 10 minutos; **nunca** se declara completada a medias. Una vez iniciada (`processing`) ya no se puede cancelar (`409 ACCOUNT_DELETION_IN_PROGRESS`). Tickets: el texto de la persona se sustituye por «[Consulta eliminada]» / «[Mensaje eliminado]» y los tickets quedan cerrados (se conserva la referencia). La auditoría (`audit_events`), las denuncias con su prueba y los registros de pago se conservan; el motivo escrito al solicitar la baja se borra al completarse. El resumen de la ejecución (`erasure_summary`) solo contiene recuentos, nunca datos personales.
- La app, durante `scheduled`, muestra el aviso «Eliminación programada para el …» (`settings.account.pendingDeletion`) y el botón «Cancelar eliminación».

---

## 7. Máquinas de estado

```
Acuse de mensaje propio   sent ──(destinatario consulta)──▶ delivered ──(destinatario lee)──▶ read
Ticket                    open ──(personal responde)──▶ answered ──(usuario responde)──▶ open ;  open|answered ──▶ closed
Denuncia                  open ──▶ in_review ──▶ actioned | dismissed        (las mueve el personal)
Exportación               queued ──▶ processing ──▶ ready ──▶ expired ;  processing ──▶ failed ;  (sin almacenamiento) blocked_storage_disabled
Eliminación de cuenta     scheduled ──▶ processing ──▶ completed ;  scheduled ⇄ blocked ;  scheduled|blocked ──▶ cancelled
Notificación              delivered (visible) | suppressed (oculta por preferencias del usuario)
```

## 8. Seguridad y privacidad implementadas

| Regla | Dónde |
|---|---|
| Autorización por recurso: 404 si no eres parte | conversaciones, mensajes, notificaciones, tickets, adjuntos, denuncias, exportaciones, tokens push |
| Acceso a chat siempre re-evaluado en servidor (reserva vigente + sin bloqueo + ruta derivada) | `chat-access.ts` (reglas) · `chat-inbox.ts` (bandeja, contadores, cabecera) · `chat-messages.ts` (mensajes, acuses, llamada) |
| El teléfono de la otra parte solo en ventana de viaje, auditado | `call-contact` |
| Denunciar solo a quien compartiste reserva/chat; prueba literal conservada | `moderation.ts` |
| Adjuntos privados con URL firmada de 5 min; tipo y tamaño verificados al completar | `support.ts` |
| Exportación solo con datos propios; enlace firmado y auditado | `data-export.ts` |
| Eliminación de cuenta: confirmación, gracia, bloqueos, una transacción, auditoría sin datos personales | `account-deletion.ts` |
| Sesión exigida antes de validar; límites por sesión; errores 4xx estables; `Cache-Control: no-store` | `index.ts`, `http.ts` |
| Trabajos periódicos (exportaciones, caducidades, eliminaciones vencidas, limpieza de subidas abandonadas) con `FOR UPDATE SKIP LOCKED` | `jobs.ts` |
| Avisos esenciales imposibles de desactivar (servicio + CHECK + filtro) | `notifications.ts`, migración 060 |
| Auditoría (`audit_events`): `chat.report.created`, `chat.peer_call.contact_revealed`, `support.ticket.created|closed`, `privacy.export.requested|downloaded`, `account.deletion.*`, `notifications.preferences.updated` | `src/lib/audit.ts` |

## 9. Contrato de tablas para `trust` (lado administración)

`trust` **lee y escribe** estas tablas directamente (mismo patrón que el resto de módulos; sin dependencia de código de `comms`). Los disparadores de la migración 062/063 mantienen las invariantes, de modo que `trust` solo debe insertar/actualizar lo indicado.

### 9.1 Tickets
```
support_tickets(id uuid PK, reference text unique "MVC-2026-000123", user_id uuid, category text {trip_issue|payment_issue|account_profile},
  status text {open|answered|closed}, trip_id uuid null, booking_id uuid null, body text (consulta original, ≤500),
  assigned_to_user_id uuid null, last_user_message_at timestamptz, last_staff_message_at timestamptz null,
  closed_at timestamptz null, closed_by text null {user|staff}, created_at, updated_at)
support_ticket_messages(id uuid PK, ticket_id uuid FK, author_type text {user|staff}, author_user_id uuid, body text (1–4000),
  created_at)               -- el primer mensaje (autor user) es la consulta original
support_attachments(id uuid PK, owner_user_id, ticket_id, message_id, storage_provider, storage_key, content_type, size_bytes, sha256, created_at)
```
- **Responder** (staff): `INSERT INTO support_ticket_messages(ticket_id, author_type, author_user_id, body) VALUES ($1,'staff',$staff,$body)`. El disparador `trg_support_ticket_message_after_insert` (función `support_ticket_message_after_insert()`) pasa el ticket a `answered` (si no estaba `closed`), fija `last_staff_message_at` y **crea la notificación** `support_reply` al usuario. No hay que tocar `support_tickets` a mano.
- **Asignar**: `UPDATE support_tickets SET assigned_to_user_id=$staff`.
- **Cerrar**: `UPDATE support_tickets SET status='closed', closed_at=now(), closed_by='staff'`.
- Descargar adjuntos: URL firmada con `PrivateObjectStorage.createDownloadUrl(storage_key)` (auditar en `trust`).
- Índices: `(status, last_user_message_at)` para la cola de trabajo, `(user_id, created_at desc)`.

### 9.2 Denuncias
```
user_reports(id uuid PK, reporter_user_id, reported_user_id, reason text {harassment|unsafe_behavior|inappropriate_content|spam_or_fraud|no_show|other},
  details text null, trip_id uuid null, conversation_id uuid null, status text {open|in_review|actioned|dismissed},
  resolution_note text null (solo interno, nunca se muestra al usuario), resolved_by_user_id uuid null, resolved_at timestamptz null, created_at, updated_at)
user_report_evidence(id, report_id FK, message_source text {direct|group}, message_id uuid, sender_user_id uuid, kind text, body text, location_lat, location_lng,
  message_created_at timestamptz, created_at)       -- copia literal tomada al denunciar
```
- **Resolver**: `UPDATE user_reports SET status='actioned'|'dismissed', resolved_by_user_id=$staff, resolved_at=now(), resolution_note=$note`. El disparador `trg_user_report_before_update` (función `user_report_before_update()`) fija `resolved_at`, mantiene `updated_at` y avisa al denunciante (`report_update`) al pasar a `actioned|dismissed` (texto genérico, sin resultado).
- **Retirar un mensaje** (moderación): `UPDATE trip_direct_messages|chat_group_messages SET hidden_at=now(), hidden_by_user_id=$staff, hidden_reason=$text WHERE id=$1`. La app lo muestra como retirado (`hidden:true`, sin contenido).
- **Suspender cuenta**: `UPDATE app_users SET status='suspended'` ya hace que `resolveSession` rechace al usuario (`ACCOUNT_NOT_ACTIVE`).

### 9.3 Otras tablas del módulo (solo lectura para `trust`)
`chat_conversations`, `chat_participants`, `chat_group_messages`, `trip_direct_messages` (008 ampliada), `notifications` (012 ampliada con `delivery_state`), `notification_preferences`, `push_tokens`, `user_settings`, `data_export_requests`, `account_deletion_requests`.

## 10. Migraciones y cambios sobre tablas base

| Migración | Contenido |
|---|---|
| `060_comms_notifications.sql` | `notification_preferences` (con `CHECK (essential_trip_notices)`), `push_tokens`; `notifications.delivery_state` + disparador `comms_apply_notification_preferences` (suprime solo `arrival_*` y categoría `message` según preferencias). |
| `061_comms_chat.sql` | `trip_direct_messages` + `seq`, `kind`, `location_*`, `hidden_*`; `chat_conversations`, `chat_participants`, `chat_group_messages`, vista `chat_trip_route_keys`. |
| `062_comms_support.sql` | `support_tickets`, `support_ticket_messages`, `support_attachments`, `support_upload_intents`, disparadores de estado y notificación. |
| `063_comms_reports_settings.sql` | `user_reports`, `user_report_evidence`, `user_settings`. |
| `064_comms_data_rights.sql` | `data_export_requests`, `account_deletion_requests`. |

Las migraciones solo referencian tablas base (001–019: `app_users`, `trips`, `bookings`…) y las propias, de modo que `comms` se puede migrar y probar en aislamiento (`MIGRATIONS_EXCLUDE="020-059,080-099"`). Ampliar `notifications` (012) y `trip_direct_messages` (008) es compatible hacia atrás: las columnas nuevas tienen valores por defecto y el código existente sigue funcionando.

## 11. Puntos de integración para otros módulos (`src/modules/comms/public.ts`)

`public.ts` es la **única** superficie de `comms` que otros módulos deben importar. Se registra una vez al arrancar el módulo propietario; registrar dos veces con el mismo `name` sustituye al anterior.

| API | Para qué | Quién debe usarla |
|---|---|---|
| `notify()` (`src/lib/notify.ts`) | Crear avisos. Usar `kind` `arrival_*` para los avisos opcionales de llegada; todo lo demás es esencial y no puede suprimirse. El filtro por preferencias es automático (disparador, §10). | todos |
| `registerDeletionBlocker({ name, check(db, userId) → [{ code, message, count }] })` | Impedir (o pausar) la eliminación de cuenta: pagos/compensaciones pendientes, disputas abiertas, liquidaciones al conductor… Se evalúa al consultar, al solicitar y al ejecutar. | `money`, `trips` (viajes recurrentes futuros), `trust` (casos abiertos) |
| `registerExportContributor({ name, build(db, userId) → unknown })` | Añadir su sección a la exportación de datos (`modules.<name>`), **solo con datos del propio usuario**. Mientras un módulo no se registre, la exportación lo lista en `notIncluded` con el motivo (hoy: `money` y `trips`). | `money`, `live`, `trips`, `trust` |
| `registerErasureStep({ name, storageKeys?(db, userId) → string[], run(client, userId) → recuentos \| void })` | Borrar/anonimizar los datos personales del módulo **dentro de la misma transacción** de la eliminación de cuenta; `storageKeys` devuelve objetos privados (S3) a borrar antes. Un error deshace todo y se reintenta. | `money` (métodos de pago, recibos), `trips` (lugares favoritos, rutina…), `live` (comentarios de valoraciones, incidencias, enlaces), `trust` (fotos, revisión de identidad, aceptaciones) |
| `getShareLiveLocationInTrip(db, userId)` | Ajuste «Compartir ubicación en viaje»: `live` debe consultarlo antes de mostrar la posición precisa de esa persona a los demás. | `live` |
| `isEssentialNotification(kind, category)` | Decidir si un aviso puede suprimirse por preferencias. | cualquiera |
| `processQueuedDataExports` · `expireDataExports` · `executeDueAccountDeletions` · `cleanupSupportUploads` · `runCommsJobsOnce` · `startCommsJobs` | Trabajos periódicos. El módulo arranca un temporizador interno cada `COMMS_JOBS_INTERVAL_SECONDS` (60 por defecto; `0` lo desactiva) y es seguro con varias réplicas (`FOR UPDATE SKIP LOCKED`); también se pueden lanzar desde un cron externo. | despliegue |
| `loadCommsConfig`, tipos `CommsConfig`, `DataRightsDeps`, `ObjectEraser` | Configuración y dependencias de los trabajos. | despliegue / pruebas |

**Estado real hoy** (comprobado en el código del árbol, no solo en este contrato):
- `trust` y `live` ya se conectan al registro al arrancar su módulo (`registerTrustDataRights()` en `src/modules/trust/index.ts`, `registerLiveDataRights()` en `src/modules/live/index.ts`): aportan su sección a la exportación (`modules.trust`, `modules.live`) y su paso de borrado dentro de la transacción de la eliminación (`trust` además declara las claves de sus objetos privados en `storageKeys`). Sus propias pruebas (`tests/live-data-rights.integration.test.ts`, `tests/trust-audit-support.integration.test.ts`) ejercitan la exportación y la eliminación reales de `comms` con esos adaptadores, incluido el deshacer completo si un paso posterior falla.
- `money` y `trips` **no** han registrado nada: la exportación los declara en `notIncluded` y la eliminación no toca sus tablas (métodos de pago, recibos, lugares favoritos, rutina…). Ningún módulo ha registrado todavía un `registerDeletionBlocker`: los bloqueos que sí existen son los de las tablas base (viajes publicados o en curso como conductor, reservas confirmadas pendientes de realizar, solicitudes abiertas y compensaciones de pago pendientes, §6.2).
- Propuesta de bloqueo para `money` (estados reales de sus `CHECK`): pagos del usuario en `requires_action` o `processing`; reembolsos (`refund_requests`, como pasajero o conductor) en `pending_review`, `approved` o `executing`; liquidaciones (`payout_runs`) del conductor en `draft` o `processing`. Sin ese registro, una persona con un reembolso o una liquidación en curso **podría** eliminar su cuenta.
- `live` aplica el ajuste «Compartir ubicación en viaje» leyendo `user_settings.share_live_location_in_trip` directamente (`src/modules/live/privacy-service.ts`, con valor `true` si la tabla o la fila no existen), no a través de `getShareLiveLocationInTrip`; ambos leen la misma columna.

## 12. Estado honesto

**Implementado y probado** — pruebas de integración en la base de datos propia `mvc_comms` (`tests/comms-*.integration.test.ts`, 58 pruebas en 6 ficheros, ver el informe de entrega para los comandos y resultados):
- *Notificaciones*: lista con filtros y cursor, contadores, marcar leído (una, todas, por categoría), preferencias con avisos esenciales imposibles de desactivar (servicio + `CHECK` + disparador), supresión de opcionales, aviso de mensajes agrupado por conversación, registro y baja de dispositivos push (el token nunca se devuelve).
- *Mensajes*: bandeja (pestañas, búsqueda, paginación), cabecera, chat de reserva y grupos de ruta recurrente con pertenencia derivada, mensajes de texto/ubicación idempotentes, acuses `sent|delivered|read` (también por el sondeo de la insignia), paginación hacia atrás y sondeo `afterSeq`, mensajes retirados por moderación, llamada a la otra parte con ventana de viaje y auditoría, bloqueos (lista) y denuncias de personas y de mensajes (prueba literal, topes, idempotencia), y compatibilidad con las rutas antiguas del chat y de bloqueos probada contra `buildApp`.
- *Centro de ayuda*: selector de viajes, subida privada de imágenes (intención → `PUT` → comprobación de tamaño y cabecera), consultas con vínculo a viaje/reserva, hilo, respuestas, cierre, topes, idempotencia y limpieza de subidas abandonadas.
- *Ajustes*, *exportación de datos* (contenido solo propio, subida firmada, reintentos, caducidad, estado bloqueado) y *eliminación de cuenta* (bloqueos reales, confirmación, gracia, cancelación, ejecución en una transacción con reintentos, anonimización y borrado de objetos, sin que una solicitud bloqueada frene a las demás).
- *Capa HTTP*: los 39 endpoints coinciden con `mobile/src/api/types/comms.ts` (comparador de contrato con el compilador de TypeScript), OpenAPI completo, sesión antes de validar, errores 4xx estables, cuerpos vacíos, límites de frecuencia reales por sesión, sesiones revocadas tras eliminar la cuenta y arranque en la app real con todos los módulos (sin rutas duplicadas).

**Pendiente de verificar** (no se ha podido comprobar con lo disponible; no se afirma que funcione):
- Comportamiento con **datos reales de otros módulos**. Las 58 pruebas pasan también contra una base con todas las migraciones que existen hoy en el árbol (001–012, 020–022, 030–033, 040–045, 060–064 y 080–083, es decir, también las de `trips`, `money`, `live` y `trust`; base de comprobación `mvc_comms_full`, creada y borrada para esta verificación), así que mis migraciones y consultas conviven con el esquema completo. Pero esas pruebas no insertan filas en las tablas de los otros módulos: lo que depende de ellas (`ratingAverage`/`ratingCount` desde valoraciones, tarifas aprobadas para `contribution`, métodos de pago…) se comprueba en tiempo de ejecución y cae a valores neutros, y no se ha probado con datos reales de esos módulos.
- Participación de `money` y `trips` en la exportación y la eliminación (§11): no han registrado contribuidores, bloqueos ni pasos de borrado; la exportación los declara en `notIncluded` y la eliminación **no** toca sus tablas (pagos, reembolsos, recibos, liquidaciones, métodos de pago, lugares favoritos, rutina…). `trust` y `live` sí están conectados y lo prueban sus propias suites contra la exportación y la eliminación reales de `comms`; yo no he repetido esas pruebas cruzadas.
- Bloqueo de la eliminación por reembolsos o liquidaciones en curso: sin un `registerDeletionBlocker` de `money` (propuesta en §11), solo se bloquean los casos de las tablas base.
- Rendimiento y carga: no hay pruebas de carga. La bandeja (`GET /v1/conversations`) calcula en cada llamada todas las conversaciones accesibles de la persona (sin límite de antigüedad): adecuado para decenas de chats; con historiales de cientos habrá que paginar en SQL. El sondeo de la insignia (`unread-count`) sí es ligero.
- Subida y borrado reales en S3 (en las pruebas el almacenamiento y el borrador de objetos son dobles en memoria; el cliente `S3ObjectEraser` y la subida por URL firmada no se han probado contra un servidor S3 real).

**Bloqueado** (necesita decisión o credencial externa; nada se simula):
- **Entrega push**: no hay proveedor/credenciales (`PUSH_PROVIDER=disabled`). El registro de tokens funciona; los avisos solo existen dentro de la app y `NotificationPreferences.push` lo declara (`available:false`, `PROVIDER_DISABLED`).
- **Adjuntos de soporte y enlace de descarga de la exportación**: requieren almacenamiento privado S3 (`PRIVATE_STORAGE_PROVIDER=s3`). Desactivado → `503 PRIVATE_STORAGE_NOT_CONFIGURED` / exportación `blocked_storage_disabled`. La interfaz `PrivateObjectStorage` actual no tiene `put` ni `delete`; el módulo sube exportaciones con URL firmada y borra con su propio cliente S3.
- **Llamar a la otra persona**: revelar el teléfono entre participantes necesita validación de privacidad (base jurídica y política). Implementado con ventana de viaje y auditoría; configurable (`COMMS_PEER_CALL_ENABLED`).
- **Plazos de conservación** del plan de eliminación (6 años pagos, 3 años denuncias): propuesta pendiente de validación jurídica.

**No implementado**:
- Notas de voz (micrófono en la barra del chat) e imágenes/adjuntos en chats: el mecanismo de subida privada existente es específico de vehículos; la app debe mostrar solo «Ubicación» en el botón de adjuntar y no ofrecer micrófono.
- Cambio de teléfono («Mi móvil») y pantalla «Permisos de la app» (solo sistema operativo): no tienen endpoint en este módulo (el cambio de teléfono pertenece a `auth`).
- Mensajes entre pasajero y conductor **antes** de confirmar la reserva (la regla vigente exige reserva confirmada).
- Tiempo real (WebSocket/SSE): la app sondea `afterSeq` y `unread-count`.
- Valoraciones propias de `comms`: no hay. `ratingAverage`/`ratingCount` se leen de `profiles.rating_sum`/`rating_count` (migración 030 de `live`, misma aritmética que `live` y `trips`: `round(suma·10 / recuento)/10`); en una base sin esas columnas son `null` y `0`.
- Panel de personal para tickets y denuncias: es del módulo `trust` (este módulo solo define el contrato de tablas, §9).

## 13. Variables de entorno (todas con valor seguro por defecto)

El módulo las lee de `process.env` en `src/modules/comms/config.ts` (no de `src/config.ts`, que es de otro propietario). **Falta añadirlas a `.env.example`** (fichero ajeno): hasta entonces rigen los valores por defecto. Un valor inválido hace fallar el arranque con un mensaje claro.

| Variable | Defecto | Uso |
|---|---|---|
| `PUSH_PROVIDER` | `disabled` | Solo `disabled` está implementado. |
| `COMMS_PEER_CALL_ENABLED` | `true` | Permite `call-contact`. |
| `COMMS_PEER_CALL_WINDOW_BEFORE_MINUTES` / `…_AFTER_MINUTES` | `720` / `180` | Ventana del teléfono. |
| `COMMS_ACCOUNT_DELETION_GRACE_DAYS` | `14` | Periodo de gracia (1–60). |
| `COMMS_EXPORT_TTL_HOURS` | `168` | Caducidad de la exportación (1–720). |
| `COMMS_JOBS_INTERVAL_SECONDS` | `60` | Trabajos periódicos (0 = desactivados). |
| `PUBLIC_MEDIA_BASE_URL` | vacío | Base pública para construir `photoUrl` a partir de `profiles.public_photo_key` (solo fotos aprobadas). Vacío → `photoUrl: null`. |

## 14. Catálogo de errores del módulo

| HTTP | code | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Esquema inválido, JSON mal formado, `cursor` y `afterSeq` a la vez, texto con caracteres de control |
| 400 | `INVALID_CURSOR` | Cursor corrupto |
| 400 | `CHAT_SELF_FORBIDDEN` / `REPORT_SELF_FORBIDDEN` | Autoconversación / autodenuncia |
| 400 | `CALL_NOT_SUPPORTED_FOR_GROUPS` | Llamar en un grupo |
| 401 | `AUTH_REQUIRED` · `AUTH_INVALID` · `AUTH_INVALID_OR_EXPIRED` | Sesión (módulo auth); se comprueba antes de validar |
| 403 | `ACCOUNT_NOT_ACTIVE` | Cuenta suspendida |
| 403 | `CHAT_FORBIDDEN` / `CHAT_BLOCKED` | Sin reserva vigente / bloqueo |
| 403 | `REPORT_NOT_RELATED` / `SUPPORT_LINK_FORBIDDEN` | Sin relación con la persona o el viaje |
| 404 | `NOTIFICATION_NOT_FOUND` · `PUSH_TOKEN_NOT_FOUND` · `CONVERSATION_NOT_FOUND` · `MESSAGE_NOT_FOUND` · `TRIP_NOT_FOUND` · `USER_NOT_FOUND` · `SUPPORT_TICKET_NOT_FOUND` · `SUPPORT_ATTACHMENT_NOT_FOUND` · `UPLOAD_INTENT_NOT_FOUND` · `EXPORT_NOT_FOUND` · `ACCOUNT_DELETION_NOT_FOUND` | Inexistente **o ajeno** |
| 409 | `CHAT_IDEMPOTENCY_CONFLICT` · `REPORT_IDEMPOTENCY_CONFLICT` · `SUPPORT_IDEMPOTENCY_CONFLICT` · `REPORT_ALREADY_FILED` · `SUPPORT_TICKET_CLOSED` · `UPLOAD_OBJECT_MISSING` · `UPLOAD_STORAGE_MISMATCH` · `EXPORT_NOT_READY` · `ACCOUNT_DELETION_BLOCKED` · `ACCOUNT_DELETION_IN_PROGRESS` | Conflictos de estado o de idempotencia |
| 410 | `UPLOAD_INTENT_EXPIRED` · `EXPORT_EXPIRED` | Caducados |
| 413 | `PAYLOAD_TOO_LARGE` | Cuerpo de más de 1 MiB |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | `Content-Type` no admitido (usa `application/json`) |
| 422 | `INVALID_CHAT_MESSAGE` · `INVALID_LOCATION` · `ESSENTIAL_NOTICES_LOCKED` · `PUSH_TOKEN_INVALID` · `REPORT_EVIDENCE_INVALID` · `SUPPORT_ATTACHMENT_LIMIT` · `SUPPORT_ATTACHMENT_INVALID` · `PRIVATE_UPLOAD_TYPE_NOT_ALLOWED` · `PRIVATE_UPLOAD_SIZE_INVALID` · `UPLOADED_FILE_SIZE_MISMATCH` · `UPLOADED_FILE_TYPE_MISMATCH` · `ACCOUNT_DELETION_CONFIRMATION_REQUIRED` | Reglas de dominio |
| 429 | `RATE_LIMITED` · `REPORT_RATE_LIMITED` · `SUPPORT_TICKET_LIMIT` · `EXPORT_RATE_LIMITED` | Límites (los tres últimos son topes de negocio) |
| 503 | `PRIVATE_STORAGE_NOT_CONFIGURED` | Almacenamiento privado desactivado |

## 15. Lista de endpoints (39)

| Método | Ruta | Resumen |
|---|---|---|
| GET | `/v1/notifications` | Listar notificaciones (filtro por categoría, no leídas, cursor) |
| GET | `/v1/notifications/unread-count` | Contadores de no leídas |
| POST | `/v1/notifications/read-all` | Marcar todas (o una categoría) como leídas |
| POST | `/v1/notifications/:notificationId/read` | Marcar una notificación como leída |
| GET | `/v1/me/notification-preferences` | Preferencias de notificaciones |
| PATCH | `/v1/me/notification-preferences` | Cambiar preferencias (avisos esenciales bloqueados) |
| GET | `/v1/me/push-tokens` | Dispositivos push registrados |
| POST | `/v1/me/push-tokens` | Registrar/actualizar token push |
| DELETE | `/v1/me/push-tokens/:tokenId` | Dar de baja un token push |
| GET | `/v1/conversations` | Bandeja de mensajes (todos / reservas / grupos, búsqueda) |
| GET | `/v1/conversations/unread-count` | Mensajes sin leer |
| POST | `/v1/conversations/direct` | Abrir el chat de una reserva |
| GET | `/v1/conversations/:conversationId` | Cabecera del chat (viaje, reserva, recogida, aporte, miembros) |
| GET | `/v1/conversations/:conversationId/messages` | Mensajes (cursor hacia atrás / afterSeq) |
| POST | `/v1/conversations/:conversationId/messages` | Enviar texto o ubicación |
| POST | `/v1/conversations/:conversationId/read` | Marcar leído |
| GET | `/v1/conversations/:conversationId/call-contact` | Teléfono de la otra parte en ventana de viaje |
| POST | `/v1/conversations/:conversationId/messages/:messageId/report` | Denunciar un mensaje |
| GET | `/v1/me/blocks` | Personas bloqueadas |
| POST | `/v1/me/reports` | Denunciar a una persona (con prueba) |
| GET | `/v1/me/reports` | Mis denuncias |
| GET | `/v1/me/support/trips` | Viajes para vincular a una consulta |
| POST | `/v1/me/support/uploads/intents` | Crear subida privada de imagen |
| POST | `/v1/me/support/uploads/:intentId/complete` | Completar subida de imagen |
| GET | `/v1/me/support/attachments/:attachmentId/download` | URL firmada de un adjunto propio |
| POST | `/v1/me/support/tickets` | Enviar consulta al centro de ayuda |
| GET | `/v1/me/support/tickets` | Mis consultas |
| GET | `/v1/me/support/tickets/:ticketId` | Hilo de una consulta |
| POST | `/v1/me/support/tickets/:ticketId/replies` | Responder en una consulta |
| POST | `/v1/me/support/tickets/:ticketId/close` | Cerrar una consulta |
| GET | `/v1/me/settings` | Ajustes del usuario |
| PATCH | `/v1/me/settings` | Cambiar ajustes |
| POST | `/v1/me/data-exports` | Solicitar exportación de datos |
| GET | `/v1/me/data-exports` | Mis exportaciones |
| GET | `/v1/me/data-exports/:exportId` | Estado de una exportación |
| GET | `/v1/me/data-exports/:exportId/download` | URL firmada de la exportación |
| GET | `/v1/me/account-deletion` | Estado, bloqueos y plan de eliminación |
| POST | `/v1/me/account-deletion` | Solicitar eliminación (confirmación + gracia) |
| POST | `/v1/me/account-deletion/cancel` | Cancelar la eliminación |
