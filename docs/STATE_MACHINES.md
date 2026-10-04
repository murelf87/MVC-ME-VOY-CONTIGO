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

También puede terminar en cancelled cuando exista política de cancelación versionada.

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
