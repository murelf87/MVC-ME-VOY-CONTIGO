# MVC — Máquinas de estado

## Solicitud de plaza
pending -> accepted -> payment_pending -> confirmed

Alternativas:
- pending -> rejected
- pending|accepted|payment_pending -> cancelled|expired
- payment_pending -> payment_late

La aceptación del conductor y el hold se ejecutan de forma transaccional; el estado visible final de una aceptación correcta es payment_pending.

## Seat hold
active -> consumed | released

Expira según la lógica de reserva. Un pago posterior a expiración no crea una reserva y pasa a compensación.

## Reserva
confirmed -> completed | no_show | cancelled | driver_cancelled

- completed: hubo recogida verificada mediante código.
- no_show: el viaje terminó sin recogida verificada.
- La consecuencia económica de no_show aún no está definida.

## Viaje
draft -> published -> active -> completed

También puede terminar en cancelled; el reembolso sigue la política versionada que aceptó cada pasajero al pagar.

## GPS
- solo active acepta nuevas posiciones;
- eventos duplicados son idempotentes;
- un evento antiguo puede conservarse en histórico pero no sustituye al estado vivo más reciente;
- al salir de active, la API no presenta el viaje como ubicación en directo.

## Chat
Solo existe acceso conductor ↔ pasajero con booking confirmado/completado y sin bloqueo entre ambos.

## Cambio de ruta (desvío)
awaiting_driver -> awaiting_passengers -> applied

Alternativas:
- awaiting_driver -> applied (nadie se retrasa más que la flexibilidad del viaje)
- awaiting_driver | awaiting_passengers -> rejected (el conductor o un solo pasajero dice que no)
- awaiting_driver | awaiting_passengers -> expired (10 minutos sin respuesta, la ruta cambió, el coche ya pasó o no quedan plazas al aplicar)

Al aplicarse se renumeran todas las solicitudes del viaje y el nuevo pasajero entra en payment_pending con plaza retenida. Ver docs/ROUTE_CHANGES.md.

## Evento del proveedor de pagos
received -> processed | deferred | failed; ignored si no afecta a MVC.
deferred -> processed cuando llega lo que faltaba (reintento por orden de ocurrencia).

## Reembolso de una cancelación
not_applicable | pending_policy | pending_provider -> completed (cuando el proveedor confirma el importe exacto).

## Pago a conductor
pending_provider -> paid | failed. Un fallo devuelve el importe al saldo disponible.

## Disputa
open -> won | lost. Solo avanza con eventos más recientes; una disputa perdida se contabiliza una vez.
