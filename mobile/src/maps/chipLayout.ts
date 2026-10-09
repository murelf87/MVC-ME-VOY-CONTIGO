import { textWidth } from './textMetrics';
import type { ChipSize, MapChipSpec } from './types';

/**
 * Tamaños de chip (pt). Las láminas usan títulos de 13 a 17,6 pt según la pantalla (medido sobre los recortes): se
 * resumen en tres escalones. `lg` = «2 plazas», «A 6 km»; `md` = tarjetas de parada y de recogida; `sm` = «Completo»,
 * etiquetas pequeñas y la tarjeta del birrete.
 */
export interface ChipMetrics {
  title: number;
  subtitle: number;
  trailing: number;
  titleLine: number;
  subtitleLine: number;
  padX: number;
  padY: number;
  radius: number;
}

export const CHIP_SIZES: Readonly<Record<ChipSize, ChipMetrics>> = {
  lg: { title: 17, subtitle: 16, trailing: 16, titleLine: 20, subtitleLine: 19, padX: 12, padY: 7, radius: 14 },
  md: { title: 15.5, subtitle: 15, trailing: 15, titleLine: 19, subtitleLine: 18, padX: 12, padY: 7, radius: 14 },
  sm: { title: 14, subtitle: 13.5, trailing: 13.5, titleLine: 17, subtitleLine: 16, padX: 10, padY: 7, radius: 13 },
};

/** Separación entre bloques de un chip (pt). */
export const CHIP_GAP = 12;
export const CHIP_ICON_W = 20;
export const CHIP_HANDLE_W = 18;
/** Asa «≡»: separación antes y después de la línea fina que la precede (láminas 19: 8 y 9 pt). */
export const CHIP_HANDLE_GAP_BEFORE = 8;
export const CHIP_HANDLE_GAP_AFTER = 9;
export const CHIP_LINE_GAP = 1;
/** Separación entre el icono y el texto. */
const ICON_TEXT_GAP = 6;

export interface ChipLayout {
  width: number;
  height: number;
  size: ChipSize;
  metrics: ChipMetrics;
  /** Ancho reservado al icono (incluye separación). */
  iconBlock: number;
  /** Ancho del bloque de texto principal. */
  textBlock: number;
  /** Ancho reservado a hora + asa a la derecha (incluye separaciones). */
  trailBlock: number;
  /** Ancho del texto de la derecha. */
  trailingText: number;
  /**
   * `true` cuando la hora cabe en la segunda línea, bajo el final del título («1. Palomares del Río / Origen … 07:00»,
   * lámina 19): entonces va dentro del bloque de texto y no ocupa una columna propia.
   */
  trailingInline: boolean;
  titleLines: string[];
  subtitleLines: string[];
}

const linesOf = (text: string | undefined): string[] => (text ? text.split('\n') : []);

/** Tamaño por defecto de un chip. */
export const DEFAULT_CHIP_SIZE: ChipSize = 'md';

/** Tamaño exacto de un chip a partir de su contenido (sin medir en pantalla). */
export function measureChip(spec: MapChipSpec, fallbackSize: ChipSize = DEFAULT_CHIP_SIZE): ChipLayout {
  const size = spec.size ?? fallbackSize;
  const m = CHIP_SIZES[size];
  const titleLines = linesOf(spec.title);
  const subtitleLines = linesOf(spec.subtitle);
  const titleW = Math.max(0, ...titleLines.map((l) => textWidth(l, m.title, spec.titleWeight ?? 'bold')));
  const subW = Math.max(0, ...subtitleLines.map((l) => textWidth(l, m.subtitle, 'medium')));
  const textBlock = Math.ceil(Math.max(titleW, subW)) + 2;
  const iconBlock = spec.icon ? CHIP_ICON_W + ICON_TEXT_GAP : 0;
  const trailingText = spec.trailing ? Math.ceil(textWidth(spec.trailing, m.trailing, 'medium')) + 1 : 0;
  // Con una sola línea de título y de subtítulo, la hora cabe bajo el final del título si el subtítulo + separación + hora no lo pasan.
  const trailingInline = trailingText > 0 && titleLines.length === 1 && subtitleLines.length === 1 && subW + CHIP_GAP + trailingText <= titleW;
  const column = trailingText > 0 && !trailingInline;
  let trailBlock = 0;
  if (column) trailBlock += CHIP_GAP + trailingText;
  if (spec.handle) trailBlock += CHIP_HANDLE_GAP_BEFORE + 1 + CHIP_HANDLE_GAP_AFTER + CHIP_HANDLE_W;
  const innerH = titleLines.length * m.titleLine + (subtitleLines.length ? CHIP_LINE_GAP + subtitleLines.length * m.subtitleLine : 0);
  return {
    width: Math.ceil(m.padX * 2 + iconBlock + textBlock + trailBlock),
    height: Math.ceil(m.padY * 2 + innerH),
    size,
    metrics: m,
    iconBlock,
    textBlock,
    trailBlock,
    trailingText,
    trailingInline,
    titleLines,
    subtitleLines,
  };
}
