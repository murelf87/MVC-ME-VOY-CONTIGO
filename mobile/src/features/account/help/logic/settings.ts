/**
 * Lógica pura de «Ajustes» (lámina 34): línea de roles de la cabecera, teléfono con formato, tamaños de letra y
 * mezcla optimista de cambios. Sin React ni red: se prueba en Node.
 */
import type { FontScale, UserSettings, UserSettingsPatch } from "@/api/types";
import { formatNationalSpanishPhone } from "@/api/phone";
import { helpStrings } from "../strings";

export const FONT_SCALE_ORDER: readonly FontScale[] = ["small", "normal", "large", "extra_large"];

export interface FontScaleOption {
  value: FontScale;
  label: string;
  description: string;
}

export function fontScaleOptions(): FontScaleOption[] {
  return FONT_SCALE_ORDER.map((value) => ({
    value,
    label: helpStrings.fontSheet.options[value].label,
    description: helpStrings.fontSheet.options[value].description,
  }));
}

export function fontScaleLabel(scale: FontScale): string {
  return helpStrings.fontSheet.options[scale].label;
}

const STAFF_ROLES: ReadonlySet<string> = new Set(["admin", "verification_admin", "finance_admin", "support_admin"]);

/**
 * Línea bajo el nombre en la cabecera de «Ajustes». El contrato no trae el género de la persona: se usan los literales
 * de la lámina 34 («Conductora», «Conductora y pasajera»), igual que el resto de la app (messages).
 */
export function roleLine(roles: readonly string[]): string {
  const driver = roles.includes("driver");
  const passenger = roles.includes("passenger");
  if (driver && passenger) return helpStrings.settings.roleBoth;
  if (driver) return helpStrings.settings.roleDriver;
  if (passenger) return helpStrings.settings.rolePassenger;
  if (roles.some((role) => STAFF_ROLES.has(role))) return helpStrings.settings.roleStaff;
  return helpStrings.settings.roleNone;
}

/** `+34600123456` → `+34 600 123 456`. Otros prefijos se devuelven tal cual; sin número → `null`. */
export function formatPhoneDisplay(e164: string | null | undefined): string | null {
  if (e164 === null || e164 === undefined || e164.trim() === "") return null;
  const national = formatNationalSpanishPhone(e164);
  return national === e164 ? e164 : `+34 ${national}`;
}

/** Aplica un cambio parcial a los ajustes (envío optimista). Devuelve un objeto nuevo; no toca `account`. */
export function applySettingsPatch(settings: UserSettings, patch: UserSettingsPatch): UserSettings {
  return {
    ...settings,
    ...(patch.shareLiveLocationInTrip !== undefined ? { shareLiveLocationInTrip: patch.shareLiveLocationInTrip } : {}),
    ...(patch.fontScale !== undefined ? { fontScale: patch.fontScale } : {}),
    ...(patch.language !== undefined ? { language: patch.language } : {}),
  };
}

/** Junta dos cambios parciales: el más reciente gana en cada campo. */
export function mergePatches(older: UserSettingsPatch, newer: UserSettingsPatch): UserSettingsPatch {
  return {
    ...older,
    ...(newer.shareLiveLocationInTrip !== undefined ? { shareLiveLocationInTrip: newer.shareLiveLocationInTrip } : {}),
    ...(newer.fontScale !== undefined ? { fontScale: newer.fontScale } : {}),
    ...(newer.language !== undefined ? { language: newer.language } : {}),
  };
}

export function isEmptyPatch(patch: UserSettingsPatch): boolean {
  return patch.shareLiveLocationInTrip === undefined && patch.fontScale === undefined && patch.language === undefined;
}

/**
 * Deshace los campos de `failed` que NO se han vuelto a cambiar después (los que sí tienen un cambio más nuevo en
 * `newer` conservan ese valor). `confirmed` son los últimos ajustes que el servidor aceptó.
 */
export function revertFailedPatch(current: UserSettings, confirmed: UserSettings, failed: UserSettingsPatch, newer: UserSettingsPatch): UserSettings {
  return {
    ...current,
    ...(failed.shareLiveLocationInTrip !== undefined && newer.shareLiveLocationInTrip === undefined
      ? { shareLiveLocationInTrip: confirmed.shareLiveLocationInTrip }
      : {}),
    ...(failed.fontScale !== undefined && newer.fontScale === undefined ? { fontScale: confirmed.fontScale } : {}),
    ...(failed.language !== undefined && newer.language === undefined ? { language: confirmed.language } : {}),
  };
}

/**
 * ¿Debe el servidor mandar sobre el tamaño de letra de este móvil? Solo si la persona ya guardó algo alguna vez
 * (`updatedAt` ≠ null): unos ajustes «por defecto» no deben pisar la elección hecha antes de entrar.
 */
export function serverFontScaleWins(settings: Pick<UserSettings, "updatedAt">): boolean {
  return settings.updatedAt !== null;
}
