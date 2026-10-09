/**
 * «Tamaño de letra» de Ajustes (lámina 34): Pequeño · Normal · Grande · Muy grande.
 *
 * Es una preferencia de la PERSONA (se guarda en su cuenta con `PATCH /v1/me/settings` y en el dispositivo), distinta del
 * tamaño de letra del sistema: este factor se multiplica por el del sistema, que `Text` ya limita con
 * `MAX_FONT_SIZE_MULTIPLIER`. Con «Normal» (factor 1) la maquetación es idéntica a las láminas.
 *
 * Este módulo es puro (sin almacenamiento ni red): quien lee y guarda el valor es `features/account/help/fontScaleSync.ts`,
 * y quien lo aplica es `ui/Text.tsx` (y los campos de texto de `ui/TextField.tsx`) con `useFontScaleFactor()`.
 */
import { useSyncExternalStore } from "react";

export const FONT_SCALE_NAMES = ["small", "normal", "large", "extra_large"] as const;
export type FontScaleName = (typeof FONT_SCALE_NAMES)[number];

export const DEFAULT_FONT_SCALE: FontScaleName = "normal";

/** Factor aplicado a tamaño, interlineado y espaciado entre letras. */
export const FONT_SCALE_FACTORS: Readonly<Record<FontScaleName, number>> = {
  small: 0.9,
  normal: 1,
  large: 1.15,
  extra_large: 1.3,
};

export function isFontScaleName(value: unknown): value is FontScaleName {
  return typeof value === "string" && (FONT_SCALE_NAMES as readonly string[]).includes(value);
}

/** Escala un tamaño en pt (a medios puntos). Con factor 1 devuelve el mismo número, sin redondear. */
export function scaleFontSize(size: number, factor: number): number {
  return factor === 1 ? size : Math.round(size * factor * 2) / 2;
}

let current: FontScaleName = DEFAULT_FONT_SCALE;
const listeners = new Set<() => void>();

export function getFontScale(): FontScaleName {
  return current;
}

export function getFontScaleFactor(): number {
  return FONT_SCALE_FACTORS[current];
}

/** Cambia el tamaño de letra de TODA la app al instante. Devuelve `true` si cambió. */
export function setFontScale(next: FontScaleName): boolean {
  if (next === current) return false;
  current = next;
  for (const listener of [...listeners]) listener();
  return true;
}

export function subscribeFontScale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Nombre del tamaño elegido (re-renderiza al cambiar). */
export function useFontScale(): FontScaleName {
  return useSyncExternalStore(subscribeFontScale, getFontScale, getFontScale);
}

/** Factor numérico del tamaño elegido (re-renderiza al cambiar). */
export function useFontScaleFactor(): number {
  return useSyncExternalStore(subscribeFontScale, getFontScaleFactor, getFontScaleFactor);
}
