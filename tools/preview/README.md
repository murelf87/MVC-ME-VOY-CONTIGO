# tools/preview — vista previa interactiva de MVC en un solo HTML

La app REAL (React Native + Expo, `expo export --platform web`) dentro de un visor con marco de móvil y un panel de pruebas,
en **un único fichero** (`dist-preview/mvc-preview.html`, < 16 MB, cero peticiones externas). Sirve para que una persona abra
la app como en un móvil, salte a cualquier pantalla del diseño, fuerce situaciones difíciles (sin Internet, GPS apagado, permisos
denegados, otra hora) y apunte correcciones. Para las máquinas hay un puente (`window.__mvc`) y un corredor de pruebas.

**No es la distribución de la app** (iOS/Android usan builds nativas). El servidor es un backend en memoria
(`mobile/src/preview`) con datos de ejemplo de Sevilla; lo que un navegador no puede dar (permisos del sistema, cámara,
galería, SMS, compartir, Apple Pay / Google Pay, biometría, avisos) lo SIMULA el visor y lo etiqueta como «Simulación». Nada
cobra, envía ni lee nada real.

```
npm --prefix mobile run preview:artifact        construir  →  dist-preview/mvc-preview.html (+ mvc-app.html, build-report.json)
open dist-preview/mvc-preview.html              (o arrástralo a Chrome/Safari/Firefox; también funciona como artifact de claude.ai)
npm --prefix mobile run preview:smoke           humo: todos los flujos en Chromium sin cabeza
node tools/design/compare.mjs --screen 11       app ↔ diseño (ver tools/design/README.md)
```

Todo lo pesado (exportar, Playwright) pide `/tmp/mvc-heavy.lock` con `flock` (la máquina es compartida): si otro agente está
construyendo o probando, espera su turno. `--no-lock` lo omite (solo si ya lo tienes).

## Qué hay aquí

| Ruta | Qué es |
|---|---|
| `build-artifact.mjs` | Exporta la app (hermética: `EXPO_PUBLIC_PREVIEW=1`, un solo bundle) y monta los HTML con todo dentro |
| `shell/` | Visor y su contrato: `viewer.html/.css`, `system.css`, `viewer-core/system/panel/main.js`, `inner.js` (corre DENTRO de la app antes del bundle) y **`API.md`** (el contrato app ↔ visor, léelo antes de tocar nada) |
| `smoke.mjs` | Corredor de flujos de Playwright |
| `flows/*.mjs` | Los flujos: `boot`, `system`, `panel`, `stubs`, `routes` (+ los que añada cada slice) |
| `lib/pw.mjs`, `lib/flow.mjs`, `lib/heavy.mjs` | Playwright/Chromium, sesión de prueba con vigilancia de errores y red, bloqueo `flock` |
| `lib/web-stubs.mjs`, `lib/stubs-harness.mjs`, `lib/stubs-entry.js` | Qué sustitutos web hay y si cubren lo que la app importa (aviso en la build); arnés con esbuild que ejecuta cada sustituto contra el shell real (flujo `stubs`) |
| `map/` | (no es de esta herramienta) mapa base de Sevilla |
| `../../mobile/web-stubs/*`, `../../mobile/metro.config.js` | Sustitutos web de los módulos nativos de Expo (solo con `platform==='web'`), hablan con el visor |

## Construir

```
npm --prefix mobile run preview:artifact [-- --skip-export] [-- --clean] [-- --no-thumbs] [-- --keep-web] [-- --no-lock]
```

1. `expo export --platform web` con el entorno limpio de `EXPO_*` (más `EXPO_PUBLIC_PREVIEW=1`, `EXPO_NO_DOTENV=1`,
   `EXPO_NO_BUNDLE_SPLITTING=1`, `EXPO_OFFLINE=1`), caché de Metro privada (`dist-preview/.tmp`), `--max-workers 2`,
   `--max-old-space-size=3072`. Arranque en frío ≈ 30 s con la app actual; con caché menos.
2. Monta `dist-preview/mvc-app.html` (la app sola) y `dist-preview/mvc-preview.html` (visor + app comprimida), con imágenes,
   fuentes e iconos como `data:` (solo las fuentes de iconos de los juegos que `mobile/src` importa; un recurso de más de
   1,5 MB no se mete en línea porque Chrome rechaza URLs de más de 2 MB), CSP restrictiva y comprobación estructural de
   hermeticidad. Falla si pasa de 16 MB (avisa desde 12).
3. Comprueba que los sustitutos web (`mobile/web-stubs/*`) **exportan todo lo que `mobile/src` importa** de cada módulo de Expo
   sustituido (compilador de TypeScript, ~1 s): un nombre que falta no rompe la build pero sí la pantalla que lo llama, así que
   la build avisa (`⚠ expo-location: la app usa «X» … no lo exporta`) y lo deja en `build-report.json` (`stubCoverage`). Aviso, no error.
4. `dist-preview/build-report.json`: qué se ha incluido y cuánto pesa.

| Opción | Efecto |
|---|---|
| `--skip-export` | Reutiliza `dist-preview/web` y solo vuelve a montar los HTML (cambios en `shell/`: unos segundos) |
| `--clean` | Borra también la caché de Metro (primera build lenta) |
| `--no-thumbs` | Sin miniaturas de los diseños (necesita Python 3 + Pillow para generarlas; si faltan, la build lo avisa y el panel funciona sin ellas) |
| `--keep-web` | No borra `dist-preview/web` antes de exportar |

**Si la app no compila ahora mismo** (ruta o import que otro equipo aún no ha escrito) la build NO se inventa nada: sale con
código **3**, imprime los ficheros/imports rotos que Metro ha encontrado (`mobile/src/…: no existe el módulo «…»`) y los guarda
en `build-report.json` (`exportFailed: true`). Mientras tanto `smoke.mjs` y `compare.mjs` se niegan a probar el HTML antiguo
(`--stale-ok` lo salta a sabiendas). Este script nunca arregla ficheros de otros equipos: se informa al responsable del slice.
Códigos de salida: `0` bien · `1` error de montaje · `3` la app no compila.

## Usar el visor

Abre `mvc-preview.html`. A la izquierda el móvil (iPhone 15, 393×852; también Pro Max, SE, Pixel 8 y 320 px); a la derecha el
panel de 340 px con seis secciones:

- **Estás en** — pantalla actual, su diseño (miniatura y lámina), perfil, móvil, estado del puente, «Atrás» y «Reiniciar la app».
- **Perfil de prueba** — Persona nueva · Pasajero · Conductor · Administración (reinicia la app con datos de Sevilla de ese perfil),
  semilla de datos y «Borrar datos y empezar de cero».
- **Ir a pantalla** — buscador de las láminas del diseño y de todas las rutas de la app; un clic abre la pantalla con su
  perfil, parámetros y hora.
- **Simulaciones** — móvil, conexión (Wi-Fi / datos / sin Internet), GPS, lugar de Sevilla, permisos del sistema, reloj (hora de
  Madrid), hora de la barra de estado, lector de pantalla, SMS y notificaciones de prueba, tema del visor.
- **Correcciones** — anotar lo que está mal con la pantalla, el perfil y el móvil; copiar / ver / descargar `.md` / borrar.
- **Cómo probarla** — pasos, qué es real y qué simulado, límites, datos de la compilación.

`?chrome=0` muestra la app sola. En ventanas de menos de 760 px el visor deja la app a pantalla completa (modo móvil) y el panel
es un cajón (pestaña «PANEL»). El visor sigue el modo claro/oscuro del sistema; **la app es siempre clara**. Parámetros de URL y
API para herramientas: `shell/API.md` §7–§8.

## Humo y flujos

```
npm --prefix mobile run preview:smoke [-- <opciones>]
node tools/preview/smoke.mjs --list                        # flujos disponibles
node tools/preview/smoke.mjs --flow boot,system            # solo esos
node tools/preview/smoke.mjs -v                            # cada paso según termina
node tools/preview/smoke.mjs --flow routes --slice search  # el flujo «routes» acotado a un slice (o --route Nombre,Otra, --shots)
node tools/preview/smoke.mjs --url file:///…/mvc-app.html  # la app suelta en vez del visor
node tools/preview/smoke.mjs --allow-console "regex"       # tolera un error de consola concreto (repetible)
```

Otras opciones: `--out <dir>` (capturas e informe; por defecto `dist-preview/smoke`) · `--viewport 1400x900` · `--timeout <s por flujo>`
· `--action-timeout <s por acción de Playwright, 10>` · `--json` · `--no-lock` · `--stale-ok`. Código de salida: `0` todo bien
(los pasos saltados no fallan) · `1` algún flujo falla · `2` uso o prerrequisitos (no hay HTML, la última build falló…).
Informe: `dist-preview/smoke/report.json`; capturas en `dist-preview/smoke/<flujo>/*.png`.

**Cada flujo falla** si, en cualquier momento:

- hay un **error de consola** o una excepción no controlada;
- se hace una **petición a cualquier origen que no sea el propio HTML** (`data:`, `blob:` y `about:` no cuentan) o se abre un WebSocket;
- la app intenta salir a Internet (`shell.blocked` no vacío; el flujo que PRUEBA el corte lo declara con `s.allowBlocked = true`);
- (los flujos que miran una pantalla de la app) se ve un **marcador de obra**: `PendingScreen`, «Pantalla sin implementar», «Próximamente»,
  `lorem`, «coming soon», `FIXME`, `TODO:`/`TODO(`/`TODO[`, o un elemento `data-testid="<Ruta>.pending"`.
  *Desviación del encargo, declarada:* el patrón literal `/PendingScreen|TODO|Próximamente|lorem/i` con la `i` coincide con la palabra
  española «todo» (`Todo listo`, `todos los viajes`) en cualquier pantalla; `TODO` se busca como marcador de obra (con `:`/`(`/`[`)
  y distinguiendo mayúsculas. Además se añade el texto visible real de la pantalla provisional del andamiaje.

### Los flujos que hay

| Flujo | Qué prueba |
|---|---|
| `boot` | Visor + marco + barra de estado + isla; seis secciones del panel en orden; «Estás en» = `__mvc.route()`; primera pantalla sin marcadores de obra ni salidas; `?chrome=0` (393×852, sin panel) |
| `system` | La capa del sistema simulada: permisos iOS/Android (incluido «No permitir» → bloqueado y dos negativas en Android), Ajustes simulados + foreground, cámara, galería y archivos, compartir, abrir enlaces (también `<a href>`), Apple Pay / Google Pay (etiqueta «no se cobra nada»), biometría, alertas, notificaciones y SMS (bandeja + app Mensajes), sin Internet (fetch cortado, `offline`/`online`), reloj, GPS, cambio de móvil, app solo clara frente a visor oscuro, historial/almacenamiento, guardar archivo |
| `stubs` | Cada sustituto web de Expo (`mobile/web-stubs`) **ejecutado de verdad** contra el shell real, sin la app (arnés con esbuild, `dist-preview/stubs-harness.html`): permisos (`undetermined/granted/denied/blocked`), GPS bueno/débil/apagado, posición, seguimiento, geocodificación, avisos locales y pulsación, cámara y galería de ejemplo, `CameraView`, `StatusBar`, hooks de permisos, almacenamiento seguro, portapapeles, enlaces, red (Wi-Fi/datos/sin Internet), idioma, keep-awake. Sin esbuild se salta con el motivo |
| `panel` | Cada sección del panel contra el puente real: «Ir a pantalla» (buscar, saltar, miniaturas), perfiles, semilla, simulaciones, notas (Markdown + descarga), ocultar panel, modo móvil con cajón |
| `routes` | Abre TODAS las rutas de `__mvc.routes()` con el perfil de su slice y cuenta ok / pendientes / redirigidas / con error (`dist-preview/smoke/routes/routes.json`). Es el medidor de avance: falla mientras alguna ruta siga siendo la pantalla provisional |

### Escribir un flujo (por slice)

Crea `tools/preview/flows/<slice>.mjs` (los ficheros que empiezan por `_` se ignoran). Exporta `meta` y una función por defecto:

```js
export const meta = { description: 'búsqueda y reserva (slice search)', timeoutSeconds: 120 };

export default async function search(s) {
  await s.open('?profile=passenger&perm=granted');       // visor; espera a que la app arranque
  await s.requireBridge();                               // salta el flujo si la app aún no expone window.__mvc

  await s.step('abre los resultados con datos de ejemplo', async () => {
    await s.inApp(() => window.__mvc.open('TripResults', { from: 'sevilla-este', to: 'uni-sevilla' }, { profile: 'passenger' }));
    await s.waitText(/Sevilla Este/);
    await s.checkForbiddenText('TripResults');           // marcadores de obra + ruta sin implementar
    await s.shot('resultados');                          // dist-preview/smoke/search/resultados.png
  });

  await s.step('reservar pide el pago simulado', async () => {
    await s.tap('TripDetail.reserve');                   // data-testid
    await s.waitText('Simulación de Apple Pay');         // el visor dibuja la hoja de pago simulada
  });
}
```

`s` (clase `Session` de `lib/flow.mjs`): `open(query)`, `step(nombre, fn)` (un fallo se anota y el flujo sigue; deja una captura
`fallo-N.png` y cierra los diálogos del sistema abiertos), `expect(cond, msg)`, `note(msg)`, `skip(razón)`, `requireBridge()`,
`shot(nombre)`, `app` (el marco de la app), `page` (el visor), `inApp(fn, arg)` / `inViewer(fn, arg)`, `until(fn, arg, qué)` /
`untilViewer(...)` (espera a condiciones que llegan por `postMessage`: **no leas a ciegas**), `appText()`, `waitText()`, `tid(id)`,
`tap(id)`, `type(id, valor)`, `settle()`, `checkForbiddenText()`, `checkBlocked()`, `pendingRoutes()`, `resetSystem()`, `allowBlocked`,
`args` (`--slice`, `--route`, `--shots`). Dentro de la app están `window.__mvc` (§4 de `shell/API.md`) y
`window.__MVC_PREVIEW_SHELL__` (§3); en el visor `window.__mvcViewer` (§7).

## Qué es real y qué es simulado (sin adornos)

- **Real:** la app (navegación, pantallas, validación de formularios, estados de carga y error) compilada para web.
- **Simulado y etiquetado:** el servidor (backend en memoria con datos de ejemplo de Sevilla), SMS/OTP (el SMS muestra el código),
  permisos, Ajustes, cámara, galería, archivos, compartir, abrir enlaces, Apple Pay / Google Pay, biometría, avisos, red, GPS y reloj.
- **No existe en un navegador y no se prueba aquí:** hápticos, ubicación real, GPS en segundo plano, notificaciones push,
  biometría real, teselas de mapa (el mapa es un dibujo propio de la provincia de Sevilla), el rendimiento de un móvil real y el
  **teclado en pantalla** (no se simula: una pantalla con formulario puede quedar tapada por el teclado de verdad sin que esto lo
  detecte; el visor tampoco recorta la altura al «abrir» un campo).
- **Navegadores:** todo se ha probado en Chromium (el único instalado en la máquina de pruebas). Safari ≥ 16.4 y Firefox deberían
  abrirlo (el visor usa `DecompressionStream`) pero **no se han probado**. Los márgenes seguros del móvil simulado se leen por
  `react-native-safe-area-context` (web), que el visor obliga a volver a medir al cambiar de móvil (el flujo `system` lo comprueba).
- Las pruebas de este directorio comprueban el visor y el cableado con la app, **no** que cada pantalla sea correcta: eso lo dice
  el flujo de su slice (y `tools/design/compare.mjs` frente al diseño). Una vista previa que arranca no equivale a «producción lista».

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| «Esperando el bloqueo /tmp/mvc-heavy.lock» | Otro agente exporta o prueba; espera. `flock -n /tmp/mvc-heavy.lock true` dice si está libre |
| «No existe dist-preview/mvc-preview.html» | `npm --prefix mobile run preview:artifact` |
| «La última compilación … FALLÓ» | Arregla los ficheros que lista (son del slice que los escribe) y vuelve a construir |
| No encuentra Playwright | `PW_MODULE=/ruta/a/node_modules/playwright`, o la instalación global `/opt/node22/lib/node_modules/playwright` |
| No encuentra Chromium | `CHROME_PATH=/ruta/a/chrome` (por defecto `/opt/pw-browsers/chromium`) |
| El visor dice «La app no ha arrancado en 30 s» | Mira el recuadro rojo con el error: suele ser una excepción al evaluar el bundle |
| Un flujo se queda esperando un diálogo | Una captura `fallo-N.png` lo enseña; `window.__mvcViewer.resetDialogs()` cierra todo lo abierto |
