/**
 * Contrato público del mapa de MVC (`MvcMap`). Mismo API en iOS/Android (react-native-maps: Apple Maps / Google Maps)
 * y en la vista previa web (sustituto vectorial de Sevilla en `mobile/web-stubs/react-native-maps.js`).
 *
 * Convenciones:
 *  - Coordenadas WGS84 como `{ lat, lng }` (estructuralmente idéntico a `GeoPoint` de `@/api/types`).
 *  - Medidas en pt (puntos lógicos), igual que el resto de la UI.
 *  - El mapa NO hace red: recibe marcadores/rutas ya resueltos por la pantalla (hook → api → backend).
 */
import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/** Punto WGS84. Compatible con `GeoPoint` de `@/api/types` (no se importa para no acoplar el módulo). */
export interface MapPoint {
  lat: number;
  lng: number;
}

/** Región visible: centro + extensión en grados (como `Region` de react-native-maps, con `lat/lng`). */
export interface MapRegion {
  lat: number;
  lng: number;
  latDelta: number;
  lngDelta: number;
}

/** Rectángulo geográfico (suroeste / noreste). */
export interface MapBounds {
  sw: MapPoint;
  ne: MapPoint;
}

/** Márgenes interiores en pt (zona del mapa tapada por tarjetas / hojas inferiores). */
export interface EdgePadding {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

// ───────────────────────────── Chips ─────────────────────────────

/** Tono del texto de un chip. `brand` = azul MVC; `neutral` = azul marino de la UI; `muted` = secundario. */
export type ChipTone = 'brand' | 'neutral' | 'success' | 'warning' | 'danger' | 'muted';

/** Lado del pin en el que se coloca el chip. */
export type ChipSide = 'right' | 'left' | 'top' | 'bottom';

/** Iconos disponibles dentro de un chip. */
export type ChipIcon = 'walk' | 'car' | 'cap' | 'clock';

/**
 * Tamaño del chip: `lg` (título de 17 pt: «2 plazas», «A 6 km»), `md` (15,5 pt: paradas y recogidas; por defecto) y
 * `sm` (14 pt: «Completo», etiquetas pequeñas, tarjeta del birrete).
 */
export type ChipSize = 'lg' | 'md' | 'sm';

/**
 * Contenido de un chip («2 plazas», «Ana / llega en 8 min», «Montequinto / 08:05», «1. Palomares del Río / Origen / 07:00 ≡»).
 * El texto NO se ajusta solo: cada línea es una línea (el ancho se calcula con métricas de Roboto Condensed). Para
 * varias líneas del mismo estilo usa «\n» dentro de `title` o `subtitle` («Universidad\nde Sevilla»).
 */
export interface MapChipSpec {
  /** Línea principal (negrita). */
  title: string;
  /** Segunda línea (peso normal). */
  subtitle?: string;
  /**
   * Texto a la derecha (p. ej. hora «07:25» en las tarjetas de parada). Con título y subtítulo de una sola línea, si cabe
   * bajo el final del título va en la línea del subtítulo («Origen … 07:00»); si no, en una columna propia.
   */
  trailing?: string;
  /** Icono a la izquierda del texto («4 min» con peatón). */
  icon?: ChipIcon;
  /** Color del título. Por defecto `brand`. */
  tone?: ChipTone;
  /** Color de la segunda línea. Por defecto `neutral` (o `muted` si `tone` es `neutral`). */
  subtitleTone?: ChipTone;
  /** Asa «≡» de reordenar, precedida de una línea fina (tarjetas de parada del conductor). Solo visual en el marcador. */
  handle?: boolean;
  /** Lado en el que aparece respecto al pin. Por defecto `right`. */
  side?: ChipSide;
  /** Alineación del texto cuando hay varias líneas. Por defecto `left`. */
  align?: 'left' | 'center';
  /** Tamaño del chip. Por defecto `md`. */
  size?: ChipSize;
  /** Peso del título: `bold` (por defecto) o `medium` (p. ej. «Completo» en la lámina 09, menos énfasis). */
  titleWeight?: 'bold' | 'medium';
}

// ───────────────────────────── Marcadores ─────────────────────────────

export type MapMarkerKind =
  | 'car'
  | 'pickupA'
  | 'pickupB'
  | 'origin'
  | 'destination'
  | 'destinationCap'
  | 'stop'
  | 'user'
  | 'cluster'
  | 'flag'
  | 'label';

interface MarkerBase {
  /** Identificador estable (clave React y valor devuelto en `onMarkerPress`). */
  id: string;
  position: MapPoint;
  /** Etiqueta junto al marcador. */
  chip?: MapChipSpec;
  /** Orden de apilado (mayor = encima). Por defecto según el tipo. */
  zIndex?: number;
  /** Texto para lectores de pantalla. Por defecto se deduce del tipo y del chip. */
  accessibilityLabel?: string;
}

/**
 * Coche en el mapa.
 *  - `variant: 'pin'` (por defecto): pin con cola de la búsqueda (lámina 09). `seats` (plazas libres) genera el chip
 *    estándar: «2 plazas» · «1 plaza» · «Completo» (gris) si no hay `chip`.
 *  - `variant: 'live'`: coche en curso sin cola, anclado por su centro (seguimiento y ruta del conductor, láminas 13a y 21).
 *  - `variant: 'badge'`: coche pequeño suelto, anclado por su centro (mapa de actividad del panel de administración, lámina 37).
 */
export interface CarMarker extends MarkerBase {
  kind: 'car';
  seats?: number;
  variant?: 'pin' | 'live' | 'badge';
  /** Fuerza el aspecto «completo» (gris) aunque `seats` no esté. */
  full?: boolean;
}

/** Punto de recogida propuesto A (pin azul con «A») / B (pin verde con «B»). */
export interface PickupMarker extends MarkerBase {
  kind: 'pickupA' | 'pickupB';
  /** Resaltado cuando es la opción elegida. */
  selected?: boolean;
}

/** Inicio de un recorrido (anillo azul con hueco blanco). */
export interface OriginMarker extends MarkerBase {
  kind: 'origin';
}

/** Pin con hueco blanco: «Tu recogida», «Tu destino», origen de una ruta. */
export interface DestinationMarker extends MarkerBase {
  kind: 'destination';
  /** Por defecto `brand`. */
  tone?: 'brand' | 'success' | 'warning';
}

/** Disco blanco con birrete (destino universitario). Con `chip.side = 'bottom'` se dibuja como una sola tarjeta. */
export interface DestinationCapMarker extends MarkerBase {
  kind: 'destinationCap';
}

/** Parada intermedia: anillo, con número opcional. */
export interface StopMarker extends MarkerBase {
  kind: 'stop';
  /** Número de parada mostrado dentro del anillo. */
  index?: number;
  /** `warning` = parada nueva propuesta (naranja). */
  tone?: 'brand' | 'warning';
  /** Parada final: rombo blanco en el centro. */
  end?: boolean;
}

/** Posición de la persona usuaria (punto azul con halo de precisión). */
export interface UserMarker extends MarkerBase {
  kind: 'user';
  /** Radio de precisión en metros (halo). */
  accuracyM?: number;
}

/** Agrupación de vehículos (número dentro de un disco azul con halo). */
export interface ClusterMarker extends MarkerBase {
  kind: 'cluster';
  count: number;
}

/** Bandera de meta con halo (destino final del conductor, lámina 19). */
export interface FlagMarker extends MarkerBase {
  kind: 'flag';
}

/**
 * Etiqueta suelta (solo chip, sin gráfico): «4 min» con peatón sobre el trayecto a pie, «A 6 km de tu destino» junto a la
 * ruta. La coordenada es el CENTRO del chip. `chip` es obligatorio.
 */
export interface LabelMarker extends MarkerBase {
  kind: 'label';
  chip: MapChipSpec;
}

export type MapMarkerSpec =
  | CarMarker
  | PickupMarker
  | OriginMarker
  | DestinationMarker
  | DestinationCapMarker
  | StopMarker
  | UserMarker
  | ClusterMarker
  | FlagMarker
  | LabelMarker;

// ───────────────────────────── Rutas ─────────────────────────────

/**
 * Tipos de trazo:
 *  - `route`    línea azul continua con borde blanco (ruta del conductor).
 *  - `walk`     puntos (trayecto a pie desde el punto de recogida).
 *  - `alt`      gris continuo (ruta alternativa).
 *  - `approach` línea discontinua (aproximación del coche / cambio de ruta propuesto).
 */
export type MapRouteKind = 'route' | 'walk' | 'alt' | 'approach';

export interface MapRouteSpec {
  id: string;
  kind: MapRouteKind;
  points: readonly MapPoint[];
  /** Grosor en pt; por defecto según el tipo. */
  width?: number;
  /** Color; por defecto según el tipo. */
  color?: string;
  zIndex?: number;
}

// ───────────────────────────── Componente ─────────────────────────────

/** Qué encuadrar al montar (y al cambiar `fitKey`). */
export type MapFit = 'content' | readonly MapPoint[] | MapBounds;

export interface RegionChangeMeta {
  /** `true` cuando el movimiento ha terminado (equivale a `onRegionChangeComplete`). */
  settled: boolean;
  /** `true` si el cambio lo provocó un gesto de la persona usuaria. */
  byUser: boolean;
}

export interface MvcMapProps {
  /** Cámara inicial. Si no hay ni esto ni `fit`, se usa Sevilla. */
  initialRegion?: MapRegion;
  /** Encuadre automático: `'content'` = marcadores + rutas; o una lista de puntos; o un rectángulo. */
  fit?: MapFit;
  /** Cambia para forzar un nuevo encuadre (p. ej. al cambiar de ruta). */
  fitKey?: string | number;
  /** Márgenes interiores para el encuadre y para los controles (zona tapada por hojas inferiores). */
  edgePadding?: Partial<EdgePadding>;
  markers?: readonly MapMarkerSpec[];
  routes?: readonly MapRouteSpec[];
  /** Marcador resaltado (se dibuja encima y algo mayor). */
  selectedMarkerId?: string | null;
  onMarkerPress?: (marker: MapMarkerSpec) => void;
  onMapPress?: (point: MapPoint) => void;
  onRegionChange?: (region: MapRegion, meta: RegionChangeMeta) => void;
  /** Ubicación de la persona usuaria (la pantalla la obtiene con su hook de permisos). Dibuja el punto azul. */
  userLocation?: MapPoint | null;
  /** Precisión (m) del halo del punto azul. */
  userAccuracyM?: number;
  /** Sin `userLocation`, activa el punto azul nativo del sistema (solo iOS/Android; requiere permiso concedido). */
  showUserLocation?: boolean;
  /** Muestra el botón redondo «centrar en mi ubicación». */
  recenter?: boolean;
  /** Se llama al pulsar el botón (p. ej. para pedir el permiso). Después el mapa se centra en `userLocation` o en el contenido. */
  onRecenter?: () => void;
  /** `false` desactiva gestos (mapa decorativo). Por defecto `true`; con `lite` es `false`. */
  interactive?: boolean;
  /** Modo tarjeta: sin gestos ni controles, apto para listas/tarjetas incrustadas. */
  lite?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
  /** Capas superpuestas (leyendas, tarjetas…). Se pintan encima del mapa; no capturan toques fuera de su contenido. */
  children?: ReactNode;
}

/** Métodos imperativos (ref de `MvcMap`). */
export interface MvcMapHandle {
  /** Reencuadra marcadores + rutas. */
  fitToContent(options?: { animated?: boolean; padding?: Partial<EdgePadding> }): void;
  fitToPoints(points: readonly MapPoint[], options?: { animated?: boolean; padding?: Partial<EdgePadding> }): void;
  animateTo(target: MapRegion | MapPoint, options?: { zoomDelta?: number; durationMs?: number }): void;
  /** Centra en `userLocation` (si existe) o reencuadra el contenido. */
  recenter(): void;
  /** Posición en pantalla (pt, relativa al mapa) de una coordenada; `null` si aún no hay mapa. */
  pointForCoordinate(point: MapPoint): Promise<{ x: number; y: number } | null>;
}
