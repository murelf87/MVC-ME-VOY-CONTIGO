# Contrato app ↔ visor de la vista previa (MVC · Me voy contigo)

Propietario: agente `preview-shell`. Lo consumen `app` (`mobile/src/platform/previewBridge.ts` es su transcripción tipada),
`preview-backend` (`mobile/src/preview/**`), los stubs web (`mobile/web-stubs/*`), las herramientas
(`tools/design/compare.mjs`, `tools/preview/smoke.mjs`) y las pantallas de cada slice. **Solo existe en la vista previa**
(`EXPO_PUBLIC_PREVIEW=1`, navegador). En iOS/Android nada de esto está en el paquete: toda lectura debe ser
`getPreviewShell()?.…` y degradar con elegancia si no existe.

Estado de lo descrito: todo lo de este documento está **implementado y probado en Chromium** con `tools/preview/smoke.mjs`
(flujos `boot`, `system`, `panel`, `routes`), salvo lo marcado «no probado». Lo que simula el visor (permisos, cámara, galería,
compartir, Apple Pay / Google Pay, biometría, SMS, avisos, red, GPS) está **etiquetado como simulación en pantalla** y no toca
nada real: ni cámara, ni ubicación, ni cobros.

## 0. Arquitectura en una frase

`dist-preview/mvc-preview.html` = **visor** (marco del móvil + panel de 340 px + capa del sistema) que lleva dentro, comprimida
(gzip+base64, se descomprime con `DecompressionStream`), la **app real** (`expo export --platform web`) y la monta en un
`<iframe srcdoc>` del tamaño exacto del móvil elegido. Visor y app solo hablan por `postMessage` (funciona aunque el origen sea
opaco, como en el visor de artifacts de claude.ai). Dentro del iframe, `inner.js` (se ejecuta ANTES que el bundle) instala los
globales de ese documento. `dist-preview/mvc-app.html` es la misma app SOLA («modo suelto», sin visor).

```
visor (documento exterior, window.__mvcViewer)      iframe srcdoc (la app)
  marco · barra de estado · isla · inicio             inner.js → globalThis.__MVC_PREVIEW_SHELL__
  capa del sistema (permisos, cámara, pagos…) ←─ postMessage ─→  bundle de la app → window.__mvc (lo escribe la app)
  panel: estás en · perfil · ir a pantalla · simulaciones · correcciones · cómo probarla
```

El documento exterior **no** define `window.__mvc` (así `findAppFrame` de las herramientas encuentra el marco de la app): usa
`window.__mvcViewer` (§7) o llama al marco de la app con Playwright (`frame.evaluate(() => window.__mvc.open(...))`).

## 1. La build de vista previa (`npm --prefix mobile run preview:artifact`)

| Variable | Valor | Quién la lee |
|---|---|---|
| `EXPO_PUBLIC_PREVIEW` | `1` | `App.tsx` → `src/preview/install.ts` (backend en el navegador), `previewBridge.ts`, rutas de desarrollo |

Es la ÚNICA variable que fija la build. `EXPO_PUBLIC_API_URL` **no** se define: `src/api/client.ts` usa
`PREVIEW_FALLBACK_API_URL = "https://api.preview.mvc.invalid"` (un host `.invalid`, reservado) y `install.ts` atiende ese origen
en memoria. La build es **hermética**: se borran del entorno todas las `EXPO_*` ajenas, no se lee ningún `.env`, Metro usa una
caché privada (`dist-preview/.tmp`) y exporta un solo bundle. Metro (`mobile/metro.config.js`) sustituye los módulos nativos por
`mobile/web-stubs/*` **solo cuando `platform === 'web'`**. Todo (bundle, imágenes, fuentes, iconos) va dentro del HTML como
`data:`; el HTML pasa un chequeo estructural de hermeticidad al construirse y una prueba de red con Playwright (cero peticiones).

CSP en ambos documentos: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;
font-src data:; media-src data: blob:; connect-src data: blob:; worker-src blob:` (+ `frame-src about: data: blob:` en el visor).

## 2. Qué decide el visor ANTES de que arranque la app

`window.__MVC_PREVIEW_BOOT__` (JSON síncrono que escribe el visor en el `srcdoc`; también `window.MVC_PREVIEW_PROFILE`).
`inner.js` lo lee y lo deja en `shell.boot`; `src/preview/core/shell.ts` lo vuelve a leer desde `__MVC_PREVIEW_SHELL__.boot`.

```ts
interface PreviewBoot {
  profile: 'new' | 'passenger' | 'driver' | 'admin';   // «Perfil de prueba» del visor
  seed?: string;                                       // semilla de datos
  clock?: string | null;                               // ISO con zona; la hora «de hoy» para el backend y la UI
  device: PreviewDevice;
  sim: PreviewSim;
  permissions: Partial<Record<PreviewPermissionKind, PreviewPermissionStatus>>;
  chrome: boolean;                                     // false con ?chrome=0 o en modo móvil (sin marco)
}
```

Perfiles: `new` = persona nueva (sin sesión; empieza en Bienvenida), `passenger` = Miguel Torres, `driver` = Ana García López
(Seat Arona), `admin` = personal de administración. Cambiar de perfil **reinicia la app** (iframe nuevo) y borra su
almacenamiento (no el del visor, que usa el prefijo `mvcv.*`).

## 3. `globalThis.__MVC_PREVIEW_SHELL__` (lo instala `inner.js`)

El contrato tipado completo (con todos los tipos) está en `mobile/src/platform/previewBridge.ts`; esto es lo que cada
método hace de verdad y qué devuelve. Todas las operaciones del sistema son **asíncronas** y llevan etiqueta «Simulación».

| Miembro | Comportamiento |
|---|---|
| `version` | `1` |
| `boot`, `device`, `sim`, `profile` | `device` y `sim` son getters: **se reemplaza el objeto** al cambiar (no se muta). |
| `permissionStatus(kind)` | Síncrono. Lee la caché de la app, que el visor actualiza con el evento `mvc:preview-permission`. |
| `requestPermission(kind)` | Si ya está `granted`/`blocked` devuelve ese estado SIN diálogo. Si no, el visor dibuja el diálogo del sistema (estilo iOS o Android según `device.platform`) y devuelve el estado final. **iOS**: «No permitir» → `blocked` (no vuelve a preguntar). **Android**: 1.ª negativa → `denied`, 2.ª → `blocked`. «Solo esta vez / Permitir una vez» → `granted` hasta que la app se reinicia. Concurrente: la 2.ª llamada recibe la misma promesa. |
| `setPermission(kind, status)` | Fija el estado sin diálogo (pruebas, «Simulaciones» del panel). |
| `openSettings()` | Abre «Ajustes › MVC» simulado (interruptores por permiso, ubicación Nunca/Preguntar/Al usar/Siempre). Se resuelve al pulsar «‹ MVC». Mientras está abierta la app recibe `visibilitychange` (`hidden` → `visible`) y los cambios llegan como `mvc:preview-permission`. |
| `cameraCapture(opts?)` | Cámara simulada a pantalla completa; el disparador devuelve una **foto de ejemplo rotulada** («FOTO DE EJEMPLO», `example: true`, JPEG `data:`). Cancelar → `null`. `opts.instant` o `?auto=1` la devuelven sin interfaz. |
| `pickImages(opts?)` | «Fototeca» simulada con 6 imágenes de ejemplo y «Elegir un archivo de mi ordenador…» (archivo real, ≤ 8 MB, `example: false`). Cancelar → `[]`. |
| `pickDocument(opts?)` | «Archivos» simulado con PDFs de ejemplo (`data:application/pdf`) o un archivo real. Siempre devuelve **array**. Alias `pickDocuments`. |
| `share(opts)` | Hoja de compartir simulada (Mensajes, Correo, Notas, Copiar): `'shared'` si se elige destino, `'dismissed'` si se cancela. No envía nada. |
| `openExternal(url)` | «¿Abrir enlace externo?» con la dirección; `true` si se acepta (la vista previa **no sale** del navegador: lo dice en el diálogo). |
| `payWithWallet(req)` | Hoja «Simulación de Apple Pay — no se cobra nada» (iOS) o «Simulación de Google Pay — no se cobra nada» (Android). `authorized` + `reference` `SIM-APAY-XXXXXX` / `SIM-GPAY-XXXXXX`, `cancelled`, o `failed` (botón «Simular fallo»). Nunca cobra nada. |
| `biometricPrompt(opts?)` | Diálogo «Simulación de biometría — no se lee ningún rostro ni huella»: `success` / `fail` / `cancel` a elección de la persona. |
| `alert(opts)` | Alerta del sistema; devuelve el `id` del botón pulsado (Escape = el de estilo `cancel`). |
| `saveFile({baseName, data})` | Hoja «Guardar» simulada y descarga real del navegador (`<a download>`): `'saved'` / `'declined'` / `'failed'`. |
| `deliverSms(sms)` | SMS «recibido»: banner del sistema, bandeja del visor y app «Mensajes» simulada (el código resaltado). **Lo llama el backend en memoria al pedir un OTP.** En modo suelto muestra un aviso con el código. |
| `notify(n)` | Banner de notificación (MVC o Mensajes; `tone` info/warning/critical). Si se pulsa: evento `mvc:preview-notification-response` con `{id, data}`. Deslizar hacia arriba lo descarta. |
| `setStatusBar({style, hidden})` | El stub de `expo-status-bar` lo llama; el visor ya adapta el color a lo que hay debajo. |
| `setClock(iso\|null)` | Desplaza `Date.now()`/`new Date()` DE ESTE DOCUMENTO (sustituye `Date`; el tiempo corre desde ese instante). |
| `reportScreen(name, params?)` | La app lo llama en cada cambio de ruta → «Estás en» del visor. (Si no lo llama, `inner.js` sondea `__mvc.route()` cada 300 ms.) |
| `blocked` | `{kind, url}[]` — peticiones a Internet cortadas (`fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`). |
| `isOffline()` | `sim.network === 'none'`. |

**Extensiones** (fuera del contrato tipado; las usan stubs y pruebas): `shell.platform` (= `device.platform`, se actualiza),
`shell.permissions` (caché), `shell.pickDocuments`, `shell.copyToClipboard(text)`, `shell.statusBar` (estado actual),
`shell.errors` (errores de la app reenviados), `shell.boot.standalone`.

### Eventos DOM en la ventana de la app

| Evento | `detail` |
|---|---|
| `mvc:preview-sim` | `PreviewSim` nuevo. Además: `online`/`offline` de `window`, y `navigator.onLine`/`navigator.connection` (con su `change`) reflejan «Sin Internet»; `@react-native-community/netinfo` (stub web) lo lee. |
| `mvc:preview-permission` | `{ kind, status }` |
| `mvc:preview-device` | `PreviewDevice` nuevo (el iframe cambia de tamaño y se dispara `resize`). |
| `mvc:preview-notification-response` | `{ id?, data? }` |

**El backend en el navegador DEBE rechazar con `TypeError('Failed to fetch')` toda petición a la API mientras
`shell.isOffline()`**: el visor no puede cortar lo que `install.ts` atiende antes de que llegue al `fetch` de abajo.
Seguridad de red: `inner.js` instala un `fetch` (y `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon`) que rechaza
cualquier URL que no sea `data:`/`blob:`/`about:` y la anota en `shell.blocked` (el panel muestra «N peticiones cortadas»).
`install.ts` se instala **encima** de ese `fetch`: atiende los hosts `.invalid` y deja pasar el resto hacia abajo.

## 4. `window.__mvc` (lo escribe la app: `mobile/src/preview/install.ts` + `bridge.ts`)

```ts
interface MvcBridge {
  ready(): boolean;                      // contenedor de navegación montado Y backend en el navegador instalado
  route(): string | null;                // nombre de la ruta hoja actual
  params(): Record<string, unknown> | undefined;
  routes(): Array<{ name: string; slice: string; screen?: string; title?: string; params?: Record<string, unknown> | null }>;
  /** Escenario: cierra sesión, re-siembra el backend (profile/seed/clock), inicia sesión como ese perfil, fija el reloj
   *  y navega a `route` con `params` dejando una pila coherente. Resuelve al terminar. */
  open(route: string, params?: Record<string, unknown>, opts?: { profile?: 'new'|'passenger'|'driver'|'admin'; seed?: string; clock?: string | null }): Promise<void>;
  goBack(): void;
  idle?(timeoutMs?: number): Promise<void>;   // sin peticiones del backend en vuelo
  reset?(profile?: string): Promise<void>;    // borra los datos del navegador y vuelve a la primera pantalla
}
```

Quién lo usa: el visor (`routes()` para «Ir a pantalla», `open`, `goBack`, `route/params` para «Estás en»), `compare.mjs`
(`open` + `idle`), `smoke.mjs` y los flujos (`routes`, `open`, `idle`, `profile()` si existe). `inner.js` considera la app
**lista** (`ready` hacia el visor) cuando `__mvc.ready()` es verdadero; si la app no expone `__mvc`, cuando `#root` tiene contenido
(2,5 s) y lo dice el panel («Puente de pruebas ausente»). `routes[].screen` es el número de lámina del diseño («09», «13a»): así
«Estás en» y «Ir a pantalla» enseñan la miniatura del diseño que corresponde.

## 5. Visor → app y app → visor (`postMessage`)

Todos los mensajes llevan `mvc: 1` y solo se atienden si `event.source` es el marco esperado.

| Tipo | Dirección | Contenido |
|---|---|---|
| `{t:'rpc', id, m, a}` / `{t:'rpc-result', id, ok, v, e}` | app → visor → app | Método del sistema (`requestPermission`, `setPermission`, `openSettings`, `cameraCapture`, `pickImages`, `pickDocuments`, `share`, `openExternal`, `copyToClipboard`, `saveFile`, `payWithWallet`, `biometricPrompt`, `alert`, `notify`, `deliverSms`, `sms`). |
| `{t:'event', n, d}` | app → visor | `hello`, `ready`, `screen {route, params}`, `statusbar {light, homeLight, hidden}`, `blocked {kind, url}`, `error {message}` |
| `{t:'event', n, d}` | visor → app | `sim`, `permission`, `device`, `clock`, `notification-response`, `foreground {foreground}` |
| `{t:'call', id, m, a}` / `{t:'call-result', id, ok, v, e}` | visor → app → visor | Llama a `window.__mvc[m](...a)` (p. ej. `open`, `goBack`, `routes`). |

## 6. Reglas para la app en el modo vista previa

- No pases `linking` a `NavigationContainer` en web-preview (la URL del iframe es `about:srcdoc`).
- Alimenta `SafeAreaProvider` con `initialMetrics` = `device.safe*` (`getPreviewSafeAreaMetrics()`): el iframe no tiene
  `env(safe-area-inset-*)`. `inner.js` además responde a `getComputedStyle(...).padding*` con esos márgenes para las vistas que
  usan `env()`.
- `Platform.OS` en web es `'web'`: usa `resolveDevicePlatform()` / `device.platform` para lo que dependa de iOS/Android.
- Cada cambio de ruta: `reportPreviewScreen(name, params)`.
- Los códigos OTP los entrega el backend en memoria con `shell.deliverSms(...)`; **el SMS muestra el código** (simulación etiquetada).
- Pagos: `shell.payWithWallet(...)`; el visor dibuja «Simulación de Apple Pay/Google Pay — no se cobra nada».
- El tema de la app es **solo claro**: el visor fuerza `color-scheme: light` y `matchMedia('(prefers-color-scheme: dark)')`
  devuelve `false` dentro del iframe.
- `window.open` y los `<a href>` externos pasan por `openExternal`: nunca salen del navegador. `history` y
  `localStorage`/`sessionStorage` funcionan dentro de `about:srcdoc` (historial virtual y, si el navegador bloquea el
  almacenamiento, memoria durante la sesión).

## 7. API del visor para herramientas (`window.__mvcViewer`, documento exterior)

```ts
interface MvcViewer {
  version: string;
  state: object;                                   // perfil, móvil, sim, perms, sms, notes, pantalla, puente…
  whenReady(timeoutMs?): Promise<state>;           // la app ha arrancado (evento ready de inner.js)
  call(method, args?, timeoutMs?): Promise<any>;  // llama a window.__mvc[method] en la app
  open(route, params?, opts?): Promise<void>;      // = call('open', …)
  setSim(patch): void;   setClock(iso|null): void; setDevice(id): void; setProfile(id, {wipe?}): Promise<void>;
  setPermission(kind, status): void;
  reload(opts?): Promise<void>;                    // reinicia la app (iframe nuevo)
  pendingDialogs(): number; dismissDialog(): boolean; resetDialogs(): number;
  sms(): Sms[]; notes(): Note[]; blocked(): {kind,url}[]; errors(): string[];
  frame(): HTMLIFrameElement;
}
```

Para encontrar el marco de la app con Playwright: `tools/preview/lib/pw.mjs` → `findAppFrame(page)` (el marco con `__mvc.open`;
con `{requireBridge:false}` el marco con `__MVC_PREVIEW_SHELL__`).

## 8. URL

### Visor (`mvc-preview.html?…`)

| Parámetro | Efecto |
|---|---|
| `chrome=0` | La app sola a pantalla completa de la ventana (sin marco, panel ni barra de estado). Lo usa `compare.mjs`. En ventanas < 760 px de ancho el visor también deja la app a pantalla completa y el panel pasa a ser un cajón (pestaña «PANEL»). |
| `profile=new\|passenger\|driver\|admin` | Perfil inicial (por defecto el último elegido; si no, `new`) |
| `device=iphone15\|promax\|se\|pixel8\|small` | Móvil inicial (con `chrome=0` solo cambia márgenes seguros y plataforma) |
| `route=Nombre&params={json}` | Al arrancar, `__mvc.open(route, params, {profile, seed, clock})` |
| `seed=…` `clock=ISO` | Se pasan al arranque y a `open` |
| `perm=ask\|granted\|denied\|blocked` | Estado inicial de todos los permisos (`ask` = sin preguntar) |
| `autoperm=1` | Responde «Permitir» solo a los diálogos de permisos. `auto=1` resuelve **todos** los diálogos del sistema (permisos, cámara, galería, compartir, pagos, biometría) con el resultado positivo, sin interfaz. |
| `network=wifi\|cellular\|none` `gps=good\|weak\|off` `place=<id>` `status=HH:mm` `screenreader=1` | Simulaciones iniciales |
| `theme=auto\|light\|dark` `panel=0` `section=here\|profile\|goto\|sim\|notes\|how` | Aspecto del visor |

### App suelta (`mvc-app.html?…`, sin visor)

Mismos `profile` (por defecto `passenger`), `device`, `perm` (por defecto `granted`), `seed`, `clock`, `auto` (por defecto `1`:
cámara/galería/pagos devuelven su resultado sin interfaz y los SMS salen como aviso con el código). Útil para pruebas
unitarias de pantalla; no hay panel ni capa del sistema.

## 9. Límites que conviene conocer

- Un navegador no es un móvil: hápticos, ubicación real, GPS en segundo plano, notificaciones push y biometría reales **no
  existen aquí**; el visor los simula (etiquetados) o los omite.
- La cámara y la galería devuelven imágenes de ejemplo rotuladas; la única entrada real es «Elegir un archivo de mi ordenador…».
- `visibilitychange` de «Ajustes» es una simulación: no hay un segundo plano real.
- El mapa es un dibujo propio de la provincia de Sevilla (sin teselas en línea).
- Safari < 16.4 no puede descomprimir la app (`DecompressionStream`): el visor lo dice en pantalla.
- Solo se ha probado en Chromium (el único navegador instalado en la máquina de pruebas); Safari ≥ 16.4 y Firefox no se han probado.
- El teclado en pantalla no se simula: no tapa la pantalla ni recorta la altura del móvil al enfocar un campo.
- Márgenes seguros: `inner.js` hace que `getComputedStyle` de la medición de `react-native-safe-area-context` (web) devuelva los del
  móvil simulado y, al llegar un evento `device`, dispara en esos elementos todos los nombres posibles de `transitionend` para que
  la librería vuelva a medir (Chromium escucha `webkitTransitionEnd`). `__MVC_PREVIEW_SHELL__.safeAreas = { reads, lastTop }`
  (diagnóstico: lecturas de la librería y último `top` entregado) lo usa el flujo `system`. `initialMetrics` de `App.tsx` solo fija el
  primer pintado.
