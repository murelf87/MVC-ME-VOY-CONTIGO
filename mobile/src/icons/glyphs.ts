/**
 * Registro de iconos semánticos de la app.
 *
 * Cada `IconName` apunta a un glifo de @expo/vector-icons (Ionicons, MaterialCommunityIcons o MaterialIcons). Los nombres
 * de glifo están tipados por la propia librería, así que un glifo inexistente no compila. El inventario sale de revisar
 * las 40 pantallas aprobadas (ver docs/DESIGN_SYSTEM.md §«Iconos»); donde el diseño usa un dibujo propio que la
 * librería no tiene, se indica la desviación en el comentario.
 */
import type { ComponentProps } from "react";
import type Ionicons from "@expo/vector-icons/Ionicons";
import type MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";

type IonGlyph = ComponentProps<typeof Ionicons>["name"];
type MciGlyph = ComponentProps<typeof MaterialCommunityIcons>["name"];
type MiGlyph = ComponentProps<typeof MaterialIcons>["name"];

export type GlyphRef =
  | { readonly set: "ion"; readonly glyph: IonGlyph }
  | { readonly set: "mci"; readonly glyph: MciGlyph }
  | { readonly set: "mi"; readonly glyph: MiGlyph };

const ion = (glyph: IonGlyph): GlyphRef => ({ set: "ion", glyph });
const mci = (glyph: MciGlyph): GlyphRef => ({ set: "mci", glyph });
const mi = (glyph: MiGlyph): GlyphRef => ({ set: "mi", glyph });

/** Pantallas del diseño donde aparece cada icono: se indica solo cuando no es evidente. */
export const glyphs = {
  // — Navegación y controles —
  back: ion("chevron-back"),
  chevronRight: ion("chevron-forward"),
  chevronDown: ion("chevron-down"),
  chevronUp: ion("chevron-up"),
  close: ion("close"),
  /** Aspa gruesa en blanco sobre disco rojo (16b «Si la solicitud es rechazada»). */
  closeBold: mci("close-thick"),
  /** Aspa blanca sobre círculo rojo (16 «Si la solicitud es rechazada», 08, 20 «Rechazar»): se pinta con `IconTile`. */
  closeCircle: ion("close-circle"),
  check: ion("checkmark"),
  /** Visto grueso dentro de un punto relleno (16 «Solicitud» actual). */
  checkBold: mci("check-bold"),
  checkCircle: ion("checkmark-circle"),
  /** Doble visto de mensaje enviado/leído (26). */
  checkDouble: ion("checkmark-done"),
  add: ion("add"),
  addCircle: ion("add-circle"),
  remove: ion("remove"),
  /** ⋮ (26, 30, 31). */
  more: ion("ellipsis-vertical"),
  /** ··· (09 «Otros», 18). */
  moreHorizontal: ion("ellipsis-horizontal"),
  /** ≡ asa de reordenar (19). */
  drag: ion("menu"),
  search: ion("search"),
  /** Controles deslizantes (09 «Con plazas»). */
  filter: ion("options"),
  /** ↑↓ con la flecha de subida a la izquierda (10 «Intercambiar origen y destino»); Ionicons la dibuja al revés. */
  swapVertical: mi("swap-vert"),
  swapHorizontal: ion("swap-horizontal"),
  arrowRight: ion("arrow-forward"),
  arrowLeft: ion("arrow-back"),
  arrowUp: ion("arrow-up"),
  arrowDown: ion("arrow-down"),
  /** Círculo azul con flecha (14 «Ida»/«Vuelta»). */
  arrowCircleRight: ion("arrow-forward-circle"),
  arrowCircleLeft: ion("arrow-back-circle"),
  /** ↗ verde / ↘ rojo de las variaciones de KPI (37). */
  trendUp: mci("arrow-top-right-thick"),
  trendDown: mci("arrow-bottom-right-thick"),
  /** Flecha curvada (12 «Desvío total aprox.»). */
  turn: ion("arrow-redo"),
  refresh: ion("refresh"),
  sync: ion("sync"),
  external: ion("open-outline"),
  copy: ion("copy-outline"),
  link: ion("link"),
  download: ion("download-outline"),
  upload: ion("cloud-upload-outline"),
  edit: ion("create-outline"),
  eye: ion("eye-outline"),
  eyeOff: ion("eye-off-outline"),
  pause: ion("pause-circle"),
  /** Asa de ordenación / filtros avanzados. */
  tune: ion("funnel-outline"),

  // — Estado e información —
  /** «i» blanca sobre círculo (06, 13, 15, 22, 24, 28, 35). */
  info: ion("information-circle"),
  infoOutline: ion("information-circle-outline"),
  /** «!» sobre círculo (04 error, 08 «Repetir», 15 aviso, 24 «Reportar incidencia»). */
  alertCircle: ion("alert-circle"),
  /** Signo «!» suelto, para dibujarlo en blanco sobre un círculo de color (04, 08, 15, 36a). */
  exclaim: mci("exclamation-thick"),
  /** Letra «i» suelta, para dibujarla en blanco sobre un círculo de color. */
  infoMark: mci("information-variant"),
  /** Triángulo de advertencia (37 «Incidencias»). */
  warning: ion("warning"),
  /** «?» sobre círculo (15, 33 «Comisión de la plataforma»). */
  help: ion("help-circle"),
  shield: ion("shield-checkmark"),
  /** Sin conexión. */
  offline: ion("cloud-offline-outline"),
  /** Barras de cobertura (22 «Sin señal»). */
  signal: ion("cellular"),
  /** Navegación tachada (36a «Sin señal GPS»). */
  gpsOff: mi("near-me-disabled"),
  star: ion("star"),
  starOutline: ion("star-outline"),

  // — Personas —
  person: ion("person"),
  personOutline: ion("person-outline"),
  people: ion("people"),
  peopleOutline: ion("people-outline"),
  /** Pasajero sentado (02, 12 «Solicitar plaza», 29 «Pasajero»). */
  passenger: mci("seat-passenger"),
  /** Volante (rol conductor). */
  steering: mci("steering"),
  /** Tarjeta de identidad (06, 07 «Otra forma de verificar»). */
  idCard: mci("card-account-details"),

  // — Dispositivos y acciones —
  camera: ion("camera"),
  cameraOutline: ion("camera-outline"),
  image: ion("image-outline"),
  phone: ion("call"),
  phoneOutline: ion("call-outline"),
  smartphone: ion("phone-portrait"),
  /** Móvil de marco grueso con botón inferior (34 «Mi móvil»). */
  cellphone: mci("cellphone"),
  mail: ion("mail-outline"),
  lock: ion("lock-closed"),
  bell: ion("notifications"),
  bellOutline: ion("notifications-outline"),
  settings: ion("settings"),
  logout: ion("log-out-outline"),
  trash: ion("trash"),
  mic: ion("mic"),
  /** Avión de papel (enviar mensaje, 26). */
  send: ion("send"),
  attach: ion("attach"),
  /** Flecha de navegación/enviar (21 «Ver ruta en el mapa», 35 «Enviar consulta»). */
  navigate: ion("navigate"),
  /** Mira de ubicación (09, 13). */
  locate: ion("locate"),
  share: mci("share-variant"),
  /** Burbuja vacía (barra inferior «Mensajes»). */
  chat: ion("chatbubble-outline"),
  /** Burbuja rellena (barra inferior «Mensajes» activa). */
  chatFilled: ion("chatbubble"),
  /** Burbuja con puntos (08 «Pedir ayuda»). */
  chatEllipses: ion("chatbubble-ellipses"),
  /** Burbuja con «?» (35 «¿En qué podemos ayudarte?»). */
  chatHelp: mci("chat-question"),
  /** Burbuja con líneas (25 bandeja vacía). */
  chatText: mci("message-text-outline"),

  // — Documentos, tiempo y lugares —
  /** Hoja con líneas, rellena (07, 14 «Condiciones de cancelación», 34 «Permisos de la app»). */
  document: ion("document-text"),
  documentOutline: ion("document-text-outline"),
  receipt: mci("receipt-text"),
  calendar: ion("calendar"),
  /** Calendario con puntos (09 «Viajes»). */
  calendarOutline: ion("calendar-outline"),
  /** Calendario con cuadrícula (10, 14, 18, 37 «Hoy»). */
  calendarGrid: mci("calendar-month"),
  /** Calendario con visto (30 «Confirmada»). */
  calendarCheck: mci("calendar-check"),
  /** Reloj de trazo grueso (04, 12, 16, 18, 27, 37). */
  clock: ion("time-outline"),
  clockFilled: ion("time"),
  pin: ion("location"),
  pinOutline: ion("location-outline"),
  /** Anillo con punto: origen de ruta (10 «Origen», 30). */
  originDot: ion("radio-button-on"),
  flag: ion("flag"),
  map: ion("map"),
  mapOutline: ion("map-outline"),
  list: ion("list"),
  /** Ruta con dos extremos (12 «Trayecto total»). */
  route: mci("map-marker-path"),
  /** Dos pines unidos (15 «Distancia estimada», 24). */
  distance: mci("map-marker-distance"),

  // — Transporte y categorías de trayecto —
  /** Coche visto de frente (09, 12, 17, 21…). */
  car: ion("car"),
  carOutline: ion("car-outline"),
  /** Peatón (13 «4 min a pie»). */
  walk: mci("walk"),
  /** Corredor (09/18 «Deporte»). */
  run: mci("run"),
  briefcase: ion("briefcase"),
  /** Birrete (09/18 «Universidad», 11, 12). */
  school: ion("school"),
  /** Llave inglesa (09 «FP»). Deviación: en 18 «FP» el diseño muestra una caja de herramientas. */
  wrench: ion("build"),
  /** Cruz médica (09/18 «Hospital»). */
  hospital: mci("hospital-box"),
  home: ion("home"),

  // — Dinero y planes —
  /** Pila de monedas (12 «Precio por persona», 27 «Pago del viaje completado»). */
  coins: mci("database"),
  /** Billetes (33 «A cobrar este mes»). */
  cash: mci("cash-multiple"),
  euro: mci("currency-eur"),
  /** Tarjeta de crédito (16, 17, 33, 35, 36a). */
  card: ion("card"),
  /** Corona (32 «Membresía»). */
  crown: mci("crown"),
  /** Barras (37 «Resultado»). */
  chart: mci("chart-bar"),
  /** «ᴀA» (34 «Tamaño de letra»). */
  textSize: mci("format-size"),
  /** Logotipo de Apple (16 «Apple Pay»). */
  apple: ion("logo-apple"),
  // ── admin-ops (panel de personal: tarifas, operación, legal, atención y liquidaciones) ──
  /** 40 «Configuración de tarifas (propuesta)». */
  opsTagCheck: mci("tag-check"),
  /** Historial de versiones de tarifa y de eventos. */
  opsHistory: mci("history"),
  /** Atención al cliente. */
  opsHeadset: mci("headset"),
  /** Documentos legales. */
  opsScale: mci("scale-balance"),
  /** Editar un documento. */
  opsFileEdit: mci("file-document-edit-outline"),
  /** Pendiente de revisión. */
  opsClipboardClock: mci("clipboard-text-clock"),
  /** Adjuntos de una consulta. */
  opsPaperclip: mci("paperclip"),
  opsImage: mci("image-outline"),
  opsFilePdf: mci("file-pdf-box"),
  /** Guardar. */
  opsSave: mci("content-save-outline"),
  /** Cola vacía. */
  opsInbox: mci("inbox"),
} as const satisfies Record<string, GlyphRef>;

export type IconName = keyof typeof glyphs;

/** Todos los nombres de icono, en el orden del registro (para la galería y las pruebas). */
export const iconNames = Object.keys(glyphs) as readonly IconName[];
