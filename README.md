# MVC — Me voy contigo — Backend

Backend transaccional y geoespacial para viajes compartidos interurbanos que permanecen íntegramente dentro de una misma provincia española.

## Estado actual
Versión backend: `0.2.0`.

La CI actual verifica:
- TypeScript estricto y build.
- PostgreSQL/PostGIS y migraciones.
- 8 tests unitarios.
- 10 tests de integración.
- Auditoría de dependencias de producción.

La ejecución #8 de GitHub Actions quedó completamente verde.

## Requisitos
- Node.js 24
- npm
- Docker + Docker Compose, o PostgreSQL 17 con PostGIS 3.5

## Inicio local
1. Copia `.env.example` a `.env.local`.
2. Configura una contraseña PostgreSQL local segura.
3. Arranca PostGIS.
4. Exporta `DATABASE_URL`.
5. Ejecuta `npm install`.
6. Ejecuta `npm run db:migrate`.
7. Ejecuta `npm run typecheck`.
8. Ejecuta `npm test`.
9. Ejecuta `npm run test:integration`.
10. Ejecuta `npm run dev`.

## Autenticación
Endpoints implementados:
- `POST /v1/auth/phone/start`
- `POST /v1/auth/phone/verify`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`

Por defecto `SMS_PROVIDER=disabled`. Para SMS real debe configurarse un proveedor operativo; el adaptador incluido es Twilio Verify. No hay códigos OTP universales ni contraseñas maestras.

## Seguridad
No hay contraseñas reales, secretos ni credenciales en el repositorio. Los tokens de sesión solo se almacenan como hash SHA-256.

## Economía
El código soporta tarifas versionadas, pero no activa 0,30 €/km, 1 % de comisión ni Premium. Esas cifras siguen pendientes de aprobación.

## Documento esencial
Lee `PROMPT_MAESTRO_MVC.md` antes de continuar el desarrollo.

## Estado de producción
Consulta `STATUS_2026-10-04.md`, `docs/TEST_EVIDENCE.md` y `docs/BLOCKERS.md`.

**Todavía no debe presentarse como producción lista.**
