/**
 * Espaciado, radios, tamaños de control y sombras. Valores medianos medidos sobre las láminas
 * (design/screens-raw, 1 pt = 2 px en design/screens). Las láminas no son idénticas entre sí: ver docs/DESIGN_SYSTEM.md §«Desviaciones».
 */
import { colors } from "./colors";

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export type SpacingKey = keyof typeof spacing;

/** Radios. `button` y `card` son los que más se repiten (≈12 y ≈14 pt). La 01 usa radios mayores (`xl`). */
export const radii = {
  xs: 6,
  sm: 8,
  md: 12,
  lg: 14,
  xl: 18,
  xxl: 24,
  pill: 999,
} as const;

export type RadiusKey = keyof typeof radii;

export const layout = {
  /** Margen horizontal de pantalla (29–34 pt en las láminas; mediana 30). */
  screenX: 30,
  /** Separación vertical entre bloques de pantalla. */
  blockGap: 16,
  /** Alto de la fila de cabecera por debajo del margen seguro superior (centro del título ≈ 80 pt con isla). */
  headerRow: 44,
  /** Ancho máximo del contenido en pantallas anchas (web/tablet). */
  contentMaxWidth: 520,
} as const;

/** Tamaños de control (alto en pt). */
export const sizes = {
  button: 53,
  buttonSm: 44,
  buttonXs: 34,
  /** Campo con etiqueta interior (03). */
  field: 68,
  /** Campo compacto de una línea (09 «¿A dónde vas?»). */
  fieldCompact: 44,
  textArea: 112,
  /** Zona táctil mínima. */
  touch: 44,
  tile: 48,
  tileSm: 40,
  tileLg: 56,
  otp: 56,
  iconButton: 48,
  chevron: 24,
  bottomNav: 58,
  switchW: 51,
  switchH: 31,
  checkbox: 30,
  radio: 24,
  dayPill: 41,
  statusPill: 31,
  progressDot: 31,
  /** Punto de paso pendiente (16b: 26 pt, más pequeño que el actual y el alcanzado). */
  progressDotIdle: 26,
} as const;

/** Tamaños de avatar (pt). */
export const avatarSizes = {
  xs: 28,
  sm: 36,
  md: 45,
  lg: 62,
  xl: 75,
  xxl: 90,
  hero: 112,
} as const;

export type AvatarSize = keyof typeof avatarSizes;

/** Sombras (como `boxShadow`: lo entienden iOS, Android ≥ 9 con la nueva arquitectura y react-native-web). */
export const shadows = {
  none: undefined,
  /** Tarjetas y botones flotantes sobre el mapa (09: botón de ubicación, chips de plaza). */
  float: `0px 4px 14px ${hexAlpha(colors.shadow, 0.16)}`,
  /** Tarjeta elevada sutil (12 resumen de precio, listas). */
  card: `0px 2px 8px ${hexAlpha(colors.shadow, 0.07)}`,
  /** Barra inferior de navegación (09): sombra hacia arriba sobre el mapa. */
  nav: `0px -4px 16px ${hexAlpha(colors.shadow, 0.08)}`,
  /** Hoja modal inferior. */
  sheet: `0px -6px 24px ${hexAlpha(colors.shadow, 0.14)}`,
  /** CTA principal (resplandor azul tenue bajo el botón de 01/03). */
  cta: `0px 6px 14px ${hexAlpha(colors.primary, 0.22)}`,
} as const;

export type ShadowKey = keyof typeof shadows;

/** `#RRGGBB` + alfa → `rgba(...)`. */
export function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
