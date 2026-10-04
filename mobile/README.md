# MVC Mobile — Expo SDK 57

Aplicación móvil iOS/Android de MVC — Me voy contigo.

## Stack
- Expo SDK 57
- React 19.2.3
- React Native 0.86.3
- TypeScript

## Arranque con Expo Go
1. Copia `.env.example` a `.env.local`.
2. Sustituye `YOUR_PC_LAN_IP` por la IP LAN del equipo que ejecuta el backend.
3. Ejecuta `pnpm install`.
4. Ejecuta `pnpm start`.
5. Escanea el QR con Expo Go.

## Estado actual
La build móvil conecta contratos reales del backend para:
- health check;
- inicio de verificación telefónica;
- verificación de código;
- perfil autenticado;
- cierre de sesión.

No contiene respuestas simuladas de backend.
