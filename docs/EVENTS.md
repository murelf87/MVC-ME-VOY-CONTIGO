# Contratos de eventos

Tres familias de eventos salen del backend. Todas se escriben en la misma transacción que la
acción que las causa: si la acción se deshace, el evento tampoco existe.

## 1. Avisos al usuario (`user_notifications`)
Se leen con `GET /v1/me/notifications` y se marcan con `POST /v1/me/notifications/read`.
Cada aviso tiene `id`, `kind`, `trip_id`, `payload`, `created_at`, `read_at`, `departure_at` y `as_driver`.
Los nombres viajan en el `payload` para que la bandeja se lea bien aunque el perfil cambie después.
El envío push (APNs/FCM) no está conectado: falta el proveedor (BLOCKERS 6).

| `kind` | Quién lo recibe | `payload` |
|---|---|---|
| `ride_request.received` | Conductor | `requestId`, `passengerName` |
| `ride_request.accepted` | Pasajero | `requestId`, `driverName`, `holdExpiresAt` |
| `ride_request.rejected` | Pasajero | `requestId`, `driverName` |
| `booking.confirmed` | Pasajero y conductor | `bookingId`, `passengerName`, `driverName` |
| `booking.cancelled_by_passenger` | Conductor | `passengerName` |
| `trip.started` | Pasajeros confirmados | `driverName` |
| `trip.driver_arriving` | Pasajero aún no recogido, una sola vez por reserva (≤ 120 s o ≤ 500 m) | `driverName`, `etaS`, `roadDistanceM` |
| `trip.completed` | Pasajeros recogidos y no presentados | `driverName` |
| `trip.cancelled` | Pasajeros afectados | `driverName`, `reason`, `forceMajeure` |
| `route_change.requested` | Conductor | `proposalId`, `passengerName`, `addedDistanceM`, `addedDurationS` |
| `route_change.proposed` | Pasajero confirmado que se retrasaría más que la flexibilidad | `proposalId`, `driverName`, `extraDelayS` |
| `route_change.applied` | Solicitante | `proposalId`, `requestId`, `holdExpiresAt`, `driverName` |
| `route_change.applied` | Conductor y pasajeros consultados | `proposalId`, `passengerName` |
| `route_change.rejected` | Solicitante, conductor y consultados (menos quien rechaza) | `proposalId`, `reason` |
| `report.closed` | Quien reportó | `reportId`, `status`, `note` |

Tipo en código: `NotificationKind` en `src/services/notification-service.ts`. Añadir un `kind` exige
añadir su texto en `mobile/src/screens/NotificationsScreen.tsx`.

## 2. Eventos de pago (proveedor → MVC)
El adaptador de cada proveedor convierte sus webhooks en eventos neutrales
(`InternalPaymentEvent` en `src/payments/types.ts`). Hoy existe el de Stripe.

| `type` | Campos | Efecto |
|---|---|---|
| `payment.succeeded` | `providerPaymentId`, `amountCents`, `requestId` | Confirma la reserva si el hold sigue vivo y el importe coincide con el precio congelado; si no, crea una compensación. Asiento contable `capture`. |
| `refund.succeeded` | `providerPaymentId`, `providerRefundId`, `amountCents` | Cierra el reembolso de una cancelación o compensación. Asiento `refund`. Si llega antes que la cancelación, queda `deferred` y se reintenta. |
| `refund.failed` | `providerPaymentId`, `providerRefundId`, `reason` | Guarda el error en la cancelación para revisión. |
| `dispute.changed` | `providerDisputeId`, `providerPaymentId`, `amountCents`, `status` (`open`/`won`/`lost`), `reason` | Actualiza la disputa; un evento más antiguo no pisa uno más nuevo. `lost` genera un asiento `dispute_lost` una sola vez. |
| `payout.paid` / `payout.failed` | `providerPayoutId`, `payoutId`, `amountCents`, `reason` | Cierra el pago mensual al conductor (`payout_paid`) o devuelve el dinero a su saldo disponible (`payout_failed`). |

Cada webhook se guarda en `payment_provider_events` con clave única `(provider, event_id)`:
repetirlo no hace nada. Estados: `received`, `processed`, `deferred`, `ignored`, `failed`.
Detalle en `docs/PAYMENTS.md`.

## 3. Libro contable (`ledger_transactions`)
Tipos: `capture`, `release`, `refund`, `payout_reserve`, `payout_paid`, `payout_failed`,
`dispute_lost`, `dispute_won`. Cada uno tiene una clave de idempotencia
(`booking:{id}:capture`, `payout:{id}:paid`, `dispute:{id}:lost`…), suma cero y no se puede
modificar ni borrar.

## 4. Auditoría (`audit_events`)
Cada operación sensible deja `actor_user_id`, `action`, `entity_type`, `entity_id` y `metadata`.
Se consulta en `GET /v1/admin/audit` (solo administración).

| Área | `action` |
|---|---|
| Acceso | `auth.challenge.started`, `auth.login` |
| Perfil e identidad | `profile.updated`, `profile.reviewed`, `private_document.registered`, `private_document.reviewed` |
| Usuarios y roles | `user.suspended`, `user.reactivated`, `role.granted`, `role.revoked`, `user.blocked`, `user.unblocked` |
| Vehículos | `vehicle.created`, `vehicle.updated`, `vehicle.reviewed` |
| Viajes | `trip.draft.created`, `trip.started`, `trip.completed`, `trip.cancelled`, `trip_series.created`, `trip_series.status_changed` |
| Solicitudes | `ride_request.created`, `ride_request.accepted_with_hold`, `ride_request.rejected`, `ride_request.cancelled` |
| Recogida | `pickup_code.generated`, `pickup.verified` |
| Cambios de ruta | `route_change.requested`, `route_change.driver_accepted`, `route_change.applied`, `route_change.rejected`, `route_change.expired` |
| Chat y reportes | `chat.message.sent`, `incident_report.created`, `incident_report.status_changed` |
| Finanzas | `tariff.created`, `tariff.approved`, `cancellation_policy.created`, `cancellation_policy.activated`, `payouts.prepared` |
| Datos | `province.dataset.activated` |

Los cobros, reembolsos y pagos no pasan por esta tabla: su registro es el propio webhook guardado
más el asiento contable, que tampoco se pueden modificar.

## 5. Errores
Catálogo de códigos estables en `docs/ERRORS.md`.
