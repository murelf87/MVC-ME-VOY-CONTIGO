# MVC — Me voy contigo — Backend

Código fuente del backend MVC desarrollado hasta el 4 de octubre de 2026.

## Objetivo
Backend transaccional y geoespacial para viajes compartidos interurbanos que permanecen íntegramente dentro de una misma provincia española.

## Requisitos
- Node.js 24
- npm
- Docker + Docker Compose, o PostgreSQL 17 con PostGIS 3.5

## Inicio local
1. Copia `.env.example` a `.env.local`.
2. Configura PostgreSQL/PostGIS.
3. Exporta `DATABASE_URL`.
4. Ejecuta `npm install`.
5. Ejecuta `npm run db:migrate`.
6. Ejecuta `npm run typecheck`.
7. Ejecuta `npm test`.
8. Ejecuta `npm run test:integration`.
9. Ejecuta `npm run dev`.

## Autenticación
El backend contiene primitivas de autenticación y sesión seguras, protección de `/me`, hash de tokens y revocación.

El envío SMS real **no está activado** mientras no exista un proveedor real configurado. No hay códigos universales ni proveedor ficticio presentado como producción.

## Geografía y routing
- PostGIS.
- Validación de geometría completa de ruta dentro de provincia.
- Importación provincial trazable.
- Abstracción de routing/geocoding.
- Adaptador Google Maps con pruebas unitarias sin exponer la API key.
- Seguimiento de posición en vivo a nivel de persistencia.

## Economía
El código soporta tarifas versionadas, pero no activa 0,30 €/km, 1 % de comisión ni Premium. Esas cifras siguen pendientes de aprobación.

## Documento esencial
Lee `PROMPT_MAESTRO_MVC.md` antes de continuar el desarrollo.

## CI
GitHub Actions ejecuta:
- instalación;
- typecheck;
- build;
- unit tests;
- migraciones PostGIS;
- suite de integración completa;
- auditoría de dependencias de producción.

Estado verificado el 4 de octubre de 2026: **CI verde**.

## Estado
Consulta `STATUS_2026-10-04.md`, `docs/TEST_EVIDENCE.md` y `docs/BLOCKERS.md`.

**El proyecto todavía no debe presentarse como producción lista.**
