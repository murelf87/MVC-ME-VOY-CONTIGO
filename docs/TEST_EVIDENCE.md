# Evidencia de pruebas

## GitHub Actions — ejecución #8
Commit probado: `41afd42d4fefc2dd8277fb628f41a33eef0c07ad`.

Entorno:
- Node.js 24.
- PostgreSQL 17 + PostGIS 3.5.
- `NODE_ENV=test`.
- SMS desactivado; la integración de autenticación usa exclusivamente un test double dentro de los tests, nunca como proveedor operativo.

Resultados:
- Instalación de dependencias: PASS.
- TypeScript strict typecheck: PASS.
- Build: PASS.
- Tests unitarios: 8/8 PASS.
- Migración `001_core.sql`: PASS.
- Migración `002_auth_sessions.sql`: PASS.
- Tests de integración: 10/10 PASS.
- Auditoría de dependencias de producción: 0 vulnerabilidades.

## Cobertura de integración actual
1. Ruta con extremos dentro pero geometría que abandona provincia -> rechazo.
2. Ruta completamente contenida -> publicación.
3. Concurrencia por un único asiento/segmento -> una sola reserva.
4. Solicitudes en segmentos no solapados -> coexistencia correcta.
5. Pago posterior a expiración del hold -> compensación, sin reserva.
6. Confirmación de pago duplicada -> idempotencia.
7. Verificación de teléfono -> usuario, roles permitidos y sesión revocable.
8. Auto-registro administrativo -> rechazo antes de llamar al proveedor.
9. Reenvío de OTP durante cooldown -> rechazo.
10. Código OTP erróneo -> no crea usuario ni sesión.

Las suites de integración se ejecutan con `--test-concurrency=1` porque comparten una base de datos temporal y realizan limpieza explícita de tablas entre casos.
