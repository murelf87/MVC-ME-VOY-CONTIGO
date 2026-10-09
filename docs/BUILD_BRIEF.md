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

---

## 10. FASE 2 — Pantallas pixel a pixel (paquetes de trabajo)

La fase 1 (cimientos) está cerrada. Esta fase construye **las pantallas reales**. El dueño exige «pixel a pixel, 100 % funcional»:
una pantalla no está terminada hasta que, superpuesta a su lámina, no se distingue (salvo fotos/mapa/ilustraciones) y TODOS sus botones hacen algo real.

### 10.1 Punto de partida (honesto)

| Pieza | Estado |
|---|---|
| Sistema de diseño (`@/theme`, `@/ui` 35 componentes, `@/icons`, `@/brand` logo literal, `@/i18n`) | Hecho y medido contra las láminas (galería viva: ruta `UiGallery`; ver `mobile/src/dev/sections/*`). `docs/DESIGN_SYSTEM.md` aún no está escrito: lee `mobile/src/ui/index.ts` y la galería. |
| Mapa (`@/maps`: `MvcMap`, marcadores, chips, mapa base vectorial de Sevilla) | Hecho (`docs/MAPS.md`). |
| Esqueleto: navegación, API tipada, sesión, hooks, plataforma | Hecho (`mobile/README.md`, `mobile/src/navigation/**`, `mobile/src/api/**`, `mobile/src/hooks/**`). |
| Backend en navegador (`mobile/src/preview/**`) | El núcleo sirve el backend 0.14 (auth, perfil, vehículos, documentos, borradores, solicitudes, chat, GPS). **Los endpoints de los módulos nuevos (`/v1/search/trips`, pagos, comunicaciones, confianza, directo…) los escribe cada paquete** en su `preview/*.ts` según `docs/contracts/<módulo>.md`. `docs/PREVIEW_BACKEND.md` aún no está escrito: lee `mobile/src/preview/index.ts`, `core/router.ts` y los ejemplos de `mobile/src/preview/handlers/*.ts`. |
| Backend real (5 módulos, 26+ migraciones, contratos) | Hecho (`docs/contracts/*.md`, `mobile/src/api/types/*.ts`). |
| **Pantallas** | **NO hechas.** Todas las rutas apuntan a `PendingScreen`. Es tu trabajo. |

### 10.2 Tu bucle de trabajo (≈10 s por vuelta; NO exportes)

1. **Servidor de desarrollo único** (Metro, recarga en caliente, modo vista previa): `tools/preview/dev-server.sh status`.
   Si está PARADO → `tools/preview/dev-server.sh start` (1–2 min la primera vez). Si dice que el bundle NO compila por un fichero **que no es tuyo**,
   es otro equipo a mitad de edición: espera 30–60 s y repite (no lo toques). **Nunca arranques otro Metro, ni ejecutes `expo export` /
   `preview:artifact` / `pnpm install`**: de eso se encarga el orquestador (la máquina tiene 2 núcleos y todos compartís este servidor).
   Si Metro se cuelga: `tools/preview/dev-server.sh restart`.
2. **Escribe** tu pantalla (ficheros completos con Write o Edit; en ficheros compartidos con otro equipo —p. ej. `routes.ts`— usa SOLO Edit, nunca Write).
   Metro recompila lo que cambia; no hay nada que reiniciar.
3. **Compara con la lámina**: `node tools/design/compare.mjs --dev --screen 11` (`--screen 13a` · `--variant b`). Genera `design/out/compare/<id>.png`
   (4 paneles: diseño ‖ app ‖ superposición 50 % ‖ diferencia) y `<id>.json` (SSIM, bandas cabecera/cuerpo/base, puntos calientes, desplazamiento
   global). **Abre el PNG con Read y míralo.** El SSIM es una pista, no el objetivo: manda lo que ves en la superposición.
   Necesita un escenario `design/scenarios/<id>.json` (ver `design/scenarios/README.md`): crea el tuyo.
4. **Mide**: `node tools/design/compare.mjs --export-design --screen 11` escribe `design/out/screens-pt/11.png` (la lámina a 393 pt @2x, sin bisel).
   Con Python/PIL amplía y recorta zonas para medir posiciones (1 pt = 2 px). Usa también `design/reference/<id>.jpg`, `design/screens-raw/<id>.png`
   (color real), `design/tokens.json`.
5. **Tipos**: `tools/preview/typecheck.sh src/features/<tu-slice>` (serializado entre todos los equipos —tsc gasta ~1 GB— e incremental: 3–10 s;
   enseña SOLO los errores de tus rutas y cuenta los del resto; debe quedar a 0 en tu parte. Pasa varios filtros si tocas varias carpetas:
   `… src/features/driver src/api/types/trips.ts`). No lances `tsc` por tu cuenta.
   **Pruebas de lógica pura**: `cd mobile && node --import tsx --test "src/features/<tu-slice>/**/*.test.ts"` (node:test; sin importar React Native).
6. **Flujo interactivo con clics reales** (Playwright): escribe `tools/preview/flows/<tu-paquete>.mjs` (ver `tools/preview/README.md` «Escribir un flujo»)
   y ejecútalo con `node tools/preview/smoke.mjs --dev --flow <tu-paquete> --out dist-preview/smoke-<tu-paquete>`. Mide el avance con
   `node tools/preview/smoke.mjs --dev --flow routes --slice <slice> --out dist-preview/smoke-<tu-paquete>`: las rutas de tu paquete
   deben pasar de «pendiente» a «ok».
7. Si algo del sistema de diseño (`@/ui`, `@/icons`, `@/theme`, `@/maps`) no basta: primero un envoltorio local en tu `components/`;
   si el defecto es del componente compartido, corrígelo con una **modificación compatible hacia atrás** (propiedad opcional nueva, arreglo
   medido contra ≥ 2 pantallas) y anótalo en tu informe. Nunca cambies el aspecto por defecto de un componente compartido «a ojo» para una sola pantalla.
   Los glifos nuevos se **añaden** a `mobile/src/icons/glyphs.ts` (solo añadir) copiando el trazo del diseño; no redibujes el logo (`@/brand`).

**No hagas `git add/commit/push`**: el orquestador confirma por bloques. No toques ficheros de otro paquete; si necesitas algo suyo, díselo al
orquestador con `SendMessage` a `main` (nombre de ruta/tipo/parámetro que necesitas) y sigue con lo tuyo.

### 10.3 Catálogo de rutas (contrato entre equipos)

Las **102 rutas** ya existen en `features/<slice>/routes.ts` (apuntando a `PendingScreen`) con su tipo de parámetros. Es un **contrato entre equipos**:
puedes AÑADIR parámetros opcionales y rutas nuevas (nombres únicos en toda la app), nunca renombrar ni quitar; cambia el `component` por tu pantalla real
y rellena `previewParams` (para que «Ir a pantalla» del visor abra la ruta). Los nombres sin lámina son las **páginas de producción adicionales**: se diseñan
**en el mismo lenguaje visual** (mismos componentes, espaciados, tipografía, tonos, iconos y textos con la voz de las láminas), no se improvisan.

| Paquete | Rutas con lámina | Páginas adicionales (sin lámina) |
|---|---|---|
| `auth` | Welcome 01 · ChooseRole 02 · CreateAccount 03 · VerifyPhone 04 · ProfilePhoto 05 · PrivateCheckCapture 06 · PrivateCheckPrivacy 07 · PrivateCheckStatus 08 | SignIn · PrivateCheckOtherWay · LegalAcceptance · PermissionPrompt |
| `search-browse` (buscar y ver) | MapHome 09 · DefineRoute 10 · TripResults 11 · TripDetail 12 | PlaceSearch |
| `search-request` (solicitar y pagar) | PickupPoint 13 · WeeklySeat 14 · ReviewRequest 15 · RequestStatusPayment 16 | PaymentProcessing · PaymentResult |
| `driver` (publicar) | MyVehicle 17 · PublishRoute 18 · StopsRoute 19 · DriverRequests 20 | VehicleForm · VehicleDocuments · RoutePublished · DriverRequestDetail |
| `driver-ops` (operar el viaje) | — | DriverTripManage · DriverCancelTrip · DriverConsole · PickupVerify · ProposeRouteChange · DriverTripFinished |
| `live` (pasajero en directo) | WaitingForCar 21 · RouteChange 22 · InCar 23 · TripFinished 24 | RateTrip · ReportIncident · IncidentReports · IncidentDetail · ShareTrip · SharedTripView · LivePrivacy |
| `messages` | Inbox 25 · BookingChat 26 · Notifications 27 · CancelBooking 28 | NotificationSettings · BlockedUsers · ReportUser · CancelBookingResult · ConversationInfo |
| `profile` | MyProfile 29 · MyTrips 30 · FavoritesRoutine 31 · Plans 32 | EditProfile · VerificationStatus · WeeklyReservation · BookingDetail · FavoriteForm · RoutineEntryForm |
| `account-money` | PaymentsEarnings 33 | PaymentHistory · PaymentMethods · AddPaymentMethod · ReceiptsList · ReceiptDetail · PayoutDetail · EarningDetail · Refunds |
| `account-help` | Settings 34 · HelpCenter 35 · ServiceStatus 36 | LegalCenter · LegalDocument · SupportTickets · SupportNewTicket · SupportTicketDetail · DataExports · DeleteAccount · About |
| `admin-review` | AdminSummary 37 · AdminUsersReview 38 · AdminBookingsRefunds 39 | AdminHome · AdminUserFile · AdminRefundDetail |
| `admin-ops` | AdminTariffsOps 40 | AdminPayoutRuns · AdminTariffVersions · AdminAlerts · AdminAuditLog · AdminLegalDocs · AdminLegalEditor · AdminSupportQueue · AdminSupportTicket |

Carpetas y ficheros propios: `features/<slice>/` (los paquetes que comparten slice usan subcarpetas: `search/browse|request`, `driver/publish|ops`, `account/money|help`, `admin/review|ops`;
y ficheros de vista previa separados: `features/<slice>/preview/<paquete>.ts`, ya creados vacíos). `routes.ts` del slice se comparte: solo Edit.

### 10.4 Definición de «pantalla terminada» (todo lo siguiente)

1. **Pixel a pixel** frente a su lámina (y frente a la variante a/b si la hay): mismos elementos, misma posición y tamaño (±2 pt), mismos textos **literales**
   (incluidos «ejemplo», «Por definir», «Propuesta»), mismos colores (muestréalos de `design/screens-raw`), pesos y tamaños de letra (±0,5 pt), radios (±1 pt),
   iconos con la misma forma, sombras, separadores y estados (activo/inactivo/seleccionado/deshabilitado). Se compara a 393 × `designHeightPt` @2x. Lo que NO puedas
   igualar (foto, mapa con teselas reales, ilustración) se declara en el informe con pantalla y elemento.
2. **Variantes a/b = estados de datos** (§4.3): la app implementa ambas según lo que devuelva la API; el escenario de cada variante las reproduce.
3. **Funcional de verdad**: cada botón/enlace/chip/pestaña/campo hace algo real contra un endpoint (de la vista previa, con el MISMO contrato que el backend real) o navega
   a una ruta que existe. Sin botones decorativos, sin `TODO`, sin «próximamente», sin datos inventados en el código de la pantalla (los datos de ejemplo viven solo en
   `preview/`; las respuestas del preview se anotan con los tipos de `@/api/types/<módulo>` para que `tsc` avise si se separan del contrato).
4. **Todos los estados** con los componentes del sistema: cargando (`Skeleton`), vacío (`EmptyState`), error con «Reintentar» (`ErrorStateCard`), sin conexión (`OfflineBanner`),
   sin permiso/ubicación apagada, sesión caducada (la gestiona la navegación), cuenta de invitado (`requireAccount`), formularios con validación en español y botón
   deshabilitado mientras envía, doble toque protegido, `Idempotency-Key` donde toque (§4.2).
5. **Reglas duras del producto** (§2): economía no activada («Por definir»), una sola provincia, privacidad del mapa, identidad sin biometría facial, nada «pagado» sin confirmación del servidor, etc.
6. **Accesibilidad**: `accessibilityRole/Label`, objetivos táctiles ≥ 44 pt, `testID="<Pantalla>.<elemento>"` en todo lo interactivo, `fontScale` razonable, orden de lectura lógico.
7. **Escenario(s)** en `design/scenarios/<id>.json` (uno por lámina/variante) y `previewParams` en las rutas; **flujo de humo** en `tools/preview/flows/<paquete>.mjs`
   que recorre el camino principal con clics reales y falla ante errores de consola, red externa o texto de obra.
8. **Textos** en un fichero propio de tu paquete (`strings.ts`, español de España); no edites el `es.ts` compartido salvo para AÑADIR claves genéricas.
9. `tsc` a 0 errores y pruebas de tu lógica pura en verde.

Orden de trabajo recomendado: (a) las pantallas de lámina, una a una con su comparación, (b) sus estados y variantes, (c) las páginas adicionales (diseñándolas
con los mismos componentes; pega al lado la lámina más parecida como referencia), (d) flujo de humo, (e) informe. **Entrega pronto lo más visible**: el
orquestador publica la vista previa por bloques para que el dueño vea el avance.

### 10.5 Informe final de paquete (obligatorio, breve)

Por ruta: `Implementado y probado` (comparada con la lámina a ojo + flujo/tests en verde) · `Implementado pendiente de verificar` · `Bloqueado` (decisión o credencial externa:
pagos, SMS real, Google Maps…) · `No implementado`. Con: la última métrica del comparador (SSIM y desplazamiento) de cada lámina, **qué no consigues igualar y por qué**,
endpoints usados (y los que faltan en el backend real), defectos encontrados en ficheros ajenos (archivo:línea) y dependencias nuevas (no instales: pídelas).

### 10.6 Quién implementa cada endpoint en la vista previa (evita rutas duplicadas)

El router de la vista previa **lanza al arrancar** si dos equipos registran la misma ruta, y eso deja muerta la app de TODOS. Reglas:

1. Registra SOLO los endpoints de tu fila. Los que aparecen como «consume» los implementa otro equipo: no los dupliques; si todavía no existen, trabaja con lo que haya y
   avisa al orquestador (`SendMessage` a `main`) con el endpoint exacto que necesitas. Antes de registrar nada: `grep -rn "<ruta>" mobile/src/features/*/preview mobile/src/preview/handlers`.
2. Para sustituir un endpoint del núcleo 0.14 (p. ej. `POST /v1/trips/:tripId/requests`, que el contrato amplía) usa `r.override(...)` (ver `core/router.ts`).
3. Datos compartidos del mundo base (`mobile/src/preview/{seeds,domain,core}`): solo AÑADE (Edit), nunca cambies firmas ni borres; anótalo en tu informe.
   Las colecciones nuevas, con el prefijo de su módulo (`money_`, `comms_`, `trust_`, `live_`, `trips_`); las variantes de datos (`seedVariants`), con el prefijo de tu paquete (`auth-…`, `request-…`).
4. Importes siempre `Money` (céntimos enteros + `status`); respuestas tipadas con `@/api/types/<módulo>` para que `tsc` avise si se separan del contrato real.

| Paquete | Registra (contrato en `docs/contracts/<módulo>.md`) | Consume (de otro paquete / del núcleo) |
|---|---|---|
| `auth` | trust usuario: `GET /v1/me/verification` · `PUT /v1/me/roles` · `GET /v1/me/photo` · `POST /v1/me/photo/upload-intents` y `…/{intentId}/complete` · `GET /v1/me/identity-check` · `POST /v1/me/identity-check/upload-intents` y `…/complete` · `POST /v1/me/identity/documents/upload-intents` y `…/complete` · `GET /v1/public/users/{userId}/photo` · legal: `GET /v1/legal/documents` · `GET /v1/legal/documents/{kind}` · `…/versions/{version}` · `GET /v1/me/legal/status` · `GET /v1/me/legal/acceptances` · `POST /v1/me/legal/acceptances` | núcleo: `/v1/auth/*` (SMS/OTP, sesión) |
| `search-browse` | trips: `GET /v1/trip-categories` · `GET /v1/trips/map` · `GET /v1/search/trips` · `GET /v1/trips/:tripId` · `POST /v1/trips/:tripId/quote` | núcleo: `/v1/provinces*`, `/v1/maps/geocode|reverse` |
| `search-request` | trips: `GET /v1/trips/:tripId/pickup-points` · `POST /v1/trips/:tripId/requests` (override) · `GET /v1/ride-requests/:id` · `POST …/withdraw` · `POST /v1/trips/:tripId/weekly-requests/preview` · `POST …/weekly-requests` · `GET /v1/weekly-reservations/:id` · `POST …/withdraw`; money: `GET /v1/ride-requests/{id}/payment` · `POST …/payment-intents` · `GET /v1/payments/{id}` | `quote` (browse) |
| `driver` | trips: `GET /v1/me/driver/requests` · `GET /v1/me/driver/readiness` · `POST /v1/me/routes/plan` · `POST /v1/me/routes` · `POST /v1/ride-requests/:id/decision` (override) · `POST /v1/weekly-reservations/:id/decision`; vehículos: ampliación `color` (override si hace falta) | núcleo: vehículos, documentos, subidas |
| `driver-ops` | live: `POST /v1/trips/{tripId}/route-changes` · `POST /v1/route-changes/{id}/cancel` · `GET /v1/me/trips/{tripId}/console`; money: `POST /v1/bookings/{id}/driver-cancel`; lo que falte para cancelar un viaje entero (mira primero `handlers/trips.ts` del núcleo) | núcleo: `pickup-verify`, `start`, `complete`, `location`; `GET /v1/route-changes/{id}` (live) |
| `live` | live: `GET /v1/bookings/{id}/live` · `…/in-car` · `…/summary` · `GET /v1/route-changes/{id}` · `POST …/respond` · `POST /v1/trips/{tripId}/ratings` · `POST /v1/incident-reports` · `GET /v1/me/incident-reports` y `…/{reportId}` · adjuntos (`…/attachments` y `…/complete`) · `POST|GET|DELETE /v1/bookings/{id}/share` · `GET /v1/shared-trips/{token}` · `GET|PUT /v1/me/live-privacy` | núcleo: `pickup-code`, `location` |
| `messages` | comms: notificaciones (`GET /v1/notifications` · `unread-count` · `POST …/{id}/read` · `read-all`) · `GET|PATCH /v1/me/notification-preferences` · `GET|POST /v1/me/push-tokens` y `DELETE …/{id}` · conversaciones (`GET /v1/conversations` · `unread-count` · `POST …/direct` · `GET …/{id}` · `GET|POST …/{id}/messages` · `POST …/{id}/read` · `GET …/{id}/call-contact` · `POST …/messages/{mid}/report`) · `GET /v1/me/blocks` · `POST|GET /v1/me/reports`; money: `GET /v1/bookings/{id}/cancellation-preview` · `POST /v1/bookings/{id}/cancel` | núcleo: `PUT|DELETE /v1/me/blocks/:userId` |
| `profile` | trips: `GET /v1/me/trips/overview` · favoritos (`GET|POST /v1/me/favorites`, `PATCH|DELETE …/{id}`) · rutina (`GET /v1/me/routine`, `POST …/entries`, `PATCH|DELETE …/entries/{id}`, `POST …/suspensions`, `DELETE …/suspensions/{weekStart}`, `PUT …/weekly-offer`); money: `GET /v1/plans` · `GET /v1/me/plan` | núcleo: perfil; trust: `GET /v1/me/verification` (auth); trips: `GET /v1/weekly-reservations/:id`, `GET /v1/ride-requests/:id` (search-request) |
| `account-money` | money: `GET /v1/me/payments` · `…/passenger-summary` · `…/driver-summary` · `GET /v1/me/earnings` y `…/{bookingId}` · `GET|POST /v1/me/payment-methods` y `DELETE …/{id}` · `GET /v1/me/receipts` · `…/{id}` · `…/{id}/printable` · `GET /v1/me/payouts` y `…/{id}` · `GET /v1/me/refunds` | `GET /v1/payments/{id}` (search-request) |
| `account-help` | comms: `GET|PATCH /v1/me/settings` · soporte (`GET /v1/me/support/trips` · subidas `…/uploads/intents` y `…/complete` · `GET …/attachments/{id}/download` · `POST|GET /v1/me/support/tickets` · `GET …/{id}` · `POST …/{id}/replies` · `POST …/{id}/close`) · exportaciones (`POST|GET /v1/me/data-exports`, `GET …/{id}`, `GET …/{id}/download`) · eliminación (`GET|POST /v1/me/account-deletion`, `POST …/cancel`); lo que use «Estado del servicio» (36: busca en los contratos y en `handlers/health.ts`) | legal (auth): `GET /v1/legal/documents*`; núcleo: `/v1/auth/logout` |
| `admin-review` | trust: `GET /v1/admin/me` · `GET /v1/admin/summary` · `…/summary/vehicle-activity` · `GET /v1/admin/review/users` y `…/{userId}` · `POST …/{userId}/decision` · `POST /v1/admin/evidence/{kind}/{evidenceId}/access` · `GET /v1/admin/bookings`; money admin: `GET /v1/admin/refund-proposals` y `…/{id}` · `POST …/{id}/approve|reject|execute` | — |
| `admin-ops` | trust: tarifas (`GET /v1/admin/tariffs` · `PUT …/draft` · `POST …/example` · `GET …/versions` · `POST …/versions/{id}/publish`) · `GET|PUT /v1/admin/operations` · alertas (`GET /v1/admin/alerts` · `POST …/evaluate` · `POST …/{id}/status`) · `GET /v1/admin/audit-events` · legal admin (`GET|POST /v1/admin/legal/documents`, `POST …/{id}/publish`) · atención (`GET /v1/admin/support/tickets` · `GET|POST …/{id}[/reply|/assign|/close]` · `POST /v1/admin/support/attachments/{id}/access`); money admin: `GET|POST /v1/admin/payout-runs` · `POST …/{id}/execute` | `GET /v1/admin/me` (admin-review) |

Los tickets de soporte los **crea** `account-help` (lado usuario) y los **atiende** `admin-ops` (lado administración): comparten la colección `comms_support_tickets` (la crea `account-help`; `admin-ops` la lee y la actualiza,
y mientras no exista, siembra la suya con los mismos campos que el contrato `comms.md §9`). Lo mismo con las devoluciones (`money_refunds`: las crea `messages` al cancelar; las revisa `admin-review`)
y con las incidencias (`live_incident_reports`: las crea `live`; las consulta la administración). Si necesitas una colección de otro paquete y aún no está, créala con el esquema del contrato (`docs/contracts`) y nómbrala igual.
