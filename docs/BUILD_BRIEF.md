# MVC · Me voy contigo — Briefing de construcción (léelo entero antes de tocar nada)

Documento interno para quien construya una parte de la app. Todos trabajamos **a la vez** sobre el mismo árbol
(`/home/claude/murelf87/mvc-me-voy-contigo`). Respeta tu propiedad de archivos (sección 8).

## 1. Misión

Construir **MVC · Me voy contigo** («Tu provincia, en movimiento.»): carpooling interurbano dentro de **una sola
provincia española** (primera provincia: **Sevilla**). Código real iOS/Android (Expo/React Native + TypeScript estricto)
y backend real (Node 24 / Fastify 5 / PostgreSQL + PostGIS). El dueño pide:

- **Fiel al diseño, pixel a pixel**: logo exacto, tokens, jerarquía, textos y estados de las 13 láminas aprobadas.
- **100 % funcional, front y backend**: ningún botón decorativo, ningún TODO / placeholder / «próximamente» (salvo lo que
  el propio diseño marca como «Propuesta / No disponible por el momento», que se muestra así, tal cual).
- **Diseñar, en el mismo lenguaje visual, las páginas que falten para producción** (legal, permisos, editar perfil,
  recibos, valoración, incidencias, compartir viaje, eliminar cuenta, estados vacíos/error/offline…).
- Una **vista previa interactiva** (artifact de un solo HTML) que ejecuta la app real contra un backend local en el navegador.

Idioma de toda la UI: **español de España (es-ES)**, con los textos exactos de las láminas.

## 2. Reglas duras (de `PROMPT_MAESTRO_MVC.md`; léelo si tu parte toca economía, pagos, identidad, rutas o seguridad)

1. No reconstruyas lo que ya existe y funciona (backend 0.14: auth OTP, perfiles, vehículos, documentos privados, borradores/publicación de
   viaje con validación PostGIS «una sola provincia», búsqueda por segmentos, solicitudes → aceptación → hold → reserva, GPS, chat 1:1,
   bloqueo, inicio/fin de viaje, código de recogida, motor de dinero en céntimos). Extiéndelo.
2. **Nada falso en el producto**: ni proveedores falsos, ni endpoints inventados, ni saldos simulados, ni «pagado» sin confirmación del servidor.
   Si falta credencial/decisión externa: contrato seguro + integración **desactivada** + documentada como *Bloqueado*.
   (La vista previa del navegador simula un backend de forma explícita y etiquetada; eso vive solo en `mobile/src/preview/**`.)
3. **Economía NO activada**: no hay 0,30 €/km, ni 1 %, ni Premium, ni topes definitivos. Sin tarifa aprobada, todo importe derivado
   viaja como `Money{cents:null,status:"pending_definition"}` y la UI dice **«Por definir»**. El dinero va en **céntimos enteros**.
   Las láminas muestran importes «ilustrativos / propuesta»: la app los muestra solo si la API devuelve `status:"illustrative"` (solo la vista previa).
4. **Una sola provincia por viaje** (origen, paradas, puntos de recogida/bajada y geometría completa). Mensajes de error claros
   («Destino fuera de provincia», «Huelva (sugerida) — Fuera de provincia»).
5. **Identidad/biometría**: la selfie NO acredita identidad; no se activa biometría facial. Foto pública ≠ comprobación privada (almacenamiento
   privado, URL firmadas, auditoría). Siempre hay alternativa («Otra forma de verificar: documento de identidad»).
6. **Privacidad del mapa en vivo**: ubicación aproximada para público; precisa solo para participantes autorizados; nunca «en directo» una posición vieja.
7. Autorización por recurso (nadie lee chats, posiciones, reservas ni documentos ajenos). Auditoría en operaciones sensibles.
8. Etiquetas honestas en cualquier informe: **Implementado y probado / Implementado pendiente de verificar / Bloqueado / No implementado**.
   Nunca declares «producción lista».
9. No toques otros proyectos (EmgSOS en `/home/claude/murelf87/emgsos` es **solo lectura**: puedes copiar de él, nunca escribir). No hagas `git push` ni abras PR.

## 3. Material de diseño (fuente de verdad visual)

Todo en `design/` (no versionado salvo `reference/`, `logo/`, `manifest.json`; se regenera con `python3 tools/design/slice_boards.py <carpeta>`):

- `design/boards/<id>.png` — las 13 láminas originales (1536×1024). 
- `design/screens/<NN><v>.png` — cada pantalla recortada y normalizada **por ancho a 786 px (= 393 pt @2x)**, sin deformar; la altura es la de su lámina.
- `design/screens-raw/<NN><v>.png` — recorte nativo (≈358 px de ancho) sin reescalar; úsalo para muestrear color o comparar a 1×.
- `design/reference/<NN><v>.jpg` — 393 px de ancho (1×) para consulta rápida.
- `design/manifest.json` — por pantalla: lámina, variante, `screenBox`, **`designHeightPt`** (altura de diseño en pt; ≈775–860 según lámina), `ptPerRawPx`.
- `design/logo/` — logo oficial **vectorizado literal** (`layers.json`, `mvc-logo.svg`, `mvc-icon.svg`, `mvc-word.svg`). Colores del logo: azul `#044DFD`, verde `#26CDA1`, navy `#000928`. **Prohibido redibujar el logo**; solo usar estas capas.

Las láminas están generadas, así que **cada lámina tiene su propia escala vertical** (altura de diseño 775–860 pt). Protocolo de fidelidad:
1. Construye con un layout flexible real (funciona en 393×852 y en otros tamaños).
2. Para comparar, renderiza la pantalla en un viewport de **393 × `designHeightPt`** (DPR 2) y compárala con `design/screens/<NN>.png`
   (herramienta `tools/design/compare.mjs`, la entrega el agente de vista previa; mientras no exista, usa tu propio Playwright en `/opt/node22/lib/node_modules/playwright`).
3. Ignora en la comparación las esquinas redondeadas del marco (radio ≈ 55 pt) y la barra de estado/isla (la dibuja el visor, no la app).
4. Ajusta posición, tamaño de fuente, interlineado, colores, radios, iconos y espaciados hasta que superpuestas coincidan (objetivo: desviación ≤ 2–3 pt en cada elemento).
   Informa con honestidad de lo que NO consigas igualar (iconos distintos, fotos de baja resolución, mapas reales).
5. Textos: copia **literalmente** los de la lámina (incluidos «ejemplo», «Por definir», «Propuesta»). Si dos variantes (a/b) difieren, la app implementa los dos
   estados según los datos (ver sección 4.3).

### 3.1 Mapa lámina → pantalla → slice → ruta

| Lámina (archivo) | Pantallas | Notas |
|---|---|---|
| 01 `e3c876ab` | 01 `Welcome`, 02 `ChooseRole`, 03 `CreateAccount`, 04 `VerifyPhone` | slice `auth` |
| 02 `0fa52456` | 05 `ProfilePhoto`, 06 `PrivateCheckCapture`, 07 `PrivateCheckPrivacy`, 08 `PrivateCheckStatus` | slice `auth` |
| 03 `647e77cf` | 09 `MapHome`, 10 `DefineRoute`, 11 `TripResults`, 12 `TripDetail` | slice `search` |
| 04a `94f0c2a7` / 04b `9946a6cc` | 13 `PickupPoint`, 14 `WeeklySeat`, 15 `ReviewRequest`, 16 `RequestStatusPayment` | slice `search`; **04b** (ejemplo 0,30 €/km, «Importes ilustrativos; no son tarifas finales») y 04a (todo «Por definir») son dos estados del mismo flujo |
| 05 `ef66f2a7` | 17 `MyVehicle`, 18 `PublishRoute`, 19 `StopsRoute`, 20 `DriverRequests` | slice `driver` |
| 06 `4935dd58` | 21 `WaitingForCar`, 22 `RouteChange`, 23 `InCar`, 24 `TripFinished` | slice `live` |
| 07 `4b3da40f` | 25 `Inbox`, 26 `BookingChat`, 27 `Notifications`, 28 `CancelBooking` | slice `messages` |
| 08 `161c43cd` | 29 `MyProfile`, 30 `MyTrips`, 31 `FavoritesRoutine`, 32 `Plans` | slice `profile` |
| 09a `635cb7c8` / 09b `b1e81622` | 33 `PaymentsEarnings` (pasajero con «--,-- €» / pasajero con datos / conductor), 34 `Settings`, 35 `HelpCenter`, 36 `ServiceStatus` («Estados de error»: 4 tarjetas) | slice `account`; **09b** es la revisión con datos; los captions de 09b están desplazados (3.ª = Ajustes, 4.ª = Centro de ayuda con «Si es urgente») |
| 10a `2241038a` / 10b `088f251c` | 37 `AdminSummary`, 38 `AdminUsersReview`, 39 `AdminBookingsRefunds`, 40 `AdminTariffsOps` | slice `admin`; 10a/10b difieren en tarifas (borrador 0,30 vs 0,18 €/km; «Identidad · En revisión» vs «DNI verificado») → ambos son estados de datos |

El logo aparece en 01 (apilado: icono + MVC + «Me voy contigo») y en cabeceras de láminas (horizontal).

### 3.2 Decisiones de navegación derivadas del diseño
- **Pila única** (`@react-navigation/native-stack`, `headerShown:false`): cada pantalla pinta su propia cabecera (chevron azul atrás + título centrado azul) con `ScreenHeader`.
- La **barra inferior** (Mapa · Viajes · Publicar(+) · Mensajes · Perfil) aparece **solo en `MapHome`** (como en la lámina 09); Viajes/Publicar/Mensajes/Perfil son pantallas empujadas con chevron atrás.
- Panel de administración: solo si el usuario tiene rol de personal; se entra desde Ajustes («Panel de administración», visible solo para personal).
- «Explorar sin registrarme» entra en `MapHome` en modo invitado (puede buscar y ver; para solicitar plaza se pide cuenta).

## 4. Convenciones de la app móvil (`mobile/`)

### 4.1 Estructura
```
mobile/
  App.tsx index.ts app.json metro.config.js tsconfig.json
  assets/ (fonts, design/ = arte recortado de las láminas)
  web-stubs/ (sustitutos SOLO para web/vista previa de módulos nativos)
  src/
    theme/ ui/ icons/ brand/ i18n/          ← sistema de diseño (propiedad del agente `ds`)
    navigation/ api/ session/ hooks/ platform/  ← esqueleto (propiedad del agente `app`)
    maps/                                    ← mapa (agente `map`)
    preview/                                 ← backend en navegador + núcleo de vista previa (agente `preview-backend`)
    features/<slice>/                        ← pantallas por slice
         routes.ts       tipos de parámetros + lista de rutas del slice
         index.ts        export { routes }
         screens/ components/ hooks/
         api.ts          funciones de red del slice (usa src/api/client)
         preview/handlers.ts   handlers del backend en navegador para los endpoints que usa el slice
    legacy/                                  ← código antiguo, SOLO LECTURA (referencia de lógica de red/subida privada); no importar desde código nuevo
```
Alias: `@/…` → `mobile/src/…`. TypeScript `strict`; **prohibido `any`** salvo en bordes tipados con comentario. Sin lógica de red dentro de componentes: pantalla → hook → `features/<slice>/api.ts` → `src/api/client`.

### 4.2 Reglas de pantalla
- Cada pantalla: estados **cargando / vacío / error (con reintento) / sin conexión / sin permiso** diseñados con los componentes del sistema (`ErrorState`, `Banner`, `Skeleton`…). Formularios con validación y mensajes en español.
- `testID` obligatorio en elementos interactivos y contenedores: `"<Pantalla>.<elemento>"` (p. ej. `TripResults.card.0`, `CreateAccount.submit`).
- Accesibilidad: `accessibilityRole`, `accessibilityLabel` en iconos/botones sin texto, tamaño táctil ≥ 44 pt, soporte de `fontScale` razonable.
- Safe areas reales (`react-native-safe-area-context`); no asumas isla dinámica.
- Dinero: `formatMoney(m: Money)` (de `@/i18n`) — «4,00 €», «Por definir», y etiqueta «ilustrativo» si procede. Fechas: `formatDate…` en español («Lunes, 7 de abril de 2026»).
- Idempotencia: acciones que crean cosas (solicitar plaza, pagar, publicar) envían cabecera `Idempotency-Key` (uuid) y toleran reintento.
- Datos: nunca inventes datos en la app. Si el backend no lo da, la pantalla lo dice (vacío/«Por definir»). Los datos de ejemplo viven solo en la vista previa.

### 4.3 Variantes de las láminas = estados de datos
Si dos láminas (a/b) de la misma pantalla difieren por **contenido**, impleméntalo como estados de los datos (p. ej. «--,-- €» cuando no hay datos, importes cuando existan), no como pantallas distintas. La vista previa debe poder reproducir **cada variante** (ver «escenarios», sección 6).

### 4.4 Contratos (API)
- Tipos compartidos en `mobile/src/api/types/`: `common.ts` (Money, PublicUser, Page, Uuid, IsoDateTime…), y un archivo por módulo backend (`trips.ts`, `live.ts`, `money.ts`, `comms.ts`, `trust.ts`) que **escribe el propietario del módulo backend ANTES de implementar** (contrato primero), más `docs/contracts/<módulo>.md` (endpoints, auth, request/response, errores, máquinas de estado). Los schemas Fastify deben producir exactamente esos tipos.
- Error de API: `{ error:{ code, message, details? }, requestId }` (ya existente). Códigos estables en MAYÚSCULAS_SNAKE.
- Paginación: `Page<T>` con cursor opaco. Fechas ISO-8601 UTC; fechas de calendario `YYYY-MM-DD` (Europe/Madrid).
- Todos los endpoints nuevos: `/v1/...`, Bearer opaco, schema completo (params, query, body, response, security, tags, summary en español), validación estricta.
- `docs/openapi.json` se **genera** con `npm run openapi:export` (desde los schemas Fastify). No lo edites a mano.

## 5. Convenciones del backend (`src/`)
- Módulos nuevos en `src/modules/<trips|live|money|comms|trust>/` (cada uno registrado en `src/modules/register.ts`; ya existe un `index.ts` vacío por módulo). Servicios con `pg` y transacciones; SQL parametrizado; sin ORM.
- Reutiliza: `src/auth/session.ts` (`resolveSession`, `readBearerToken`, `requireAnyRole`), `src/errors.ts` (`DomainError`), `src/lib/notify.ts` (`notify()` → tabla `notifications`), `src/lib/audit.ts` (`writeAudit()`), `src/lib/dto.ts` (`moneyDefined`, `moneyPending`), `src/domain/money.ts`.
- **Migraciones**: rangos propios — `trips` 020–029, `live` 030–039, `money` 040–059, `comms` 060–079, `trust` 080–099 (`012` ya existe: tabla `notifications`). Nombre `0NN_descripcion.sql`, idempotentes dentro de su transacción. Solo referencian tablas base (001–012) o las propias del módulo; **no dependas de tablas de otro módulo nuevo**.
- **Base de datos de pruebas propia por módulo** (el clúster PG16+PostGIS ya corre en `127.0.0.1:5432`, rol `mvc`, clave `mvc_local_test`): `mvc_trips`, `mvc_live`, `mvc_money`, `mvc_comms`, `mvc_trust`. Ejemplo:
  `export DATABASE_URL=postgres://mvc:mvc_local_test@127.0.0.1:5432/mvc_trips; MIGRATIONS_EXCLUDE="040-099" npm run db:migrate`
  (`MIGRATIONS_EXCLUDE` omite los rangos de otros módulos para que sus migraciones a medio escribir no te rompan). **Nunca uses `mvc_test` ni otra base ajena.**
- Pruebas: unitarias en `tests/unit/*.test.ts`; integración en `tests/<modulo>-*.integration.test.ts` (patrón `tests/*.integration.test.ts`), con su `beforeEach` de truncado **solo de tus tablas + las que sembraste**, y casos de autorización (acceso ajeno → 403/404), concurrencia y reglas de dominio. Ejecuta: `node --import tsx --test --test-concurrency=1 tests/<tu>.integration.test.ts`.
- `npm run typecheck` debe pasar (tu parte). Si ves errores en archivos de otro módulo, **no los arregles**: repórtalos.
- Configuración nueva → `src/config.ts` + `.env.example`, **desactivada por defecto** (`*_PROVIDER=disabled`).
- Hora del servidor puede ser Europe/Madrid o UTC: no dependas de la zona del proceso (fechas de calendario como `YYYY-MM-DD` en SQL con `AT TIME ZONE 'Europe/Madrid'`).

## 6. Vista previa interactiva (artifact)
- Se construye con `npm run preview:artifact` (agente `preview-shell`) → `dist-preview/mvc-preview.html` (un solo archivo ≤ 16 MB; solo scripts inline).
- Modo vista previa: `EXPO_PUBLIC_PREVIEW=1`. `src/preview/install.ts` (agente `preview-backend`) intercepta `fetch` hacia `API_URL` y sirve el **mismo contrato** desde un backend en memoria con datos de Sevilla. SMS/cámara/pagos/permisos/mapa se **simulan de forma explícita** (visor: «Simulación»).
- Cada slice registra sus endpoints en `features/<slice>/preview/handlers.ts`:
  `export function registerPreview(r: PreviewRouter, db: PreviewDb): void` (API del núcleo en `src/preview/core`).
- **Escenarios**: `design/scenarios/<NN><v>.json` = cómo llegar a la pantalla del diseño en la vista previa
  `{ "screen":"11", "profile":"passenger", "route":"TripResults", "params":{…}, "seed":"…", "clock":"2026-10-05T07:17:00+02:00" }`.
  `window.__mvc.open(route, params, {profile, seed})` es el puente que usa la herramienta de comparación.
- Perfiles de prueba: **Persona nueva · Pasajero (Miguel) · Conductor (Ana) · Administración**. Personajes del diseño: Ana García López (conductora, Seat Arona/León), Miguel Torres, Laura, Carlos, Marta.
- Los avatares/fotos son recortes de las láminas (personas ficticias de ilustración): **solo vista previa**; el producto usa fotos subidas por el usuario.

## 7. Calidad exigida
- `pnpm typecheck` (mobile) y `npm run typecheck` (backend) sin errores en tu parte; sin `console.log` de depuración; sin código muerto.
- Cada botón hace algo real contra un endpoint real (o navegación real). Si no existe el endpoint, **créalo en el backend** (o pídelo en el informe) en vez de dejar el botón vacío.
- Comandos pesados (export web, Playwright, builds) **siempre** con `flock /tmp/mvc-heavy.lock <comando>`: la máquina tiene 2 núcleos y 7 GB.
- No instales dependencias sin avisar: el `package.json` lo comparten todos (si necesitas una, añádela con `pnpm add` en `mobile/` y lístala en tu informe).

## 8. Propiedad de archivos (si algo no es tuyo, no lo edites: repórtalo)

| Agente | Propietario de |
|---|---|
| `ds` (sistema de diseño) | `mobile/src/{theme,ui,icons,brand,i18n,dev}/**`, `mobile/assets/**`, `mobile/src/assets/**`, `design/tokens.json`, `docs/DESIGN_SYSTEM.md`, `tools/design/extract_assets.py` |
| `app` (esqueleto) | `mobile/{App.tsx,index.ts,app.json,tsconfig.json,README.md}`, `mobile/src/{navigation,api(excepto types/<módulo>.ts),session,hooks,platform}/**`, `mobile/src/features/*/{routes.ts,index.ts}` (stubs) |
| `map` | `mobile/src/maps/**`, `mobile/web-stubs/react-native-maps.js`, `mobile/web-stubs/map-data/**`, `tools/preview/map/**` |
| `preview-shell` | `tools/preview/**` (excepto `map/`), `tools/design/compare.mjs`, `mobile/metro.config.js`, `mobile/web-stubs/*` (excepto mapas), `dist-preview/` |
| `preview-backend` | `mobile/src/preview/**`, `mobile/src/features/*/preview/handlers.ts` (solo los stubs iniciales), `design/scenarios/**` (los de los endpoints existentes) |
| `be-trips` | `src/modules/trips/**`, `migrations/02x`, `tests/*trips*`, `docs/contracts/trips.md`, `mobile/src/api/types/trips.ts` |
| `be-live` | `src/modules/live/**`, `migrations/03x`, `tests/*live*`, `docs/contracts/live.md`, `mobile/src/api/types/live.ts` |
| `be-money` | `src/modules/money/**`, `migrations/04x–05x`, `tests/*money*`, `docs/contracts/money.md`, `mobile/src/api/types/money.ts` |
| `be-comms` | `src/modules/comms/**`, `migrations/06x–07x`, `tests/*comms*`, `docs/contracts/comms.md`, `mobile/src/api/types/comms.ts` |
| `be-trust` | `src/modules/trust/**`, `migrations/08x–09x`, `tests/*trust*`, `docs/contracts/trust.md`, `mobile/src/api/types/trust.ts` |
| Slices front (fase 2) | `mobile/src/features/<su slice>/**` (excepto stubs ya creados que sí pueden editar), `design/scenarios/<sus pantallas>.json` |

Ficheros compartidos que **solo el orquestador** edita: `package.json`/`pnpm-lock.yaml` (consúltalo), `src/app.ts`, `src/modules/register.ts`, `docs/openapi.json`, `docs/STATUS*`, `docs/BLOCKERS.md`, `README.md`.

## 9. Informe final (obligatorio, breve)
1. Qué entregaste (archivos clave) y cómo se prueba (comandos exactos).
2. Evidencia: salida resumida de typecheck/tests/compare (números reales).
3. **Honestidad**: lo que no pudiste hacer / lo que queda *Bloqueado* o *No implementado* / desviaciones respecto al diseño (con pantalla y elemento).
4. Defectos encontrados en archivos que no son tuyos (archivo:línea, descripción) y dependencias nuevas añadidas.
