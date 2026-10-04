# Evidencia de pruebas del bloque recuperado

Resultados registrados en la sesión de construcción original:
- TypeScript typecheck: PASS.
- Build TypeScript: PASS.
- Unit tests de dinero: 3/3 PASS.
- `npm audit --omit=dev`: PASS después de actualizar Fastify y plugins a versiones fijadas.
- Integración PostGIS: 6 pruebas escritas pero pendientes de ejecución por indisponibilidad del daemon Docker/PostGIS en la sesión.

Pruebas de integración incluidas:
1. Ruta con extremos dentro pero geometría que sale de la provincia -> rechazo.
2. Ruta completamente contenida -> publicación.
3. Dos solicitudes concurrentes sobre un único asiento/segmento -> solo una gana.
4. Solicitudes en segmentos no solapados -> ambas pueden mantener asiento.
5. Pago recibido tras expirar hold -> compensación/reembolso, sin reserva.
6. Pago proveedor duplicado -> idempotencia, una sola reserva.
