# MVC — Me voy contigo — Backend

Backend de MVC – Me voy contigo, versión actual 0.10.0.

## Objetivo
Viajes compartidos interurbanos dentro de una sola provincia española, con capacidad por segmento, routing real, reservas transaccionales, mapa en vivo y autorización por recurso.

## Stack
- Node.js 24
- TypeScript estricto
- Fastify
- PostgreSQL 17
- PostGIS 3.5

## Funciones actuales
- acceso con correo y contraseña + sesiones revocables;
- perfiles, vehículos y revisión;
- routing provincial calculado en servidor;
- creación/publicación de viajes;
- búsqueda con disponibilidad por segmento;
- solicitudes, aceptación/rechazo y seat holds;
- lógica idempotente de confirmación/pago tardío;
- GPS en vivo con privacidad precisa/aproximada;
- chat 1:1 autorizado y bloqueo;
- inicio/final del viaje;
- código de recogida hasheado;
- clasificación de reserva como completed/no_show al finalizar.

## Proveedores
No se usan proveedores falsos para declarar operaciones reales.
- Correo: códigos de confirmación y de contraseña listos, sin proveedor de envío todavía.
- Maps: Google Maps disponible, desactivado sin clave.
- Storage: pendiente.
- Pagos/payouts: pendiente.
- Push: pendiente.

## Desarrollo local
1. Copia .env.example.
2. Configura PostgreSQL/PostGIS.
3. Define DATABASE_URL.
4. npm install
5. npm run db:migrate
6. npm run typecheck
7. npm test
8. npm run test:integration
9. npm run dev

## Entorno local completo
Ver docs/DEV_LOCAL.md para recorrer la app de punta a punta con proveedores de desarrollo.

Más documentación: [docs/ADMIN.md](docs/ADMIN.md) (panel de administración y roles), [docs/CANCELLATIONS.md](docs/CANCELLATIONS.md) (cancelaciones, valoraciones e incidencias) y [docs/RECURRING.md](docs/RECURRING.md) (viajes recurrentes y reserva semanal) [docs/ROUTE_CHANGES.md](docs/ROUTE_CHANGES.md) (desvíos, recogida con el viaje en marcha y hora de llegada) , [docs/PAYMENTS.md](docs/PAYMENTS.md) (pagos, contabilidad y pagos a conductores) y [docs/DEPLOY.md](docs/DEPLOY.md) (despliegue, copias y vuelta atrás). El contrato OpenAPI se regenera con `npm run openapi`.

## Vista previa del móvil

Un solo comando genera la app móvil como un único HTML con todo dentro: `mobile/dist-preview/movil-mvc.html`, de unos 2 MB. Ese archivo contiene el código de la app, la fuente de iconos y un marco de teléfono con selector de modelo (iPhone 15, Pro Max, SE, Android, Pixel, Fold y 320 px).

```
cd mobile
npm install
npm run preview:build
```

El archivo se abre en cualquier navegador sin internet. También se puede publicar tal cual como Artifact en un chat de Claude, y la app de Claude lo enseña en el panel de la derecha.

Es una vista previa: no llama a ningún servidor. `mobile/preview/preview-api.js` contesta en el navegador con datos de ejemplo, y los correos, los pagos y las respuestas de otros usuarios se simulan. La app real nunca carga ese archivo.

Archivos (en `mobile/preview/`):

- `stage.html`: el marco del teléfono.
- `app.html`: la página de la app.
- `build.mjs`: la compilación.

## CI
Último run verde:
https://github.com/murelf87/MVC-ME-VOY-CONTIGO/actions/runs/37210934637

## Reglas maestras
Lee PROMPT_MAESTRO_MVC.md.

## Estado detallado
- STATUS_2026-10-04.md
- docs/TEST_EVIDENCE.md
- docs/MANDATORY_TESTS.md
- docs/EVENTS.md
- docs/ERRORS.md
- docs/ACCOUNT_DELETION.md
- docs/BLOCKERS.md
- docs/STATE_MACHINES.md
- docs/openapi.json

No declarar producción lista todavía.
