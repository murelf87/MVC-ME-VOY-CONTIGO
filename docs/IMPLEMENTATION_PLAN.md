# Implementation Plan — MVC Me Voy Contigo

## Objetivo
Completar el producto con una base transaccional, geoespacial y auditable, alineada con `PROMPT_MAESTRO_MVC.md`, sin simular integraciones de producción.

## Estado de referencia actual
- **Implementado y probado**: núcleo backend TypeScript/Fastify, motor monetario exacto, pruebas unitarias y pruebas de integración clave (geografía, concurrencia, idempotencia y pago tardío con compensación).
- **Implementado pendiente de verificar**: ejecución estable de integración en entorno reproducible (CI + PostGIS) y validación continua de migraciones.
- **Bloqueado**: credenciales/proveedores reales, dataset provincial oficial trazable aprobado, decisiones jurídicas/comerciales pendientes.
- **No implementado**: autenticación completa, flujo móvil end-to-end, panel admin completo, pagos y payouts reales, GPS/chat/push operativos en producción.

## Fases

### Fase 0 — Base de calidad y verificación continua
**Meta**: convertir el backend actual en una base verificable en cada cambio.

Entregables:
1. Workflow CI con Node 24 + PostGIS para:
   - migraciones,
   - typecheck,
   - unit tests,
   - integration tests.
2. Política de ramas y PRs obligando checks verdes.
3. Evidencia de ejecución de tests en cada PR.

Criterio de salida:
- Cada PR ejecuta y aprueba el pipeline sin intervención manual.

### Fase 1 — Identidad, perfiles y autorización por recurso
**Meta**: asegurar acceso real y separación de datos públicos/privados.

Entregables:
1. Registro/login/refresh/revocación y recuperación de sesión.
2. Roles multi-perfil (pasajero y conductor en una cuenta).
3. Almacenamiento privado para selfies/documentos + URLs firmadas.
4. Autorización por recurso para reservas, chats, ubicaciones y administración.

Criterio de salida:
- Sin puertas traseras, sin contraseña maestra, con pruebas de acceso no autorizado.

### Fase 2 — Publicación de viajes y geografía obligatoria
**Meta**: publicar solo viajes íntegramente dentro de provincia.

Entregables:
1. Integración de routing real.
2. Importador/versionado de límites provinciales oficiales trazables.
3. Validación completa de geometría (origen, destino, paradas y ruta total).
4. Persistencia de geometría, distancia y ETA por carretera.

Criterio de salida:
- Bloqueo automático de rutas que salgan de provincia aunque extremos estén dentro.

### Fase 3 — Solicitudes, holds, reservas y concurrencia
**Meta**: evitar overbooking bajo carga y concurrencia real.

Entregables:
1. Flujo completo solicitud → aceptación → hold temporal → pago → reserva.
2. Capacidad por segmentos con bloqueos transaccionales.
3. Expiración de hold + manejo de pago tardío con compensación/reembolso.
4. Idempotencia estricta para confirmaciones de pago.

Criterio de salida:
- Pruebas concurrentes reproducibles con una sola reserva para último asiento.

### Fase 4 — Recurrentes, reserva semanal y flexibilidad de viaje
**Meta**: soportar recurrencia sin duplicidades ni desbordes de capacidad.

Entregables:
1. Orquestación de ocurrencias recurrentes.
2. Reserva semanal por disponibilidad real.
3. Re-cálculo objetivo por cambios materiales y aceptación explícita de afectados.

Criterio de salida:
- Sin dobles reservas ni cambios materiales aplicados sin aceptación.

### Fase 5 — Pagos marketplace, conciliación y payouts
**Meta**: operación económica real con proveedor regulado.

Entregables:
1. Webhooks firmados e idempotentes.
2. Ledger auditable (pendiente/disponible).
3. Reembolsos, disputas, conciliación y payouts.
4. Política de cancelación versionada y aplicada por escenario.

Criterio de salida:
- Trazabilidad completa de cada euro sin uso de `float`.

### Fase 6 — Móvil, mapa en directo, chat y notificaciones
**Meta**: experiencia operativa para pasajeros y conductores.

Entregables:
1. App móvil conectada a contratos reales.
2. Mapa en directo con privacidad por nivel de autorización.
3. Chat, código de recogida, inicio/fin de viaje, incidencias y valoraciones.
4. Reconexión GPS, posición obsoleta y límites de tracking en background.

Criterio de salida:
- Flujos críticos E2E validados en dispositivos reales.

### Fase 7 — Administración, operación y despliegue
**Meta**: plataforma operable y mantenible en producción.

Entregables:
1. Panel admin con roles y auditoría.
2. Monitorización, alertas, backups y prueba de restauración.
3. Entornos dev/staging/prod con despliegue y rollback.
4. Hardening de seguridad y gestión de secretos.

Criterio de salida:
- Operación segura, auditable y recuperable ante fallos.

## Pruebas obligatorias de salida a producción
Se requiere cumplir la matriz del documento maestro (geografía, concurrencia, idempotencia, webhooks fuera de orden, cancelaciones versionadas, GPS/reconexión, accesos no autorizados y restauración real de backup).

## Bloqueos y decisiones externas (seguimiento)
1. Selección y credenciales de proveedores (SMS, KYC, storage privado, routing, pagos, push).
2. Aprobación de dataset provincial oficial con metadatos de fuente/licencia/fecha/versión.
3. Definición jurídica/comercial de biometría facial y política final de economía/cancelaciones.
4. Validación legal y operativa para puesta en tiendas y producción.

## Definición práctica de “producción lista”
Un entorno solo se considerará listo cuando:
- los flujos críticos estén probados E2E,
- las integraciones reales estén verificadas,
- la seguridad y auditoría estén activas,
- exista evidencia de operación y recuperación.
