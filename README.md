# MVC — Me voy contigo — Backend

Código fuente del bloque backend construido hasta el 4 de octubre de 2026.

## Objetivo
Backend transaccional y geoespacial para viajes compartidos interurbanos que permanecen íntegramente dentro de una misma provincia española.

## Requisitos
- Node.js 24
- npm
- Docker + Docker Compose, o PostgreSQL 17 con PostGIS 3.5

## Inicio local
1. Copia `.env.example` a `.env.local`.
2. Configura una contraseña PostgreSQL local segura.
3. Arranca PostGIS con Docker Compose.
4. Exporta `DATABASE_URL`.
5. Ejecuta `npm install`.
6. Ejecuta `npm run db:migrate`.
7. Ejecuta `npm run typecheck`.
8. Ejecuta `npm test`.
9. Ejecuta `npm run test:integration`.
10. Ejecuta `npm run dev`.

## Seguridad
No hay contraseñas reales, secretos ni credenciales en este repositorio.
Los endpoints mutantes todavía no están publicados porque falta el bloque de autenticación/autorización. Esto es deliberado.

## Economía
El código soporta tarifas versionadas, pero no activa 0,30 €/km, 1 % de comisión ni Premium. Esas cifras siguen pendientes de aprobación.

## Documento esencial
Lee `PROMPT_MAESTRO_MVC.md` antes de continuar el desarrollo. Contiene el funcionamiento y reglas completas del producto.

## Estado
Consulta `STATUS_2026-10-04.md`, `docs/TEST_EVIDENCE.md` y `docs/BLOCKERS.md`.

**Este repositorio todavía no debe presentarse como producción lista.**
