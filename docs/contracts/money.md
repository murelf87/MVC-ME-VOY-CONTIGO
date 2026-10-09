# Contrato del módulo `money` — pagos, cobros, cancelaciones, devoluciones y planes

Propietario: agente `be-money`. Tipos TypeScript equivalentes (fuente para la app): `mobile/src/api/types/money.ts`.
Código: `src/modules/money/**` · migraciones `040–045` · pruebas `tests/*money*` (base `mvc_money`).

> **Etiquetas honestas** (BUILD_BRIEF §2.8). Este documento describe el contrato; el estado de cada pieza y las decisiones pendientes están en §15.
> **No existe proveedor de pagos**: no hay credenciales ni decisión de proveedor. `PAYMENTS_PROVIDER=disabled` es el único valor
> aceptado hoy. Todo lo que dependa del proveedor (crear intento, guardar método, devolver, abonar) responde
> `409 PAYMENTS_PROVIDER_DISABLED`. **Nada se marca como pagado sin un evento firmado confirmado por el servidor.**

## 1. Convenciones

| Tema | Regla |
|---|---|
| Base | `/v1/...`, JSON UTF-8 (salvo el recibo imprimible, `text/html`). `Authorization: Bearer mvc_sess_…` (sesión opaca de `auth`). |
| Autenticación | Resuelta por el núcleo `auth` en todas las rutas salvo `GET /v1/plans` (público) y el webhook (firma HMAC). Sin cabecera → `401 AUTH_REQUIRED`; esquema distinto de Bearer o token sin el prefijo `mvc_sess_` → `401 AUTH_INVALID`; token desconocido, caducado o revocado → `401 AUTH_INVALID_OR_EXPIRED`; cuenta suspendida o eliminada → `403 ACCOUNT_NOT_ACTIVE`; rol insuficiente → `403 AUTH_FORBIDDEN`. Ninguna ruta protegida devuelve datos sin una sesión válida de una cuenta activa. |
| Error | `{ "error": { "code": "MAYÚSCULAS_SNAKE", "message": "texto en español", "details"?: … }, "requestId": "…" }`. Los códigos son estables y están todos en §1.1; el `message` es orientativo y está en español (**la app decide por `code`, nunca por el texto**). El módulo `money` tiene su propio manejador de errores encapsulado: validación de entrada → `400 VALIDATION_ERROR` con `details: [{ "path": "/campo", "message": "…" }]`; JSON mal formado → `400 VALIDATION_ERROR`; tipo de contenido sin analizador (p. ej. XML) → `415 VALIDATION_ERROR`; exceso de peticiones → `429 RATE_LIMITED`; cualquier fallo no previsto → `500 INTERNAL_ERROR` sin detalle. |
| Caché | Toda respuesta lleva `Cache-Control: no-store` (hay datos personales y financieros); el recibo imprimible, además, `private, no-store`. |
| Dinero | Siempre `Money = { cents: number\|null, currency: "EUR", status: "defined"\|"pending_definition"\|"illustrative" }`. **Céntimos enteros, nunca float.** Sin tarifa/política aprobada → `{ "cents": null, "currency": "EUR", "status": "pending_definition" }` y la UI escribe «Por definir». El backend real **nunca** emite `illustrative`. El importe **nunca** lo decide el cliente: el cuerpo de las peticiones no lleva importes (salvo `approvedCents` en la aprobación de una devolución por finanzas). |
| Idempotencia | Cabecera `Idempotency-Key` (8–128 caracteres `[A-Za-z0-9_-]`, p. ej. un UUID v4) **obligatoria** en: crear intento de pago, añadir método de pago, cancelar/cancelar como conductor, aprobar/rechazar/ejecutar devolución, generar/ejecutar liquidaciones. Mismo `(usuario, operación, clave)` + mismo cuerpo → se devuelve la **misma respuesta** con cabecera `Idempotency-Replayed: true` y sin repetir efectos. Misma clave con otro cuerpo/ruta → `422 IDEMPOTENCY_KEY_REUSED`. Falta la cabecera → `400 IDEMPOTENCY_KEY_REQUIRED`. Los errores no se guardan (el reintento se vuelve a evaluar). |
| Paginación | `?limit=` (1–50, por defecto 20) y `?cursor=` opaco → `{ items, nextCursor }` (`Page<T>`). |
| Fechas | Instantes ISO-8601 UTC con milisegundos. Fechas de calendario `YYYY-MM-DD` y periodos `YYYY-MM` en `Europe/Madrid`. |
| Propiedad | Ver §8. Recurso ajeno → `404` (`*_NOT_FOUND`), nunca `403`, para no filtrar existencia. Los endpoints `/v1/admin/**` exigen rol `finance_admin` o `admin` (`403 AUTH_FORBIDDEN` en otro caso; `401 AUTH_REQUIRED` sin sesión). |
| Auditoría | Operaciones sensibles (intento de pago, evento de pago aplicado, cancelación, decisión de devolución, liquidación) escriben `audit_events` (sin datos personales). Un acceso denegado al panel de finanzas (sesión válida sin `finance_admin`/`admin`) queda auditado como `admin.access_denied`; sin sesión no hay actor y no se audita. |
| Privacidad de métodos | El servidor **nunca** almacena ni devuelve PAN/CVV/IBAN completo: solo la referencia tokenizada del proveedor (no expuesta) y `brand/last4/country/exp`. Un `providerToken` con aspecto de número de tarjeta (13–19 dígitos, Luhn válido) se rechaza: `400 RAW_CARD_DATA_REJECTED`. |

### 1.1 Catálogo de errores (`error.code`)

Son los códigos estables del módulo (`MoneyErrorCode` en `mobile/src/api/types/money.ts`). Las pruebas comprueban que este catálogo, el tipo de la app y el código fuente no se desvían.
Los códigos de `cannotPayReason` (§4.1) y de `blocked` en la vista previa de cancelación (§8.1) comparten nombre con errores, pero viajan dentro de un `200`.

| `error.code` | HTTP | Cuándo |
|---|---|---|
| `AUTH_REQUIRED` | 401 | falta la cabecera `Authorization` |
| `AUTH_INVALID` | 401 | esquema distinto de `Bearer` o token sin el prefijo `mvc_sess_` |
| `AUTH_INVALID_OR_EXPIRED` | 401 | token desconocido, caducado o revocado |
| `ACCOUNT_NOT_ACTIVE` | 403 | cuenta suspendida o eliminada |
| `AUTH_FORBIDDEN` | 403 | rol insuficiente (panel de finanzas: solo `finance_admin`/`admin`) |
| `VALIDATION_ERROR` | 400, 415 | cuerpo, consulta o parámetros inválidos (`details` con la ruta del campo), JSON mal formado (400) o tipo de contenido no admitido (415) |
| `RATE_LIMITED` | 429 | demasiadas peticiones |
| `INTERNAL_ERROR` | 500 | error no previsto; el detalle no se expone |
| `IDEMPOTENCY_KEY_REQUIRED` | 400 | falta `Idempotency-Key` o su formato no es válido (8–128 caracteres `[A-Za-z0-9_-]`) |
| `IDEMPOTENCY_KEY_REUSED` | 422 | la misma clave con otro cuerpo u otra ruta |
| `PAYMENTS_PROVIDER_DISABLED` | 409 | no hay proveedor de pagos activo (estado actual); también si el pago original es de otro proveedor |
| `PAYMENT_AMOUNT_NOT_DEFINED` | 409 | sin cotización o sin tarifa aprobada: el importe está «Por definir» |
| `PAYMENT_ALREADY_OPEN` | 409 | ya hay un pago en curso para la solicitud (`details.paymentId`), o el método lo usa un pago abierto |
| `PAYMENT_METHOD_NOT_AVAILABLE` | 409 | método no ofrecido por el proveedor, ajeno o inactivo, o token rechazado por el proveedor |
| `PAYMENT_NOT_FOUND` | 404 | pago inexistente o de otro usuario |
| `PAYMENT_METHOD_NOT_FOUND` | 404 | método de pago inexistente o de otro usuario |
| `PAYMENT_PROVIDER_ERROR` | 502 | el proveedor falló: no se guarda nada y se puede reintentar con la misma clave |
| `RAW_CARD_DATA_REJECTED` | 400 | el token tiene aspecto de número de tarjeta (no se registra ni se guarda) |
| `REQUEST_NOT_FOUND` | 404 | solicitud inexistente o de otro pasajero |
| `REQUEST_NOT_PAYABLE` | 409 | la solicitud no está en `payment_pending` |
| `REQUEST_ALREADY_PAID` | 409 | la solicitud ya tiene reserva |
| `HOLD_EXPIRED` | 409 | la reserva provisional de la plaza caducó o fue liberada |
| `BOOKING_NOT_FOUND` | 404 | reserva inexistente o de otro usuario (cancelar, vista previa, cobros) |
| `BOOKING_NOT_CANCELLABLE` | 409 | la reserva no se puede cancelar (completada, `driver_cancelled` o `no_show`) |
| `TRIP_ALREADY_STARTED` | 409 | el viaje ya empezó: el pasajero acude a incidencias/soporte |
| `REFUND_NOT_FOUND` | 404 | devolución inexistente (o de otro pasajero en las rutas del pasajero) |
| `REFUND_NOT_PENDING` | 409 | la propuesta ya fue decidida |
| `REFUND_AMOUNT_REQUIRED` | 400 | la propuesta no tiene importe y falta `approvedCents` |
| `REFUND_AMOUNT_EXCEEDS_PAID` | 400 | `approvedCents` supera lo que aún se puede devolver de ese pago |
| `REFUND_NOTE_REQUIRED` | 400 | falta la nota obligatoria (sin política aplicable, cambio de importe o rechazo) |
| `REFUND_NO_PAYMENT_RECORD` | 409 | no hay un pago registrado en MVC que devolver |
| `REFUND_NOT_EXECUTABLE` | 409 | la devolución no está aprobada pendiente de proveedor (`awaiting_provider`) ni fallida: no se puede pedir al proveedor |
| `RECEIPT_NOT_FOUND` | 404 | recibo inexistente o de otro usuario |
| `PAYOUT_NOT_FOUND` | 404 | liquidación inexistente (o de otro conductor en las rutas del conductor) |
| `PAYOUT_NOT_EXECUTABLE` | 409 | la liquidación no está en `draft` ni `failed` |
| `PAYOUT_ACCOUNT_REQUIRED` | 409 | el conductor no tiene una cuenta de cobro activa |
| `WEBHOOK_SIGNATURE_INVALID` | 401 | firma del webhook ausente, inválida o caducada |
| `WEBHOOK_PAYLOAD_INVALID` | 400 | cuerpo del webhook no interpretable |
| `PAYMENTS_WEBHOOK_NOT_CONFIGURED` | 503 | sin `PAYMENTS_WEBHOOK_SECRET` o con el proveedor desactivado: el webhook se rechaza siempre |
| `PAYMENT_UNKNOWN` | 409 | el evento se refiere a un objeto aún desconocido: el proveedor debe reintentar |

## 2. Disponibilidad del proveedor (estado actual)

Todas las respuestas que dependen del proveedor incluyen `availability`:

```json
{
  "enabled": false,
  "status": "provider_disabled",
  "message": "Pagos aún no disponibles",
  "chargeMethods": [],
  "payoutsEnabled": false,
  "refundsEnabled": false
}
```

La UI usa `enabled=false` para mostrar «Pagos aún no disponibles», deshabilitar «Pagar reserva» y vaciar «Método de pago». No hay botón decorativo:
el botón existe, está deshabilitado y explica el motivo (`cannotPayReason`).

## 3. Resumen de endpoints

| # | Método y ruta | Auth | Pantalla / uso |
|---|---|---|---|
| 1 | `GET /v1/ride-requests/{requestId}/payment` | pasajero de la solicitud | 16a/16b «Estado y pago» |
| 2 | `POST /v1/ride-requests/{requestId}/payment-intents` | pasajero · `Idempotency-Key` | «Pagar reserva» |
| 3 | `GET /v1/payments/{paymentId}` | pagador | sondeo del estado del pago (decidido solo por el servidor) |
| 4 | `GET /v1/me/payments` | usuario | 33 «Mis pagos» · «Ver todos» (pasajero) |
| 5 | `GET /v1/me/payments/passenger-summary` | usuario | 33a/33b pestaña «Soy pasajero» |
| 6 | `GET /v1/me/payments/driver-summary` | usuario | 33a pestaña «Soy conductor» |
| 7 | `GET /v1/me/earnings` | conductor | 33 «Últimos cobros» · «Ver todos» |
| 8 | `GET /v1/me/earnings/{bookingId}` | conductor del viaje | detalle de un cobro |
| 9 | `GET /v1/me/payment-methods` | usuario | 33 «Método de pago» · «Editar» |
| 10 | `POST /v1/me/payment-methods` | usuario · `Idempotency-Key` | añadir método (token del proveedor) |
| 11 | `DELETE /v1/me/payment-methods/{methodId}` | propietario | quitar método |
| 12 | `GET /v1/me/receipts` | usuario | 33 «Historial de pagos y recibos» · «Facturas y justificantes» |
| 13 | `GET /v1/me/receipts/{receiptId}` | propietario | recibo estructurado |
| 14 | `GET /v1/me/receipts/{receiptId}/printable` | propietario | recibo imprimible (`text/html`) |
| 15 | `GET /v1/me/payouts` | conductor | 33 «Liquidación mensual» |
| 16 | `GET /v1/me/payouts/{payoutId}` | conductor propietario | detalle de una liquidación |
| 17 | `GET /v1/bookings/{bookingId}/cancellation-preview` | pasajero de la reserva | 28 «Detalle del reembolso (propuesta)» |
| 18 | `POST /v1/bookings/{bookingId}/cancel` | pasajero · `Idempotency-Key` | 28 «Confirmar cancelación» |
| 19 | `POST /v1/bookings/{bookingId}/driver-cancel` | conductor del viaje · `Idempotency-Key` | cancelación por el conductor |
| 20 | `GET /v1/me/refunds` | pasajero | seguimiento de devoluciones |
| 21 | `GET /v1/plans` | sin sesión necesaria (público) | 32 «Planes MVC» |
| 22 | `GET /v1/me/plan` | usuario | plan actual |
| 23 | `POST /v1/webhooks/payments` | firma HMAC del proveedor | servidor a servidor |
| 24 | `GET /v1/admin/refund-proposals` | `finance_admin`\|`admin` | 39a/39b «Reservas y devoluciones» |
| 25 | `GET /v1/admin/refund-proposals/{refundId}` | `finance_admin`\|`admin` | «Revisar devolución» |
| 26 | `POST /v1/admin/refund-proposals/{refundId}/approve` | `finance_admin`\|`admin` · `Idempotency-Key` | aprobar |
| 27 | `POST /v1/admin/refund-proposals/{refundId}/reject` | `finance_admin`\|`admin` · `Idempotency-Key` | rechazar |
| 28 | `POST /v1/admin/refund-proposals/{refundId}/execute` | `finance_admin`\|`admin` · `Idempotency-Key` | pedir al proveedor la devolución aprobada |
| 29 | `GET /v1/admin/payout-runs` | `finance_admin`\|`admin` | liquidaciones |
| 30 | `POST /v1/admin/payout-runs` | `finance_admin`\|`admin` · `Idempotency-Key` | generar liquidaciones de un periodo |
| 31 | `POST /v1/admin/payout-runs/{payoutId}/execute` | `finance_admin`\|`admin` · `Idempotency-Key` | pedir el abono al proveedor |

Los ejemplos usan Sevilla, **Ana García López** (conductora) y **Miguel Torres** (pasajero). Los identificadores son ejemplos.
Donde el ejemplo trae importes `defined` se indica que corresponde a un pago **confirmado por el servidor bajo una tarifa aprobada**
(hoy no existe: ver §9); los importes de ejemplo **no son tarifas**.

Objetos reutilizados en los ejemplos:

```json
// PublicUser
{ "id": "2d9f4a71-6c3b-4e58-8a07-b1e4c9d35f22", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 }
// MoneyTripRef
{ "tripId": "c4a8e2b0-1d57-4f93-a6c8-72e5b9d01a34", "departureAt": "2026-10-12T05:25:00.000Z", "originLabel": "Sevilla Centro", "destinationLabel": "Isla Mágica" }
```
`photoUrl` es `null` hasta que exista el servicio de URL públicas de foto aprobada (pendiente fuera de este módulo, ver §9.4).

---

## 4. Pago de una solicitud aceptada

### 4.1 `GET /v1/ride-requests/{requestId}/payment` → `RequestPaymentContext`

Datos de la pantalla 16 (Estado y pago). Solo el pasajero de la solicitud (otro usuario → `404 REQUEST_NOT_FOUND`).
La cuenta atrás se calcula con `hold.secondsRemaining` (reloj del servidor). Si la reserva provisional sigue `active` en base de datos pero ya pasó `expiresAt`
(el liberador periódico aún no la ha procesado), se muestra `hold:{status:"released",secondsRemaining:0}`: la plaza ya no está retenida y `cannotPayReason` es `HOLD_EXPIRED`.

Estado actual (proveedor desactivado y sin tarifa aprobada):

```json
{
  "requestId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "requestStatus": "payment_pending",
  "driver": { "id": "2d9f4a71-6c3b-4e58-8a07-b1e4c9d35f22", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
  "trip": { "tripId": "c4a8e2b0-1d57-4f93-a6c8-72e5b9d01a34", "departureAt": "2026-10-12T05:25:00.000Z", "originLabel": "Sevilla Centro", "destinationLabel": "Isla Mágica" },
  "hold": { "status": "active", "expiresAt": "2026-10-09T13:53:00.000Z", "secondsRemaining": 892 },
  "availability": { "enabled": false, "status": "provider_disabled", "message": "Pagos aún no disponibles", "chargeMethods": [], "payoutsEnabled": false, "refundsEnabled": false },
  "methods": [
    { "kind": "apple_pay", "available": false },
    { "kind": "google_pay", "available": false },
    { "kind": "card", "available": false }
  ],
  "savedMethods": [],
  "summary": {
    "contribution": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "platformFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "processing": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "taxes": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "total": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "tariffVersion": null,
    "quoteSnapshotId": null
  },
  "canPay": false,
  "cannotPayReason": { "code": "PAYMENTS_PROVIDER_DISABLED", "message": "Pagos aún no disponibles" },
  "payment": null,
  "bookingId": null
}
```

Con proveedor activo y tarifa aprobada (**ejemplo de forma; importes ilustrativos, no son tarifas**): `availability.enabled=true`,
`methods[].available=true`, `summary.contribution={cents:1800,status:"defined"}`, `platformFee`, `total` `defined`, `canPay=true`, `cannotPayReason=null`.

`summary` es `defined` solo si existe una cotización congelada (`quote_snapshots`, escrita por `trips`) ligada a una versión de tarifa no borrador; si no, todos los campos son `pending_definition`.
`cannotPayReason.code` (por prioridad): `REQUEST_ALREADY_PAID` · `REQUEST_NOT_PAYABLE` · `HOLD_EXPIRED` · `PAYMENT_ALREADY_OPEN` · `PAYMENTS_PROVIDER_DISABLED` · `PAYMENT_AMOUNT_NOT_DEFINED`.

### 4.2 `POST /v1/ride-requests/{requestId}/payment-intents` → `201 CreatePaymentIntentResponse`

Cabecera `Idempotency-Key` obligatoria. Solo el pasajero de la solicitud. Cuerpo (el importe lo calcula el servidor desde la cotización congelada):

```json
{ "method": { "kind": "apple_pay" } }
```

Condiciones: solicitud en `payment_pending`, hold activo y no caducado, importe definido (cotización con tarifa aprobada), sin otro pago abierto
(`requires_action`/`processing`) para la solicitud y método ofrecido por el proveedor. Errores:

| HTTP | `error.code` | Cuándo |
|---|---|---|
| 400 | `IDEMPOTENCY_KEY_REQUIRED` · `VALIDATION_ERROR` | cabecera ausente / cuerpo inválido |
| 404 | `REQUEST_NOT_FOUND` | no existe o es de otro pasajero |
| 409 | **`PAYMENTS_PROVIDER_DISABLED`** | no hay proveedor activo (estado actual) |
| 409 | `REQUEST_NOT_PAYABLE` · `REQUEST_ALREADY_PAID` | solicitud no está en `payment_pending` / ya tiene reserva |
| 409 | `HOLD_EXPIRED` | la reserva provisional caducó o fue liberada |
| 409 | `PAYMENT_AMOUNT_NOT_DEFINED` | sin cotización o sin tarifa aprobada (importe «Por definir») |
| 409 | `PAYMENT_ALREADY_OPEN` | ya hay un pago en curso; `details.paymentId` |
| 409 | `PAYMENT_METHOD_NOT_AVAILABLE` | método no ofrecido por el proveedor o `paymentMethodId` ajeno/inactivo |
| 422 | `IDEMPOTENCY_KEY_REUSED` | misma clave con otro cuerpo |
| 502 | `PAYMENT_PROVIDER_ERROR` | el proveedor falló (nada se guarda; reintentar con la misma clave) |

Estado actual:

```json
{
  "error": { "code": "PAYMENTS_PROVIDER_DISABLED", "message": "Pagos aún no disponibles. Tu plaza sigue reservada provisionalmente, pero todavía no se puede cobrar." },
  "requestId": "req-7f1e2d3c"
}
```

Con proveedor activo (**ejemplo de forma**):

```json
{
  "payment": {
    "id": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f",
    "requestId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "bookingId": null,
    "status": "requires_action",
    "outcome": "awaiting_payment",
    "amount": { "cents": 1800, "currency": "EUR", "status": "defined" },
    "refunded": { "cents": 0, "currency": "EUR", "status": "defined" },
    "method": { "kind": "apple_pay", "maskedLabel": null },
    "failureCode": null,
    "createdAt": "2026-10-09T13:39:12.000Z",
    "updatedAt": "2026-10-09T13:39:12.000Z",
    "succeededAt": null
  },
  "clientAction": { "type": "sdk_payment_sheet", "clientSecret": "<opaco, lo da el proveedor>", "redirectUrl": null }
}
```

**El resultado del SDK en el móvil no confirma nada**: la app sondea `GET /v1/payments/{id}` (cada 1–2 s, máx. ~60 s) hasta `succeeded`, `failed`, `expired` o `refunded`.

### 4.3 `GET /v1/payments/{paymentId}` → `PaymentView`

Solo el pagador (otro usuario → `404 PAYMENT_NOT_FOUND`). Ejemplo tras la confirmación firmada del proveedor (ejemplo de forma):

```json
{
  "id": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f",
  "requestId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
  "bookingId": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  "status": "succeeded",
  "outcome": "booking_confirmed",
  "amount": { "cents": 1800, "currency": "EUR", "status": "defined" },
  "refunded": { "cents": 0, "currency": "EUR", "status": "defined" },
  "method": { "kind": "apple_pay", "maskedLabel": null },
  "failureCode": null,
  "createdAt": "2026-10-09T13:39:12.000Z",
  "updatedAt": "2026-10-09T13:39:41.000Z",
  "succeededAt": "2026-10-09T13:39:41.000Z"
}
```

Si el pago se confirma **después** de que caducara el hold: `status:"succeeded"`, `outcome:"late_payment"`, `bookingId:null` — **no se crea reserva** (sin sobre-reserva); se genera una compensación (`payment_compensations`) y una propuesta de devolución íntegra (`origin:"late_payment"`) para finanzas.

---

## 5. «Mis pagos y cobros» (pantalla 33)

### 5.1 `GET /v1/me/payments/passenger-summary?month=YYYY-MM` → `PassengerPaymentsSummary`

`month` opcional (por defecto el mes actual en Europe/Madrid). Estado actual (hay una solicitud aceptada pendiente de pago, sin tarifa):

```json
{
  "month": "2026-10",
  "availability": { "enabled": false, "status": "provider_disabled", "message": "Pagos aún no disponibles", "chargeMethods": [], "payoutsEnabled": false, "refundsEnabled": false },
  "pendingThisMonth": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "upcomingTripsCount": 1,
  "recent": [
    {
      "key": "request:a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      "kind": "pending_request",
      "requestId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      "bookingId": null,
      "paymentId": null,
      "driver": { "id": "2d9f4a71-6c3b-4e58-8a07-b1e4c9d35f22", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
      "trip": { "tripId": "c4a8e2b0-1d57-4f93-a6c8-72e5b9d01a34", "departureAt": "2026-10-12T05:25:00.000Z", "originLabel": "Sevilla", "destinationLabel": "Camas" },
      "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" },
      "state": "pending",
      "occurredAt": "2026-10-09T13:38:00.000Z"
    }
  ],
  "paymentMethod": null,
  "platformCommission": { "status": "pending_definition", "passengerRateBps": null, "driverRateBps": null }
}
```

Reglas: `pendingThisMonth` suma los pendientes (solicitud en `payment_pending` sin intento, o pago en `requires_action`/`processing`) con salida del viaje en el mes;
si alguno no tiene importe definido → `pending_definition`; sin pendientes → `{cents:0,status:"defined"}`. Variante con datos (pantalla 33b, **ejemplo de forma**):
`pendingThisMonth={cents:2400,status:"defined"}`, filas con `state:"pending"` («Pendiente») y `state:"paid"` («Pagado») y `paymentMethod` = `{ "title":"Cuenta bancaria", "maskedLabel":"ES** **** **** 4589", … }`.

### 5.2 `GET /v1/me/payments?state=&cursor=&limit=` → `Page<PassengerPaymentItem>`

«Ver todos». `state` ∈ `pending|under_review|paid|partially_refunded|refunded|failed|expired`. Orden `occurredAt` descendente. Solo los pagos del propio usuario.

| `state` | Chip (texto sugerido) | Cuándo |
|---|---|---|
| `pending` | «Pendiente» | solicitud aceptada sin intento de pago, o pago `requires_action`/`processing` |
| `under_review` | «En revisión» | el pasajero ya pagó pero hay algo que decidir: pago tardío sin plaza, importe distinto, pago duplicado (`outcome` ≠ `booking_confirmed`) o una devolución en `pending_review`/`approved`/`executing`/`failed`. La UI no promete ni plaza ni devolución |
| `paid` | «Pagado» | pago confirmado por el servidor con reserva, sin devoluciones |
| `partially_refunded` | «Devuelto parcialmente» | el proveedor confirmó una devolución parcial y no queda nada en trámite |
| `refunded` | «Devuelto» | pago devuelto íntegramente |
| `failed` / `expired` | «Fallido» / «Caducado» | el proveedor informó el fallo / el intento caducó |

### 5.3 `GET /v1/me/payments/driver-summary?month=YYYY-MM` → `DriverPaymentsSummary`

Estado actual (conductora con 4 viajes realizados pero sin importes derivables porque la economía no está activada):

```json
{
  "month": "2026-10",
  "availability": { "enabled": false, "status": "provider_disabled", "message": "Pagos aún no disponibles", "chargeMethods": [], "payoutsEnabled": false, "refundsEnabled": false },
  "toCollectThisMonth": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "completedTripsCount": 4,
  "nextPayout": { "status": "pending_definition", "date": null, "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" } },
  "recent": [],
  "payoutAccount": null,
  "platformCommission": { "status": "pending_definition", "passengerRateBps": null, "driverRateBps": null }
}
```

`toCollectThisMonth` = neto del conductor (libro mayor) de reservas cuyo viaje se completó en el mes y que aún no se han abonado (`available` + `in_payout`).
Sin asientos de libro y con viajes completados y sin tarifa aprobada → `pending_definition`; sin viajes → `0 defined`.
`nextPayout.date` es `null` («Por definir») mientras no exista una liquidación programada.

### 5.4 `GET /v1/me/earnings?state=&cursor=&limit=` → `Page<DriverEarningItem>` · 5.5 `GET /v1/me/earnings/{bookingId}` → `DriverEarningDetail`

Solo el conductor del viaje (otro → `404 BOOKING_NOT_FOUND`). `state` ∈ `pending|available|in_payout|paid_out` («Pendiente», «Por cobrar», «En liquidación», «Cobrado»).
Los cobros se **derivan del libro mayor** (cuenta `driver_payable` del conductor, por reserva), nunca de la cotización: sin asientos no hay cobros. No son cobros (y no se listan) las reservas
`cancelled`, `driver_cancelled` y `no_show` —su importe está en revisión, sus consecuencias no están definidas— ni las que quedaron con neto 0 por una devolución íntegra.
`available` = reserva `completed` que aún no está en ninguna liquidación; `in_payout` = en una liquidación no `paid`; `paid_out` = en una liquidación `paid`.

```json
{
  "bookingId": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  "passenger": { "id": "7b1e0c52-3f64-4a8e-9d21-0c5a8b6f4e10", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
  "trip": { "tripId": "c4a8e2b0-1d57-4f93-a6c8-72e5b9d01a34", "departureAt": "2026-10-12T05:25:00.000Z", "originLabel": "Sevilla", "destinationLabel": "Tomares" },
  "net": { "cents": 1800, "currency": "EUR", "status": "defined" },
  "state": "paid_out",
  "occurredAt": "2026-10-12T05:58:00.000Z",
  "lines": {
    "contribution": { "cents": 1800, "currency": "EUR", "status": "defined" },
    "driverCommission": { "cents": 0, "currency": "EUR", "status": "defined" },
    "refundAdjustments": { "cents": 0, "currency": "EUR", "status": "defined" },
    "net": { "cents": 1800, "currency": "EUR", "status": "defined" }
  },
  "payoutId": "e0f1a2b3-c4d5-4e6f-8a7b-9c0d1e2f3a4b"
}
```
(Ejemplo de forma con importes ilustrativos. El conductor nunca ve comisión, procesamiento ni impuestos del pasajero, ni su método de pago.)

---

## 6. Métodos de pago

### 6.1 `GET /v1/me/payment-methods?purpose=charge|payout` → `PaymentMethodsResponse`

Estado actual (lista vacía, proveedor desactivado):

```json
{ "items": [], "availability": { "enabled": false, "status": "provider_disabled", "message": "Pagos aún no disponibles", "chargeMethods": [], "payoutsEnabled": false, "refundsEnabled": false } }
```

Con proveedor (ejemplo de forma, cuenta del conductor):
```json
{ "items": [ { "id": "b7c8d9e0-f1a2-4b3c-8d4e-5f6a7b8c9d0e", "purpose": "payout", "kind": "bank_account", "brand": null, "last4": "4589", "country": "ES", "expMonth": null, "expYear": null, "title": "Cuenta bancaria", "maskedLabel": "ES** **** **** 4589", "isDefault": true, "status": "active", "createdAt": "2026-09-30T09:12:00.000Z" } ], "availability": { "enabled": true, "status": "enabled", "message": null, "chargeMethods": ["apple_pay", "card"], "payoutsEnabled": true, "refundsEnabled": true } }
```

### 6.2 `POST /v1/me/payment-methods` → `201 PaymentMethod`

`Idempotency-Key` obligatoria. Cuerpo `AddPaymentMethodRequest`: `{ "purpose": "charge", "providerToken": "<token del SDK>", "setAsDefault": true }`.
Errores: `409 PAYMENTS_PROVIDER_DISABLED` (estado actual) · `400 RAW_CARD_DATA_REJECTED` (el token parece un número de tarjeta; **no** se registra ni se almacena) ·
`409 PAYMENT_METHOD_NOT_AVAILABLE` (el proveedor rechaza el token) · `502 PAYMENT_PROVIDER_ERROR`. El primer método de cada finalidad queda como predeterminado.

### 6.3 `DELETE /v1/me/payment-methods/{methodId}` → `{ "removed": true }`

Solo el propietario (otro → `404 PAYMENT_METHOD_NOT_FOUND`). Desvincula en el proveedor y marca el método como retirado (se conserva el registro, no se muestra). Si era el predeterminado, el más reciente restante lo pasa a ser.
No se puede quitar un método usado por un pago abierto: `409 PAYMENT_ALREADY_OPEN`.

---

## 7. Recibos y liquidaciones

### 7.1 Recibos: `GET /v1/me/receipts?kind=payment|refund|earning_statement` → `Page<ReceiptSummary>` · `GET /v1/me/receipts/{receiptId}` → `Receipt` · `GET /v1/me/receipts/{receiptId}/printable` → `text/html`

Los recibos son **justificantes no fiscales** emitidos tras un evento confirmado por el servidor (pago confirmado, devolución ejecutada, abono pagado). **No son facturas**: no hay decisión fiscal ni de numeración
de facturación (ver §15). Cada uno lleva un `number` correlativo anual `MVC-J-AAAA-NNNNNN` y es inmutable. Ejemplo (**de forma**, tras un pago confirmado bajo tarifa aprobada):

```json
{
  "id": "d1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a",
  "number": "MVC-J-2026-000012",
  "kind": "payment",
  "issuedAt": "2026-10-09T13:39:41.000Z",
  "total": { "cents": 1800, "currency": "EUR", "status": "defined" },
  "trip": { "tripId": "c4a8e2b0-1d57-4f93-a6c8-72e5b9d01a34", "departureAt": "2026-10-12T05:25:00.000Z", "originLabel": "Sevilla Centro", "destinationLabel": "Isla Mágica" },
  "counterpart": { "id": "2d9f4a71-6c3b-4e58-8a07-b1e4c9d35f22", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
  "bookingId": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
  "paymentId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f",
  "fiscalInvoice": false,
  "lines": [
    { "key": "contribution", "amount": { "cents": 1800, "currency": "EUR", "status": "defined" } },
    { "key": "platform_fee", "amount": { "cents": 0, "currency": "EUR", "status": "defined" } }
  ],
  "notice": "Justificante de pago no fiscal emitido por MVC. No es una factura."
}
```
La versión imprimible es HTML autocontenido (sin scripts, texto escapado), apto para `expo-print`/WebView, con `Content-Type: text/html; charset=utf-8`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff` y
`Content-Security-Policy: default-src 'none'`. La generación de PDF queda **fuera de alcance** (la app puede imprimir el HTML a PDF).
La numeración `MVC-J-AAAA-NNNNNN` es correlativa **sin huecos** por año (contador bloqueado en la misma transacción que emite el recibo) y los recibos son inmutables (triggers de solo-añadir).
Mientras el proveedor está desactivado no existe ningún pago confirmado y la lista es `{ "items": [], "nextCursor": null }`.

### 7.2 `GET /v1/me/payouts` → `MyPayoutsResponse` · `GET /v1/me/payouts/{payoutId}` → `PayoutDetail`

Liquidación mensual al conductor. Estado actual:

```json
{
  "items": [],
  "nextCursor": null,
  "availability": { "enabled": false, "status": "provider_disabled", "message": "Pagos aún no disponibles", "chargeMethods": [], "payoutsEnabled": false, "refundsEnabled": false },
  "schedule": { "frequency": "monthly", "dayStatus": "pending_definition", "dayOfMonth": null },
  "nextPayout": { "status": "pending_definition", "date": null, "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" } },
  "payoutAccount": null
}
```
Una liquidación (`PayoutView`) agrupa el neto disponible de las reservas **completadas** del mes natural `period` (una por conductor y mes). `scheduledFor=null` = «Por definir». Ver máquina de estados §10.4 y reglas de generación en §8.6.

---

## 8. Cancelación y devoluciones

### 8.1 `GET /v1/bookings/{bookingId}/cancellation-preview` → `CancellationPreview`

Solo el pasajero de la reserva (otro → `404 BOOKING_NOT_FOUND`). **No existe política de cancelación aprobada**, por lo que la respuesta actual es:

```json
{
  "booking": {
    "id": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
    "status": "confirmed",
    "seats": 1,
    "trip": { "tripId": "c4a8e2b0-1d57-4f93-a6c8-72e5b9d01a34", "departureAt": "2026-10-12T05:25:00.000Z", "originLabel": "Sevilla Centro", "destinationLabel": "Isla Mágica" },
    "driver": { "id": "2d9f4a71-6c3b-4e58-8a07-b1e4c9d35f22", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
    "paid": { "cents": 400, "currency": "EUR", "status": "defined" }
  },
  "canCancel": true,
  "blocked": null,
  "scenario": "passenger_cancellation",
  "reasons": ["no_longer_needed", "schedule_change", "found_other_option", "other"],
  "policy": { "status": "pending_review", "version": null, "effectiveFrom": null, "summary": null },
  "lines": [
    { "key": "trip_contribution", "amount": { "cents": 400, "currency": "EUR", "status": "defined" }, "noteCode": "subject_to_conditions" },
    { "key": "platform_fee", "amount": { "cents": null, "currency": "EUR", "status": "pending_definition" }, "noteCode": "policy_pending_review" }
  ],
  "proposedRefund": { "cents": null, "currency": "EUR", "status": "pending_definition" },
  "decisionMode": "admin_review",
  "legalNotice": "Si corresponde, los reembolsos obligatorios por ley se realizarán según la normativa vigente."
}
```

(«Aporte del viaje 4,00 € · Según condiciones», «Gestión de la plataforma · Por definir · Política pendiente de revisión».) La app **no puede prometer** ningún reembolso mientras `policy.status="pending_review"`.
Con una política aprobada **aceptada al pagar** (versión guardada en el pago): `policy.status="approved"`, `proposedRefund` y `lines[].amount` `defined`, `noteCode:"per_policy"`.
Si el viaje ya empezó (`trips.status='active'` o recogida verificada): `canCancel=false`, `blocked={code:"TRIP_ALREADY_STARTED",…}` (la consecuencia económica de «viaje ya iniciado» **no está definida**; el pasajero usa incidencias/soporte).
`blocked.code` ∈ `BOOKING_ALREADY_CANCELLED|BOOKING_NOT_CANCELLABLE|TRIP_ALREADY_STARTED` (`CancellationBlockCode`); viajan dentro de un `200`, no como error HTTP.

### 8.2 `POST /v1/bookings/{bookingId}/cancel` → `CancelBookingResponse`

`Idempotency-Key` obligatoria. Cuerpo: `{ "reason": "schedule_change", "note": "opcional, máx. 500" }`. Efectos (una transacción): reserva → `cancelled`; solicitud → `cancelled` (libera la capacidad de los segmentos y permite volver a solicitar);
si quedara un hold activo se libera; **se crea una propuesta de devolución `pending_review`** si hubo importe pagado; auditoría; aviso al conductor.
La respuesta **no** dice que se devolverá dinero: dice que hay una propuesta en revisión.

```json
{
  "booking": { "id": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b", "status": "cancelled" },
  "refund": {
    "id": "f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c",
    "status": "pending_review",
    "origin": "passenger_cancellation",
    "bookingId": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
    "requestId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    "paymentId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f",
    "paid": { "cents": 400, "currency": "EUR", "status": "defined" },
    "proposedRefund": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "approvedRefund": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "platformFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "finalPassengerCost": { "cents": null, "currency": "EUR", "status": "pending_definition" },
    "executionStatus": "not_started",
    "policy": { "status": "pending_review", "version": null, "effectiveFrom": null, "summary": null },
    "createdAt": "2026-10-09T14:02:11.000Z",
    "decidedAt": null,
    "refundedAt": null
  },
  "alreadyCancelled": false
}
```

Errores: `404 BOOKING_NOT_FOUND` · `409 BOOKING_NOT_CANCELLABLE` (completada, `driver_cancelled`, `no_show`) · `409 TRIP_ALREADY_STARTED` · `422 IDEMPOTENCY_KEY_REUSED`.
Reintentar sobre una reserva ya cancelada por el mismo pasajero devuelve `200` con `alreadyCancelled:true` y la propuesta existente (sin duplicar nada). El aviso `refund_proposal_created` al pasajero solo existe en la cancelación del pasajero (§13).

### 8.3 `POST /v1/bookings/{bookingId}/driver-cancel` → `CancelBookingResponse`

Conductor del viaje (otro → `404 BOOKING_NOT_FOUND`). Cuerpo `{ "reason": "vehicle_issue" }`. Reserva → `driver_cancelled`, solicitud → `cancelled`,
propuesta `origin:"driver_cancellation"` en `pending_review` (**las consecuencias de la cancelación del conductor y del no-show no están definidas**: nunca se resuelven solas), aviso `booking_cancelled_by_driver` al pasajero (no `refund_proposal_created`). No se aplica ninguna política de cancelación del pasajero a esta cancelación.

### 8.4 `GET /v1/me/refunds` → `Page<RefundView>`

Devoluciones del pasajero (propuestas y decididas). El pasajero ve `refundedAt` solo si el proveedor confirmó la devolución.

### 8.5 Panel de finanzas (`finance_admin` | `admin`)

`GET /v1/admin/refund-proposals?tab=all|cancelled|refunded&status=&origin=&period=7d|30d|90d|365d|all&provinceCode=&cursor=&limit=` → `AdminRefundList`
(`tab=cancelled` = abiertas: `pending_review|approved|executing|failed`; `tab=refunded` = `refunded`; `all` = todas; `counts` respeta `period` y `provinceCode` pero no `tab`). Cada llamada materializa
las consecuencias pendientes de otros módulos (reservas `cancelled`/`driver_cancelled`/`no_show` sin registro) de forma idempotente. Ejemplo (pantalla 39a, **ejemplo de forma**: el importe pagado es ilustrativo):

```json
{
  "items": [
    {
      "id": "f2a3b4c5-d6e7-4f8a-9b0c-1d2e3f4a5b6c",
      "status": "pending_review",
      "origin": "passenger_cancellation",
      "bookingId": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
      "requestId": "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
      "paymentId": "9c8d7e6f-5a4b-4c3d-8e2f-1a0b9c8d7e6f",
      "paid": { "cents": 500, "currency": "EUR", "status": "defined" },
      "proposedRefund": { "cents": null, "currency": "EUR", "status": "pending_definition" },
      "approvedRefund": { "cents": null, "currency": "EUR", "status": "pending_definition" },
      "platformFee": { "cents": null, "currency": "EUR", "status": "pending_definition" },
      "finalPassengerCost": { "cents": null, "currency": "EUR", "status": "pending_definition" },
      "executionStatus": "not_started",
      "policy": { "status": "pending_review", "version": null, "effectiveFrom": null, "summary": null },
      "createdAt": "2026-10-05T06:26:00.000Z",
      "decidedAt": null,
      "refundedAt": null,
      "passenger": { "id": "7b1e0c52-3f64-4a8e-9d21-0c5a8b6f4e10", "displayName": "Miguel Torres", "firstName": "Miguel", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
      "driver": { "id": "2d9f4a71-6c3b-4e58-8a07-b1e4c9d35f22", "displayName": "Ana García López", "firstName": "Ana", "photoUrl": null, "ratingAverage": null, "ratingCount": 0 },
      "trip": { "tripId": "c4a8e2b0-1d57-4f93-a6c8-72e5b9d01a34", "departureAt": "2026-10-05T06:12:00.000Z", "originLabel": "Sevilla - Los Bermejales", "destinationLabel": "Sevilla - Cartuja (Universidad)" },
      "cancelledBy": "passenger",
      "cancelledAt": "2026-10-05T06:26:00.000Z",
      "cancelReason": "schedule_change",
      "cancelNote": null,
      "decision": null
    }
  ],
  "nextCursor": null,
  "counts": { "all": 12, "cancelled": 5, "refunded": 3 }
}
```

(En el diseño «Devolución propuesta 5,00 €» y «Coste final pasajero 0,00 €» son ilustrativos: sin política aprobada la propuesta es `pending_definition` y finanzas fija el importe al aprobar.)

- `GET /v1/admin/refund-proposals/{id}` → `AdminRefundDetail` (añade `payment`, `maxRefundable`, `ledger`).
- `POST …/{id}/approve` `{ "approvedCents": 500, "note": "Cancelación con antelación; criterio caso a caso" }` → `AdminRefundItem`. El cuerpo es opcional (sin cuerpo equivale a `{}` y se aprueba el importe propuesto). Reglas: la propuesta debe estar en `pending_review`; `approvedCents` es obligatorio si la propuesta es `pending_definition`
  y debe cumplir `1 ≤ approvedCents ≤ maxRefundable`; `note` es obligatoria si no hay política aplicable o si se cambia el importe propuesto. Sin política el motivo queda como `decision.basis="manual_without_policy"`.
  Efectos (misma transacción): estado `approved`, asiento de libro «devolución aprobada» (reparto proporcional **solo entre los componentes del cobro**, p. ej. 500 sobre [950, 150] → 432/68; las liquidaciones no cuentan), auditoría, aviso al pasajero. Con proveedor activo se solicita la devolución al proveedor (`executing`);
  con el proveedor desactivado queda `approved` + `executionStatus:"awaiting_provider"` (**no se marca como devuelta**). `refunded` solo llega con el evento firmado `refund.succeeded`.
- `POST …/{id}/reject` `{ "note": "Fuera de condiciones" }` → `AdminRefundItem` (`rejected`, aviso al pasajero; la nota es obligatoria).
- `POST …/{id}/execute` → `AdminRefundItem`: reintenta pedir la devolución aprobada al proveedor (`approved` con `awaiting_provider`, o `failed`); en cualquier otro estado `409 REFUND_NOT_EXECUTABLE` (se evalúa primero). `409 PAYMENTS_PROVIDER_DISABLED` mientras no haya proveedor.
- Errores comunes: `401 AUTH_REQUIRED` · `403 AUTH_FORBIDDEN` (cualquier rol que no sea `finance_admin`/`admin`: `passenger`, `driver`, `support_admin`, `verification_admin`) · `404 REFUND_NOT_FOUND` · `409 REFUND_NOT_PENDING` ·
  `400 REFUND_AMOUNT_REQUIRED` · `400 REFUND_AMOUNT_EXCEEDS_PAID` · `400 REFUND_NOTE_REQUIRED` · `409 REFUND_NO_PAYMENT_RECORD` (no hay pago registrado en MVC que devolver) · `409 REFUND_NOT_EXECUTABLE` y `409 PAYMENTS_PROVIDER_DISABLED` (solo `execute`).
  Concurrencia: aprobaciones simultáneas de la **misma** propuesta con claves distintas → una gana y el resto `409 REFUND_NOT_PENDING`; dos propuestas del **mismo pago** que a la vez superarían lo cobrado → la segunda `400 REFUND_AMOUNT_EXCEEDS_PAID` con `details.maxRefundableCents`. Lo devuelto nunca supera lo cobrado.

### 8.6 Liquidaciones (finanzas)

- `GET /v1/admin/payout-runs?period=2026-10&status=draft` → `Page<AdminPayoutRun>`.
- `POST /v1/admin/payout-runs` `{ "period": "2026-10" }` → `201 GeneratePayoutRunsResponse`: crea una liquidación `draft` por conductor con neto **positivo** de reservas `completed` cuyo viaje se completó en ese mes natural (`Europe/Madrid`) y que no estén ya en otra liquidación
  (un conductor y mes → una sola; idempotente). `scheduledFor` queda `null` («Por definir») hasta que se apruebe un calendario.
  Neto de la liquidación = `min(suma de las reservas elegibles, saldo del conductor − liquidaciones abiertas)`: si se devolvió dinero ya liquidado («payout ya enviado») el saldo negativo se compensa aquí, de modo que el neto puede ser menor que la suma de sus reservas
  (la API no expone todavía una línea de ajuste) y, si el saldo no alcanza, no se genera liquidación y el conductor cuenta en `skipped`.
  **Limitación conocida:** una reserva cuyo viaje se completa *después* de generar la liquidación de su mes no se añade a ella (el conductor cuenta como `skipped`) y se queda en «Por cobrar» sin liquidación; hace falta una política de regularización (ver §15).
- Eventos `payout.paid`/`payout.failed` (§11): `paid` solo si el importe del evento coincide con el neto; `failed` permite volver a ejecutar con una nueva clave derivada del proveedor (contador de intentos). Al pasar a `paid` se emite el recibo `earning_statement` y el aviso `payout_paid`.
- `POST /v1/admin/payout-runs/{id}/execute` → `AdminPayoutRun`: pide el abono al proveedor (`processing`). `409 PAYMENTS_PROVIDER_DISABLED` hoy; `409 PAYOUT_ACCOUNT_REQUIRED` si el conductor no tiene cuenta de cobro activa; `409 PAYOUT_NOT_EXECUTABLE` si no está en `draft`/`failed`. `paid` llega solo con el evento firmado `payout.paid`.

---

## 9. Planes (pantalla 32)

`GET /v1/plans` → `PlansResponse` (público; no hay endpoint de compra) y `GET /v1/me/plan` → `MyPlanResponse` (`free` para todos).

```json
{
  "items": [
    { "code": "free", "name": "Cuenta gratuita", "tagline": "Uso ocasional", "status": "active",
      "features": ["Buscar y reservar plazas", "Guardar destinos y rutina", "Mensajería con otros usuarios", "Gestionar tus viajes básicos"],
      "economicsNote": null, "availabilityNote": null, "price": { "cents": 0, "currency": "EUR", "status": "defined" } },
    { "code": "premium_driver", "name": "Premium Conductor", "tagline": "Para rutas regulares", "status": "proposal",
      "features": ["Gestionar tus plazas semanales", "Visibilidad en rutas frecuentes", "Historial de viajes y pasajeros", "Liquidación mensual de trayectos", "Soporte prioritario"],
      "economicsNote": { "title": "Cuota y comisiones por definir", "detail": "Propuesta en fase de estudio." }, "availabilityNote": null,
      "price": { "cents": null, "currency": "EUR", "status": "pending_definition" } },
    { "code": "membership", "name": "Membresía", "tagline": "Próximamente", "status": "unavailable",
      "features": [], "economicsNote": null,
      "availabilityNote": "Más opciones y ventajas para usuarios frecuentes. Esta funcionalidad no está disponible por el momento.",
      "price": { "cents": null, "currency": "EUR", "status": "pending_definition" } }
  ]
}
```
`GET /v1/me/plan` → `{ "planCode": "free", "status": "active", "purchasable": false }`. Premium Conductor se muestra como «Propuesta» y Membresía como «No disponible por el momento»: no se puede contratar ninguna.

---

## 10. Máquinas de estado

### 10.1 Pago (`payments.status`) — lo mueve **solo** el servidor, por eventos del proveedor

```
requires_action ──► processing ──► succeeded ──► refunded   (refunded = devuelto íntegramente; devoluciones parciales: succeeded + refunded.cents>0)
        │                 │             ▲
        ├────────────────►├──► failed ──┘ (un `succeeded` tardío tras `failed`/`expired` SÍ se aplica: el dinero se cobró)
        └──► expired ◄────┘
```
- Rango por evento; un evento de rango menor al estado actual se ignora (`ignored_stale`); `failed`/`expired` tras `succeeded` se ignora y se registra el conflicto (`ignored_conflict`). El resultado interno queda en `payment_events.outcome`
  (`applied|ignored_stale|ignored_conflict|ignored_unsupported|compensation_created`) con un `detail` JSON (p. ej. `reason:"amount_mismatch"`, `eventCents`).
- `succeeded` exige importe y moneda iguales a los del intento; si no, **no se crea reserva** (`outcome:"amount_mismatch"`, revisión manual).
- A lo sumo **un pago abierto** (`requires_action|processing`) por solicitud.

### 10.2 Éxito del pago → reserva (misma transacción que el evento)

1. Bloqueo de solicitud → pago → hold (mismo orden que el motor de reservas).
2. Solicitud `payment_pending` y hold `active` con `expires_at > now()` → reserva `confirmed` (con `bookings.provider_payment_id`), hold `consumed`, solicitud `confirmed`, asientos de libro, recibo.
3. Hold caducado/liberado o solicitud ya no pagable → **sin reserva**: solicitud `payment_late`, fila en `payment_compensations` (`refund_required`, `pending`), asiento en cuenta de suspenso y propuesta de devolución íntegra (`late_payment`).
4. Ya existe reserva con otro pago → compensación `duplicate_payment`.

### 10.3 Devolución (`refund_requests.status`)

```
pending_review ──approve──► approved ──(proveedor activo)──► executing ──refund.succeeded──► refunded
      │                        │  (proveedor desactivado: executionStatus=awaiting_provider)      └─refund.failed─► failed ─(execute)─► executing
      └──reject──► rejected
```

### 10.4 Liquidación (`payout_runs.status`)

`draft ──execute──► processing ──payout.paid──► paid` · `processing ──payout.failed──► failed ──execute──► processing` · `draft|failed ──► cancelled` (reservado).

### 10.5 Política de cancelación (`cancellation_policies.status`)

`draft → pending_review → approved → retired`. **Hoy no hay ninguna aprobada.** El pago guarda la política aprobada vigente al pagar (`payments.cancellation_policy_id`); si era `null`, la cancelación posterior se trata siempre como `pending_review` aunque luego se apruebe una política.
No existe regla absoluta «MVC conserva su comisión»: cualquier retención es **dato** de una política aprobada (`rules[].refundCommissionBps`).

## 11. Webhook de pagos — `POST /v1/webhooks/payments`

Servidor a servidor. Sin Bearer. Cuerpo **crudo** (la firma se calcula sobre los bytes recibidos). Esqueleto genérico de firma (`src/modules/money/provider/webhook-signature.ts`), que el adaptador del proveedor reutiliza o sustituye:

```
X-Webhook-Signature: t=<unix segundos>,v1=<hex HMAC-SHA256(secreto, "<t>." + cuerpoCrudo)>[,v1=<hex con el secreto anterior>]
```
- Tolerancia de reloj: 300 s. Comparación en tiempo constante.
- **Sin `PAYMENTS_WEBHOOK_SECRET` configurado ⇒ rechazo siempre** (`503 PAYMENTS_WEBHOOK_NOT_CONFIGURED`); con proveedor desactivado también. Firma inválida/ausente/caducada ⇒ `401 WEBHOOK_SIGNATURE_INVALID`. Cuerpo no interpretable ⇒ `400 WEBHOOK_PAYLOAD_INVALID`.
- Límite de tasa propio de la ruta; no se registran cuerpos en logs.
- El adaptador traduce el cuerpo del proveedor a eventos normalizados (`provider`, `eventId`, `type`, referencia del objeto, `occurredAt`, importe, moneda, código de fallo). Tipos: `payment.requires_action|processing|succeeded|failed|expired`, `refund.succeeded|failed`, `payout.paid|failed`.
- **Idempotencia**: `payment_events` tiene `unique(provider, provider_event_id)`; el evento y sus efectos se confirman en una sola transacción. Un duplicado devuelve `200` con `result:"duplicate"` y no repite efectos.
- **Fuera de orden / tardíos**: rango de estados (§10.1). Un `succeeded` posterior a un `failed`/`expired` o a la caducidad del hold se procesa (§10.2).
- **Objeto desconocido** (p. ej. el evento llega antes de que se confirme la transacción que creó el intento): `409 PAYMENT_UNKNOWN` sin guardar nada, para que el proveedor reintente.

Respuesta `200`: `{ "received": true, "results": [ { "eventId": "evt_1", "result": "applied" } ] }`. `result` ∈ `applied` | `duplicate` | `ignored`; con `ignored` va un `reason`: `stale` (llegó tarde o fuera de orden), `conflict` (contradice el estado, p. ej. importe distinto o devolución no aprobada) o `unsupported`.
Un pago que se cobra sin poder crear la reserva se informa como `{ "result": "applied", "reason": "compensation_created" }` (no se perdió dinero ni plaza: ver §10.2).
El webhook vive en su propio contexto Fastify para conservar el cuerpo **crudo** (cualquier tipo de contenido llega como `Buffer`, máx. 256 KiB) y tiene su propio límite de tasa (300/min).

## 12. Libro mayor (ledger)

Solo-añadir (triggers impiden `UPDATE`/`DELETE`), céntimos enteros con signo, cada transacción suma **0** (trigger diferido) y tiene una clave idempotente única (`tx_key`).
Cuentas: `passenger` (quien paga, usuario), `driver_payable` (usuario), `platform_revenue`, `processing_fees`, `tax_payable`, `suspense` (cobrado sin reserva), `refund_payable` (usuario), `external_payout` (usuario).

| Evento | Asientos (suma 0) |
|---|---|
| Pago confirmado y reserva creada | `passenger −T`, `driver_payable +(C−Dc)`, `platform_revenue +(Pc+Dc)`, `processing_fees +Pr`, `tax_payable +Tx` (T = C+Pc+Pr+Tx) |
| Pago tardío (sin reserva) | `passenger −T`, `suspense +T` |
| Devolución aprobada (R) | reparto proporcional de R entre las cuentas del cobro (o `suspense`) en negativo y `refund_payable +R` |
| Devolución ejecutada (evento `refund.succeeded`) | `refund_payable −R`, `passenger +R` |
| Liquidación pagada (evento `payout.paid`) | `driver_payable −X`, `external_payout +X` |

Las comisiones son 0 mientras no haya tarifa aprobada (en la práctica no se llega a cobrar sin tarifa: no hay importe). Reglas de redondeo del reparto proporcional: método del mayor resto; el resto desempata a favor de la cuenta de mayor importe.
`driver_payable` puede quedar negativo si se devuelve dinero ya liquidado («payout ya enviado»): el saldo negativo se compensa en la siguiente liquidación (no se genera liquidación con neto ≤ 0; ver §8.6).
**Despliegue:** los triggers de solo-añadir bloquean `UPDATE`/`DELETE` fila a fila pero no `TRUNCATE`; el rol de base de datos de la aplicación no debe tener el privilegio `TRUNCATE` sobre `ledger_entries`, `ledger_transactions` ni `receipts`.

## 13. Notificaciones in-app emitidas (`notify()`)

| Destinatario | `category` / `kind` | Cuándo |
|---|---|---|
| Pasajero | `payment` / `payment_confirmed` | pago confirmado y plaza reservada |
| Conductor | `trip` / `booking_confirmed` | reserva creada por pago confirmado |
| Pasajero | `payment` / `payment_failed` | pago fallido con la solicitud aún pagable |
| Pasajero | `payment` / `payment_late_refund_pending` | pago tardío: sin plaza, devolución en trámite |
| Pasajero | `payment` / `payment_under_review` | pago recibido con importe distinto o duplicado: revisión manual de Administración |
| Conductor | `trip` / `booking_cancelled` | el pasajero cancela |
| Pasajero | `trip` / `booking_cancelled_by_driver` | el conductor cancela |
| Pasajero | `payment` / `refund_proposal_created` | el pasajero cancela y se crea una propuesta de devolución (la cancelación del conductor avisa con `booking_cancelled_by_driver`) |
| Pasajero | `payment` / `refund_approved` · `refund_rejected` · `refund_completed` | decisión de finanzas / devolución confirmada por el proveedor |
| Conductor | `payment` / `payout_paid` | abono confirmado por el proveedor |

## 14. Autorización (resumen)

| Recurso | Quién puede leer/actuar |
|---|---|
| Contexto de pago, intento, pago | el pasajero pagador (otros → 404) |
| Cobros y liquidaciones | el conductor del viaje (otros → 404); nunca ven datos de pago del pasajero |
| Métodos, recibos, devoluciones propias | su propietario (otros → 404) |
| Cancelar reserva | pasajero de la reserva; `driver-cancel`: conductor del viaje |
| `/v1/admin/**` | `finance_admin`, `admin` (los demás roles, incluido `support_admin`, → `403 AUTH_FORBIDDEN` y auditoría `admin.access_denied`) |
| Webhook | solo con firma válida del proveedor |

## 15. Estado honesto, decisiones y bloqueos pendientes

**Implementado y probado** (base real PostgreSQL/PostGIS, ver §16):
- Las 31 rutas con su contrato: schemas Fastify, autenticación, `Idempotency-Key`, catálogo de errores (§1.1), avisos (§13) y tipos de la app comparados automáticamente con este documento.
- Intento de pago idempotente con importe tomado de la cotización congelada del servidor; con el proveedor desactivado `409 PAYMENTS_PROVIDER_DISABLED` y nada se marca como pagado.
- Webhook firmado: sin secreto se rechaza, idempotencia por `(provider, eventId)` también bajo concurrencia, eventos duplicados y fuera de orden, pago tardío → compensación y devolución propuesta **sin sobre-reserva**.
- Cancelación con política pendiente (`pending_review`, importes «Por definir», sin promesa de reembolso), con política aprobada aceptada al pagar, cancelación del conductor y consecuencias de `no_show`.
- Devoluciones: matriz de permisos (`finance_admin`/`admin` sí; `passenger`, `driver`, `support_admin`, `verification_admin` y sin sesión no), límite de lo devuelto bajo concurrencia, `refunded` solo con el evento firmado.
- Libro mayor de solo-añadir con asientos que suman 0 (restricciones de base de datos y propiedades con semillas fijas), recibos no fiscales con numeración sin huecos y versión imprimible.
- Resúmenes de «Mis pagos y cobros», cobros derivados del libro mayor, liquidaciones mensuales (generar, pedir, confirmar o fallar por evento firmado, compensación de dinero ya abonado), métodos de pago solo tokenizados, planes sin compra.

**Implementado, pendiente de verificar (necesita un proveedor real):**
- El esqueleto de firma (`webhook-signature.ts`) y la traducción de eventos se han ejercitado solo con un proveedor simulado que vive en `tests/money-support.ts` (`StubPaymentProvider`; no existe en código de producción). Un adaptador real debe traer su propio esquema de firma y cuerpo y pasar su propia batería.
- Ningún flujo se ha probado contra un proveedor, un SDK móvil ni importes de una tarifa real.
- Despliegue: los triggers de solo-añadir no bloquean `TRUNCATE` (ver §12); hay que retirar ese privilegio al rol de la aplicación.

**Bloqueado (decisión/credencial externa; NO se ha elegido proveedor):**
1. **Proveedor de pagos para marketplace con payouts a terceros** (MVC no debe custodiar fondos fuera de un proveedor regulado). Candidatos a evaluar, sin preferencia: Stripe Connect, Adyen for Platforms, Mangopay, Mollie (Connect), Checkout.com (Platforms), Lemon Way. Criterios: licencia de dinero electrónico/entidad de pago en la UE, split payments y payouts mensuales, SEPA, Apple Pay/Google Pay, soporte de disputas y KYC/KYB de conductores, coste por transacción, sede/protección de datos (RGPD), documentación de conciliación.
2. Credenciales, cuenta de pruebas del proveedor, URL de webhook y secreto (`PAYMENTS_WEBHOOK_SECRET`) y adaptador concreto (`PaymentProvider`).
3. **Economía**: tarifa aprobada (`tariff_versions.status='approved'` + cotización congelada por `trips`). Sin ella no hay importes y el cobro es imposible (`PAYMENT_AMOUNT_NOT_DEFINED`).
4. **Política de cancelación** versionada y validada jurídica/comercialmente (incluye si MVC retiene comisión y en qué supuestos; cancelación del conductor, no-show, fuerza mayor, viaje iniciado, pago realizado/no liquidado, payout enviado). Hoy `cancellation_policies` está vacía.
5. **Calendario de abonos** (día del mes) y periodicidad semanal de cobro al pasajero («cuando el modelo final lo permita»).
6. **Fiscalidad/facturación**: tratamiento de IVA/impuestos sobre comisiones, obligación de factura y numeración, retenciones a conductores (¿actividad económica?), y si el reparto de gastos encaja como «gastos compartidos» en cada caso. Los recibos actuales son justificantes **no fiscales**.
7. ¿Reembolso automático de pagos tardíos sin revisión humana? (hoy: propuesta íntegra `pending_review`).
8. Disputas/contracargos y conciliación con extractos del proveedor: modelo no implementado.
9. Premium/Membresía: precio, cuota y comisiones por definir; no hay compra.
10. **Regularización de liquidaciones**: qué hacer con una reserva que se completa después de generar la liquidación de su mes y con un neto de liquidación menor que la suma de sus reservas por compensaciones (ver «Limitaciones conocidas»).

**No implementado:** cobro semanal con incidencias/no-show (PROMPT_MAESTRO test 8; depende de 3 y 5), disputas, conciliación contra extractos, PDF de recibos, gestión de políticas de cancelación desde el panel (hoy solo por migración/SQL), reintentos automáticos (no hay planificador de tareas), endpoint de compra de planes.

**Limitaciones conocidas (observaciones de diseño):**
1. Una reserva cuyo viaje se completa *después* de generar la liquidación de su mes no entra en ella (el conductor cuenta como `skipped`) y permanece en «Por cobrar» sin liquidación. Habría que permitir completar liquidaciones en `draft` o generar un ajuste.
2. Con compensación de dinero ya abonado el neto de una liquidación puede ser menor que la suma de sus reservas y la API no muestra una línea de ajuste; si lo devuelto iguala o supera lo elegible no se genera liquidación y las reservas siguen figurando «Por cobrar».
3. Los triggers de solo-añadir no detienen `TRUNCATE` (privilegio del rol de la aplicación; ver §12).
4. `support_admin` ve reservas en la matriz de `trust`, pero los endpoints de dinero (`/v1/admin/**`) son solo `finance_admin|admin` por diseño del encargo.

## 16. Pruebas

Base de pruebas `mvc_money` (migraciones 001–019 y 040–045) y, además, una base con **todas** las migraciones de todos los módulos. Comandos:

```
export DATABASE_URL=postgres://<usuario>:<clave>@127.0.0.1:5432/mvc_money
MIGRATIONS_EXCLUDE="020-039,060-099" npm run db:migrate
node --import tsx --test --test-concurrency=1 tests/money.test.ts tests/money-unit.test.ts tests/money-*.integration.test.ts
npm run typecheck
```

| Fichero | Pruebas | Qué demuestra |
|---|---|---|
| `tests/money-unit.test.ts` | 66 | firma HMAC (tiempo constante, tolerancia, secreto ausente), reparto proporcional por mayor resto, desglose, detector de número de tarjeta, motor de política de cancelación, transiciones de estado del pago, claves idempotentes, HTML del recibo, proveedor desactivado y configuración |
| `tests/money-payments.integration.test.ts` | 59 | proveedor desactivado, intento de pago idempotente, webhook (duplicado, fuera de orden, tardío → compensación, concurrencia), autorización |
| `tests/money-cancellation.integration.test.ts` | 26 | vista previa sin y con política, cancelar (pasajero y conductor), consecuencias de `no_show` |
| `tests/money-refunds.integration.test.ts` | 32 | matriz RBAC del panel, aprobar/rechazar/ejecutar, eventos de devolución, límites bajo concurrencia, lista |
| `tests/money-ledger.integration.test.ts` | 34 | restricciones y triggers del libro mayor, asientos del ciclo de vida, propiedades con semillas fijas, recibos (estructura, numeración sin huecos, inmutabilidad, imprimible) |
| `tests/money-reports.integration.test.ts` | 29 | resumen del pasajero, «Ver todos», resumen del conductor, cobros, planes |
| `tests/money-payouts.integration.test.ts` | 41 | liquidaciones (generar, ejecutar, confirmar por evento, compensar), métodos de pago tokenizados |
| `tests/money-http.integration.test.ts` | 18 | inventario de rutas frente a este documento, tipos de la app frente a los schemas, catálogo de errores y avisos, matriz de autenticación e `Idempotency-Key`, OpenAPI, «lo que devuelve el servicio es lo que sale por HTTP» |
| `tests/money.test.ts` | 3 | aritmética de dinero del dominio (preexistente) |

Total 308 pruebas (50 suites), todas en verde contra `mvc_money` y contra la base con todas las migraciones.
