# Despliegue, monitorización y vuelta atrás

Guía para cuando exista un servidor. Hoy no hay ningún entorno de staging ni de producción contratado: nada de esto está desplegado.

## Entornos
| | Desarrollo | Staging | Producción |
|---|---|---|---|
| `NODE_ENV` | development | production | production |
| SMS / mapas | `dev_console` / `dev_local` permitidos | Twilio y Google con claves de prueba | Twilio y Google con claves restringidas |
| Pagos | `disabled` | Stripe en modo test | Stripe en modo live |
| Base de datos | local | copia separada, nunca la de producción | gestionada, con copias automáticas |

Los proveedores de desarrollo se niegan a arrancar fuera de `NODE_ENV=development`. Los secretos van en el gestor de secretos del proveedor de hosting, nunca en el repositorio ni en `.env` versionados (`.env.example` solo lleva nombres).

## Publicar una versión
1. CI en verde (tipos, build, pruebas unitarias y de integración con PostGIS, auditoría de dependencias).
2. `npm run db:backup-check` contra la base del entorno: deja la copia de antes del cambio y prueba que se restaura.
3. `npm ci && npm run build`.
4. `npm run db:migrate`: las migraciones son solo hacia delante y cada una corre en su propia transacción; si una falla no se aplica nada de ella.
5. Arrancar `npm start` detrás de un proxy TLS con `TRUST_PROXY=true`, y esperar a que `GET /health/ready` responda 200 (comprueba base de datos y PostGIS) antes de enviarle tráfico.
6. `npm run openapi` y comprobar que `docs/openapi.json` no cambió sin querer.

## Vuelta atrás
- Código: volver a desplegar la versión anterior. Las migraciones están pensadas para que el código anterior siga funcionando (columnas nuevas con valor por defecto o nulas).
- Datos: si una migración rompió datos, restaurar la copia del paso 2 (`pg_restore`). El libro contable no se edita nunca: los errores se corrigen con asientos nuevos.

## Tareas programadas
- `npm run series:materialize`: publica las próximas semanas de los viajes recurrentes (diaria).
- `npm run payments:retry`: reintenta webhooks que llegaron antes de lo que necesitaban (cada 5 minutos).
- `npm run db:backup-check`: copia y simulacro de restauración (diaria; conservar las copias según la política de retención que se decida).

## Monitorización mínima
- `GET /health/live` y `GET /health/ready` en el comprobador de disponibilidad.
- Alertas sobre el panel de finanzas: libro que no cuadra, conciliación que no coincide, eventos de pago en `failed` o `deferred` más de una hora, reembolsos `pending_provider` antiguos.
- Logs: Fastify registra método, ruta, estado y duración; no registra cabeceras ni cuerpos, así que tokens, códigos SMS y documentos no salen en los logs. Los teléfonos se enmascaran en el panel.
