/**
 * Composición de la bienvenida (lámina 01) para cualquier tamaño de pantalla. Función pura: se prueba en Node.
 *
 * La lámina mide 393 × 835 pt (iPhone 15: margen superior 59 pt, inferior 34 pt). Todas las cifras de `WELCOME_DESIGN`
 * son medidas sobre `design/out/screens-pt/01.png` (1 pt = 2 px). La hoja blanca de abajo se ancla al borde inferior;
 * la ilustración se apoya sobre ella y, encima, el logotipo, el lema y la frase, que se miden desde el borde inferior de
 * la ilustración (así acompañan al dibujo). En pantallas más anchas todo escala con el ancho; en pantallas más bajas la
 * ilustración se recorta por arriba y el texto se reduce para que quepa; en pantallas más altas sobra cielo por arriba
 * (la ilustración empieza con el mismo color que el fondo).
 */

export const WELCOME_DESIGN = {
  width: 393,
  height: 835,
  /** Alto/ancho de la ilustración (712 × 1034 px). */
  heroAspect: 1034 / 712,
  /** Línea superior hasta la que la lámina enseña la ilustración (margen seguro 59 pt − 13). */
  heroTopCrop: 46,
  /** Cuánto se mete la ilustración por debajo de la hoja blanca (alinea el coche con la lámina; medido por correlación). */
  heroOverSheet: 10.5,
  /** Alto del borde curvo de la hoja. */
  sheetEdge: 20,
  /** Alto del contenido de la hoja (puntos, dos botones y enlace) sin el margen inferior. */
  sheetBody: 194.35,
  /** Margen inferior de la hoja (el enlace acaba a 20 pt del borde inferior). */
  sheetBottomPad: 20,
  /** Logotipo apilado: la lámina lo muestra entre x 104 y 278 (centro 191) y empieza en y 66. */
  logo: { left: 105, top: 65.5, width: 172 },
  headline: {
    fontSize: 40.5,
    lineHeight: 40.5,
    line1: { left: 86.5, top: 253 },
    line2: { left: 77, top: 290 },
  },
  /** Punto verde que cierra el lema: en la lámina es un disco de 11 pt, mayor que el punto de la tipografía. */
  dot: { left: 369.5, top: 313, size: 11 },
  subtitle: { centerX: 218, width: 262, top: 334.75, fontSize: 19.5, lineHeight: 22.5, letterSpacing: 0.8 },
} as const;

export interface WelcomeLayoutInput {
  width: number;
  height: number;
  /** Margen seguro superior (`useSafeAreaInsets().top`). */
  insetTop: number;
  /** Margen inferior de la hoja ya calculado (`sheetBottomPad` o más si el dispositivo tiene barra de gestos). */
  bottomPad: number;
}

export interface WelcomeLayout {
  /** Factor de escala del texto y del logotipo. */
  scale: number;
  heroTop: number;
  heroHeight: number;
  sheetHeight: number;
  logo: { left: number; top: number; width: number };
  headline: { fontSize: number; lineHeight: number; line1: { left: number; top: number }; line2: { left: number; top: number } };
  dot: { left: number; top: number; size: number };
  subtitle: { left: number; top: number; width: number; fontSize: number; lineHeight: number; letterSpacing: number };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Pasa una coordenada horizontal de la lámina a la pantalla: escala alrededor del centro. */
function mapX(xDesign: number, width: number, scale: number): number {
  const centerDesign = WELCOME_DESIGN.width / 2;
  return width / 2 + (xDesign - centerDesign) * scale;
}

/** Borde inferior de la ilustración en la lámina (y). */
function designHeroBottom(): number {
  const d = WELCOME_DESIGN;
  return d.height - (d.sheetEdge + d.sheetBody + d.sheetBottomPad) + d.heroOverSheet;
}

export function computeWelcomeLayout(input: WelcomeLayoutInput): WelcomeLayout {
  const d = WELCOME_DESIGN;
  const width = Math.max(1, input.width);
  const height = Math.max(1, input.height);
  const widthScale = width / d.width;
  const sheetHeight = d.sheetEdge + d.sheetBody + input.bottomPad;

  const natural = width * d.heroAspect;
  const heroBottom = height - sheetHeight + d.heroOverSheet;
  const heroTopMin = Math.max(input.insetTop - 13, 0);
  const heroTop = Math.max(heroBottom - natural, heroTopMin);
  const heroHeight = Math.max(heroBottom - heroTop, 1);

  // Si no cabe el espacio que la lámina da sobre la ilustración, el texto se reduce en proporción (nunca por debajo del 62 %).
  const designAbove = (designHeroBottom() - d.heroTopCrop) * widthScale;
  const fit = clamp((heroBottom - heroTopMin) / designAbove, 0.62, 1);
  const scale = widthScale * fit;
  const y = (yDesign: number): number => heroBottom - (designHeroBottom() - yDesign) * scale;

  return {
    scale,
    heroTop,
    heroHeight,
    sheetHeight,
    logo: { left: mapX(d.logo.left, width, scale), top: y(d.logo.top), width: d.logo.width * scale },
    headline: {
      fontSize: d.headline.fontSize * scale,
      lineHeight: d.headline.lineHeight * scale,
      line1: { left: mapX(d.headline.line1.left, width, scale), top: y(d.headline.line1.top) },
      line2: { left: mapX(d.headline.line2.left, width, scale), top: y(d.headline.line2.top) },
    },
    dot: { left: mapX(d.dot.left, width, scale), top: y(d.dot.top), size: d.dot.size * scale },
    subtitle: {
      left: mapX(d.subtitle.centerX - d.subtitle.width / 2, width, scale),
      top: y(d.subtitle.top),
      width: d.subtitle.width * scale,
      fontSize: d.subtitle.fontSize * scale,
      lineHeight: d.subtitle.lineHeight * scale,
      letterSpacing: d.subtitle.letterSpacing * scale,
    },
  };
}

/** Margen inferior de la hoja: el enlace de la lámina queda a 20 pt del borde aunque haya 34 pt de barra de gestos. */
export function welcomeBottomPad(insetBottom: number): number {
  return Math.max(insetBottom - 14, WELCOME_DESIGN.sheetBottomPad);
}
