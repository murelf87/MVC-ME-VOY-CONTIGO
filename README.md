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

## Bloques implementados
- autenticación por teléfono con proveedor configurable y sesiones opacas revocables;
- perfiles y roles;
- vehículos con propiedad, revisión y reinicio de revisión tras cambios;
- documentos privados modelados y revisión administrativa, sin exponer claves privadas al usuario;
- PostGIS y límites provinciales trazables;
- routing/geocoding abstraído y adaptador Google Maps;
- creación de borradores de viaje con ruta calculada en servidor;
- validación de geometría completa dentro de una provincia;
- publicación de viajes verificados;
- solicitudes de plaza con decisión exclusiva del conductor;
- hold transaccional por segmento y protección contra overbooking;
- confirmación de pago idempotente y compensación de pago tardío a nivel de dominio;
- seguimiento GPS con orden de eventos, idempotencia y estado obsoleto;
- ubicación precisa solo para conductor/pasajero confirmado y aproximada para público/no autorizado.

## Proveedores externos
El código no activa proveedores falsos.

- SMS: adaptador Twilio Verify disponible; desactivado sin credenciales.
- Maps: adaptador Google Maps disponible; desactivado sin clave real.
- Storage privado: contrato interno preparado, pero el endpoint de carga no se abre hasta elegir proveedor real.
- Pagos/payouts: todavía no integrados con proveedor real.
- Push: todavía no integrado.

## Economía
El sistema soporta estructura de tarifas versionadas, pero **no activa** 0,30 €/km, 1 % de comisión ni Premium. Siguen siendo decisiones pendientes.

## CI
GitHub Actions ejecuta:
- instalación;
- typecheck estricto;
- build;
- unit tests;
- migraciones PostgreSQL/PostGIS;
- suite de integración secuencial;
- auditoría de dependencias de producción.

Última ejecución verificada:
https://github.com/murelf87/MVC-ME-VOY-CONTIGO/actions/runs/37210090230

Resultado: **SUCCESS**.

## Documento esencial
Lee `PROMPT_MAESTRO_MVC.md` antes de continuar.

## Estado
Consulta `STATUS_2026-10-04.md`, `docs/TEST_EVIDENCE.md` y `docs/BLOCKERS.md`.

**El proyecto todavía no debe presentarse como producción lista.**
