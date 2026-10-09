# Escenarios de diseño

Un **escenario** dice cómo llegar, en la vista previa, a una pantalla de las láminas del diseño: con qué persona de prueba
(perfil), con qué datos (variante), a qué hora (reloj) y a qué pantalla (ruta y parámetros). Lo lee
`tools/design/compare.mjs` (compara la app con la lámina) y lo ejecuta `window.__mvc.open(...)`.

> **SIMULACIÓN.** Los datos de un escenario salen del backend en memoria de la vista previa (`mobile/src/preview/**`, Sevilla,
> personas ficticias). No existen en producción. Referencia completa: `docs/PREVIEW_BACKEND.md`.

## Fichero

`design/scenarios/<pantalla>.json`, donde `<pantalla>` es el id de `design/manifest.json`: `11.json`, `13a.json`, `13b.json`…
(`compare.mjs` busca `<pantalla>.json`, luego `<NN><variante>.json`, luego `<NN>.json`).

```json
{
  "screen": "20",
  "variant": "",
  "profile": "driver",
  "route": "DriverRequests",
  "params": { "tripId": { "$ref": "trip.anaMorning" } },
  "seed": "request-pending",
  "clock": "2026-10-05T07:17:00+02:00"
}
```

| Campo | Tipo | Obligatorio | Qué es |
|---|---|---|---|
| `screen` | texto | por convención | Id de la pantalla en `design/manifest.json` (`"11"`, `"13a"`). El nombre del fichero debe ser `<screen>.json`. |
| `variant` | `""` \| `"a"` \| `"b"` | no | Letra de la lámina (`13a`/`13b`). Solo documenta: debe coincidir con el manifest. |
| `profile` | `new` \| `passenger` \| `driver` \| `admin` | no (`passenger`) | Quién ha iniciado sesión (tabla de abajo). |
| `route` | texto | **sí** | Nombre de la ruta de la app (`window.__mvc.routes()` las lista; salen de `features/*/routes.ts`). |
| `params` | objeto | no | Parámetros de la ruta (los tipos están en `features/<slice>/routes.ts`). Admite `{ "$ref": "…" }`. |
| `seed` | texto | no (`default`) | Variante de datos (tabla de abajo). Un nombre que no existe es un **error**, no un `default` silencioso. |
| `clock` | ISO-8601 **con desfase** | no | Hora virtual. Sin él se conserva la actual (por defecto, lunes 5 de octubre de 2026, 07:17 en Madrid). |
| `perm` | `granted` \| `ask` \| `denied` \| `blocked` | no (`granted`) | Estado de los permisos del sistema simulados (lo aplica `compare.mjs`). |
| `device`, `height`, `waitFor`, `note` | | no | Opciones de `compare.mjs`: modelo de móvil, alto en pt, texto/selector que debe verse antes de capturar, nota libre. |

Cualquier clave que empiece por `_` se ignora (comentarios libres). Cualquier otra clave desconocida es un error de dedo: la
prueba `src/preview/scenarios.test.ts` falla.

## Perfiles

| `profile` | Quién | Teléfono (para «Iniciar sesión») |
|---|---|---|
| `new` | Nadie: sin sesión (Bienvenida, registro con SMS simulado) | — |
| `passenger` | **Miguel Torres**, pasajero, 4,8 ★ (12 viajes) | +34 611 000 102 |
| `driver` | **Ana García López**, conductora, 4,8 ★ (32 viajes), Seat Arona y Seat León verificados | +34 611 000 101 |
| `admin` | **Administración MVC** (todos los roles de revisión) | +34 611 000 199 |

El resto del reparto (Laura, Carlos, Marta, Miguel Ángel…) son los teléfonos `+34 611 000 103…119`. El código SMS lo muestra el
visor (o `window.__mvc.lastSms()`).

## Variantes de datos (`seed`)

Todas parten del mismo mundo base y las horas son **relativas a «ahora»**, así que valen con cualquier `clock`. Lista viva:
`window.__mvc.seeds()`.

| `seed` | Qué deja |
|---|---|
| `default` | Lunes 5 de octubre de 2026, 07:17. Oferta de la mañana en Sevilla (Ana 08:05 Montequinto → Dos Hermanas → Universidad con 2 plazas libres; Miguel Ángel 08:03 desde Mairena del Aljarafe; Carlos con 1 plaza; Marta completa), reservas de otras personas y **dos solicitudes pendientes** (Hugo, Nuria) en el viaje de Ana. |
| `driver-requests` | Igual que `default` (las dos solicitudes pendientes ya están ahí). |
| `empty` | Sin viajes, solicitudes ni historial: estados vacíos («Sin coincidencias», «Aún no has publicado»). |
| `fresh-driver` | Ana acaba de hacerse conductora: sin vehículo, documentos ni viajes (alta desde cero). |
| `request-pending` | `default` + Miguel pidió plaza a Ana hace 3 minutos (esperando respuesta). |
| `request-accepted` | Ana aceptó hace 8 s: plaza retenida 15 min (cuenta atrás **14:52**) y pago pendiente. |
| `booking-confirmed` | Miguel pagó: reserva confirmada y conversación con Ana abierta. |
| `trip-live-waiting` | Viaje en curso; el coche a ~600 m de la parada de Montequinto, donde espera Miguel. |
| `trip-live-in-car` | Miguel y Laura a bordo (código de recogida verificado), al 40 % del trayecto. |
| `trip-finished` | El viaje terminó hace 2 minutos (pantalla de valoración). |

Cada slice puede declarar sus propias variantes (`seedVariants` + `seedSlice` en su `preview/handlers.ts`; ver `docs/PREVIEW_BACKEND.md`).

## Referencias a datos sembrados: `{ "$ref": "…" }`

Los ids (de una solicitud, una reserva…) nacen al sembrar, así que un escenario no puede escribirlos. En su lugar:
`"requestId": { "$ref": "request.miguel" }`. `window.__mvc.open` lo sustituye por el id real **después** de sembrar, a cualquier
profundidad de `params`. Un objeto con `$ref` no puede llevar más claves.

| Referencia | Es |
|---|---|
| `user.<clave>` | Una persona del reparto: `ana`, `miguel`, `laura`, `carlos`, `marta`, `miguelAngel`, `hugo`, `nuria`, `staff`… |
| `trip.<clave>` | Un viaje sembrado: `anaMorning` (el de las 08:05), `miguelAngelMorning` (08:03), `carlosWork`, `martaWork`, `anaReturn`, `anaDraft`… |
| `vehicle.<clave>` | Un vehículo sembrado: `anaArona`, `anaLeon`… |
| `request.<persona>` | Su solicitud más reciente en el viaje de Ana de las 08:05: `miguel`, `laura`, `hugo`, `nuria`. |
| `booking.<persona>` | La reserva de esa solicitud (`miguel`, `laura`). |

`window.__mvc.refs()` devuelve todas con su id (o `null` si no existen en esa variante: p. ej. `request.miguel` solo existe en las
variantes que crean su solicitud). Si el escenario pide una que no existe, `open` falla con un mensaje que lo dice y deja la app
en la primera pantalla del perfil. Los slices añaden las suyas con `registerSeedRef("conversation.miguel", (db) => …)`.

## Reloj

- Sin `clock`, la hora es la de las láminas: **lunes 5 de octubre de 2026, 07:17** (`+02:00`, horario de verano).
- Las láminas 11 y 12 dicen «Te recoge en 7 min» para una salida a las 08:05: son las **07:58** (`"clock": "2026-10-05T07:58:00+02:00"`).
- Escribe siempre el desfase (`+02:00` hasta el 25 de octubre de 2026, `+01:00` después, o `Z`): sin él, el instante depende de la
  zona horaria del navegador.
- La barra de estado de las láminas (09:41, 07:17…) la ignora `compare.mjs`; el reloj sirve para lo que sale **dentro** de la
  pantalla (cuentas atrás, «llega en 8 min», «hace 5 s»).

## Ejemplos de este directorio (solo endpoints que ya existen en el backend 0.14)

| Fichero | Pantalla | Qué enseña |
|---|---|---|
| `11.json` | 11 · `TripResults` (resultados) | Parámetros anidados (`criteria`), reloj distinto del de por defecto. Solo usa `GET /v1/trips/search`. |
| `17.json` | 17 · `MyVehicle` (tu vehículo) | Perfil de conductora y una `$ref` constante (`vehicle.anaArona`). Solo usa `GET /v1/me/vehicles` y `/v1/me/documents`. |
| `20.json` | 20 · `DriverRequests` (solicitudes) | Variante de datos (`request-pending`) + `$ref` a un viaje. Solo usa `GET /v1/trips/{id}/requests` y `POST /v1/ride-requests/{id}/decision`. |

Lo que las láminas dicen y la vista previa **no** puede reproducir (honestidad; no se «arregla» fingiéndolo):

- **Lámina 11** muestra a Ana «desde Montequinto, 1,2 km» y a Miguel Ángel «desde Mairena del Aljarafe, 800 m» como resultados de
  un mismo origen. Montequinto y Mairena están a unos 11 km: ninguna búsqueda real devuelve ambos a esas distancias. El escenario
  usa un origen a 1,2 km de la parada de Ana (la primera tarjeta coincide); la segunda aparece buscando desde Mairena.
- **Lámina 20** muestra una solicitud «Mairena del Aljarafe 07:17 → Sevilla (Trabajo) 07:25 · 1/3 plazas». En el mundo sembrado Miguel
  pide plaza en el viaje de las 08:05 de Ana (Montequinto → Universidad); las cifras de la tarjeta salen de ese viaje.
- **Matrículas.** La lámina 12 dice «Matrícula ilustrativa: 1234 LKM» y la 17 muestra «1234 MBC» para el mismo Seat Arona gris (y
  `docs/contracts/trips.md` usa «LKM» como `plateHint` y «1234 MBC» en la vista de la conductora). Se siembra **1234 MBC** (lo que
  ve la dueña en «Tu vehículo»); al pasajero solo le llegan las tres últimas letras, así que «Detalle del viaje» enseñará «MBC».
- **Lámina 16b** (reserva semanal) necesita solicitudes semanales, que no existen en el backend 0.14: las crea el módulo de
  viajes y la variante de datos la declara el slice de búsqueda.

## Probar un escenario

```bash
# 1. ¿Está bien escrito? (no necesita navegador: valida campos, ruta, perfil, variante, reloj y resuelve las $ref)
cd mobile && ../node_modules/.bin/tsx --test src/preview/scenarios.test.ts

# 2. Compararlo con la lámina (necesita la vista previa compilada y Chromium; ver tools/design/README.md)
node tools/design/compare.mjs --screen 20
node tools/design/compare.mjs --all
```

A mano, en la consola del navegador con la vista previa abierta:

```js
await window.__mvc.open(
  "DriverRequests",
  { tripId: { $ref: "trip.anaMorning" } },
  { profile: "driver", seed: "request-pending", clock: "2026-10-05T07:17:00+02:00" }
);
window.__mvc.refs();     // ids sembrados
window.__mvc.seeds();    // variantes disponibles
window.__mvc.requests(); // últimas peticiones que ha atendido el backend simulado
```

Sin visor, la página también arranca con `?mvcProfile=driver&mvcSeed=request-pending&mvcClock=2026-10-05T07:17:00%2B02:00`.

## Añadir un escenario (slices)

1. Crea `design/scenarios/<pantalla>.json` con la tabla de arriba. Los tipos de `params` están en `features/<tu slice>/routes.ts`.
2. Si la lámina necesita un estado de datos que no existe, decláralo en tu `features/<slice>/preview/handlers.ts`
   (`seedVariants: { "mi-variante": "qué contiene" }` y construye los datos en `seedSlice(db, profile, seed)` con los servicios de
   dominio del núcleo, no con filas escritas a mano). Si necesitas ids en `params`, registra una referencia con `registerSeedRef`.
3. Si las láminas `a` y `b` de una pantalla difieren por **contenido**, es una variante de datos de la **misma** ruta
   (`13a.json` y `13b.json` con distinto `seed`), no una pantalla distinta.
4. Ejecuta `tsx --test src/preview/scenarios.test.ts`: dice qué corregir (clave desconocida, ruta inexistente, variante con errata,
   reloj sin desfase, `$ref` que no existe en tu variante…).
