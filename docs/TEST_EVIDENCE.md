# Evidencia de pruebas — 2026-10-04

GitHub Actions:
https://github.com/murelf87/MVC-ME-VOY-CONTIGO/actions/runs/37204463106

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
- utilidades OTP/sesión;
- normalización de teléfono y roles self-service;
- tokens de sesión;
- adaptador Google Maps y serialización de rutas/geocoding.

## Integration tests cubiertos
- ruta con extremos dentro pero geometría fuera -> bloqueo;
- ruta íntegramente dentro -> publicación;
- concurrencia por último asiento;
- ocupación por segmentos no solapados;
- pago tardío tras expiración de hold;
- idempotencia de pago;
- autenticación/verificación con proveedor de test aislado;
- restricción de roles administrativos en registro público;
- cooldown de reenvío;
- código de verificación incorrecto sin crear usuario/sesión;
- importación provincial válida;
- importación provincial atómica ante errores;
- duplicados de dataset;
- selección de alternativa de routing que permanezca dentro de provincia;
- rechazo de puntos fuera de provincia;
- fallback segmentado con paradas;
- bloqueo cuando ninguna ruta permanece dentro de provincia.

Las pruebas que usan proveedores externos reales siguen bloqueadas hasta configurar credenciales y entornos oficiales.
