# MVC Mobile — Expo SDK 57

Aplicación móvil iOS/Android de **MVC — Me voy contigo**.

## Stack
- Expo SDK 57
- React 19.2.3
- React Native 0.86.3
- TypeScript
- Expo SecureStore para la sesión en iOS/Android

## Configuración
La app no incorpora una URL de producción inventada.

Configura:

```env
EXPO_PUBLIC_API_URL=https://api.tu-dominio-mvc.com
```

Para pruebas LAN con Expo Go puede usarse la IP del equipo que ejecuta el backend, por ejemplo:

```env
EXPO_PUBLIC_API_URL=http://192.168.x.x:3000
```

Los archivos `.env*.local` están excluidos de Git.

## Pantallas y backend
Cada pantalla llama a endpoints reales del backend (contrato completo en `../docs/openapi.json`); no hay datos de ejemplo dentro de la app.

| Pantalla | Qué hace | Endpoints principales |
|---|---|---|
| Acceso | Alta e inicio de sesión por SMS; la sesión se guarda en SecureStore y se valida al abrir | `/v1/auth/phone/start`, `/v1/auth/phone/verify`, `/v1/auth/session`, `/v1/auth/logout` |
| Inicio y búsqueda | Provincia por GPS o lista, búsqueda por tramos, viajes en marcha y con desvío | `/v1/provinces`, `/v1/provinces/resolve`, `/v1/maps/geocode`, `/v1/trips/search`, `/v1/trips/detour-search` |
| Publicar | Borrador con ruta calculada en el servidor, publicación, repetir, series semanales | `/v1/me/trips`, `/v1/me/trips/:id/publish`, `/v1/me/trips/:id/repeat` |
| Viajes | Solicitudes, decisión del conductor, cancelaciones, desvíos, reserva semanal | `/v1/me/ride-requests`, `/v1/trips/:id/requests`, `/v1/ride-requests/:id/decision`, `/v1/route-changes/...`, `/v1/series/:id/weekly-requests` |
| Directo | Coche en el mapa, hora de llegada, aviso de llegada, código de recogida, inicio y fin | `/v1/trips/:id/location`, `/v1/trips/:id/eta`, `/v1/live/map`, `/v1/bookings/:id/pickup-code`, `/v1/bookings/:id/pickup-verify` |
| Mensajes | Chat entre conductor y pasajero confirmado, bloqueo | `/v1/trips/:id/chat/...`, `/v1/me/blocks` |
| Perfil | Foto, documentos, vehículos, ganancias del conductor, valoraciones, reportes | `/v1/me/profile`, `/v1/me/uploads/...`, `/v1/me/vehicles`, `/v1/me/earnings`, `/v1/bookings/:id/rating`, `/v1/reports` |
| Avisos | Bandeja de notificaciones | `/v1/me/notifications` |
| Administración | Solo con rol de staff: verificación, viajes, reportes, tarifas, cancelaciones, cobros y pagos, auditoría | `/v1/admin/...` |

Lo que todavía no existe en la app porque depende de proveedores sin contratar (ver `../docs/BLOCKERS.md`): pagar la plaza desde la app (falta el proveedor de pagos y su SDK), notificaciones push con la app cerrada y la subida real de fotos a almacenamiento privado.

## Ubicación del conductor
- Se comparte solo con la app abierta y en primer plano durante un viaje activo (`src/live/shareLocation.ts`): una posición cada 10 s o cada 25 m.
- Cada posición lleva un `eventId` único y la hora del GPS, así el backend descarta duplicados y no deja que una posición vieja sustituya a la actual.
- Sin cobertura, las posiciones se guardan en el móvil (hasta 30, unos cinco minutos) y se reenvían al recuperar la señal, la más reciente primero. Si el servidor rechaza una posición para siempre (viaje terminado, no eres el conductor) se descarta; si es por límite de peticiones se reintenta.
- Si pasan más de 60 s sin posición, pasajeros y mapa ven la ubicación como antigua y sin hora estimada; nunca se muestra como "en directo".
- Permisos: iOS solo pide "Mientras se usa la app" (`NSLocationWhenInUseUsageDescription` en `app.json`); Android pide ubicación precisa. No se piden permisos de segundo plano.

### Segundo plano: no implementado
Seguir enviando la ubicación con la pantalla bloqueada o con otra app delante necesita:
- iOS: permiso "Siempre", `UIBackgroundModes: location`, indicador azul en la barra y justificación ante la revisión de App Store.
- Android: servicio en primer plano con notificación fija, permiso `ACCESS_BACKGROUND_LOCATION` y su declaración en Google Play.
- En ambos: `expo-task-manager`, un build de desarrollo (no funciona en Expo Go) y pruebas en dispositivos reales con ahorro de batería activado.

Queda sin activar hasta decidir que el producto lo necesita y preparar los textos para las tiendas. Mientras tanto la app debe quedarse abierta durante el viaje.

## Validación
Antes de aceptar un cambio móvil:
1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. export iOS de Expo
4. export Android de Expo

GitHub Actions ejecuta estas comprobaciones en cada push.

## Estado de producción
**Todavía no está listo para producción.**

Conectado a endpoints reales:
- provincias, geocodificación, búsqueda, solicitudes y decisiones;
- publicación de viaje;
- reservas del pasajero con código de recogida;
- viajes del conductor: iniciar, compartir GPS, verificar recogida y finalizar;
- chat entre conductor y pasajero confirmado;
- seguimiento del coche (exacto para el pasajero del viaje, aproximado para el resto).

Pendientes principales del móvil:
- mapa con teselas (ahora abre la posición en Google Maps);
- fotos/documentos;
- notificaciones push;
- pagos;
- incidencias/ratings;
- builds de tienda y pruebas en dispositivos.
