/**
 * Paleta de MVC · Me voy contigo.
 *
 * Cada color lleva su procedencia en el comentario que lo precede (la lee `tools/design/gen_tokens.cts` para generar
 * `design/tokens.json`, y una prueba falla si algún color queda sin justificar). Hay tres orígenes:
 *  - «Medido»: relleno o tinta muestreados sobre las láminas aprobadas (design/screens-raw y design/screens): mediana de
 *    píxeles planos, o media del 3 % de píxeles más oscuros/saturados en el caso de un texto.
 *  - «Ajustado»: medido, pero modificado lo mínimo para llegar a contraste AA (≥ 4,5:1); se indica el valor medido.
 *  - «Derivado» / «Valor de proyecto»: las láminas no lo muestran (estados pulsado y desactivado, bordes casi
 *    invisibles, esqueletos…) y se calcula a partir de un valor medido.
 * Los textos de las láminas usan tres tintas azules distintas que no deben mezclarse: `heading` (títulos, ultramarino),
 * `primary` (acciones y controles) y la tinta marino de lectura (`text.*`).
 *
 * Solo tema claro (decisión de producto): no existe `dark`.
 */

/** Colores del logo oficial (design/logo/layers.json). NO se usan para la interfaz salvo dentro de `MvcLogo`. */
export const brand = {
  /** Medido en el trazado del logo oficial (design/logo/layers.json). */
  blue: "#044DFD",
  /** Medido en el trazado del logo oficial (design/logo/layers.json). */
  green: "#26CDA1",
  /** Medido en el trazado del logo oficial (design/logo/layers.json): tinta marino del logotipo «MVC». */
  navy: "#000928",
} as const;

export const colors = {
  brand,

  /** Medido: mediana del relleno de los botones principales (rgb 0, 84, 253) en 03, 04, 10, 14b y 16b. */
  primary: "#0054FD",
  /** Derivado: `primary` oscurecido ≈ 16 % (estado pulsado; las láminas no muestran estados). */
  primaryPressed: "#0046D6",
  /** Derivado: `primary` al 45 % sobre blanco (botón desactivado). */
  primaryDisabled: "#8DB1FF",
  /** Medido: texto e iconos blancos sobre azul, verde y rojo plenos. */
  onPrimary: "#FFFFFF",

  /** Medido: mediana de 50 títulos de pantalla (#0407FB); también etiquetas de sección y chevron de volver. */
  heading: "#0407FA",

  text: {
    /** Medido: nombres y cifras en negrita (muestreo de oscuros #000035…#000047). */
    strong: "#00003C",
    /** Medido: texto de lectura regular (#020A61, #111A65, #091275, #162687 → mediana). */
    body: "#06105F",
    /** Medido: etiquetas, subtítulos y descripciones (#425BAE, #4560AF, #3B54AA, #3551A9 → mediana). */
    muted: "#4258AC",
    /** Medido: azul intenso de lectura en franjas y tarjetas de estado (22 «El cambio de ruta…» #162CAC, #1A30AE; 36a #0000AE/#1E26A8). */
    deep: "#0A1AAC",
    /** Ajustado: medido #687BC2 / #6274BD (pies y «Tiempo estimado»); oscurecido a contraste 5,2:1 sobre blanco y 4,6:1 sobre `bg.chip`. */
    subtle: "#5868B2",
    /** Medido: etiquetas de pasos pendientes (16b «Pago», «Confirmada»: #1F3FB2, #1732AB → mediana). */
    stepIdle: "#1B38AE",
    /** Ajustado: medido #374685 (09 «¿A dónde vas?») y #3B55B6 (10 «Tu destino»); se aclara un poco para distinguirlo del texto escrito, con contraste 5,7:1. */
    placeholder: "#4F62AC",
    /** Ajustado: medido #636D9A…#6673AB (26, hora de un mensaje); oscurecido a contraste 4,7:1 sobre la burbuja gris. */
    time: "#5C699A",
    /** Valor de proyecto: gris azulado de texto desactivado (exento de contraste mínimo). */
    disabled: "#969BAC",
    /** Medido: enlaces subrayados de 03 («Política de Privacidad», «Términos de Uso») y 04 («Reenviar código»). */
    link: "#0234FB",
    /** Medido: texto blanco sobre fondos plenos. */
    inverse: "#FFFFFF",
    /** Derivado: blanco al 80 % (reloj de un mensaje pendiente sobre la burbuja azul de 26). */
    inverseSoft: "rgba(255, 255, 255, 0.8)",
    /** Derivado: blanco al 65 % (doble visto de un mensaje entregado, aún no leído, sobre la burbuja azul de 26). */
    inverseFaint: "rgba(255, 255, 255, 0.65)",
  },

  bg: {
    /** Medido: fondo de todas las pantallas. */
    screen: "#FFFFFF",
    /** Medido: tarjeta azul clara estándar (moda #EEF6FE / #EAF6FE / #E6F2FE). */
    tint: "#EAF4FE",
    /** Derivado: punto medio entre blanco y `tint` (fondo pulsado de superficies blancas). */
    tintSoft: "#F2F8FE",
    /** Medido: azul claro más cargado de barras «Total», píldoras y botones secundarios (#D3E9FE…#DFF0FE → mediana). */
    tintStrong: "#DCEBFE",
    /** Derivado: `tint` oscurecido ≈ 2 % (fondo pulsado de tarjetas tintadas). */
    tintPressed: "#D6E8FD",
    /** Medido: contenedor de controles segmentados y chips inactivos (10 #EDF3FE / #E9F2FD; 25 y 27 #E8F2FD). */
    chip: "#E8F2FD",
    /** Valor de proyecto: gris azulado muy claro de superficies neutras y campos desactivados. */
    gray: "#F5F7F9",
    /** Medido: burbuja de chat recibida (26: #EDF1F5, #EDF0F3, #EBEDF2, #F2F4F6 → mediana). */
    bubble: "#EDF0F4",
    /** Valor de proyecto: fondo de botón desactivado. */
    disabled: "#E4E5E9",
    /** Valor de proyecto: base de los esqueletos de carga. */
    skeleton: "#E9EEF6",
    /** Valor de proyecto: brillo que recorre los esqueletos de carga. */
    skeletonHighlight: "#F4F7FB",
    /** Derivado: `brand.navy` al 45 % (velo detrás de hojas y diálogos). */
    overlay: "rgba(0, 9, 40, 0.45)",
    /** Medido: tarjetas blancas sobre fondos tintados. */
    white: "#FFFFFF",
    /** Medido: disco con la inicial del administrador (37a #A5C2F6, 38a #A5C0F6). */
    avatarTile: "#A5C1F6",
  },

  border: {
    /** Medido: contorno de campos y tarjetas con fondo blanco (#CEE1FA, #D2E1F7, #D7E3F4). */
    default: "#D3E3F8",
    /** Medido: contorno de tarjetas tintadas (#D3E8FC, #E5EEF8, #EAF3FD; borde de las baldosas de 37a #E6F1FB). */
    soft: "#DCEAFB",
    /** Valor de proyecto: separadores de listas (las láminas los dibujan casi blancos, ≈ #E6EEF9 en 34b). */
    divider: "#E3EAF6",
    /** Medido: contorno de casillas tintadas, p. ej. el código SMS de 04 (#BFD7F6…#C5DAF7 → mediana). */
    tint: "#C3D9F7",
    /** Medido: anillo de la insignia de cámara blanca de 05 (#AED3FB…#BCD8FB → mediana). */
    ring: "#B3D3FB",
  },

  success: {
    /** Medido: verde de confirmación (media de 12 muestras: rgb 15, 195, 139) en discos, trazos y barras. */
    solid: "#0FC38B",
    /** Medido: relleno del botón «Aceptar» de 20 (#1ABE89, plano), con texto blanco (contraste 2,2:1: viene de la lámina). */
    button: "#1ABE89",
    /** Derivado: `button` oscurecido ≈ 12 % (estado pulsado). */
    buttonPressed: "#17A978",
    /** Medido: fondo de la banda «Solicitud aceptada» de 16b (#E9F9F2, #E6F9F0) y de 14b (#E8F8F0). */
    bg: "#E8F9F1",
    /** Derivado: `solid` al 45 % sobre blanco (contorno de tarjetas de éxito). */
    border: "#8FE3CC",
    /** Medido: texto verde oscuro (#025B39, #066C5C, #06675A → mediana). */
    text: "#05604B",
    /** Medido: título de la banda de éxito de 16b («¡Solicitud aceptada!» #003B2E). */
    strong: "#00392E",
  },

  /** Naranja de advertencia («Repetir», «Pendiente», 08, 15, 22). */
  warning: {
    /** Medido: iconos y discos de aviso (#E04701…#EA5402, #D95501). */
    solid: "#E85002",
    /** Medido: fondo de la banda de aviso de 22 (#FEEBDF, #FEEDDA). */
    bg: "#FEEBDF",
    /** Medido: fondo de tarjetas de aviso suaves (#FEF1E2). */
    bgSoft: "#FEF1E2",
    /** Derivado: `solid` al 35 % sobre blanco (contorno de avisos). */
    border: "#F5BE9A",
    /** Medido: texto de aviso (#CF2807). */
    text: "#CF2807",
    /** Medido: texto de aviso fuerte (#A62B01). */
    textStrong: "#A62B01",
    /** Medido: título rojo de la franja de 22 («Ana propone una nueva parada»: #BF0000). */
    title: "#BF0000",
  },

  /** Ámbar de aviso informativo (36a «Destino fuera de provincia», 22 «Sin señal»). */
  amber: {
    /** Medido: disco de 36a «Destino fuera de provincia» (#FDB52C). */
    solid: "#FDB52C",
    /** Medido: fondo de la tarjeta ámbar de 36a (#FEF5E5). */
    bg: "#FEF5E5",
    /** Medido: fondo de baldosas e iconos ámbar (#FEE8B6). */
    bgStrong: "#FEE8B6",
    /** Medido: estrellas de valoración (#FD9C05). */
    star: "#FD9C05",
  },

  error: {
    /** Medido: discos y botones rojos (04 #E10E11, 16b #E60625/#ED0523, 20 #DD0515 → media rgb 232, 6, 26). */
    solid: "#E8061A",
    /** Derivado: `solid` oscurecido ≈ 14 % (estado pulsado). */
    solidPressed: "#C70515",
    /** Medido: fondo de la banda de error de 04 (#FEEAEA) y 16b (#FEEAEE). */
    bg: "#FEEAEC",
    /** Medido: relleno del botón suave «Rechazar» de 20 (#FED2D2, #FDCED1). */
    bgStrong: "#FDD0D3",
    /** Medido: contorno rojo del botón «Rechazar» de 22 (#F95461, #FA5E6B). */
    border: "#FA5E6B",
    /** Medido: contorno rojo claro de 22 (#FC828C). */
    borderSoft: "#FD8D92",
    /** Medido: texto de error de 04 «Código incorrecto…» (#D1060C); en 22 y 38a «Rechazar» se ve más vivo (#FB0000, contraste 3,4:1). */
    text: "#D1060C",
    /** Medido: título de la banda de error de 16b («Si la solicitud es rechazada» #AD0006). */
    strong: "#AD0006",
    /** Medido: icono rosa de «No hay plazas» en 36a (#FD3860). */
    rose: "#FD3860",
    /** Medido: icono coral de «Pago rechazado» en 36a (#FC3F41). */
    coral: "#FC3F41",
  },

  info: {
    /** Medido: fondo de las bandas informativas (16b #E5F2FD, #E2F1FE; 22 #EBF3FD). */
    bg: "#E6F0FE",
    /** Medido: disco azul pizarra de la franja informativa de 22 (#6C86B7). */
    tile: "#6C86B7",
  },

  gray: {
    /** Medido: disco de los pasos pendientes de 16b («Pago», «Confirmada»: #D5DEEC, #D1DBEB). */
    ring: "#D4DDEC",
    /** Medido: línea entre pasos pendientes de 16b (#D1DAE9, #CFD8E9). */
    line: "#D2DBEA",
    /** Valor de proyecto: gris azulado de iconos secundarios (contraste ≥ 3:1 sobre blanco). */
    icon: "#8894B2",
    /** Valor de proyecto: azul grisáceo del icono de ayuda «?» (contraste ≥ 3:1 sobre blanco). */
    help: "#748DC7",
    /** Medido: círculo numerado de los pasos de 06 «Busca un lugar con buena luz». */
    step: "#6275A0",
  },

  /** Franja de aviso fuerte de 22 «Sin señal · Última posición…» (#FEE7B6 / #570000 / #DD0600 / #E73700). */
  notice: {
    /** Medido: fondo de la franja (#FEE7B6; #FDE6B0). */
    bg: "#FEE7B6",
    /** Medido: título «Sin señal» (#570000; #720602 en trazos finos). */
    title: "#570000",
    /** Ajustado: medido #DD0600 (#E41D05 en trazos finos) en «Última posición: hace 2 min»; oscurecido a #CC0500 (contraste 4,8:1 sobre `notice.bg`). */
    detail: "#CC0500",
    /** Medido: barras de cobertura (#E73700). */
    icon: "#E73700",
  },

  /** Estado vacío (25 «Aún no tienes más mensajes»): fondo lavanda muy claro y tinta apagada. */
  empty: {
    /** Medido: fondo de la ilustración vacía (#F0F4FB). */
    bg: "#F0F4FB",
    /** Medido: icono (#6670AF). */
    icon: "#6670AF",
    /** Medido: texto (#5460A8). */
    text: "#5460A8",
  },

  /** Barra inferior (09). */
  nav: {
    /** Medido: icono inactivo marino oscuro (#041155, #081759). */
    iconInactive: "#081759",
    /** Ajustado: medido #4A67C1 / #5B74C1 / #5D73C2 en «Viajes», «Mensajes», «Perfil»; se usa el extremo oscuro (#4F6AB6) para contraste 5,2:1. */
    labelInactive: "#4F6AB6",
  },

  /** Iconos de campos de formulario. */
  icon: {
    /** Medido: icono de usuario de los campos de 03 (#2D52AC). */
    field: "#2F54B8",
  },

  /** Fondos de las baldosas de icono (`IconTile`, KPI, filas): tintes muy claros de cada color. */
  tile: {
    /** Medido: 37a «Viajes activos» #E6F1FE; 09 círculos de categoría #E4F0FC / #E0ECFC. */
    blue: "#E4F0FC",
    /** Medido: 37a «Ingresos brutos» #E2FAF1; 27 coche #E1FAF1; 34b #E2FAF1. */
    green: "#E2FAF1",
    /** Medido: icono verde sobre baldosa verde (27 coche #02A976, 37a euro #02A06F). */
    greenIcon: "#02A574",
    /** Medido: 27 «Pago del viaje completado» #FEF3D6. */
    amber: "#FEF3D6",
    /** Valor de proyecto: icono naranja sobre baldosa ámbar, próximo al relleno de las monedas de 27 (el contorno mide #B95E02). */
    amberIcon: "#F08C00",
    /** Medido: banda «Ana propone una nueva parada» de 22 (#FEEDDA). */
    orange: "#FEEDDA",
    /** Medido: 37a «Incidencias» #FEEDED. */
    red: "#FEEDED",
    /** Valor de proyecto: gris azulado muy claro para estados neutros. */
    gray: "#E9EDF3",
  },

  /** Píldoras de estado (`StatusPill`): relleno y texto de cada tono. */
  pill: {
    green: {
      /** Medido: «Cobrado» de 34b (#DAFAEE, #DCFAED). */
      bg: "#DAFAEE",
      /** Medido: «Cobrado» de 34b (#056A5A). */
      fg: "#056A5A",
    },
    amber: {
      /** Medido: «Pendiente» y «Requiere revisión» de 38a (#FEEACD, #FEE9CA). */
      bg: "#FEEACD",
      /** Ajustado: medido #FB2F05 (38a, contraste 3,2:1); oscurecido a #B52900 (contraste 5,4:1). */
      fg: "#B52900",
    },
    orange: {
      /** Medido: fondo de aviso naranja de 22 (#FEEBDF). */
      bg: "#FEEBDF",
      /** Medido: texto de aviso (#CF2807). */
      fg: "#CF2807",
    },
    red: {
      /** Medido: fondo del botón suave «Rechazar» de 38a (#FEE5E1). */
      bg: "#FEE5E1",
      /** Ajustado: medido #FB0000 (38a y 22, contraste 3,4:1); se usa `error.text` (4,7:1). */
      fg: "#D1060C",
    },
    blue: {
      /** Medido: igual que `bg.tintStrong`. */
      bg: "#DCEBFE",
      /** Medido: igual que `primary`. */
      fg: "#0054FD",
    },
    gray: {
      /** Valor de proyecto: gris azulado muy claro. */
      bg: "#E9EDF3",
      /** Valor de proyecto: gris azulado oscuro (contraste 4,4:1). */
      fg: "#5A6985",
    },
  },

  /** Botones suaves de acción rápida («Aprobar» / «Rechazar» de 38a). */
  soft: {
    green: {
      /** Medido: «Aprobar» de 38a (#D6F6E9, #D4F6E9). */
      bg: "#D6F6E9",
      /** Derivado: `bg` oscurecido ≈ 6 % (estado pulsado). */
      pressed: "#C6EFDE",
      /** Medido: etiqueta «Aprobar» de 38a (#003738). */
      fg: "#003738",
      /** Medido: visto verde de «Aprobar» de 38a (#028A60). */
      icon: "#028A60",
    },
    red: {
      /** Medido: «Rechazar» de 20 (#FED2D2, #FDCED1). */
      bg: "#FDD0D3",
      /** Derivado: `bg` oscurecido ≈ 6 % (estado pulsado). */
      pressed: "#FBC9CE",
      /** Ajustado: medido #DE000B (20) y #FB0000 (38a); oscurecido a #BD0007 (contraste 4,8:1 sobre `bg`). */
      fg: "#BD0007",
      /** Medido: aspa roja de «Rechazar» de 38a y 20 (#DD0515). */
      icon: "#DD0515",
    },
  },

  /** Contornos y fondos pulsados de las superficies tintadas (`ui/tones.ts`). */
  surface: {
    /** Derivado: `tintStrong` oscurecido ≈ 6 % (contorno y fondo pulsado). */
    blueStrongEdge: "#CFE2FA",
    /** Derivado: `success.bg` oscurecido ≈ 6 % (contorno de tarjetas verdes). */
    greenEdge: "#C6EFDE",
    /** Derivado: `success.bg` oscurecido ≈ 8 % (fondo pulsado de tarjetas verdes). */
    greenPressed: "#D4F4E7",
    /** Derivado: `amber.bg` oscurecido ≈ 6 % (contorno de tarjetas ámbar). */
    amberEdge: "#FAE3B2",
    /** Derivado: `amber.bg` oscurecido ≈ 4 % (fondo pulsado de tarjetas ámbar). */
    amberPressed: "#FDEFCF",
    /** Derivado: `warning.bg` oscurecido ≈ 6 % (contorno de tarjetas naranja). */
    orangeEdge: "#F9D2B6",
    /** Derivado: `warning.bg` oscurecido ≈ 6 % (fondo pulsado de tarjetas naranja). */
    orangePressed: "#FDDFCB",
    /** Derivado: `error.bg` oscurecido ≈ 6 % (contorno de tarjetas rojas). */
    redEdge: "#FBCDD2",
    /** Derivado: `error.bg` oscurecido ≈ 4 % (fondo pulsado de tarjetas rojas). */
    redPressed: "#FCDCDF",
    /** Derivado: `bg.gray` oscurecido ≈ 6 % (contorno de tarjetas grises). */
    grayEdge: "#E3E8EE",
    /** Derivado: `bg.gray` oscurecido ≈ 4 % (fondo pulsado de tarjetas grises). */
    grayPressed: "#EDF0F4",
  },

  /** Controles de formulario. */
  control: {
    /** Medido: borde de la casilla y del radio sin marcar (03, 28: #B9CBEA). */
    border: "#B9CBEA",
    /** Valor de proyecto: pista del interruptor apagado. */
    switchOff: "#C8D3E6",
    /** Medido: pista verde del interruptor encendido (18, 34a: #08BB83). */
    switchOnGreen: "#08BB83",
  },

  /** Días de la semana de solo lectura (`DayPills` sin `onChange`, 14b). */
  daypill: {
    /** Medido: «S» y «D» de 14b sobre fondo #F1F4F8. */
    mutedBg: "#F0F4F8",
    /** Medido: letras de «S» y «D» de 14b (#849AC9). */
    mutedText: "#849AC9",
  },

  /** Valor de proyecto: sombra neutra azulada para tarjetas flotantes sobre el mapa (base de `shadows.*`). */
  shadow: "#0A1A60",
} as const;

export type Colors = typeof colors;

/** Claves semánticas aceptables como color de texto. */
export type TextColorKey =
  | "heading"
  | "deep"
  | "strong"
  | "body"
  | "muted"
  | "subtle"
  | "primary"
  | "link"
  | "success"
  | "warning"
  | "error"
  | "inverse"
  | "disabled"
  | "placeholder";

export const textColor: Record<TextColorKey, string> = {
  heading: colors.heading,
  deep: colors.text.deep,
  strong: colors.text.strong,
  body: colors.text.body,
  muted: colors.text.muted,
  subtle: colors.text.subtle,
  primary: colors.primary,
  link: colors.text.link,
  success: colors.success.text,
  warning: colors.warning.text,
  error: colors.error.text,
  inverse: colors.text.inverse,
  disabled: colors.text.disabled,
  placeholder: colors.text.placeholder,
};
