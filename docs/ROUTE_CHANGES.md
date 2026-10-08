# Desvíos, recogida en marcha y hora de llegada

Secciones 11, 12 y 13 del prompt maestro.

## Reservar con el coche ya en ruta
- La búsqueda normal incluye viajes `active` solo si hay una posición del conductor de menos de 60 s y la parada de recogida está por delante del coche (`inProgress: true`).
- `createRideRequest` y la aceptación del conductor vuelven a comprobarlo: sin posición reciente `LIVE_POSITION_STALE`, parada ya pasada `PICKUP_ALREADY_PASSED`.
- La plaza se retiene y se cobra con el mismo flujo atómico de siempre (retención + confirmación del pago), con bloqueo del viaje y de los segmentos para evitar overbooking.

## Pedir que te recojan fuera de la ruta
1. `GET /v1/trips/detour-search`: viajes cuya ruta pasa lo bastante cerca de los dos puntos para caber en el desvío máximo del conductor (`max_detour_m`), en el sentido correcto y, si está en marcha, por delante del coche.
2. `POST /v1/trips/:tripId/route-changes`: el servidor inserta recogida y bajada donde menos distancia añaden, recalcula la ruta completa con el proveedor real dentro de la provincia, y comprueba desvío máximo (`DETOUR_TOO_LONG`, `DETOUR_NOT_ALLOWED`) y plazas en todos los segmentos afectados. Queda `awaiting_driver` 10 minutos.
3. `POST /v1/route-changes/:id/decision` (conductor). Si algún pasajero confirmado llegaría o sería recogido más tarde que la flexibilidad del viaje, pasa a `awaiting_passengers` y cada uno decide en `POST /v1/route-changes/:id/response`. Un solo "no" lo cancela. Si nadie se ve afectado, se aplica en el momento.
4. Al aplicarse: nuevas paradas y segmentos, `route_version + 1`, todas las solicitudes del viaje se renumeran, y el nuevo pasajero recibe la plaza retenida y el precio congelado por sus propios km (tarifa aprobada). Antes de escribir se vuelve a comprobar versión de ruta, posición del coche y plazas.

Sin recargos: el precio del nuevo pasajero sale de la tarifa aprobada por sus km reales; los pasajeros anteriores conservan el importe acordado. El tráfico cambia la hora de llegada, nunca el precio.

Listados: `GET /v1/me/trips/:tripId/route-changes` (conductor), `GET /v1/me/route-changes` (lo que pediste y lo que tienes que contestar).

## Hora estimada de llegada
- `GET /v1/trips/:tripId/eta`: solo conductor y pasajeros confirmados. Calcula la posición del coche a lo largo de su ruta y suma tiempos y metros de los segmentos que faltan (prorrateando el segmento actual).
- Con una posición de más de 60 s devuelve `stale: true` y ninguna hora: no se muestra como en directo una ubicación antigua.
- Aviso "está llegando" (`trip.driver_arriving`) una sola vez por reserva, cuando faltan 2 minutos o 500 m, escrito en la misma transacción que la posición.

## Pendiente
- Los tiempos salen de la ruta del proveedor. Con Google Maps y su clave, la ETA podría usar tráfico en tiempo real; con el proveedor de desarrollo es una estimación.
- Push real (APNs/FCM) sigue sin credenciales: los avisos quedan en la bandeja de la app.
