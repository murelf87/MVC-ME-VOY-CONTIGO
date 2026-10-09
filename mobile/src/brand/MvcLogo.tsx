import React from "react";
import { type StyleProp, type ViewStyle } from "react-native";
import Svg, { G, Path } from "react-native-svg";
import { logoBoxes, logoColors, logoPaths } from "./logoPaths";

export type MvcLogoVariant = "horizontal" | "stacked" | "icon";

export interface MvcLogoProps {
  /** `horizontal` = icono + MVC / «Me voy contigo» a la derecha (cabeceras de las láminas);
   *  `stacked` = icono encima de MVC y «Me voy contigo», centrado (pantalla 01); `icon` = solo el icono. */
  variant?: MvcLogoVariant;
  /** Ancho en pt. La altura se deduce de la proporción oficial. Si se dan ambos, manda el más restrictivo. */
  width?: number;
  /** Alto en pt. */
  height?: number;
  /** Pinta todas las capas con un único color (versión monocroma, p. ej. blanco sobre azul). */
  monochrome?: string;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Escala del icono respecto a la del rótulo en la versión apilada (medida sobre la pantalla 01: 0,755 / 0,675). */
const STACKED_ICON_SCALE = 1.118;
/** Separación entre el icono y «MVC» en la versión apilada, en unidades de origen del trazado. */
const STACKED_GAP = 8.1;

const [, , iconW, iconH] = logoBoxes.icon;
const [wordX, wordY, wordW] = logoBoxes.word;
const [tagX, tagY, tagW, tagH] = logoBoxes.tag;
const blockX = Math.min(wordX, tagX);
const blockY = wordY;
const blockW = Math.max(wordX + wordW, tagX + tagW) - blockX;
const blockH = tagY + tagH - wordY;

const stackedIconW = iconW * STACKED_ICON_SCALE;
const stackedIconH = iconH * STACKED_ICON_SCALE;
const stackedW = Math.max(stackedIconW, blockW);
const stackedH = stackedIconH + STACKED_GAP + blockH;

interface Geometry {
  /** Ancho y alto del `viewBox`. */
  w: number;
  h: number;
}

const geometry: Record<MvcLogoVariant, Geometry> = {
  horizontal: { w: logoBoxes.all[2], h: logoBoxes.all[3] },
  stacked: { w: stackedW, h: stackedH },
  icon: { w: iconW, h: iconH },
};

const defaultWidth: Record<MvcLogoVariant, number> = { horizontal: 180, stacked: 160, icon: 64 };

/** Proporción ancho/alto de cada variante del logo. */
export function logoAspectRatio(variant: MvcLogoVariant): number {
  return geometry[variant].w / geometry[variant].h;
}

/** Tamaño final en pt para un `width`/`height` solicitados (conserva siempre la proporción). */
export function logoSize(variant: MvcLogoVariant, width?: number, height?: number): { width: number; height: number } {
  const ratio = logoAspectRatio(variant);
  if (width !== undefined && height !== undefined) {
    const w = Math.min(width, height * ratio);
    return { width: w, height: w / ratio };
  }
  if (height !== undefined) return { width: height * ratio, height };
  const w = width ?? defaultWidth[variant];
  return { width: w, height: w / ratio };
}

function place(box: readonly [number, number, number, number], tx: number, ty: number, scale: number): string {
  return `translate(${tx} ${ty}) scale(${scale}) translate(${-box[0]} ${-box[1]})`;
}

/**
 * Logo oficial de MVC. Compone las capas vectorizadas de `design/logo/layers.json` (`logoPaths.ts`, generado):
 * no redibuja nada, solo las coloca y las escala de forma uniforme.
 */
export function MvcLogo({
  variant = "horizontal",
  width,
  height,
  monochrome,
  accessibilityLabel = "MVC, Me voy contigo",
  testID,
  style,
}: MvcLogoProps): React.JSX.Element {
  const size = logoSize(variant, width, height);
  const g = geometry[variant];
  const blue = monochrome ?? logoColors.blue;
  const green = monochrome ?? logoColors.green;
  const navy = monochrome ?? logoColors.navy;

  const icon = (
    <>
      <Path d={logoPaths.iconBlue} fill={blue} fillRule="evenodd" />
      <Path d={logoPaths.iconGreen} fill={green} fillRule="evenodd" />
    </>
  );
  const wordmark = (
    <>
      <Path d={logoPaths.wordNavy} fill={navy} fillRule="evenodd" />
      <Path d={logoPaths.tagBlue} fill={blue} fillRule="evenodd" />
    </>
  );

  let content: React.JSX.Element;
  let viewBox: string;
  if (variant === "horizontal") {
    const [x, y, w, h] = logoBoxes.all;
    viewBox = `${x} ${y} ${w} ${h}`;
    content = (
      <>
        {icon}
        {wordmark}
      </>
    );
  } else if (variant === "icon") {
    const [x, y, w, h] = logoBoxes.icon;
    viewBox = `${x} ${y} ${w} ${h}`;
    content = icon;
  } else {
    viewBox = `0 0 ${g.w} ${g.h}`;
    content = (
      <>
        <G transform={place(logoBoxes.icon, (g.w - stackedIconW) / 2, 0, STACKED_ICON_SCALE)}>{icon}</G>
        <G
          transform={place(
            [blockX, blockY, blockW, blockH],
            (g.w - blockW) / 2,
            stackedIconH + STACKED_GAP,
            1,
          )}
        >
          {wordmark}
        </G>
      </>
    );
  }

  return (
    <Svg
      width={size.width}
      height={size.height}
      viewBox={viewBox}
      accessibilityRole="image"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      style={style}
    >
      {content}
    </Svg>
  );
}
