/**
 * Escala tipográfica como DATOS PUROS (sin `react-native`), para poder importarla desde Node (generador de
 * `design/tokens.json`, pruebas) y desde la app. `typography.ts` la convierte en estilos de React Native.
 *
 * Cara de lectura: **Roboto Condensed** (400/500/600/700). Se midió sobre las láminas (anchos de línea de ~60 cadenas y
 * alturas de versal 0,711 em): el texto de la interfaz coincide con esta cara con interletraje 0 … −0,03 em.
 * Cara de display: **Epilogue Black (900)** para «Tu provincia, / en movimiento.» de la pantalla 01
 * (ganó a 30 candidatas gratuitas de Google Fonts por forma de «a», «t», «g» y proporción de los remates).
 *
 * Las medidas de las láminas no son uniformes entre sí (cada lámina se generó con su propia escala): las variantes son
 * la mediana por función. Cuando una pantalla pida otro tamaño, usa las props `size`/`weight`/`lineHeight`/
 * `letterSpacing` de `<Text>` en lugar de añadir variantes.
 */

export type FontWeightName = "regular" | "medium" | "semibold" | "bold";
export type FontFaceKey = FontWeightName | "display";

/** Nombre exacto con el que `useAppFonts` registra cada archivo de fuente (una familia por peso; nunca `fontWeight`). */
export const fontFaceNames: Record<FontFaceKey, string> = {
  regular: "RobotoCondensed_400Regular",
  medium: "RobotoCondensed_500Medium",
  semibold: "RobotoCondensed_600SemiBold",
  bold: "RobotoCondensed_700Bold",
  display: "Epilogue_900Black",
};

export interface TypeSpec {
  readonly face: FontFaceKey;
  /** pt */
  readonly size: number;
  /** pt */
  readonly lineHeight: number;
  /** em (se convierte a pt al construir el estilo) */
  readonly letterSpacingEm: number;
  /** Dónde se midió. */
  readonly note: string;
}

function t(face: FontFaceKey, size: number, lineHeight: number, letterSpacingEm: number, note: string): TypeSpec {
  return { face, size, lineHeight, letterSpacingEm, note };
}

/** Escala tipográfica. Los colores no forman parte de la variante: los pone `<Text color>` (por defecto `body`). */
export const typeScale = {
  display: t("display", 40, 40, -0.045, "Lema de la bienvenida «Tu provincia, en movimiento.» (01). Epilogue 900, muy apretado."),
  h1: t("bold", 33, 38, -0.03, "Título grande bajo el chevron: 03 «Tu cuenta» ≈ 34 pt, 04 «Confirma tu móvil» ≈ 32 pt ⇒ mediana 33."),
  title: t("bold", 24, 28, -0.005, "Título de cabecera de pantalla (09 «Coches en tu provincia», 12 «Detalle del viaje»…)."),
  titleSm: t("bold", 22, 26, -0.01, "Nombre de persona / cifra destacada de tarjeta (12 «Ana», 16a «14:52» base)."),
  heading: t("bold", 19, 24, -0.01, "Título de sección («Ruta prevista», «Paradas y horarios estimados», «Método de pago»)."),
  subtitle: t("regular", 19.5, 24, 0, "Subtítulo de pantalla bajo el título (03)."),
  lead: t("medium", 20, 24, -0.02, "Valor de campo y texto principal de formulario (03)."),
  body: t("regular", 17, 22, 0, "Texto de lectura."),
  bodyStrong: t("semibold", 17, 22, -0.01, "Texto de lectura con énfasis."),
  rowTitle: t("bold", 16, 20, -0.01, "Título de fila / tarjeta (12 «Montequinto», «Precio por persona»)."),
  rowText: t("regular", 14.5, 18, 0, "Texto secundario de fila (12 «Tú te subes aquí», 09 «Con plazas»): 14–15 pt."),
  rowTextStrong: t("medium", 14.5, 18, -0.01, "Texto secundario con énfasis."),
  label: t("regular", 17.5, 20, 0, "Etiqueta de campo (03 «Nombre»)."),
  caption: t("regular", 12.5, 16, 0, "Pies y metadatos (12 «Matrícula ilustrativa», «Trayecto total»)."),
  captionStrong: t("medium", 12.5, 16, 0, "Pie con énfasis."),
  tabLabel: t("medium", 14, 17, -0.01, "Etiqueta de chip de categoría (09 «Hospital», «Deporte»: 14 pt)."),
  navLabel: t("regular", 13.5, 16, 0, "Etiqueta de la barra inferior (09 «Mensajes», «Viajes»: 12,8–13,9 pt ⇒ 13,5)."),
  button: t("semibold", 22, 26, -0.02, "Botón principal (03 «Recibir código»: 22–23,5 pt; 12 «Solicitar plaza»: 21 pt)."),
  buttonSm: t("semibold", 16, 20, -0.01, "Botón secundario compacto."),
  buttonXs: t("medium", 14, 18, 0, "Botón mínimo."),
  kpi: t("bold", 34, 38, -0.02, "Cifras de KPI (37 «Resumen»)."),
  kpiLg: t("bold", 56, 60, -0.03, "Cifra gigante reservada a contadores; sin medida directa en las láminas (valor de proyecto)."),
  code: t("bold", 48, 52, 0.02, "Código de recogida (23): 4 dígitos grandes."),
} as const satisfies Record<string, TypeSpec>;

export type TextVariant = keyof typeof typeScale;

/** Multiplicador máximo de escalado del tamaño de letra del sistema (accesibilidad sin romper maquetación). */
export const MAX_FONT_SIZE_MULTIPLIER = 1.3;
