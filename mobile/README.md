# MVC · Me voy contigo: app móvil

Expo SDK 57 · React Native 0.86 · React 19 · TypeScript estricto · React Navigation 7 (pila nativa única).
Una sola base de código para iOS y Android. La compilación web (react-native-web) existe SOLO para la vista previa
interactiva y la comparación con el diseño; el producto son las apps nativas.

Idioma de producto: español de España. Primera provincia: Sevilla.

## Puesta en marcha

```bash
cd mobile
pnpm install
cp .env.example .env.local        # EXPO_PUBLIC_API_URL=http://<IP de tu PC>:3000
pnpm start                        # expo start
```

| Comando | Qué hace |
|---|---|
| `pnpm typecheck` | `tsc --noEmit` de toda la app (excluye `src/legacy` y los `*.test.ts`). |
| `npx tsc --noEmit -p tsconfig.test.json` | Comprueba los tipos de las pruebas. |
| `node --import tsx --test "src/**/*.test.ts"` | Pruebas unitarias (node:test + tsx, sin React Native). |
| `flock /tmp/mvc-heavy.lock npx expo export --platform web --output-dir /tmp/app-web` | Compilación web de producción (comprueba que todo empaqueta). |
| `npx expo config --type introspect` | Configuración nativa ya resuelta (permisos, plugins). |

### Variables de entorno

| Variable | Efecto |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL base del backend (sin barra final). Sin ella las peticiones son relativas (solo útil en web). |
| `EXPO_PUBLIC_PREVIEW=1` | Compilación de VISTA PREVIA: instala el backend en memoria (`src/preview/install`), activa el puente con el visor y la ruta `UiGallery`. Sin `EXPO_PUBLIC_API_URL` usa `https://api.preview.mvc.invalid`, que el backend en memoria intercepta. |

Metro cachea la transformación de cada fichero y Expo sustituye `EXPO_PUBLIC_*` al transformar: **tras cambiar una variable
hay que arrancar o exportar con `--clear`**, o se sigue viendo el valor anterior.

## Arquitectura

```
App.tsx                 proveedores + arranque (fuentes, sesión, enlace de entrada, pantalla de arranque)
app.json                configuración nativa (permisos en español, plugins, iconos)
src/
  api/          cliente HTTP (apiRequest), errores tipados, Idempotency-Key, subida firmada, endpoints/{auth,me}, types/
  hooks/        useApiQuery · useApiMutation · usePaginatedQuery · conectividad · ErrorBoundary
  session/      sesión (token, /me, rol activo, invitado) y AuthProvider/useAuth
  platform/     ubicación, cámara/fotos, documentos, notificaciones, háptica, compartir, portapapeles, abrir apps…
  navigation/   pila única, registro de rutas, puertas de acceso, enlaces profundos, acciones (requireAccount…)
  features/<slice>/   routes.ts + index.ts (+ screens/, components/, hooks/, api.ts, preview/handlers.ts)
  theme ui icons brand i18n dev   sistema de diseño (agente ds)
  maps/         mapa (agente map)       preview/   backend en navegador (agente preview-backend)
  legacy/       código antiguo, SOLO LECTURA: no se importa desde código nuevo
```

Reglas de dependencia (se rompen los ciclos si se respetan):

- `features/*` pueden importar `@/ui`, `@/hooks`, `@/session`, `@/navigation`, `@/platform`, `@/api`, `@/theme`, `@/i18n`…
  Nadie importa un slice salvo `navigation/registry.ts`.
- `@/navigation` (el barril) NO exporta `registry` ni `RootNavigator`: importan a los slices y crearían un ciclo.
  `App.tsx` los importa directamente.
- La lógica de red nunca vive en un componente: pantalla → hook → `features/<slice>/api.ts` → `@/api`.
- Nada importa de `src/preview/**` salvo `App.tsx` (y solo con `EXPO_PUBLIC_PREVIEW=1`).

## Cómo añade un slice sus pantallas

1. **Rutas.** Edita `features/<slice>/routes.ts`: cambia el `component` de cada `defineRoute` por tu pantalla y ajusta el
   tipo de parámetros (`type`, nunca `interface`; solo datos serializables). Las rutas nuevas se declaran aquí y sus
   nombres son únicos en TODA la app (el registro falla al arrancar si se repite uno).
   ```ts
   export type SearchParams = { TripDetail: { tripId: string; criteria?: SearchCriteriaParam } /* … */ };
   export const searchRoutes: RouteDef[] = [
     defineRoute({ name: "TripDetail", component: TripDetailScreen, access: "public", screen: "12", title: "Detalle del viaje" }),
   ];
   ```
   `access`: `"public"` (también invitados) · `"auth"` (por defecto) · `"staff"` (personal administrativo).
   `features/<slice>/index.ts` ya hace `export { searchRoutes as routes } from "./routes"`.
2. **Pantalla.** Recibe `AppScreenProps<"TripDetail">`; también puedes usar los hooks tipados:
   ```ts
   const navigation = useAppNavigation();              // navigation.navigate("PickupPoint", { tripId })
   const { params } = useAppRoute("TripDetail");       // params: { tripId; criteria?; … }
   ```
3. **Datos.** `features/<slice>/api.ts` llama a `apiRequest`; la pantalla usa `useApiQuery` / `useApiMutation` /
   `usePaginatedQuery`. Cada pantalla diseña sus estados: cargando, vacío, error con reintento, sin conexión, sin permiso.
4. **Cuenta.** Antes de una acción que exige cuenta: `if (!requireAccount({ name: "ReviewRequest", params })) return;`.
5. **Vista previa.** Los endpoints que use el slice se registran en `features/<slice>/preview/handlers.ts`
   (`registerPreview(r, db)`; la API del núcleo se importa de `@/preview`, ver `src/preview/index.ts`).
6. **Pruebas.** Lógica pura en `*.test.ts` junto al código (se ejecutan en Node: no importes React Native desde ellas).

Lo que NO hay que hacer:

- Navegar tras `signIn()` o tras `completeOnboarding()`: la navegación recoloca la pila sola (ver abajo).
- Importar `@/legacy`. Crear estado global propio para la sesión o la red: ya existen `useAuth` y `useConnectivity`.
- Guardar el token o datos personales fuera de `@/platform` (`secureStorage` / `preferences`).

## Sesión y navegación

Estados de sesión (`useAuth().status`): `booting` (leyendo token y `/me`) · `signedOut` · `guest` («Explorar sin
registrarme», solo en memoria) · `signedIn`.

| Situación | Primera pantalla |
|---|---|
| Sin sesión | `Welcome` |
| Invitado | `MapHome` |
| Con sesión sin rol de viajero (y no es personal) | `ChooseRole` |
| Con sesión, falta la foto pública (o fue rechazada) | `ProfilePhoto` |
| Con sesión y alta completa | `MapHome` (más el destino pendiente, si lo hay) |
| Con sesión pero `/me` aún no se pudo cargar (arranque sin red y sin copia) | `MapHome`; el alta se exige en cuanto `/me` llegue |

Lo que falta del alta se DERIVA de `/me` real (`getOnboardingRequirements`), nunca de banderas locales.
Arranque sin red: se conserva la sesión y se usa la última copia de `/me` (`useAuth().meStale === true`); al volver la
conexión se actualiza sola.

Acciones (`import { … } from "@/navigation"`):

| Función | Uso |
|---|---|
| `requireAccount(returnTo?)` | `true` con sesión. Si no, guarda `returnTo`, lleva a `CreateAccount` (o a `Welcome` sin sesión) y devuelve `false`. Tras el alta la app vuelve a `returnTo` con `MapHome` debajo. |
| `openTarget(target)` | Abre una ruta venida de un enlace o un aviso respetando sesión, alta y permisos (rutas de personal sin permiso: se ignoran sin revelar nada). |
| `completeOnboarding()` | Al terminar la foto: relee `/me`. `"done"` (y entra a MapHome o al destino pendiente) · `"incomplete"` (no mueve nada) · `"offline"`. |
| `applyGate()` | Recoloca la pila según la sesión. La app lo hace sola en cada entrada/salida de sesión. |
| `resetToRoute(target)` | Abre `target` con una pila coherente (vista previa y escenarios). |
| `navigationRef`, `getRouteNames()`, `getCurrentRoute()` | Navegación fuera de React y puente de la vista previa. |

Los refrescos de `/me` NO mueven a la persona de pantalla (podrían interrumpir un flujo del slice de alta, que decide
cuándo seguir llamando a `completeOnboarding()`; si necesita reaccionar a una copia obsoleta, observa
`useAuth().onboardingRequirements`).

Enlaces profundos (`mvc://trip/<id>`, `mvc://request/<id>`, `mvc://chat/<id>`, `mvc://notifications`) y toques en
avisos (`resolveNotificationTarget(data)`) pasan por `openTarget`, de modo que cada uno respeta la misma puerta de sesión
y deja `MapHome` debajo. **Desviación**: no se usa la propiedad `linking` de React Navigation (haría que un enlace
sorteara esa puerta); el equivalente está en `navigation/deepLinks.ts` + `deepLinkRuntime.ts`. Los identificadores se
validan (`[A-Za-z0-9_-]{1,64}`). En web los enlaces están desactivados.

Cada pantalla se envuelve en `GuardedScreen`: comprueba `access` (un invitado en una ruta `auth` pasa por
`CreateAccount` y vuelve; alguien sin rol de personal no ve el panel) y en una barrera de errores (si una pantalla falla
al pintar, el resto de la app sigue viva).

## Red

```ts
import { apiRequest, ApiError, errorMessage } from "@/api";
const trip = await apiRequest<Trip>(`/v1/trips/${id}`, { signal });                       // GET: reintenta 2 veces con espera
await apiRequest<Created>("/v1/ride-requests", { method: "POST", body, idempotencyKey });  // POST: nunca se reintenta solo
```

- Errores tipados: `ApiError` (`code`, `status`, `requestId`, `details`), `OfflineError`, `TimeoutError`,
  `AuthExpiredError`. `errorMessage(error)` da un texto en español para el usuario; `registerErrorMessages(map)` añade los
  de un módulo.
- Un 401 a una petición con token cierra la sesión (`authExpired`) y vacía las cachés. Un código OTP incorrecto es 401
  `AUTH_CODE_INVALID_OR_EXPIRED` y NO cierra nada.
- `Idempotency-Key`: `newIdempotencyKey()`; `useApiMutation` la gestiona sola (misma clave al reintentar tras un fallo
  indeterminado).
- Subida de fotos/archivos: `putToSignedUrl(target, source)`.

## Hooks de datos

```ts
const trip = useApiQuery(["trip", id], ({ signal }) => getTrip(id, { signal }), { staleTimeMs: 15_000 });
if (trip.isLoading) return <Skeleton />;
if (trip.isOffline && !trip.data) return <OfflineBanner retryLabel="Reintentar" onRetry={trip.refetch} />;
if (trip.isError && !trip.data) return <ErrorStateCard title="No pudimos cargar el viaje" message={errorMessage(trip.error)} actionLabel="Reintentar" onAction={trip.refetch} />;

const request = useApiMutation((vars: Vars, { idempotencyKey, signal }) => createRequest(vars, { idempotencyKey, signal }),
  { invalidates: [["my-trips"]] });
<Button loading={request.isPending} onPress={() => request.mutate({ tripId })} />

const inbox = usePaginatedQuery(["inbox"], ({ cursor, signal }) => listConversations({ cursor, signal }));
<FlatList data={inbox.items} onEndReached={inbox.fetchMore} refreshing={inbox.isRefreshing} onRefresh={inbox.refresh} />
```

Caché con deduplicación, stale-while-revalidate (si falla la revalidación se conservan los datos y se avisa con
`failedToRefresh`), revalidación al recuperar foco / primer plano / red, cancelación al desmontar y vaciado al cerrar sesión.
`queryCache.invalidate(["trips"])` / `queryCache.setData(key, updater)` para actualizaciones a mano.
Utilidades: `useDebouncedValue`, `useInterval`, `useRefreshOnFocus`, `useConnectivity`, `useIsOnline`, `ErrorBoundary`.

## Plataforma y permisos

`@/platform` no lanza nunca y devuelve uniones explícitas. Permisos: `granted | denied | blocked | unavailable`
(`PermissionResult` añade `canAskAgain` y `undetermined`; `needsSettings(r)` → ofrecer «Abrir ajustes» con
`openAppSettings()`). Cada pantalla que pide un permiso diseña antes la explicación y el estado «sin permiso».

Ubicación (`getCurrentPosition`, `watchPosition`: solo en primer plano), cámara y fotos (`takePhoto`, `captureSelfie`,
`pickPhotoFromLibrary`), documentos, notificaciones (`requestNotificationPermission`, `registerForPushToken`,
`onNotificationTap`), háptica, compartir, portapapeles, abrir mapas/teléfono/SMS/correo/web (`openMapsDirections`,
`callPhone`…), pantalla encendida (`useKeepScreenAwake`), almacenamiento (`secureStorage` para secretos, `preferences`).

Permisos declarados (`app.json`; comprobado con `npx expo config --type introspect`):

- iOS: ubicación «al usar la app», cámara y biblioteca de fotos, con textos en español. **Sin** Face ID, micrófono, ubicación
  «siempre» ni movimiento.
- Android: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `CAMERA`, `POST_NOTIFICATIONS` (+ `INTERNET`, `VIBRATE`).
  Bloqueados: `RECORD_AUDIO`, `ACCESS_BACKGROUND_LOCATION`, `READ/WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`.
- **Ubicación en segundo plano: NO se solicita.** El diseño solo necesita la posición con la app abierta (mapa, recogida,
  viaje en curso con pantalla encendida). Pedir «siempre» obligaría a justificarlo ante Apple y Google y a añadir un
  servicio en primer plano; si el producto lo exige más adelante hay que activarlo en el plugin `expo-location`
  (`isIosBackgroundLocationEnabled`, `isAndroidBackgroundLocationEnabled`), quitar el bloqueo y redactar los textos.

### Decisiones pendientes del propietario (no inventadas)

- iOS `bundleIdentifier` y Android `package` (no están en `app.json`).
- `extra.eas.projectId` (sin él `registerForPushToken()` devuelve `unavailable / no_project_id`; el servidor además tiene
  el envío push desactivado).
- Clave de Google Maps para Android (`MvcMap` usa `PROVIDER_GOOGLE` en Android): `android.config.googleMaps.apiKey`.
- `ITSAppUsesNonExemptEncryption` y la ficha de privacidad de las tiendas.
- `supportsTablet` está en `false` (el diseño es solo móvil en vertical): confirmar.
- Revisar el `AndroidManifest.xml` combinado en el primer build nativo (se bloquearon permisos que ninguna librería
  instalada debería necesitar).

## Vista previa

`App.tsx` llama a `installPreviewIfEnabled()` (`src/preview/install`) ANTES de que nada use la red, y SOLO cuando
`process.env.EXPO_PUBLIC_PREVIEW === "1"`. La condición lleva la expresión literal: Metro la sustituye y elimina la rama
entera, de modo que `src/preview/**` y `src/dev/**` no entran en el paquete de producción (comprobado: 0 apariciones de
`installPreviewIfEnabled` y `UiGallery` en el paquete web de producción).

Los módulos nativos que un navegador no puede dar (cámara, GPS, permisos, SMS, compartir, Keychain…) los sustituye Metro por
`web-stubs/*` SOLO en web; por eso `@/platform` llama siempre a los módulos de Expo, sin ramas «si preview». El puente con el
visor (`platform/previewBridge.ts`) cubre lo que Expo no tiene: márgenes seguros del móvil simulado, `reportScreen`,
pagos simulados. La ruta `UiGallery` (galería del sistema de diseño) solo existe en desarrollo y vista previa.
`window.__mvc` lo construye `src/preview` sobre `navigationRef`, `getRouteCatalog()` (en `navigation/registry`) y
`resetToRoute`.

## Pruebas y comprobaciones

- Unitarias (Node): API (cliente, errores, teléfono, subida firmada, idempotencia), caché de consultas, conectividad,
  sesión (reducer, selectores, servicio), plataforma (permisos, cálculos, enlaces), navegación (puertas, acceso, destino
  pendiente, enlaces profundos, registro de rutas y contrato de las 40 pantallas del producto).
- Integración en navegador real (Chromium + API de mentira, no incluida en el repositorio): arranque con cada estado de
  sesión, modo invitado, `requireAccount` → alta → vuelta al destino, `openTarget`, `completeOnboarding`, sesión caducada,
  puertas por ruta, arranque sin red con copia de `/me` y puesta al día al volver la conexión.
- Sin verificar en dispositivo: todo lo que depende de módulos nativos reales (permisos del sistema, cámara, GPS, push,
  Keychain, enlaces `mvc://` y toques en avisos). Los envoltorios están escritos contra las APIs de Expo 57 y probados en
  su lógica pura.

## Limitaciones conocidas

- Las pantallas de los slices son `PendingScreen` (andamiaje) hasta que cada agente escribe la suya.
- Si la revocación del token en el servidor falla al cerrar sesión, no se reintenta (la sesión local sí se borra).
- El token push no se envía al servidor (`POST /v1/me/push-tokens` lo hará el slice de mensajes/cuenta).
- Las fotos no se limpian de metadatos EXIF antes de subirse.
- No hay endpoint para añadir un rol a una cuenta existente (el rol se elige al pedir el código SMS): `ChooseRole` con
  sesión iniciada y sin rol necesita ese endpoint.
