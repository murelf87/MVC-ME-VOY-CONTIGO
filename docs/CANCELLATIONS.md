# Cancelaciones, valoraciones e incidencias

## Política de cancelación versionada

- Las cifras **no están en el código**. Finanzas (`finance_admin` o `admin`) crea una versión en borrador con `POST /v1/admin/cancellation-policies` y la activa con `POST /v1/admin/cancellation-policies/:id/activate`. Solo puede haber una activa; al activar otra, la anterior pasa a `retired`.
- Cada reserva guarda la versión activa en el momento del pago (`bookings.cancellation_policy_version_id`). Al cancelar se aplica esa versión, aunque después se haya activado otra.
- Reglas (`rules`), todas en puntos básicos (10000 = 100 %) y separadas para la aportación del trayecto y la comisión del pasajero, para que MVC pueda conservar su comisión en ciertos supuestos sin que sea una regla fija:
  - `passenger`: tramos por minutos antes de la salida (`minMinutesBeforeDeparture`); debe existir uno con 0.
  - `passengerAfterStart`: el pasajero cancela con el viaje ya iniciado (antes de subir; después de la recogida no se puede cancelar).
  - `driver`, `platform`, `forceMajeure`.
- Redondeo: cada parte se redondea al céntimo con medio hacia arriba (`floor((c·bps+5000)/10000)`); lo retenido es siempre `pagado − reembolso`.
- Sin política activa, la cancelación queda registrada con `refund_status = pending_policy` para revisión; no se inventa un importe.
- Con política, el reembolso calculado queda en `pending_provider` hasta que exista un proveedor de pagos real (**bloqueado**: falta elegir proveedor y credenciales). Finanzas lo ve en `GET /v1/admin/refunds/pending`.
- No-show y payouts ya enviados: pendientes de definir con el proveedor de pagos.

Endpoints de usuario: `POST /v1/ride-requests/:id/cancel` (pasajero), `POST /v1/me/trips/:id/cancel` (conductor, `forceMajeure` opcional; un viaje en marcha no se cancela, se finaliza), `GET /v1/cancellation-policy` (versión activa).

## Valoraciones

`POST /v1/bookings/:id/rating` (1 a 5 y comentario opcional). Solo conductor y pasajero de una reserva completada o no-show, una vez cada uno. `GET /v1/users/:id/rating` devuelve media y número.

## Incidencias y bloqueos

`POST /v1/reports` sobre un viaje en el que participaste; el pasajero solo puede reportar al conductor y el conductor a sus pasajeros. `blockUser: true` bloquea a la vez. Máximo 10 reportes al día por persona. Soporte (`support_admin` o `admin`) los revisa con `GET /v1/admin/reports` y `POST /v1/admin/reports/:id/status`; cerrar exige una nota y queda en auditoría. `GET /v1/me/blocks` y `PUT/DELETE /v1/me/blocks/:userId` gestionan los bloqueos.
