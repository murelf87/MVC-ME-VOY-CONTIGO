# Evidencia de pruebas — 2026-10-08

Rama `claude/movil-punta-a-punta` (PR #1). CI de GitHub (backend y móvil) en verde en cada commit.

- Unitarias: 28 en verde (`npm test`).
- Integración con PostgreSQL 16 + PostGIS 3.4: 119 en verde (`npm run test:integration`), migraciones 001-018.
- Copia de seguridad y restauración real (prueba 18): `npm run db:backup-check` volcó la base de desarrollo, la restauró en una base nueva y comprobó 40 tablas con el mismo número de filas, 18 migraciones y PostGIS 3.4.2.

Pruebas del prompt maestro (sección 18), una por una con el test que la cubre: `docs/MANDATORY_TESTS.md`. Cubiertas por tests automáticos: 1-7, 9, 11-17 y 18 (con el script anterior). Sin cubrir todavía: 8 (cobro semanal, pendiente de decidir el modelo) y 10 (payout mensual real, necesita proveedor; la preparación y la confirmación por webhook sí están probadas).

Nuevas en esta entrega: desvíos y recogida con el viaje en marcha, cambio de ruta aceptado y rechazado, hora de llegada y aviso único, posición obsoleta sin hora estimada, libro contable que cuadra e inmutable, webhooks firmados duplicados y fuera de orden, reembolso con reparto exacto, disputas, pagos mensuales y conciliación. Después: reconexión GPS con fixes en búfer (prueba 14) y recorrido HTTP de todas las rutas de administración sin sesión y con pasajero o conductor (prueba 17).

---

# Evidencia de pruebas — 2026-10-04

Última ejecución verde:
https://github.com/murelf87/MVC-ME-VOY-CONTIGO/actions/runs/37210934637

Resultado: SUCCESS

## Pipeline
- Install dependencies: PASS.
- TypeScript strict typecheck: PASS.
- Build: PASS.
- Unit tests: PASS.
- PostgreSQL/PostGIS: PASS.
- Migraciones 001-009: PASS.
- Integration tests secuenciales: PASS.
- Production dependency audit: PASS.

## Cobertura funcional destacada
- auth/sesiones/roles;
- rutas provinciales y routing;
- importación provincial;
- perfiles, vehículos y revisión;
- documentos privados;
- holds, pagos tardíos e idempotencia;
- GPS privado/aproximado, stale y eventos fuera de orden;
- creación/publicación de viajes con routing de servidor;
- búsqueda y disponibilidad por segmento;
- solicitudes y decisión de conductor;
- chat directo y bloqueo;
- inicio/finalización del viaje;
- código de recogida hasheado;
- persistencia de intentos fallidos;
- completed frente a no_show.

Las pruebas no sustituyen proveedores externos reales. SMS, Google Maps real, storage privado, pagos y push siguen requiriendo credenciales/entornos oficiales.
