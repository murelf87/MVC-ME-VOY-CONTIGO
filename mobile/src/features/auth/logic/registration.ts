/**
 * Validación del formulario «Tu cuenta» (lámina 03). Funciones puras, sin React ni red: se prueban en Node.
 * Los mensajes están en es-ES y salen de `authStrings`.
 */
import { normalizePhoneE164 } from "@/api/phone";
import { authStrings } from "../strings";

export const NAME_MIN = 2;
export const NAME_MAX = 40;
/** Límite del servidor para el nombre visible (`PATCH /v1/me/profile`, 2–80 caracteres). */
export const DISPLAY_NAME_MAX = 80;

export interface RegistrationForm {
  givenName: string;
  familyName: string;
  /** Tal como lo escribe la persona («612 345 678»). */
  phone: string;
  provinceId: string | null;
  accepted: boolean;
}

export type RegistrationField = "givenName" | "familyName" | "phone" | "province" | "consent";
export type RegistrationErrors = Partial<Record<RegistrationField, string>>;

export interface ValidRegistration {
  givenName: string;
  familyName: string;
  displayName: string;
  phoneE164: string;
  provinceId: string;
}

export type RegistrationValidation = { ok: true; value: ValidRegistration } | { ok: false; errors: RegistrationErrors };

/** Recorta y colapsa los espacios repetidos («  Ana   María » → «Ana María»). */
export function normalizeName(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Nombre visible que se guarda en el perfil: «Ana García López». */
export function composeDisplayName(givenName: string, familyName: string): string {
  return `${normalizeName(givenName)} ${normalizeName(familyName)}`.trim();
}

/** Primer apellido o nombre sin números ni símbolos raros (se admiten letras con tilde, guiones, apóstrofos y puntos). */
const FORBIDDEN_NAME_CHARS = /[0-9_@#$%^&*()+=[\]{}<>/\\|~`"!?;:,¡¿€£]/;

function nameError(value: string, which: "givenName" | "familyName"): string | undefined {
  const e = authStrings.create.errors;
  const name = normalizeName(value);
  if (name === "") return which === "givenName" ? e.givenNameRequired : e.familyNameRequired;
  if (name.length < NAME_MIN) return which === "givenName" ? e.givenNameShort : e.familyNameShort;
  if (name.length > NAME_MAX) return which === "givenName" ? e.givenNameLong : e.familyNameLong;
  if (FORBIDDEN_NAME_CHARS.test(name)) return e.nameChars;
  return undefined;
}

export function phoneError(raw: string): string | undefined {
  const e = authStrings.create.errors;
  const parsed = normalizePhoneE164(raw);
  if (parsed.ok) return undefined;
  switch (parsed.reason) {
    case "empty":
      return e.phoneRequired;
    case "not_spanish_mobile":
      return e.phoneNotSpanishMobile;
    case "invalid":
      return e.phoneInvalid;
  }
}

/** Valida los cuatro campos y la casilla de aceptación. Devuelve TODOS los errores a la vez para pintarlos juntos. */
export function validateRegistration(form: RegistrationForm): RegistrationValidation {
  const e = authStrings.create.errors;
  const errors: RegistrationErrors = {};

  const givenError = nameError(form.givenName, "givenName");
  if (givenError !== undefined) errors.givenName = givenError;
  const familyError = nameError(form.familyName, "familyName");
  if (familyError !== undefined) errors.familyName = familyError;
  if (givenError === undefined && familyError === undefined && composeDisplayName(form.givenName, form.familyName).length > DISPLAY_NAME_MAX) {
    errors.familyName = e.fullNameLong;
  }

  const phone = normalizePhoneE164(form.phone);
  if (!phone.ok) errors.phone = phoneError(form.phone);

  if (form.provinceId === null || form.provinceId === "") errors.province = e.provinceRequired;
  if (!form.accepted) errors.consent = e.consentRequired;

  if (Object.keys(errors).length > 0 || !phone.ok || form.provinceId === null) return { ok: false, errors };
  return {
    ok: true,
    value: {
      givenName: normalizeName(form.givenName),
      familyName: normalizeName(form.familyName),
      displayName: composeDisplayName(form.givenName, form.familyName),
      phoneE164: phone.e164,
      provinceId: form.provinceId,
    },
  };
}

/** Primer campo con error en el orden de la pantalla (para llevar el foco / el desplazamiento). */
export function firstErrorField(errors: RegistrationErrors): RegistrationField | null {
  const order: readonly RegistrationField[] = ["givenName", "familyName", "phone", "province", "consent"];
  return order.find((field) => errors[field] !== undefined) ?? null;
}
