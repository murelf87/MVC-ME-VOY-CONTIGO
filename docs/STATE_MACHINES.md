# MVC — Máquinas de estado

## Solicitud de plaza
`pending -> accepted | rejected | cancelled`

`accepted -> payment_pending | cancelled | expired`

`payment_pending -> confirmed | payment_late | cancelled | expired`

Una solicitud pendiente o aceptada todavía no es una reserva confirmada.

## Seat hold
`active -> consumed | released`

El hold es temporal y ocupa capacidad por segmento. Una confirmación de pago posterior a la expiración no crea una reserva: genera compensación/reembolso pendiente.

## Reserva
`confirmed -> completed | cancelled | driver_cancelled`

## Viaje
`draft -> published -> active -> completed`

Cualquier estado operativo puede terminar en `cancelled` conforme a una política de cancelación versionada.

## Cambio de ruta
`pending -> accepted | rejected | expired | cancelled`

Si el cambio altera materialmente precio o horario ya acordado, requiere aceptación de los pasajeros afectados antes de aplicarse.
