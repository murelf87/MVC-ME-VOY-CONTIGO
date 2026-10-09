# Carta de equipo — Fase 2 (pantallas pixel a pixel)

Eres uno de los 12 equipos que construyen **MVC · Me voy contigo** («Tu provincia, en movimiento.»: coche compartido interurbano dentro de UNA provincia
española; primera provincia: Sevilla). El dueño lo exige así, literalmente: **«PIXEL A PIXEL, 100 % FUNCIONAL, front y backend, y diseña conforme a diseño
las páginas que falten para producción»**. Sin `TODO`, sin placeholders, sin «próximamente», sin datos inventados presentados como reales, sin botones que no hacen nada.
El repositorio es `/home/claude/murelf87/mvc-me-voy-contigo` (app Expo / React Native en `mobile/`, backend Fastify en `src/`, láminas en `design/`).

## 1. Antes de escribir una línea (obligatorio)

Lee ENTERO, en este orden: `docs/BUILD_BRIEF.md` (§1–§9 reglas, §10 TU fase: bucle de trabajo, catálogo de rutas, definición de «pantalla terminada», informe, §10.6 propiedad de endpoints),
`mobile/README.md`, `tools/design/README.md`, `tools/preview/README.md`, `design/scenarios/README.md`. Después el código que vas a usar:
`mobile/src/ui/index.ts` y la galería viva `mobile/src/dev/sections/*` (cómo se usa cada componente), `mobile/src/{theme,icons,brand,i18n,maps,platform,hooks}`,
`mobile/src/navigation/{types,registry,routeDef}.ts`, `mobile/src/api` (cliente tipado) y `mobile/src/api/types/<módulo>.ts`, `mobile/src/preview/index.ts`,
`mobile/src/preview/core/{router,db}.ts` y dos ejemplos de `mobile/src/preview/handlers/*.ts`, y `mobile/src/features/<tu slice>/{routes.ts,preview/*.ts}`.
Las reglas de producto están en `docs/MASTER_PROMPT_MVC.md` (economía NO activada → «Por definir»; una sola provincia; privacidad del mapa; identidad sin biometría facial; dinero en céntimos enteros).

## 2. Convivencia (12 equipos · 1 máquina de 2 núcleos · 1 Metro compartido)

* **Un error tuyo rompe a los demás.** Si un fichero tuyo no compila, el bundle de TODOS deja de compilar; si registras una ruta de vista previa que ya existe, la app de TODOS no arranca.
  Escribe ficheros completos y coherentes (las hojas primero: no importes lo que aún no has creado); antes de registrar un endpoint, `grep` si ya existe (§10.6).
* No arranques otro Metro; **no** ejecutes `expo export`, `preview:artifact`, `pnpm install/add`; **no** hagas `git add/commit/push/checkout/stash/reset`. Tipos solo con `tools/preview/typecheck.sh src/features/<tu-slice>`.
* Edita solo lo tuyo. `routes.ts` del slice y `icons/glyphs.ts`, `i18n/es.ts`, `design/tokens.json`: solo con Edit y solo AÑADIENDO (o cambiando tu propia línea). Nada de Write sobre un fichero compartido.
* Si el bundle falla por un fichero ajeno: espera 30–60 s y repite; si persiste 5 min, `SendMessage` a `main` con archivo y error.
* Comparaciones: `node tools/design/compare.mjs --dev --screen <id>` (≈10 s; hay 2 carriles de navegador para todos). **Una comparación por cambio real**; no hagas bucles de comparación sin editar.
  Si te toca esperar el carril, aprovecha para medir en la lámina (`--export-design`) o escribir el flujo de humo.
* Estás en una máquina compartida: cierra lo que abras (navegadores, procesos), no dejes procesos en segundo plano.

## 3. Cómo se hace «pixel a pixel» (lo que hemos aprendido)

* Mira la lámina **a tamaño real** con `Read` (`design/reference/<id>.jpg`, `design/out/screens-pt/<id>.png`) y recorta/amplía zonas con Python/PIL para medir (1 pt = 2 px).
  Colores: muéstralos de `design/screens-raw/<id>.png`, no los adivines. Todos los textos, **literales** (incluido «ejemplo», «Por definir», «Propuesta»).
* El comparador usa el escenario `design/scenarios/<id>.json` + el reloj virtual de las láminas (**lunes 5 de octubre de 2026, 07:17**). Para que la pantalla muestre los mismos nombres, horas e importes que la lámina,
  **siembra en tu `preview/<paquete>.ts` los datos exactos de la lámina** (variantes `seedVariants` con el prefijo de tu paquete); el código de la pantalla nunca lleva datos de ejemplo.
* El SSIM es una pista; manda la superposición. Mira siempre `design/out/compare/<id>.png`. Si una zona no mejora tras varios intentos razonados (foto, mapa con teselas reales, ilustración, antialiasing del texto), documenta y sigue.
* Las variantes `a/b` son estados de datos: una sola pantalla que cambia según lo que devuelva la API, no dos pantallas.
* El logo se usa solo desde `@/brand` (trazado literal). Nunca lo redibujes.
* Páginas sin lámina: **diséñalas con los mismos componentes, espaciados, tipografía, tonos, iconos y voz de texto de las láminas**; ten abierta al lado la lámina más parecida y nómbrala en tu informe. No inventes un estilo nuevo.

## 4. Lo que no se acepta (el orquestador lo comprueba)

Botón sin acción · formulario sin validación en español · pantalla sin estados (cargando `Skeleton`, vacío `EmptyState`, error con «Reintentar» `ErrorStateCard`, sin conexión `OfflineBanner`, sin permiso, invitado `requireAccount`) ·
texto de obra («próximamente», «TODO», «lorem», «demo») · importes inventados en el código · promesa de pago/reembolso/tarifa sin confirmación del servidor · `console.log` · `any` innecesario · `testID` ausente en lo interactivo ·
objetivo táctil < 44 pt · navegar a una ruta que no existe · duplicar un endpoint de otro paquete.

## 5. Entregas y mensajes

* Entrega pronto lo más visible: en cuanto **dos pantallas de lámina** de tu paquete rendericen bien, manda UN `SendMessage` a `main` («paquete X: pantallas A, B listas») para que se publique una vista previa intermedia. No es un informe.
* Al terminar: informe final de paquete (§10.5 del briefing) — por ruta `Implementado y probado` / `Implementado pendiente de verificar` / `Bloqueado` / `No implementado`, con SSIM y desplazamiento de cada lámina,
  lo que no consigues igualar y por qué, endpoints usados y los que faltan en el backend real, defectos de ficheros ajenos (archivo:línea) y dependencias que pides. **No declares «terminado» lo que no has visto en la superposición.**
* Si te quedas sin margen de contexto, deja el trabajo en un estado compilable, escribe en tu informe exactamente qué falta y termina; el orquestador relanzará a alguien para continuarlo.
