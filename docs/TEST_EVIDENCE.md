# Evidencia de pruebas — 2026-10-04

Última ejecución:
https://github.com/murelf87/MVC-ME-VOY-CONTIGO/actions/runs/37210090230

Resultado: **SUCCESS**

## Fases verificadas
- Install dependencies: PASS.
- TypeScript strict typecheck: PASS.
- Build: PASS.
- Unit tests: PASS.
- PostgreSQL/PostGIS service: PASS.
- Migraciones: PASS.
- Integration tests: PASS.
- Production dependency audit: PASS.

## Unit tests cubiertos
- dinero y redondeo exacto;
- teléfono, roles y tokens de sesión;
- Google Maps Routes/Geocoding con fetch aislado;
- normalización de matrículas.

## Integration tests cubiertos
- ruta con extremos dentro pero geometría fuera -> bloqueo;
- ruta íntegramente dentro -> publicación;
- concurrencia por último asiento;
- capacidad por segmentos no solapados;
- pago tardío tras expiración de hold;
- idempotencia de pago;
- autenticación/verificación y restricción de roles;
- cooldown de reenvío;
- código de verificación erróneo sin crear usuario/sesión;
- importación provincial válida/atómica y duplicados;
- selección de alternativa de routing dentro de provincia;
- rechazo de puntos fuera de provincia;
- fallback segmentado;
- perfiles, vehículos y autorización de revisión;
- documentos privados sin exposición de claves;
- identidad verificada solo por revisor autorizado;
- GPS publicado solo por conductor real;
- precisión GPS según autorización;
- eventos GPS fuera de orden;
- idempotencia de eventos GPS;
- mapa público aproximado;
- GPS obsoleto marcado;
- solicitud de plaza por pasajero;
- bloqueo del conductor sobre su propio viaje;
- decisión exclusiva del conductor propietario;
- aceptación + hold transaccional;
- concurrencia del último asiento;
- rechazo sin hold;
- bloqueo de solicitud abierta duplicada;
- creación de viaje con routing del servidor;
- persistencia de paradas/segmentos/distancias;
- bloqueo de vehículo ajeno;
- bloqueo cuando Maps no está configurado;
- publicación por propietario;
- bloqueo de publicación por no propietario.

Las llamadas reales a SMS, Google Maps, storage y pagos siguen bloqueadas hasta configurar proveedores y credenciales oficiales.
