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
- auth por teléfono + sesiones revocables;
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
- SMS: Twilio Verify disponible, desactivado sin credenciales.
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

## CI
Último run verde:
https://github.com/murelf87/MVC-ME-VOY-CONTIGO/actions/runs/37210934637

## Reglas maestras
Lee PROMPT_MAESTRO_MVC.md.

## Estado detallado
- STATUS_2026-10-04.md
- docs/TEST_EVIDENCE.md
- docs/BLOCKERS.md
- docs/STATE_MACHINES.md
- docs/openapi.json

No declarar producción lista todavía.
