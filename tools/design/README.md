# tools/design — comparar la app con el diseño aprobado

`compare.mjs` abre la **vista previa web de la app** (`dist-preview/mvc-preview.html`) en Chromium sin cabeza, salta a la pantalla
indicada por un *escenario*, hace una captura a 393 pt de ancho @2x y la compara con la pantalla del diseño. Escribe una lámina
con cuatro paneles y las métricas en JSON. No necesita dependencias npm (Playwright se busca solo; ver abajo).

```
npm --prefix mobile run preview:artifact              # construir (o reconstruir) la vista previa
node tools/design/compare.mjs --list                  # diseños y escenarios disponibles
node tools/design/compare.mjs --screen 11             # una pantalla (13 → 13a y 13b; --variant b o --screen 13b para una sola)
node tools/design/compare.mjs --all                   # todas las que tengan escenario (un único navegador)
node tools/design/compare.mjs --screen 11 --route TripResults --params '{"from":"sevilla"}' --profile passenger   # ruta a mano
node tools/design/compare.mjs --route TripResults --profile driver --height 852                                  # captura sin diseño
node tools/design/compare.mjs --geometry --all        # solo mide el recuadro de pantalla de cada diseño
node tools/design/compare.mjs --export-design --all   # design/out/screens-pt/<id>.png: pantalla del diseño a 393 pt @2x, sin bisel
```

Cada ejecución pide `/tmp/mvc-heavy.lock` con `flock` (la máquina es compartida): si otro agente está construyendo o probando, espera
su turno. `--no-lock` lo omite (solo si ya lo tienes).

## Salida (`design/out/compare/`, ignorada por git)

| Fichero | Contenido |
|---|---|
| `<NN><v>.png` | **[ diseño ‖ render ‖ superposición 50 % ‖ diferencia ]** (1 pt = 1 px) + pie con las métricas |
| `<NN><v>.json` | métricas, geometría usada, avisos, errores de consola, peticiones externas, tiempos |
| `<NN><v>.render@2x.png` | captura de la app (393×H pt @2x) |
| `<NN><v>.design@2x.png` | el diseño con el mismo encuadre y escala (para medir a ojo con la misma regla) |
| `summary.json` / `summary.md` | solo con varias pantallas: tabla ordenada de peor a mejor SSIM |

Mapa de diferencia: la **gama azul → amarillo → rojo** es la diferencia media absoluta RGB (saturada en 64/255); lo gris oscuro es
la zona ignorada; los recuadros blancos numerados son los 5 puntos calientes (celdas de 24 pt) y coinciden con `metrics.hotspots`.

### Métricas (`metrics` en el JSON)

- `ssim`: SSIM de luminancia, ventana uniforme 7×7, media sobre los píxeles no enmascarados.
- `madRgb` / `madPct`: diferencia media absoluta RGB (0-255 / %).
- `bands`: SSIM y MAD de **cabecera** (54-150 pt), **cuerpo** y **base** (últimos 110 pt).
- `hotspots`: las 8 celdas de 24 pt con más diferencia, en pt desde la esquina superior izquierda de la pantalla.
- `shift`: desplazamiento global ±6 px del recorte que mejor alinea el render con el diseño. `significant: true` si mejora >8 %.
  **Positivo = hay que mover el contenido de la app hacia la derecha / abajo.** Si sale significativo, corrige primero eso
  (suele ser un `paddingTop` o un `gap`) antes de mirar el resto.

Referencias para interpretar (heurísticas, no un criterio de aceptación): un render **idéntico al píxel** puntúa SSIM ≈ 0,97 por el
remuestreo; ≥ 0,90 = muy cerca (textos y fotos distintos aparte); 0,80-0,90 = desviaciones menores de maquetación;
< 0,75 = revisar estructura. La comprobación visual de los cuatro paneles manda sobre el número.

### Qué se ignora

Esquinas redondeadas del bisel, **barra de estado (arriba 54 pt)** y el indicador de inicio de iOS (abajo, 150×16 pt): la app no
dibuja nada de eso. Las zonas ignoradas salen en gris oscuro en el panel de diferencia y su porcentaje en `maskedPct`.

## Escenarios (`design/scenarios/<NN><v>.json`)

Cómo llegar a cada pantalla del diseño en la vista previa. Si no existe `<NN><v>.json` se prueba `<NN>.json`.

```json
{
  "screen": "11",
  "profile": "passenger",
  "route": "TripResults",
  "params": { "from": "sevilla-este", "to": "uni-sevilla" },
  "seed": "demo",
  "clock": "2026-10-05T07:17:00+02:00"
}
```

Solo `route` es obligatorio. Campos opcionales que entiende la herramienta: `perm` (`granted` por defecto: así los diálogos de permisos
del sistema simulados no tapan la pantalla; también `ask|denied|blocked`), `device` (`iphone15` por defecto), `height` (pt; si no, el del diseño),
`waitFor` (texto o selector CSS que debe verse antes de capturar), `note`. Cualquier opción de la línea de comandos pisa al escenario.

La herramienta ejecuta, dentro de la app: `window.__MVC_PREVIEW_SHELL__?.setClock?.(clock)` y después
`await window.__mvc.open(route, params, { profile, seed, clock })`; espera `__mvc.idle()` (peticiones del backend en memoria),
`document.fonts.ready`, imágenes completas y un DOM sin cambios durante 350 ms, y captura. Si la ruta no existe, el error lista las
rutas que devuelve `__mvc.routes()`.

## Geometría: por qué NO se usa `designHeightPt` del manifest

Los recortes `design/screens-raw/*.png` (y por tanto `design/screens/*.png`, `ptPerRawPx` y `designHeightPt` del manifest)
**incluyen el bisel negro del teléfono**: el ancho del recorte (357-363 px) es ~9 % mayor que el de la pantalla real (324-337 px).
Medir en esos ficheros con `ptPerRawPx` (≈ 1,09) da todo ~8 % **menor** de lo que es (1 pt real = 0,83-0,85 px del recorte, es decir 1,18-1,2 pt por píxel). Además, el recorte
corta a veces *por dentro* de la pantalla (arriba o abajo), así que el borde real no se ve.

`compare.mjs` mide sobre la **lámina original** (`design/boards/<lámina>.png`) con la caja `bezelBox` del manifest: avanza desde cada
lado hacia dentro, cruza el bisel y localiza el primer píxel de pantalla. Las cuatro pantallas de una lámina son el mismo
teléfono, así que tamaño y bordes superior/inferior son la mediana de las cuatro, y se contrastan con la isla dinámica (que está a
11 pt del borde superior). Escala uniforme: **393 pt = anchura de pantalla medida**; el alto en pt sale de esa escala.
Por eso el viewport de cada pantalla es 393 × (alto medido) — entre 835 y 899 pt según la lámina (los mockups no son todos 393×852).
`--height 852` fuerza un iPhone 15 estándar. `--geometry --all` imprime lo medido (con avisos si algo no es fiable) y
`--export-design` escribe cada pantalla del diseño ya normalizada a 393 pt @2x en `design/out/screens-pt/`.

## Requisitos y entorno

- Chromium: `/opt/pw-browsers/chromium` (o `CHROME_PATH`). Playwright: `PW_MODULE`, `tools/preview/node_modules`, `node_modules` del repo
  o la instalación global `/opt/node22/lib/node_modules/playwright`. Sin instalar nada si existe la global.
- La app debe estar compilada en modo vista previa (`EXPO_PUBLIC_PREVIEW=1`, lo hace `preview:artifact`) y exponer `window.__mvc`
  (contrato en `tools/preview/shell/API.md`). `?chrome=0` oculta el marco del móvil y el panel del visor: la app ocupa todo el viewport.
- Contra un servidor de desarrollo (`expo start --web`): `--url http://localhost:8081 --inject-shell` (inyecta `tools/preview/shell/inner.js`).

## Opciones

```
--screen N | --variant a|b | --all | --list | --geometry | --export-design
--route Nombre --params '{json}' --profile new|passenger|driver|admin --seed S --clock ISO --perm ask|granted|denied|blocked --device iphone15
--url <url>  --out <dir>  --scenarios <dir>  --height <pt>  --inner x,y,w,h (px de la lámina)  --wait-for <texto|css>
--fresh (recarga la página en cada pantalla)  --min-wait <ms>  --settle-ms <ms>  --timeout <ms>
--fail-under-ssim <n> (código de salida 2 si alguna pantalla baja de n)  --json  --quiet  --no-lock  --stale-ok
```

Códigos de salida: `0` bien · `1` error (ruta desconocida, la app no arranca, falta el diseño, o la última compilación de la vista previa falló y el HTML es antiguo — `--stale-ok` lo salta) · `2` SSIM por debajo del umbral.

## Avisos que debes leer

El JSON y la salida marcan: pantalla que no llegó a quedarse quieta (animación continua o carga sin terminar), errores de consola,
**peticiones fuera del HTML** (la vista previa debe ser hermética: cero) y medidas de diseño poco fiables.
