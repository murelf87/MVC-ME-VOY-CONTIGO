/**
 * Tokens visuales propios del mapa. Los valores salen de MUESTREAR las láminas aprobadas (design/screens-raw), no de
 * suposiciones: ver docs/MAPS.md §Fidelidad. Si el sistema de diseño (`src/theme`) cambia el azul de marca, basta con
 * actualizar aquí; el módulo de mapas no importa de `theme/` para poder usarse (y probarse) de forma aislada. Este fichero es
 * PURO (sin react-native) para poder probarlo con `node --test`; las familias tipográficas viven en `mapFonts.ts`.
 */
import type { ChipTone, MapRouteKind } from './types';

export const MAP_COLORS = {
  /** Pin de coche, pin A y pin de destino (ultramarino de las láminas: #0511EF…#0912FC). */
  pin: '#0612F5',
  /** Pin de coche completo. */
  pinFull: '#545770',
  /** Pin B (verde). */
  pinB: '#0F7B4B',
  /** Ruta, origen, paradas, clúster (azul de marca de las láminas: #0351FC…#074DF5). */
  brand: '#0551F8',
  /** Parada nueva propuesta. */
  warning: '#E8651C',
  danger: '#E5222F',
  success: '#0F7B4B',
  white: '#FFFFFF',
  /** Texto del título de un chip (azul de las láminas, #0A0DFA). */
  chipTitle: '#0B10F2',
  /** Texto secundario azul claro de un chip («C. Luis Montoto»). */
  chipSubtitleBrand: '#1D3FE3',
  /** Texto azul marino de la UI («Completo», «08:05»). */
  navy: '#0E1B66',
  muted: '#68718F',
  /** Halo translúcido de clúster / bandera / punto de usuario. */
  haloCluster: 'rgba(186,208,248,0.58)',
  haloFlag: 'rgba(184,208,246,0.62)',
  haloUser: 'rgba(5,81,248,0.16)',
  /** Sombra de chips y marcadores. */
  shadow: '#0A1250',
  /** Botón de ubicación. */
  locateIcon: '#0C10FC',
  /** Trazos de ruta. */
  route: '#0551F8',
  routeWalk: '#0B3AF9',
  routeAlt: '#7E86A2',
  routeApproach: '#0B5BE6',
  routeCasing: '#FFFFFF',
} as const;

/** Colores de texto por tono de chip. */
export function chipToneColor(tone: ChipTone): string {
  switch (tone) {
    case 'brand':
      return MAP_COLORS.chipTitle;
    case 'neutral':
      return MAP_COLORS.navy;
    case 'success':
      return MAP_COLORS.success;
    case 'warning':
      return '#E2431B';
    case 'danger':
      return MAP_COLORS.danger;
    case 'muted':
      return MAP_COLORS.muted;
  }
}

/**
 * Sombras suaves de las tarjetas, chips y botones del mapa (`boxShadow`, como el resto de la UI: RN 0.76+ en iOS/Android y CSS en web;
 * `shadow*` está obsoleto en web). Color base = `MAP_COLORS.shadow` (#0A1250).
 */
export const MAP_SHADOWS = {
  chip: '0px 3px 9px rgba(10, 18, 80, 0.16)',
  legend: '0px 3px 10px rgba(10, 18, 80, 0.14)',
  button: '0px 3px 9px rgba(10, 18, 80, 0.2)',
} as const;

/**
 * Medidas de los marcadores (pt), MEDIDAS sobre los recortes de mapa de las láminas 09, 11, 12, 13a, 19, 21, 22, 24 y 37a
 * (azul interior de cada pin/anillo, ancho de halos, tamaño del birrete). Las láminas no son homogéneas entre sí (el
 * generador de imágenes dibujó cada una con escalas algo distintas): aquí se usa el valor central y la desviación se
 * documenta en docs/MAPS.md §Fidelidad.
 */
export const MARKER_METRICS = {
  /** Pin de coche con cola (lámina 09): cuerpo 42 + cola 8; azul interior 36. */
  carPin: { body: 42, radius: 13, inner: 36, innerRadius: 10, tail: 8, glyphW: 24 },
  /** Coche en curso sin cola (láminas 13a y 21): azul interior 31 × 39. */
  carLive: { w: 36, h: 44, innerW: 31, innerH: 39, radius: 13, innerRadius: 11, glyphW: 21 },
  /** Coche suelto del panel de administración (lámina 37a): silueta azul de 25,5 × 25 pt con borde blanco fino. */
  carBadge: { w: 29, h: 28 },
  /** Gota (A, B, destino): cabeza azul de 28 pt, altura total 37 pt, apoyada en un punto con halo. */
  drop: { w: 36, head: 28, height: 37, top: 3, dot: 13, halo: 22, outline: 2.2, hole: 4.8, letter: 17 },
  /** Anillo de origen: azul 23,6 pt con hueco de 10 pt y borde blanco de 2,2 pt. */
  origin: { size: 28, hole: 10, border: 2.2 },
  /** Anillo de parada. */
  stop: { size: 25, hole: 9, border: 2.2 },
  /** Disco con birrete (lámina 12: disco de 45 pt, birrete de 34 pt). */
  cap: { size: 46, glyphW: 33 },
  /** Tarjeta «birrete + texto» de la lámina 11: lengüeta de 38 × 29 pt sobre una tarjeta de 72 pt de ancho. */
  capCard: { minWidth: 72, tabW: 38, tabH: 29, iconW: 26.7, iconTop: 6, radius: 10, tabRadius: 12, fillet: 5, padTop: 7, padBottom: 7, shadowPad: 4 },
  /** Punto de usuario. */
  user: { core: 20, ring: 3.5 },
  /** Clúster: núcleo azul de 31-34 pt y halo de ≈ 2,2 veces el núcleo (lámina 37a). */
  cluster: { core: 35, ring: 1.2 },
  /** Bandera: halo de 38 pt (lámina 19). */
  flag: { halo: 38, glyphW: 21 },
} as const;

/** Caja de dibujo (viewBox) del glifo del birrete; da su proporción en `CapGlyph` y en el cálculo de la tarjeta. */
export const CAP_VIEWBOX = { w: 34, h: 30.4 } as const;

/** Estilo por defecto de cada tipo de ruta. */
export const ROUTE_STYLE: Record<MapRouteKind, { color: string; width: number; casing: boolean; dash?: readonly number[]; round?: boolean; zIndex: number }> = {
  alt: { color: MAP_COLORS.routeAlt, width: 4.5, casing: true, zIndex: 2 },
  route: { color: MAP_COLORS.route, width: 5.5, casing: true, zIndex: 4 },
  approach: { color: MAP_COLORS.routeApproach, width: 4.2, casing: true, dash: [10, 7], zIndex: 3 },
  walk: { color: MAP_COLORS.routeWalk, width: 4.5, casing: false, dash: [0.5, 9], round: true, zIndex: 5 },
};
