# Mapas de MVC

Módulo: `mobile/src/maps/` (componente `MvcMap`) · sustituto web: `mobile/web-stubs/react-native-maps.js` + `mobile/web-stubs/map-data/` ·
generadores y banco de pruebas: `tools/preview/map/`.

> **Estado honesto en una tabla**
>
> | Qué | Estado |
> |---|---|
> | API `MvcMap` y marcadores/rutas/chips (tipos estrictos, mismo contrato en nativo y web) | Implementado; partes puras con 46 pruebas; `tsc --noEmit` limpio |
> | Vista previa web: mapa vectorial ILUSTRATIVO de Sevilla en el estilo de las láminas | Implementado y medido contra las 9 láminas con mapa (§ 7) |
> | iOS (Apple Maps) y Android (Google Maps) con `react-native-maps` 1.27.2 | **Código escrito, NO ejecutado en ningún dispositivo ni emulador** (no hay SDK nativo en este entorno) |
> | Claves de Google Maps (Android), configuración EAS | **No existen en el repo** (a propósito). Falta en `app.json` (fichero de `app`): § 6 |
> | Datos de calles/carreteras de Sevilla | **Dibujo ilustrativo**, no datos reales ni de navegación (§ 4) |
> | Mapas sin conexión, satélite, tráfico, modo oscuro del mapa, giro/inclinación | No implementado (§ 9) |

---

## 1. Arquitectura

```
pantalla (features/*)  ──►  <MvcMap markers routes … />        mobile/src/maps/MvcMap.tsx   (no sabe en qué plataforma está)
                              │
                              ▼  API de react-native-maps  (MapView · Marker · Polyline)
        ┌─────────────────────┼───────────────────────────────────────┐
        ▼                     ▼                                       ▼
   iOS: Apple Maps       Android: Google Maps                  Web (vista previa): Metro cambia
   (MapKit, sin clave)   (Maps SDK for Android, con clave)     `react-native-maps` por
   mapType mutedStandard PROVIDER_GOOGLE + customMapStyle      mobile/web-stubs/react-native-maps.js
                         (MVC_MAP_STYLE_LIGHT)                 = canvas con el mapa ilustrativo de Sevilla
                                                               + marcadores HTML + polilíneas
```

- **Una sola implementación.** `MvcMap` solo habla la API de `react-native-maps`. En web, `metro.config.js` (de `preview-shell`) redirige
  ese módulo a mi sustituto; el resto del código no cambia.
- **El mapa no hace red ni guarda datos.** Recibe marcadores, rutas y la ubicación ya resueltos por la pantalla (hook → `api/` → backend).
  Las teselas las pide el SDK nativo (Apple/Google); en web no hay teselas, se dibuja un mapa empaquetado.
- **Marcadores sin medir nada.** El anclaje de un `Marker` nativo se fija antes de que exista el layout, y en Android los hijos del
  `Marker` se rasterizan. Por eso el tamaño de cada marcador («pin + chip de texto») se **calcula** (`markerLayout.ts`, `chipLayout.ts`)
  con los anchos de avance de Roboto Condensed (`textMetrics.ts`, generado de los TTF) y todo lleva tamaño explícito. Resultado:
  `anchor` (Google/web) y `centerOffset` (Apple) describen el mismo punto, comprobado por prueba unitaria en 17 variantes.

### Mapa de ficheros

| Fichero | Contenido |
|---|---|
| `mobile/src/maps/MvcMap.tsx` | Componente: cámara inicial, encuadre, recentrar, rutas, marcadores memoizados, `ref` imperativo, accesibilidad |
| `types.ts` | Contrato público: marcadores, rutas, chips, props, handle |
| `markerLayout.ts` | Geometría pura de cada marcador (tamaño, gráfico, chip, `anchor`, `centerOffset`, tarjeta del birrete) |
| `MarkerView.tsx`, `glyphs.tsx` | Dibujo (Views + `react-native-svg`): coche, gota A/B, anillos, clúster, bandera, birrete, usuario |
| `MapChip.tsx`, `chipLayout.ts`, `textMetrics.ts` | Chip de texto y su medida exacta (usable también suelto, p. ej. como tarjeta de parada) |
| `MapLegend.tsx`, `RecenterButton.tsx` | Leyenda (tarjeta / pie) y botón «centrar en mi ubicación» |
| `mapTheme.ts`, `mapFonts.ts`, `mapStyle.ts` | Colores, métricas de marcadores, estilos de ruta; fuentes; estilo claro de Google (`MVC_MAP_STYLE_LIGHT`) |
| `geo.ts` | `fitBounds`, `sevillaCenter`, distancias, Mercator, regiones |
| `places.ts`, `placesData.ts` | `SEVILLA_PLACES`: 74 lugares (generado de `tools/preview/map/data/places.json`) |
| `roadRoutes.ts`, `roadRoutesData.ts` | `SEVILLA_ROAD_ROUTES`: 37 rutas ilustrativas que siguen los ejes del mapa base (generado) |
| `index.ts` | Barril: `import { … } from '@/maps'` |
| `maps.test.ts` | 46 pruebas `node:test` de las partes puras |
| `mobile/web-stubs/react-native-maps.js` | Sustituto web: cámara, canvas del mapa base, marcadores HTML, `Polyline/Polygon/Circle` |
| `mobile/web-stubs/map-data/basemap.js` · `sevilla-basemap.js` | Decodificador y datos empaquetados (**generado**, 0,47 MB) |
| `tools/preview/map/` | Generadores (`build-basemap.mjs`, `gen-*.mjs`), geometría dibujada a mano (`data/`), banco de pruebas de fidelidad (`fidelity/`) |

---

## 2. Uso de `MvcMap`

```tsx
import { MvcMap, MapLegend, SEVILLA_REGION } from '@/maps';

<MvcMap
  style={{ height: 385 }}
  initialRegion={SEVILLA_REGION}            // o fit="content" para encuadrar marcadores + rutas
  recenter                                   // botón «centrar en mi ubicación»
  userLocation={me}                          // punto azul propio (mismo aspecto en iOS/Android/web)
  markers={[
    { id: 'c1', kind: 'car', seats: 2, position: { lat: 37.40, lng: -6.00 } },        // «2 plazas»
    { id: 'c2', kind: 'car', seats: 0, position: { lat: 37.36, lng: -5.97 } },        // «Completo» (gris)
    { id: 'u', kind: 'destinationCap', position: uni, chip: { title: 'Universidad\nde Sevilla', side: 'bottom', align: 'center' } },
  ]}
  routes={[{ id: 'r', kind: 'route', points: decodedPoints }]}
  onMarkerPress={(m) => navigation.navigate('TripDetail', { id: m.id })}
>
  <MapLegend position="topLeft" items={[{ icon: 'car', label: 'Ruta del conductor' }, { icon: 'walk', label: 'Trayecto a pie desde el punto' }]} />
</MvcMap>
```

Todas las medidas son **pt**. Las coordenadas son `{ lat, lng }` (WGS84), estructuralmente idénticas a `GeoPoint` de `@/api/types`.

### Props (`MvcMapProps`)

| Prop | Tipo | Por defecto / notas |
|---|---|---|
| `initialRegion` | `MapRegion {lat,lng,latDelta,lngDelta}` | Sin esto ni `fit` → encuadra el contenido; sin contenido → Sevilla (`SEVILLA_REGION`) |
| `fit` | `'content' \| MapPoint[] \| MapBounds` | Encuadre automático al estar listo el mapa, al llegar contenido por primera vez y al cambiar `fitKey` |
| `fitKey` | `string \| number` | Cambiarlo fuerza un nuevo encuadre (animado) |
| `edgePadding` | `Partial<{top,right,bottom,left}>` | Zona tapada por hojas/tarjetas: se suma al margen base (28 pt) + el saliente de los marcadores (+8) y desplaza el botón «centrar» |
| `markers` | `MapMarkerSpec[]` | Ver § 2.1. Se memoizan por firma JSON: recrear objetos idénticos no repinta |
| `routes` | `MapRouteSpec[]` | Ver § 2.2 |
| `selectedMarkerId` | `string \| null` | Se dibuja encima y algo mayor |
| `onMarkerPress` | `(marker) => void` | No se dispara para el punto del usuario |
| `onMapPress` | `(point: MapPoint) => void` | |
| `onRegionChange` | `(region, {settled, byUser}) => void` | `settled: false` llega de forma continua mientras se arrastra (no pedir datos ahí); `settled: true` = movimiento terminado |
| `userLocation` / `userAccuracyM` | `MapPoint \| null` / `number` | La pantalla obtiene la posición (hook de permisos) y la pasa; el mapa dibuja el punto azul y el halo |
| `showUserLocation` | `boolean` | Sin `userLocation`, punto azul **nativo** del sistema (necesita permiso concedido) |
| `recenter` / `onRecenter` | `boolean` / `() => void` | El botón llama a `onRecenter` (p. ej. para pedir el permiso) y centra en `userLocation` o reencuadra |
| `interactive` | `boolean` | `true`; `false` = mapa decorativo (sin gestos) |
| `lite` | `boolean` | `false`; `true` = modo tarjeta (sin gestos ni controles) para listas |
| `style`, `testID` (`'MvcMap'`), `accessibilityLabel` (`'Mapa'`) | | |
| `children` | `ReactNode` | Capas encima del mapa (leyenda, tarjetas); no capturan toques fuera de su contenido |

`ref` (`MvcMapHandle`): `fitToContent`, `fitToPoints`, `animateTo(regionOrPoint, {zoomDelta, durationMs})`, `recenter`, `pointForCoordinate` (async; `null` si aún no hay mapa).

### 2.1 Marcadores (`MapMarkerSpec`, unión por `kind`)

Campos comunes: `id` (estable), `position`, `chip?`, `zIndex?`, `accessibilityLabel?` (si falta se deduce del tipo y del chip).

| `kind` | Qué es | Notas |
|---|---|---|
| `car` | Coche. `variant: 'pin'` (por defecto, con cola, lámina 09), `'live'` (en curso, sin cola, 13a/21), `'badge'` (pequeño, silueta sin cuerpo cuadrado, 37a) | `seats` genera el chip «2 plazas» / «1 plaza» / «Completo» (gris); `full` fuerza el gris. `pin` ancla en la punta; `live`/`badge`, en el centro |
| `pickupA` / `pickupB` | Gota azul «A» / verde «B» sobre un punto con halo | `selected` |
| `origin` | Anillo azul con hueco blanco | |
| `destination` | Gota con hueco blanco («Tu recogida», «Tu destino») | `tone: 'brand' \| 'success' \| 'warning'` |
| `destinationCap` | Disco con birrete. Con `chip.side: 'bottom'` es **una sola tarjeta** (lengüeta con birrete + nombre) | Se ancla en el centro del birrete |
| `stop` | Parada: anillo con número opcional | `index`, `tone: 'warning'` (parada nueva, naranja), `end` (rombo) |
| `user` | Punto azul con halo | `accuracyM`. Lo crea `MvcMap` desde `userLocation`; también se puede pasar a mano |
| `cluster` | Número en disco azul con halo | `count`. **`MvcMap` no agrupa por sí mismo**: la pantalla/backend decide los clústeres |
| `flag` | Bandera de meta con halo | |
| `label` | Solo chip (sin gráfico): «4 min» con peatón, «A 6 km de tu destino» | La coordenada es el **centro** del chip; `chip` obligatorio |

Chip (`MapChipSpec`): `title` (negrita) · `subtitle` · `trailing` (hora a la derecha: en la línea del subtítulo si cabe bajo el título, si no en una columna) · `icon: 'walk'|'car'|'cap'|'clock'` ·
`tone`/`subtitleTone: 'brand'|'neutral'|'success'|'warning'|'danger'|'muted'` · `handle` (asa «≡» con su línea fina) · `side: 'right'|'left'|'top'|'bottom'` ·
`align: 'left'|'center'` · `size: 'lg' (17 pt) | 'md' (15,5, por defecto) | 'sm' (14)` · `titleWeight: 'bold' (por defecto) | 'medium'` («Completo» de la lámina 09 va en medio). **El texto no se ajusta solo**: usa `\n` para varias
líneas («Universidad\nde Sevilla»); el ancho se calcula con las métricas de Roboto Condensed.

### 2.2 Rutas (`MapRouteSpec`)

| `kind` | Aspecto | Uso |
|---|---|---|
| `route` | Azul continuo `#0551F8`, 5,5 pt, borde blanco | Ruta del conductor |
| `approach` | Discontinuo `#0B5BE6`, 4,2 pt (10/7), borde blanco | Aproximación del coche; cambio de ruta propuesto |
| `walk` | Puntos `#0B3AF9` (redondos), 4,5 pt, sin borde | Trayecto a pie desde el punto de recogida |
| `alt` | Gris `#7E86A2`, 4,5 pt, borde blanco | Ruta alternativa |

`width`, `color` y `zIndex` se pueden sobrescribir (p. ej. el tramo final claro de la lámina 21: `{ kind: 'route', color: '#0A88F5', width: 4.6 }`).
El borde blanco es una segunda `Polyline` (+3,5 pt) debajo de la de color.

### 2.3 Rendimiento y particularidades nativas

- **Android rasteriza los hijos de un `Marker`**: todos tienen tamaño explícito y `tracksViewChanges` está activo 900 ms tras pintarse
  y después se apaga (si no, el mapa repinta cada fotograma). Un marcador solo se repinta si cambia su firma.
  **Las fuentes (Roboto Condensed 400/500/700, `src/theme/fonts.ts`) deben estar cargadas antes de montar el mapa**: si el texto del chip se rasteriza con una fuente
  de reserva, no se corrige hasta que el marcador cambie (el `App` ya espera a las fuentes antes de mostrar pantallas).
- **Apple Maps**: se usa `centerOffset` (no `anchor`); se pasan los dos y cada plataforma usa el suyo.
- **Sombras.** Chips, leyenda y botón «centrar» usan `boxShadow` (`MAP_SHADOWS` en `mapTheme.ts`; CSS en web, donde `shadow*` está obsoleto; en Android la sombra exterior exige API 28 / Android 9 — `OutsetBoxShadowDrawable` de RN 0.86.3 —, así que en versiones anteriores no hay sombra).
  Pines, coches, birrete y clúster dibujan su sombra **dentro** de su caja (SVG), para que sobreviva a la rasterización de Android. La sombra difusa de un **chip** cae fuera de su caja,
  así que en Android (hijos del `Marker` rasterizados y recortados) probablemente no se vea; no se ha comprobado (§ 9).
- El mapa va siempre «norte arriba» (`rotateEnabled=false`, `pitchEnabled=false`), sin brújula, escala, tráfico, edificios, POIs ni botones
  del sistema; `userInterfaceStyle="light"` (la app es solo clara).
- **Accesibilidad**: cada marcador es `accessible` (`button` si es pulsable, `image` si no) con etiqueta deducida; el contenedor lleva
  `accessibilityLabel`. Los gestos del mapa siguen siendo los del sistema (VoiceOver/TalkBack).
- `MapCard` (`src/ui/MapCard.tsx`, de `ds`) resuelve los estados «cargando» y «mapa no disponible»; `MvcMap` no detecta por sí mismo que el
  SDK haya fallado (p. ej. clave de Android mal puesta): `react-native-maps` no ofrece un evento fiable para ello.

### 2.4 Utilidades y registros

- `geo.ts`: `SEVILLA_CENTER` (37,3859 · −5,9926), `sevillaCenter()`, `SEVILLA_REGION`, `SEVILLA_PROVINCE_BOUNDS`, `fitBounds(puntos | bounds, {padding})`
  → `MapRegion`, `regionForZoom`, `zoomForRegion`, `distanceMeters`, `polylineLengthMeters`, `pointAlong`, `bearingDegrees`, `boundsOf`, `boundsCenter`,
  `regionToBounds`, `isValidPoint`, `validPoints`.
- `SEVILLA_PLACES` (74): 28 municipios, 15 barrios, 9 hitos, 4 campus, 4 hospitales, 2 estaciones, 2 parques, 10 calles. `findSevillaPlace('nervion')`
  (sin tildes), `nearestSevillaPlace(punto, {kinds, maxKm})`, `sevillaPlace(id)`, `sevillaPoint(id)`. **Coordenadas aproximadas (±300 m en el centro, ±1 km en la periferia)**:
  sirven para semillas, vista previa y pruebas; no sustituyen a un geocodificador.
- `SEVILLA_ROAD_ROUTES` (37, de 1,9 a 37 km): rutas entre lugares que **siguen los ejes dibujados en el mapa base**, con `polyline` (Google, 1e5),
  `points`, `distanceM`, `durationS`, `roads`, `via`. `sevillaRoadRoute(id)`, `reverseRoadRoute`, `roadRouteBetween(a, b)`, `roadRoutesAt(lugar)`,
  `roadRouteLngLat(ruta)` (`[lng, lat][]`, GeoJSON) y `roadRouteSpec(ruta, kind, id)` (lista para pasar a `routes`).
  **Distancia y duración son estimaciones sobre un dibujo** (80/45/30 km/h según clase de vía): nunca presentarlas como resultado de un servicio de rutas.

---

## 3. Qué dibuja el sustituto web (vista previa)

El sustituto implementa lo que usa `MvcMap`: `MapView` (`initialRegion`, `animateToRegion`, `fitToCoordinates`, `pointForCoordinate`, `onRegionChange(Complete)`,
`onPress`, `onMapReady`, arrastre y rueda), `Marker` (`anchor`, `zIndex`, `onPress`, hijos), `Polyline` (continua, discontinua, punteada, cabos), `Polygon` y `Circle`.
No implementa teselas, satélite, tráfico, giro ni inclinación.

Orden de dibujo (cámara Web Mercator con teselas de 256 pt, zoom 5–19):

1. tierra · límites municipales y de provincia (discontinua) · 2. campo, mancha urbana, ciudad, casco histórico melocotón (capas «blandas» a baja resolución, bordes suaves) ·
3. parques · 4. calles locales en tres niveles de detalle (aparecen entre z 11,8 y 15,7) · 5. río (con el doble brazo de La Cartuja, más ancho que el real para que se lea a zoom bajo) ·
6. carreteras por clase (autovía → secundaria) · 7. rótulos con halo (por rango: municipios, barrios, hitos; nombre de calle z ≥ 15,2; «Río Guadalquivir» glifo a glifo a lo largo del cauce) y escudos (SE-30, A-4…) ·
8. formas (`Polygon`, `Circle`) · 9. marcadores HTML. El pie del mapa muestra la atribución **«© IGN (límites) · Mapa ilustrativo»**.

### Datos empaquetados (`sevilla-basemap.js`)

0,47 MB (límite fijado: 2,5 MB), 126 886 puntos cuantizados a 1e-5° (≈ 1 m), zig-zag + varint en un único búfer base64, decodificación perezosa por capa
(`basemap.js` normaliza el sentido de los anillos).

| Capa | Rasgos | Origen |
|---|---:|---|
| `province` | 2 | es-atlas (IGN) |
| `munis` | 116 | es-atlas (IGN) |
| `agri` | 563 | procedural |
| `urban` | 29 | dibujo a mano (ciudad + núcleos) |
| `peach` | 5 | dibujo a mano (casco, Triana, Nervión…) |
| `green` | 412 | dibujo a mano + procedural |
| `river` | 255 | dibujo a mano |
| `roads` | 85 | dibujo a mano (8 de clase 0, 36 de clase 1, 41 de clase 2) |
| `st0` / `st1` / `st2` | 1 966 / 2 530 / 5 874 | callejero procedural de 6 barrios (casco, Triana, Macarena, Nervión, Remedios, Cartuja) y núcleos |

---

## 4. Procedencia y licencias de los datos

| Dato | Fuente | Licencia / condición | Se empaqueta |
|---|---|---|---|
| Límites de provincia y de municipios | **es-atlas 0.6.0** (npm, Martín González), derivado de los datos de referencia del **IGN/CNIG** («Equipamiento Geográfico de Referencia Nacional», «Divisiones Administrativas») | Paquete: MIT. Datos IGN: reutilización libre con atribución **«© Instituto Geográfico Nacional»**; el catálogo del IGN/CNIG los publica bajo **CC BY 4.0** (atribución «CC BY 4.0 ign.es») | Sí, simplificados y cuantizados (capas `province` y `munis`) |
| Curso del Guadalquivir, parques, casco, ciudad, barrios, carreteras, callejero, campo, zonas melocotón | **Dibujo a mano y procedural del proyecto** (`tools/preview/map/data/sevilla-geometry.mjs`, `lib/streets.mjs`). Natural Earth (dominio público) solo se miró como referencia visual del cauce | Propio. Sin datos de OpenStreetMap, Google ni Apple | Sí |
| 74 lugares y rótulos | `tools/preview/map/data/places.json`: nombres geográficos con posición aproximada | Propio (hechos geográficos) | Sí |
| Tipografía de chips | Roboto Condensed (`@expo-google-fonts/roboto-condensed`) | SIL OFL 1.1 | Solo las **métricas** de avance (`textMetrics.ts`); la fuente se carga en la app |
| Mapa nativo | Apple Maps (MapKit) en iOS; Google Maps SDK for Android | Términos de Apple Maps / Google Maps Platform | **Nada**: lo sirve el SDK |

**Pendiente de confirmar antes de producción (no es asesoría legal):** la línea de atribución exacta que exigen el IGN/CNIG para las capas de límites
(el texto actual es «© IGN (límites)»). La vista previa **no** es un producto: en producción los límites los dibuja el SDK nativo.

### Ilustrativo frente a real

- **Real:** los límites de provincia y municipios (IGN, simplificados) y la posición aproximada de los lugares.
- **Ilustrativo:** todo lo demás: el trazado de calles y carreteras, el ancho del río, las zonas verdes y urbanas. Se rotula **«Mapa ilustrativo»** en el propio mapa y no
  debe usarse para decir dónde está una calle, cuánto se tarda ni qué ruta tomar. Precisión: ±300 m en el centro, ±1 km en la periferia.
- Las rutas de `SEVILLA_ROAD_ROUTES` siguen el dibujo, no carreteras reales; el backend (`MAPS_PROVIDER=google`) es quien produce rutas reales.

---

## 5. Regenerar los datos

Solo Node (sin dependencias nuevas). Orden y comandos, desde la raíz del repo:

```bash
tools/preview/map/fetch-sources.sh                  # una vez: descarga es-atlas 0.6.0 de npm a la caché (MVC_MAP_CACHE)
node tools/preview/map/build-basemap.mjs            # ≈ 1-20 s, determinista → web-stubs/map-data/sevilla-basemap.js + out/road-graph.json
node tools/preview/map/gen-places.mjs               # places.json → src/maps/placesData.ts (si cambia la lista de lugares)
node tools/preview/map/gen-road-routes.mjs          # road-graph.json → src/maps/roadRoutesData.ts (≈ 1 s; comprueba la conectividad)
node tools/preview/map/gen-text-metrics.mjs         # TTF Roboto Condensed → src/maps/textMetrics.ts (solo si cambia la fuente)
```

Tras cambiar la geometría (`data/sevilla-geometry.mjs`) hay que repetir `build-basemap` y `gen-road-routes`, y volver a pasar las pruebas y la fidelidad (§ 7-8).

---

## 6. Producción: iOS y Android

| Tema | Decisión |
|---|---|
| iOS | Apple Maps (`PROVIDER_DEFAULT`, `mapType="mutedStandard"`). **No necesita clave.** La etiqueta legal y el logotipo los dibuja MapKit |
| Android | Google Maps (`PROVIDER_GOOGLE`) con `customMapStyle={MVC_MAP_STYLE_LIGHT}` (colores muestreados de las láminas). **Necesita la clave «Maps SDK for Android»** |
| Clave de Android | Restringida por **nombre de paquete + huella SHA-1**. Se inyecta en la compilación (`android.config.googleMaps.apiKey` desde un secreto de EAS/variable de entorno, p. ej. con `app.config.ts`). **Nunca en el repo** |
| Clave del servidor | Independiente: `GOOGLE_MAPS_API_KEY` del backend (Routes/Geocoding), restringida por IP/servicio. **No reutilizar la clave del SDK del móvil** |
| Backend | `MAPS_PROVIDER` por defecto es `disabled` (`disabled \| google`; con `google` exige `GOOGLE_MAPS_API_KEY`). Mientras esté desactivado, las rutas/geocodificación responden `MAPS_PROVIDER_UNAVAILABLE` (503). Es independiente del mapa del móvil, que habla con Apple/Google directamente |
| Cumplimiento | Términos de Apple Maps y de Google Maps Platform: no ocultar ni alterar logotipo y atribución, no copiar teselas, no mezclar datos de Google con otros mapas |
| Vista previa | Nunca es evidencia del aspecto o la precisión nativos |

**Acciones fuera de mi propiedad (para `app`/orquestador):**

1. `mobile/app.json` no tiene `android.config.googleMaps.apiKey` ni la configuración del plugin de `react-native-maps`. Sin la clave, Android muestra un mapa gris o vacío. Cambiarlo a `app.config.ts` con la clave leída del entorno.
2. Crear y restringir la clave del SDK de Android en Google Cloud, y habilitar «Maps SDK for Android».
3. Probar en un *development build* (EAS) en iOS y Android reales: ver § 9.
4. `BLOCKERS.md` punto 2 (clave real del backend) sigue abierto y es independiente.

---

## 7. Banco de fidelidad contra las láminas

<!--FIDELIDAD-->

---

## 8. Pruebas

```bash
cd mobile
node --import tsx --test src/maps/maps.test.ts      # 46 pruebas de partes puras (≈ 1 s)
pnpm -s typecheck                                   # tsc --noEmit (estricto)
```

Cubren: geografía (Mercator, `fitBounds`, distancias), medidas de chip, coherencia `anchor`/`centerOffset`/gráfico/chip en 17 variantes de marcador (y la silueta de la tarjeta del birrete),
tema, lugares y búsqueda, y las 37 rutas ilustrativas (extremos a < 60 m de sus lugares, distancia coherente con la polilínea ±8 %, ida y vuelta de la codificación
`polyline` incluido el vector de referencia de Google, ruta inversa). **No renderizan nada**: el aspecto se comprueba con el banco de fidelidad (§ 7).

---

## 9. Límites conocidos

- **No verificado en dispositivos.** Nada de `MvcMap` se ha ejecutado sobre Apple Maps ni Google Maps. El código sigue la API documentada de `react-native-maps` 1.27.2 y compila,
  pero el posicionamiento exacto de marcadores (`centerOffset`/`anchor`), la rasterización de hijos en Android, el rendimiento con muchos marcadores y el estilo de Google no se han visto.
- **Sombra de los chips en Android.** La sombra difusa (`boxShadow`) cae fuera de la caja del chip y los hijos de un `Marker` se rasterizan recortados a su caja: es probable que en Android los chips no tengan sombra
  (siguen siendo blancos sobre el mapa claro). No hay margen reservado para ello; si en un dispositivo real se echa en falta, hay que añadir un margen transparente simétrico alrededor del chip en `markerLayout.ts`/`MarkerView.tsx` (el `centerOffset` no cambia con un margen simétrico; el `anchor` sí).
- `MvcMap` no pasa `mapPadding` al SDK: si una hoja inferior tapa el mapa, el logotipo de Google / la etiqueta legal de Apple quedarán debajo de la hoja. Revisar con las pantallas reales.
- Sin mapas sin conexión, satélite, tráfico, modo oscuro del mapa, giro ni inclinación. La app es solo clara.
- La vista previa web: nombres de calles solo ilustrativos; los rótulos usan la tipografía del sistema del navegador (no es idéntica entre equipos);
  a z ≥ 16 el callejero se ve «adoquinado» (retícula deformada, no calles reales).
- `MvcMap` no agrupa marcadores (`cluster` es un tipo que la pantalla rellena) ni calcula rutas (las recibe).
- Las 9 láminas son imágenes de un generador, con geografía y escalas no métricas ni homogéneas entre sí: el chip, el pin y el coche **varían de una lámina a otra**
  (§ 7); `lg/md/sm` son un compromiso, no una medida exacta de cada lámina.
