/**
 * Geometría de los marcadores (pura, sin React): tamaño del conjunto «pin + chip», posición de cada parte y punto de
 * anclaje. Todo en pt y determinista (no se mide nada en pantalla), de modo que iOS (Apple Maps: `centerOffset`),
 * Android/Google (`anchor`) y la vista previa web (`anchor`) colocan el pin exactamente sobre la coordenada.
 */
import { measureChip } from './chipLayout';
import { CAP_VIEWBOX, MARKER_METRICS } from './mapTheme';
import type { CarMarker, ChipSide, MapChipSpec, MapMarkerKind, MapMarkerSpec } from './types';

const M = MARKER_METRICS;

/** Texto estándar del chip de plazas libres: «2 plazas», «1 plaza», «Completo». */
export function seatsLabel(seats: number): string {
  if (seats <= 0) return 'Completo';
  return seats === 1 ? '1 plaza' : `${seats} plazas`;
}

/** Chip estándar de un coche según sus plazas libres. */
export function carSeatsChip(seats: number): MapChipSpec {
  return seats <= 0 ? { title: seatsLabel(seats), tone: 'neutral', size: 'sm', titleWeight: 'medium' } : { title: seatsLabel(seats), tone: 'brand', size: 'lg' };
}

/** Chip efectivo de un marcador (explícito, o el derivado de `seats` en los coches). */
export function chipOf(marker: MapMarkerSpec): MapChipSpec | undefined {
  if (marker.chip) return marker.chip;
  if (marker.kind === 'car' && marker.seats !== undefined && (marker.variant === undefined || marker.variant === 'pin')) return carSeatsChip(marker.seats);
  return undefined;
}

/** `true` si el coche se dibuja en gris («Completo»). */
export function isFullCar(marker: CarMarker): boolean {
  return marker.full === true || (marker.seats !== undefined && marker.seats <= 0);
}

/** Parte gráfica de un marcador (sin chip). `ax/ay` = punto de la coordenada dentro del gráfico; `bodyCy` = centro vertical del «cuerpo». */
export interface Graphic {
  w: number;
  h: number;
  ax: number;
  ay: number;
  bodyCy: number;
}

export function clusterSizes(count: number): { core: number; halo: number } {
  const core = count >= 10 ? M.cluster.core : M.cluster.core - 3;
  return { core, halo: Math.round(core * 2.2) };
}

export function graphicFor(marker: MapMarkerSpec): Graphic {
  switch (marker.kind) {
    case 'car':
      if (marker.variant === 'badge') return { w: M.carBadge.w, h: M.carBadge.h, ax: M.carBadge.w / 2, ay: M.carBadge.h / 2, bodyCy: M.carBadge.h / 2 };
      if (marker.variant === 'live') return { w: M.carLive.w, h: M.carLive.h, ax: M.carLive.w / 2, ay: M.carLive.h / 2, bodyCy: M.carLive.h / 2 };
      return { w: M.carPin.body, h: M.carPin.body + M.carPin.tail, ax: M.carPin.body / 2, ay: M.carPin.body + M.carPin.tail, bodyCy: M.carPin.body / 2 };
    case 'pickupA':
    case 'pickupB':
    case 'destination': {
      const d = M.drop;
      const ay = d.top + d.height + 5;
      return { w: d.w, h: Math.ceil(ay + d.halo / 2 + 1), ax: d.w / 2, ay, bodyCy: d.top + d.head / 2 };
    }
    case 'origin':
      return { w: M.origin.size, h: M.origin.size, ax: M.origin.size / 2, ay: M.origin.size / 2, bodyCy: M.origin.size / 2 };
    case 'stop': {
      const size = marker.index !== undefined && marker.index >= 10 ? M.stop.size + 4 : M.stop.size;
      return { w: size, h: size, ax: size / 2, ay: size / 2, bodyCy: size / 2 };
    }
    case 'destinationCap':
      return { w: M.cap.size, h: M.cap.size, ax: M.cap.size / 2, ay: M.cap.size / 2, bodyCy: M.cap.size / 2 };
    case 'user':
      return { w: 64, h: 64, ax: 32, ay: 32, bodyCy: 32 };
    case 'cluster': {
      const { halo } = clusterSizes(marker.count);
      return { w: halo, h: halo, ax: halo / 2, ay: halo / 2, bodyCy: halo / 2 };
    }
    case 'flag':
      return { w: M.flag.halo, h: M.flag.halo, ax: M.flag.halo / 2, ay: M.flag.halo / 2, bodyCy: M.flag.halo / 2 };
    case 'label':
      return { w: 0, h: 0, ax: 0, ay: 0, bodyCy: 0 };
  }
}

/** Distancia entre el pin y su chip. */
const GAP: Record<ChipSide, number> = { right: 8, left: 8, top: 8, bottom: 5 };

/**
 * Separación entre el gráfico y el chip según el tipo de marcador (medida en las láminas): las gotas (cabeza de 28 pt en una
 * caja de 36) llevan el chip casi pegado, los anillos a ≈ 6 pt y los puntos con halo (clúster, bandera, usuario) a 2 pt del halo.
 */
function chipGap(kind: MapMarkerKind, side: ChipSide): number {
  const horizontal = side === 'left' || side === 'right';
  if (!horizontal) return GAP[side];
  switch (kind) {
    case 'pickupA':
    case 'pickupB':
    case 'destination':
      return -1;
    case 'origin':
    case 'stop':
      return 6;
    case 'cluster':
    case 'flag':
    case 'user':
      return 2;
    default:
      return GAP[side];
  }
}

export interface MarkerLayout {
  /** Tamaño total del conjunto (pt). */
  width: number;
  height: number;
  /** Posición del gráfico dentro del conjunto. */
  graphic: Graphic & { x: number; y: number };
  chip?: { spec: MapChipSpec; x: number; y: number; w: number; h: number; side: ChipSide };
  /** Anclaje fraccionario (Google Maps / web). */
  anchor: { x: number; y: number };
  /** Desplazamiento del centro de la vista respecto a la coordenada, en pt (Apple Maps). */
  centerOffset: { x: number; y: number };
  /** `true` cuando el chip va dentro de una sola tarjeta con el birrete (destino universitario, lado inferior). */
  capCard: boolean;
}

/** Alto (pt) del glifo del birrete dibujado con el ancho dado. */
export function capGlyphHeight(width: number): number {
  return (width * CAP_VIEWBOX.h) / CAP_VIEWBOX.w;
}

/**
 * Contorno de la tarjeta «birrete + texto» (lámina 11): lengüeta superior estrecha unida a la tarjeta ancha con dos
 * empalmes cóncavos. `w` = ancho total y `h` = alto de la silueta (sin la reserva de la sombra).
 */
export function capCardPath(w: number, h: number): string {
  const { tabW, tabH, radius: rc, tabRadius: rt, fillet: f } = M.capCard;
  const x0 = (w - tabW) / 2;
  const x1 = x0 + tabW;
  const n = (v: number): string => String(Math.round(v * 100) / 100);
  return [
    `M${n(x0 + rt)} 0`,
    `H${n(x1 - rt)}`,
    `A${n(rt)} ${n(rt)} 0 0 1 ${n(x1)} ${n(rt)}`,
    `V${n(tabH - f)}`,
    `A${n(f)} ${n(f)} 0 0 0 ${n(x1 + f)} ${n(tabH)}`,
    `H${n(w - rc)}`,
    `A${n(rc)} ${n(rc)} 0 0 1 ${n(w)} ${n(tabH + rc)}`,
    `V${n(h - rc)}`,
    `A${n(rc)} ${n(rc)} 0 0 1 ${n(w - rc)} ${n(h)}`,
    `H${n(rc)}`,
    `A${n(rc)} ${n(rc)} 0 0 1 0 ${n(h - rc)}`,
    `V${n(tabH + rc)}`,
    `A${n(rc)} ${n(rc)} 0 0 1 ${n(rc)} ${n(tabH)}`,
    `H${n(x0 - f)}`,
    `A${n(f)} ${n(f)} 0 0 0 ${n(x0)} ${n(tabH - f)}`,
    `V${n(rt)}`,
    `A${n(rt)} ${n(rt)} 0 0 1 ${n(x0 + rt)} 0`,
    'Z',
  ].join('');
}

/** Calcula el conjunto «gráfico + chip» de un marcador. */
export function layoutMarker(marker: MapMarkerSpec): MarkerLayout {
  const spec = chipOf(marker);
  const side: ChipSide = spec?.side ?? 'right';
  let graphic = graphicFor(marker);
  if (marker.kind === 'label' && spec) {
    // Solo chip: la coordenada es el centro de la etiqueta.
    const c = measureChip(spec);
    return {
      width: c.width,
      height: c.height,
      graphic: { ...graphic, x: 0, y: 0 },
      chip: { spec, x: 0, y: 0, w: c.width, h: c.height, side },
      anchor: { x: 0.5, y: 0.5 },
      centerOffset: { x: 0, y: 0 },
      capCard: false,
    };
  }
  const capCard = marker.kind === 'destinationCap' && !!spec && side === 'bottom';

  if (capCard && spec) {
    // Tarjeta única: lengüeta con el birrete arriba y texto debajo (lámina 11). El anclaje es el centro del birrete.
    const k = M.capCard;
    const c = measureChip(spec, 'sm');
    const textH = c.height - 2 * c.metrics.padY;
    const w = Math.max(k.minWidth, c.width - 8);
    const h = k.tabH + k.padTop + textH + k.padBottom + k.shadowPad;
    const ay = k.iconTop + capGlyphHeight(k.iconW) / 2;
    graphic = { w, h, ax: w / 2, ay, bodyCy: h / 2 };
    return {
      width: w,
      height: h,
      graphic: { ...graphic, x: 0, y: 0 },
      chip: { spec, x: 0, y: 0, w, h, side },
      anchor: { x: 0.5, y: ay / h },
      centerOffset: { x: 0, y: h / 2 - ay },
      capCard: true,
    };
  }

  if (!spec) {
    return {
      width: graphic.w,
      height: graphic.h,
      graphic: { ...graphic, x: 0, y: 0 },
      anchor: { x: graphic.ax / graphic.w, y: graphic.ay / graphic.h },
      centerOffset: { x: graphic.w / 2 - graphic.ax, y: graphic.h / 2 - graphic.ay },
      capCard: false,
    };
  }

  const c = measureChip(spec);
  const gap = chipGap(marker.kind, side);
  let chipX = 0;
  let chipY = 0;
  if (side === 'right') {
    chipX = graphic.w + gap;
    chipY = graphic.bodyCy - c.height / 2;
  } else if (side === 'left') {
    chipX = -(c.width + gap);
    chipY = graphic.bodyCy - c.height / 2;
  } else if (side === 'top') {
    chipX = graphic.ax - c.width / 2;
    chipY = -(c.height + gap);
  } else {
    chipX = graphic.ax - c.width / 2;
    chipY = graphic.h + gap;
  }
  const minX = Math.min(0, chipX);
  const minY = Math.min(0, chipY);
  const maxX = Math.max(graphic.w, chipX + c.width);
  const maxY = Math.max(graphic.h, chipY + c.height);
  const width = Math.ceil(maxX - minX);
  const height = Math.ceil(maxY - minY);
  const gx = -minX;
  const gy = -minY;
  const px = gx + graphic.ax;
  const py = gy + graphic.ay;
  return {
    width,
    height,
    graphic: { ...graphic, x: gx, y: gy },
    chip: { spec, x: chipX - minX, y: chipY - minY, w: c.width, h: c.height, side },
    anchor: { x: px / width, y: py / height },
    centerOffset: { x: width / 2 - px, y: height / 2 - py },
    capCard: false,
  };
}

/** Orden de apilado por defecto: usuario < nodos < pins < coche en curso < seleccionado. */
export function defaultZIndex(kind: MapMarkerKind): number {
  switch (kind) {
    case 'cluster':
      return 1;
    case 'user':
      return 2;
    case 'stop':
      return 3;
    case 'origin':
      return 4;
    case 'flag':
      return 5;
    case 'destination':
    case 'destinationCap':
      return 6;
    case 'pickupA':
    case 'pickupB':
      return 7;
    case 'car':
      return 8;
    case 'label':
      return 9;
  }
}

/** Texto accesible por defecto de un marcador. */
export function accessibilityLabelOf(marker: MapMarkerSpec): string {
  if (marker.accessibilityLabel) return marker.accessibilityLabel;
  const chip = chipOf(marker);
  const chipText = chip ? [chip.title.replace(/\n/g, ' '), chip.subtitle?.replace(/\n/g, ' '), chip.trailing].filter(Boolean).join(', ') : '';
  switch (marker.kind) {
    case 'car':
      return chipText ? `Coche. ${chipText}` : 'Coche';
    case 'pickupA':
      return chipText ? `Punto de recogida A. ${chipText}` : 'Punto de recogida A';
    case 'pickupB':
      return chipText ? `Punto de recogida B. ${chipText}` : 'Punto de recogida B';
    case 'origin':
      return chipText ? `Origen. ${chipText}` : 'Origen';
    case 'destination':
      return chipText ? `Destino. ${chipText}` : 'Destino';
    case 'destinationCap':
      return chipText ? `Universidad. ${chipText}` : 'Universidad';
    case 'stop':
      return `Parada${marker.index !== undefined ? ` ${marker.index}` : ''}${chipText ? `. ${chipText}` : ''}`;
    case 'user':
      return 'Tu ubicación';
    case 'cluster':
      return `${marker.count} vehículos`;
    case 'flag':
      return chipText ? `Meta. ${chipText}` : 'Meta';
    case 'label':
      return chipText;
  }
}
