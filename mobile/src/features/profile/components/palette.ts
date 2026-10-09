/**
 * Colores MEDIDOS sobre las láminas 29–32 que el tema compartido aún no recoge (el tema solo guarda el valor mediano de cada
 * función; estas láminas usan un tono propio y se quiere ver igual que en el diseño). Cada constante dice de dónde sale.
 * Todo lo demás (azules, verdes, fondos tintados) sale de `@/theme`.
 */
export const lamina = {
  /** 29 · la nota «4,8» va en negro (#0B0B0C), no en la tinta marino del resto de textos. */
  ratingInk: "#0B0B0C",
  /** 29 · estrella de la nota (#F7AE03). */
  star: "#F7AE03",
  /** 29 · discos del teléfono y del visto de «Móvil verificado» (#029B6B / #019A6C). */
  verifiedDisc: "#029B6B",
  /** 29 · título («Móvil verificado» #052D56) y subtítulo (#445E94) de la tarjeta verde. */
  verifiedTitle: "#052D56",
  verifiedSubtitle: "#445E94",
  /** 29 · glifo del coche del rol sin seleccionar (#3D4A6F: pizarra) y su disco blanco. */
  roleGlyphIdle: "#3E4B72",
  /** 30 · fondo de la barra de pestañas (#E6F4FE) y su separador (#C9E6F7). */
  tabsBar: "#E6F4FE",
  tabsDivider: "#C9E6F7",
  /** 30 · disco de la categoría de la reserva semanal (#D9ECFE) y cúpula del coche (#D4E9FD). */
  categoryDisc: "#D9ECFE",
  dome: "#D4E9FD",
  /** 30 · píldora «En 12 min»: fondo menta (#BAF8C8), texto (#0B9852) y visto (#0AB55C). */
  pillMint: "#BAF8C8",
  pillMintText: "#0B9852",
  pillMintCheck: "#0AB55C",
  /** 30 · franja de estado «Confirmada»: fondo (#DEFAEC), texto (#106D4B) y glifos (#029561). */
  stripGreen: "#DEFAEC",
  stripGreenText: "#106D4B",
  stripGreenIcon: "#029561",
  /** 30 · franja de la llegada del conductor (#ECF5FE). */
  stripBlue: "#ECF5FE",
  /** 30 · resplandor suave azul de las tarjetas blancas. */
  cardGlow: "rgba(4, 77, 253, 0.10)",
} as const;
