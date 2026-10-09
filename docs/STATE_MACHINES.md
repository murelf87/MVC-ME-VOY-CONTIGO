# MVC — Máquinas de estado

## Solicitud de plaza
pending -> accepted -> payment_pending -> confirmed

Alternativas:
- pending -> rejected
- pending|accepted|payment_pending -> cancelled|expired
- payment_pending -> payment_late

La aceptación del conductor y el hold se ejecutan de forma transaccional; el estado visible final de una aceptación correcta es payment_pending.

Módulo `trips` (contrato en `docs/contracts/trips.md`):
- `accepted` es transitorio: nunca se devuelve en la API (se presenta como `payment_pending`).
- Una solicitud `pending` NO reserva plaza. La capacidad por tramo cuenta reservas `confirmed|completed` y holds `active` no vencidos; se vuelve a comprobar, con bloqueo (viaje y después tramos), al aceptar.
- Retirar (`withdraw`) solo es posible en `pending` (→ `cancelled`). Cancelar `payment_pending` o `confirmed` pertenece al módulo `money`.
- Solo el conductor del viaje decide; cualquier otro usuario recibe 403 `TRIP_NOT_OWNED` sin conocer el estado de la solicitud.
- Una solicitud con `weekly_reservation_id` se decide por su reserva semanal (409 `REQUEST_IN_WEEKLY_RESERVATION` al decidirla suelta).

## Seat hold
active -> consumed | released

Expira según la lógica de reserva. Un pago posterior a expiración no crea una reserva y pasa a compensación.

Módulo `trips`: el hold dura `TRIPS_SEAT_HOLD_TTL_SECONDS` (900 s por defecto) desde la aceptación. Un hold `active` vencido se libera (`released`) al leer la solicitud, la bandeja del conductor o Mis viajes, o en el barrido periódico (`TRIPS_SWEEP_INTERVAL_SECONDS`, 30 s por defecto, dentro del proceso); la solicitud pasa a `expired`, la plaza vuelve a estar libre y se avisa al pasajero una sola vez (`request_expired`).

## Reserva
confirmed -> completed | no_show | cancelled | driver_cancelled

- completed: hubo recogida verificada mediante código.
- no_show: el viaje terminó sin recogida verificada.
- La consecuencia económica de no_show aún no está definida.

## Viaje
draft -> published -> active -> completed

También puede terminar en cancelled cuando exista política de cancelación versionada.

Módulo `trips`:
- «Guardar ruta» (`POST /v1/me/routes`) publica directamente (`published`); no deja borradores.
- Serie: `trip_series.status` `active -> paused | ended`. Cada día y sentido es un `trips` real (`series_id`, `leg`, `service_date` en Europe/Madrid) con índice único `(series_id, leg, service_date)`: la materialización (ventana móvil de 28 días, ampliable bajo demanda hasta 90) es idempotente y segura en concurrencia.
- «Caducado» en Mis viajes del conductor es una etiqueta derivada (viaje `published` cuya salida pasó hace más de 2 h sin iniciarse), no un estado de base de datos.

## Reserva semanal
Agregado de las solicitudes de una `weekly_reservations` (una `ride_request` por ocurrencia):
pending -> payment_pending -> confirmed | partially_confirmed

Alternativas: rejected, cancelled, expired. Aceptar y rechazar son todo o nada sobre las ocurrencias pendientes (un hold por ocurrencia, misma caducidad; si alguna ya no tiene plaza no se acepta ninguna: 409 `NO_CAPACITY_ON_SEGMENT` con las fechas). Retirar cancela las ocurrencias `pending`; las aceptadas o confirmadas siguen la política de `money`. «Suspender próxima semana» retira las `pending` de esa semana y no toca las demás. La confirmación es por ocurrencia (la hace `money`).

## GPS
- solo active acepta nuevas posiciones;
- eventos duplicados son idempotentes;
- un evento antiguo puede conservarse en histórico pero no sustituye al estado vivo más reciente;
- al salir de active, la API no presenta el viaje como ubicación en directo.

## Chat
Solo existe acceso conductor ↔ pasajero con booking confirmado/completado y sin bloqueo entre ambos.

## Cambio de ruta
pending -> accepted | rejected | expired | cancelled

Los cambios materiales de precio/horario deben ser aceptados por pasajeros afectados antes de aplicarse. El flujo de consenso completo sigue pendiente.
