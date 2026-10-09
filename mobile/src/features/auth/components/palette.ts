/**
 * Colores del slice `auth` que las láminas 01–08 usan y la paleta global no recoge. Cada uno lleva su procedencia:
 * mediana de los píxeles planos de la zona indicada en `design/out/screens-pt/<id>.png` (la lámina a 393 pt @2x).
 */
export const authPalette = {
  /** Lámina 01: cielo sobre la escena (fila superior de la ilustración, rgb 242, 251, 254). Rellena la zona sobre la imagen. */
  welcomeSky: "#F2FBFE",
  /** Lámina 02: relleno de la tarjeta «Soy pasajero» (mediana rgb 222, 240, 253). */
  roleBlueFill: "#DEF0FD",
  /** Lámina 02: relleno de la tarjeta «Soy conductor» (mediana rgb 218, 247, 239). */
  roleGreenFill: "#DAF7EF",
  /** Lámina 02: disco «i» de la franja informativa (mediana rgb 77, 108, 187). */
  infoDisc: "#4D6CBB",
} as const;
