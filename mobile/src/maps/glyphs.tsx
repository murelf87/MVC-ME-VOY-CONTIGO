/**
 * Glifos vectoriales de los marcadores y controles del mapa (react-native-svg; funcionan igual en iOS, Android y web).
 * Dibujados a medida para el mapa (coche frontal, birrete, bandera de meta, peatón, mira de ubicación…) con las
 * proporciones de las láminas aprobadas. No sustituyen al sistema de iconos de la app (`src/icons`).
 */
import React from 'react';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { CAP_VIEWBOX } from './mapTheme';

interface GlyphProps {
  /** Ancho en pt (la altura mantiene la proporción). */
  width: number;
  color: string;
}

/** Coche visto de frente. `cut` = color de fondo que se ve a través de parabrisas y faros. */
export function CarGlyph({ width, color, cut }: GlyphProps & { cut: string }): React.JSX.Element {
  const h = (width * 22) / 28;
  return (
    <Svg width={width} height={h} viewBox="0 0 28 22">
      <Path d="M7.6 1.2h12.8c1.1 0 2.1.7 2.5 1.7L25 9H3l2.1-6.1c.4-1 1.4-1.7 2.5-1.7z" fill={color} />
      <Path d="M8.7 3.2h10.6l1.3 4.5H7.4z" fill={cut} />
      <Rect x="0.8" y="8.1" width="26.4" height="9.8" rx="3.3" fill={color} />
      <Rect x="-0.2" y="7.4" width="3" height="2.6" rx="1.1" fill={color} />
      <Rect x="25.2" y="7.4" width="3" height="2.6" rx="1.1" fill={color} />
      <Circle cx="6.5" cy="12.7" r="1.9" fill={cut} />
      <Circle cx="21.5" cy="12.7" r="1.9" fill={cut} />
      <Rect x="11.2" y="12" width="5.6" height="1.7" rx="0.85" fill={cut} />
      <Rect x="3" y="16.6" width="5.4" height="4.8" rx="1.4" fill={color} />
      <Rect x="19.6" y="16.6" width="5.4" height="4.8" rx="1.4" fill={color} />
    </Svg>
  );
}

/**
 * Coche visto de frente como SILUETA rellena (mapa de actividad del panel de administración, lámina 37a): casco, ruedas y
 * retrovisores en `color` con un borde fino `halo`, y parabrisas, faros y rejilla en `cut`. Se estira a `width × height`
 * (la lámina lo dibuja casi cuadrado: 25,5 × 25 pt).
 */
export function CarSilhouette({ width, height, color, cut, halo }: { width: number; height: number; color: string; cut: string; halo: string }): React.JSX.Element {
  const shapes = (fill: string, stroke?: string): React.JSX.Element => (
    <G fill={fill} stroke={stroke} strokeWidth={stroke ? 3.4 : 0} strokeLinejoin="round">
      <Path d="M7.6 1.2h12.8c1.1 0 2.1.7 2.5 1.7L25 9H3l2.1-6.1c.4-1 1.4-1.7 2.5-1.7z" />
      <Rect x="0.8" y="8.1" width="26.4" height="9.8" rx="3.3" />
      <Rect x="-0.2" y="7.4" width="3" height="2.6" rx="1.1" />
      <Rect x="25.2" y="7.4" width="3" height="2.6" rx="1.1" />
      <Rect x="3" y="16.6" width="5.4" height="4.8" rx="1.4" />
      <Rect x="19.6" y="16.6" width="5.4" height="4.8" rx="1.4" />
    </G>
  );
  return (
    <Svg width={width} height={height} viewBox="-2.4 -2.4 32.8 26.8" preserveAspectRatio="none">
      {shapes(halo, halo)}
      {shapes(color)}
      <Path d="M8.7 3.2h10.6l1.3 4.5H7.4z" fill={cut} />
      <Circle cx="6.5" cy="12.7" r="1.9" fill={cut} />
      <Circle cx="21.5" cy="12.7" r="1.9" fill={cut} />
      <Rect x="11.2" y="12" width="5.6" height="1.7" rx="0.85" fill={cut} />
    </Svg>
  );
}

/**
 * Birrete de graduación (proporciones de la lámina 12: 33,4 × 29,4 pt): tablero romboidal, copa honda y borla gruesa.
 * La rendija blanca entre tablero y copa se dibuja con `cut` (color del fondo; blanco por defecto), como el coche.
 */
export function CapGlyph({ width, color, cut = '#FFFFFF' }: GlyphProps & { cut?: string }): React.JSX.Element {
  const h = (width * CAP_VIEWBOX.h) / CAP_VIEWBOX.w;
  return (
    <Svg width={width} height={h} viewBox={`0 0 ${CAP_VIEWBOX.w} ${CAP_VIEWBOX.h}`}>
      <Path d="M17.5 1 33 12.1 17 19.5 1 12.1z" fill={color} />
      <Path d="M6 13.5 17 19 28 14v9.5c0 3.7-5 5.7-11 5.7s-11-2-11-5.7z" fill={color} />
      <Path d="M8.6 16.45 17 20.35 25.4 16.45" stroke={cut} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <Path d="M31.7 12.6v10.8" stroke={color} strokeWidth={2.7} strokeLinecap="round" fill="none" />
    </Svg>
  );
}

/** Bandera de meta a cuadros. */
export function FlagGlyph({ width, color }: GlyphProps): React.JSX.Element {
  const h = (width * 32) / 28;
  return (
    <Svg width={width} height={h} viewBox="0 0 28 32">
      <Rect x="2.4" y="2" width="3.2" height="28.5" rx="1.6" fill={color} />
      <Path d="M5.6 3.4c4.2-2 8.2 2 12.4 0s5-1.2 8.2 0v14.6c-3.2-1.2-4.2-1.6-8.2 0s-8.2-2-12.4 0z" fill={color} />
      <Rect x="8.6" y="5.6" width="3.4" height="3.4" fill="#FFFFFF" opacity={0.88} />
      <Rect x="15.4" y="5.6" width="3.4" height="3.4" fill="#FFFFFF" opacity={0.88} />
      <Rect x="12" y="9" width="3.4" height="3.4" fill="#FFFFFF" opacity={0.88} />
      <Rect x="18.8" y="9" width="3.4" height="3.4" fill="#FFFFFF" opacity={0.88} />
      <Rect x="8.6" y="12.4" width="3.4" height="3.4" fill="#FFFFFF" opacity={0.88} />
      <Rect x="15.4" y="12.4" width="3.4" height="3.4" fill="#FFFFFF" opacity={0.88} />
    </Svg>
  );
}

/** Peatón (trayecto a pie). */
export function WalkGlyph({ width, color }: GlyphProps): React.JSX.Element {
  const h = (width * 22) / 16;
  return (
    <Svg width={width} height={h} viewBox="0 0 16 22">
      <Circle cx="9.6" cy="3" r="2.3" fill={color} />
      <Path
        d="M7.8 6.9 6.5 12.4M6.5 12.4 3.7 20.2M6.5 12.4 9.9 15.2 9.2 20.4M7.6 8.1 4.2 10.8M7.9 8.3l3.7 2.3 1.9-.3"
        stroke={color}
        strokeWidth={2.1}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}

/** Reloj. */
export function ClockGlyph({ width, color }: GlyphProps): React.JSX.Element {
  return (
    <Svg width={width} height={width} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={2.2} fill="none" />
      <Path d="M12 6.8V12l3.6 2.2" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </Svg>
  );
}

/** Mira de «centrar en mi ubicación»: anillo, punto central y cuatro marcas. */
export function LocateGlyph({ width, color }: GlyphProps): React.JSX.Element {
  return (
    <Svg width={width} height={width} viewBox="0 0 28 28">
      <Circle cx="14" cy="14" r="7.6" stroke={color} strokeWidth={2.4} fill="none" />
      <Circle cx="14" cy="14" r="3.5" fill={color} />
      <Path d="M14 1.6v4M14 22.4v4M1.6 14h4M22.4 14h4" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

/** «i» dentro de un disco. */
export function InfoGlyph({ width, color, cut }: GlyphProps & { cut: string }): React.JSX.Element {
  return (
    <Svg width={width} height={width} viewBox="0 0 24 24">
      <Circle cx="12" cy="12" r="11" fill={color} />
      <Circle cx="12" cy="7.2" r="1.7" fill={cut} />
      <Path d="M12 10.8v7" stroke={cut} strokeWidth={2.6} strokeLinecap="round" />
    </Svg>
  );
}

/** Asa «≡» de reordenar. */
export function HandleGlyph({ width, color }: GlyphProps): React.JSX.Element {
  const h = (width * 14) / 20;
  return (
    <Svg width={width} height={h} viewBox="0 0 20 14">
      <Path d="M1.5 2h17M1.5 7h17M1.5 12h17" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

/** Rombo blanco (parada final). */
export function DiamondGlyph({ width, color }: GlyphProps): React.JSX.Element {
  return (
    <Svg width={width} height={width} viewBox="0 0 12 12">
      <Path d="M6 0.8 11.2 6 6 11.2 0.8 6z" fill={color} />
    </Svg>
  );
}

/** Hoja de parque (punto de interés verde de la base cartográfica). */
export function LeafGlyph({ width, color }: GlyphProps): React.JSX.Element {
  return (
    <Svg width={width} height={width} viewBox="0 0 16 16">
      <Path d="M2 14C2 7 6 2 14 2c0 8-4.6 12-9.4 12C3.6 14 2.8 14 2 14z" fill={color} />
    </Svg>
  );
}
