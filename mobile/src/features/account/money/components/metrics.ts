/**
 * Medidas de la pantalla 33 «Mis pagos y cobros» (láminas 33a, 33b y 34b: pestaña de conductor).
 *
 * Todo está en pt (1 pt = 2 px en `design/out/screens-pt/*.png`) y medido sobre las láminas con el boceto de tinta de
 * `tools/design` (caja de cada texto, icono y tarjeta). Las láminas no son idénticas entre sí (la 33a es más compacta que
 * la 33b), así que cada diseño tiene su preset; el resto de la app usa el sistema de diseño tal cual.
 *
 * Baselines: dentro de una línea de alto `L` y cuerpo `S`, la línea base cae a `L/2 + 0,342·S` del borde superior de
 * la línea (Roboto Condensed). `lineTop(baseline, S, L)` hace la cuenta inversa.
 */
/** Margen horizontal de la pantalla 33 (las tarjetas ocupan de 14 a 378 pt en una pantalla de 393). */
export const SCREEN_X = 14;

/** Distancia del borde superior de una línea a su línea base. */
export function baselineOffset(size: number, lineHeight: number): number {
  return lineHeight / 2 + 0.342 * size;
}

/** Borde superior de una línea de texto cuya línea base está en `baseline`. */
export function lineTop(baseline: number, size: number, lineHeight: number): number {
  return baseline - baselineOffset(size, lineHeight);
}

/** Tintas medidas que el tema no recoge (tonos intermedios entre `heading` y `text.deep`). Cada una lleva su origen. */
export const ink = {
  /** Importe de una fila (33b «12,00 €» #000693, 34b #020989). */
  rowAmount: "#010890",
  /** Texto de las tarjetas verdes de 34b: título #020B86, importe #000D72, pie #133097. */
  greenCard34: { title: "#030B86", amount: "#000D72", caption: "#133097" },
  /** Texto de la tarjeta verde de 33a: título #0205A7, importe #0002B6, pie #1826BD. */
  greenCard33: { title: "#0205A7", amount: "#0002B6", caption: "#1826BD" },
  /** Etiqueta «Cobro» de 33a (#096A87). */
  earningTag: "#09698A",
  /** Icono de tarjeta del método de pago (#00075B, marino muy oscuro). */
  cardIcon: "#00075B",
  /** Contorno de las tarjetas blancas de fila (33b #F1F6FC) y de los enlaces (#E4EFFB). */
  rowBorder: "#EBF2FC",
  linkBorder: "#E1ECFB",
} as const;

// ── Tarjetas de resumen («Pendiente este mes», «A cobrar este mes») ──────────────────────────────────────────────

export type SummaryLeading = "clock" | "coins";
export type SummaryDensity = "regular" | "compact";

export interface SummarySpec {
  /** Alto total de la tarjeta (borde incluido). */
  height: number;
  /** Radio de esquina. */
  radius: number;
  /** Distancia del borde izquierdo de la tarjeta al texto. */
  textLeft: number;
  /** Icono de la izquierda: lado, posición y (solo discos) glifo interior. */
  icon: { size: number; left: number; top: number; glyph?: number };
  /** Cuerpo y alto de línea del título, el importe y el pie, y la línea base de cada uno desde el borde superior. */
  title: { size: number; line: number; baseline: number };
  amount: { size: number; line: number; baseline: number };
  caption: { size: number; line: number; baseline: number };
  /** Centro vertical y borde derecho del chevron. */
  chevron: { size: number; centerY: number; right: number };
}

/**
 * 33b «Pendiente este mes» (tarjeta en 174..296,5): reloj de 44 pt en x 40..84, texto desde x 114, título con la línea base
 * a 210,5, importe a 250,5 (cifras de 29,5 pt de alto ⇒ cuerpo 41,5) y pie a 276.
 */
const regularClock: SummarySpec = {
  height: 122.5,
  radius: 18,
  textLeft: 100,
  icon: { size: 44, left: 26, top: 31.5 },
  title: { size: 21, line: 24, baseline: 36.5 },
  amount: { size: 41.5, line: 40, baseline: 76.5 },
  caption: { size: 19.5, line: 24, baseline: 102 },
  chevron: { size: 28, centerY: 58.75, right: 10 },
};

/** 34b «A cobrar este mes» (174..296,5): disco verde de 60,5 pt en x 36..96,5, texto desde x 121,5, importe a 252,5. */
const regularCoins: SummarySpec = {
  height: 122.5,
  radius: 18,
  textLeft: 107.5,
  icon: { size: 60.5, left: 22, top: 23, glyph: 34 },
  title: { size: 21, line: 24, baseline: 36.5 },
  amount: { size: 41.5, line: 40, baseline: 78.5 },
  caption: { size: 19.5, line: 24, baseline: 103.5 },
  chevron: { size: 28, centerY: 58.75, right: 10 },
};

/** 33a «Pendiente este mes» (173..287,5): reloj de 53,5 pt en x 36,5..90, texto desde x 120,5, título a 205,5 (+174 = 31,5). */
const compactClock: SummarySpec = {
  height: 114,
  radius: 18,
  textLeft: 106.5,
  icon: { size: 53.5, left: 22.5, top: 15.5 },
  title: { size: 21, line: 24, baseline: 31.5 },
  amount: { size: 38, line: 40, baseline: 71.5 },
  caption: { size: 19.5, line: 24, baseline: 99.5 },
  chevron: { size: 28, centerY: 59.25, right: 10 },
};

/** 33a «A cobrar este mes» (296..408,5): disco de 65 pt en x 28,5..93,5, texto desde x 120, título a 328 (+296 = 32). */
const compactCoins: SummarySpec = {
  height: 113,
  radius: 18,
  textLeft: 106,
  icon: { size: 65, left: 14.5, top: 13.5, glyph: 36 },
  title: { size: 21, line: 24, baseline: 32 },
  amount: { size: 38, line: 40, baseline: 73 },
  caption: { size: 19.5, line: 24, baseline: 99.5 },
  chevron: { size: 28, centerY: 54.5, right: 10 },
};

export function summarySpec(leading: SummaryLeading, density: SummaryDensity): SummarySpec {
  if (density === "compact") return leading === "clock" ? compactClock : compactCoins;
  return leading === "clock" ? regularClock : regularCoins;
}

// ── Filas de movimiento (avatar + «Con Ana» + fecha + trayecto + importe) ────────────────────────────────────────

export type RowVariant = "card" | "cardCompact" | "grouped";

export interface RowSpec {
  /** Alto mínimo de la fila (borde incluido en las tarjetas). */
  height: number;
  radius: number;
  avatar: { size: number; left: number; top: number };
  /** Distancia del avatar al texto. */
  gap: number;
  /** Línea superior del bloque de texto (borde superior de la primera línea) y cuerpo de cada línea. */
  text: { top: number; nameSize: number; nameLine: number; lineSize: number; lineHeight: number; lineGap: number };
  /** Bloque de la derecha: borde superior del importe, cuerpo, y píldora o etiqueta debajo. */
  right: { amountTop: number; amountSize: number; amountLine: number; chipTop: number; tagTop: number; tagSize: number };
  chevron: { size: number; top: number; right: number };
  /** Distancia entre el bloque de la derecha y el chevron. */
  rightGap: number;
}

/** 33b: tarjetas de 97 pt (347,5..444,5 y 450,5..548,5), avatar de 68 pt en x 18..86, texto desde x 102. */
const card: RowSpec = {
  height: 97,
  radius: 14,
  avatar: { size: 68, left: 4, top: 12.5 },
  gap: 16,
  text: { top: 15.7, nameSize: 20.5, nameLine: 22, lineSize: 19, lineHeight: 22, lineGap: 0 },
  right: { amountTop: 17.4, amountSize: 21, amountLine: 24, chipTop: 51.5, tagTop: 14, tagSize: 19 },
  chevron: { size: 26, top: 34, right: 0 },
  rightGap: 12,
};

/** 33a: tarjetas de 88 pt (453..541) y 78 pt (549..627), avatar de 68 pt, texto desde x 103. */
const cardCompact: RowSpec = {
  height: 83,
  radius: 14,
  avatar: { size: 68, left: 3, top: 8 },
  gap: 18,
  text: { top: 12.7, nameSize: 20.5, nameLine: 22, lineSize: 19, lineHeight: 22, lineGap: 0 },
  right: { amountTop: 44, amountSize: 21, amountLine: 24, chipTop: 44, tagTop: 12, tagSize: 19.5 },
  chevron: { size: 26, top: 29, right: 0 },
  rightGap: 12,
};

/** 34b: filas de 88,5 pt sin tarjeta propia (avatar de 66 pt en x 18..84, texto desde x 102). */
const grouped: RowSpec = {
  height: 88.5,
  radius: 0,
  avatar: { size: 66, left: 4, top: 11.5 },
  gap: 18,
  text: { top: 14.5, nameSize: 20.5, nameLine: 22, lineSize: 19, lineHeight: 22, lineGap: 0 },
  right: { amountTop: 19, amountSize: 21, amountLine: 24, chipTop: 51, tagTop: 14, tagSize: 19 },
  chevron: { size: 26, top: 31, right: 4 },
  rightGap: 12,
};

export function rowSpec(variant: RowVariant): RowSpec {
  switch (variant) {
    case "card":
      return card;
    case "cardCompact":
      return cardCompact;
    case "grouped":
      return grouped;
  }
}
