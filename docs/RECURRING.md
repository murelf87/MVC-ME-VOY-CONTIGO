# Viajes recurrentes y reserva semanal

- El conductor convierte un viaje suyo (borrador o publicado, con hora de salida) en una serie semanal: `POST /v1/me/trips/:id/repeat` con `weekdays` ISO (1 = lunes … 7 = domingo), `endsOn` opcional y `horizonWeeks` (1 a 8, por defecto 4).
- Cada ocurrencia es un viaje normal: copia la ruta verificada, paradas y tramos del viaje plantilla, y se publica con las mismas comprobaciones (identidad, coche, seguro, provincia). Si una falla, se informa en `failed` y no se publica.
- La hora es local de `Europe/Madrid`, así que los cambios de horario de verano no mueven la salida.
- Materializar es idempotente (índice único `series_id + departure_at`). Hay que programar `npm run series:materialize` una vez al día para ir añadiendo semanas; **pendiente** de elegir dónde corre el programador en producción.
- `POST /v1/me/series/:id/status` pausa, reactiva o termina una serie; pausada no crea ocurrencias nuevas.
- Reserva semanal: `POST /v1/series/:id/weekly-requests` con `weekStart` (lunes), tramo y días opcionales. Cada día se solicita en su propia transacción con los bloqueos de capacidad habituales; un día lleno vuelve como `skipped` con `NO_CAPACITY_ON_SEGMENT` en lugar de fallar toda la semana, y el índice de solicitudes abiertas impide duplicados.
- El conductor puede aceptar o rechazar la semana entera con `POST /v1/weekly-groups/:id/decision`; cada día se valida por separado y luego se paga como cualquier reserva.
- El cobro semanal agrupado depende del proveedor de pagos (**bloqueado**).
