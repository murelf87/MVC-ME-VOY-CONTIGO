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

## Flujo real conectado
- `POST /v1/auth/phone/start`
- `POST /v1/auth/phone/verify`
- `GET /v1/auth/session`
- `POST /v1/auth/logout`
- `GET /me`

El token opaco se persiste con SecureStore en iOS/Android y se valida contra el backend al restaurar la app.

## Frontend
La UI actual sigue las maquetas MVC aprobadas:
- acceso pasajero/conductor;
- Inicio “¿A dónde vamos?”;
- categorías de destino;
- ruta provincial;
- viajes;
- publicación;
- mensajes;
- viaje en directo;
- perfil/verificación;
- navegación inferior Inicio · Viajes · Publicar · Mensajes · Perfil.

Parte de esas pantallas aún contiene componentes visuales pendientes de conectar a endpoints reales. No deben interpretarse como datos operativos.

## Validación
Antes de aceptar un cambio móvil:
1. `pnpm install --frozen-lockfile`
2. `pnpm typecheck`
3. export iOS de Expo
4. export Android de Expo

GitHub Actions ejecuta estas comprobaciones en cada push.

## Estado de producción
**Todavía no está listo para producción.**

Pendientes principales del móvil:
- selector provincial alimentado por backend;
- geocodificación real de origen/destino;
- búsqueda de viajes real;
- solicitudes y decisiones reales;
- publicación de viaje;
- mapa real y ubicación;
- chat real;
- fotos/documentos;
- notificaciones push;
- pagos;
- incidencias/ratings;
- builds de tienda y pruebas en dispositivos.
