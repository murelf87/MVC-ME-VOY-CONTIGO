/**
 * Formulario de la tarifa en borrador (pantalla 40a/40b): del contrato (`AdminTariffVersion`) al texto de los campos,
 * validación en español y petición `AdminTariffDraftInput` / `AdminTariffExampleRequest`.
 *
 * Todo lo que escribe la persona viaja como ENTERO (micro-euros, puntos básicos, céntimos): ver `./money`.
 * Funciones puras: se prueban en Node.
 */
import { NBSP, formatDecimal } from "@/i18n";
import type { AdminTariffDraftInput, AdminTariffExampleRequest, AdminTariffPublishRequest, AdminTariffVersion } from "@/api/types";
import { dayStartIso, parseSpanishDate } from "./audit";
import {
  centsToText,
  commissionToText,
  parseCentsAmount,
  parseCommission,
  parseRatePerKm,
  ratePerKmToText,
  type FieldParse,
} from "./money";

/** Distancia del trayecto de ejemplo (18 km) cuando la persona no la cambia. */
export const EXAMPLE_DISTANCE_METERS = 18_000;
export const EXAMPLE_MIN_METERS = 1;
export const EXAMPLE_MAX_METERS = 2_000_000;
export const NOTES_MAX_LENGTH = 1000;

export interface TariffForm {
  rate: string;
  driverCommission: string;
  passengerCommission: string;
  premium: string;
  /** Límite de gastos compartidos por trayecto y pasajero (opcional). */
  cap: string;
  notes: string;
}

export type TariffField = keyof TariffForm;

export const EMPTY_TARIFF_FORM: TariffForm = {
  rate: "",
  driverCommission: "",
  passengerCommission: "",
  premium: "",
  cap: "",
  notes: "",
};

export function formFromDraft(draft: AdminTariffVersion | null): TariffForm {
  if (draft === null) return EMPTY_TARIFF_FORM;
  return {
    rate: ratePerKmToText(draft.ratePerKmMicros),
    driverCommission: commissionToText(draft.driverCommissionBps),
    passengerCommission: commissionToText(draft.passengerCommissionBps),
    premium: centsToText(draft.premiumMonthlyCents),
    cap: centsToText(draft.sharedCostCapCents),
    notes: draft.notes ?? "",
  };
}

export interface TariffValidation {
  valid: boolean;
  errors: Partial<Record<TariffField, string>>;
  /** Cuerpo de `PUT /v1/admin/tariffs/draft`; solo existe si el formulario es válido. */
  input: AdminTariffDraftInput | null;
}

function pick(result: FieldParse, field: TariffField, errors: Partial<Record<TariffField, string>>): number | null {
  if (result.ok) return result.value;
  errors[field] = result.message;
  return null;
}

/**
 * Valida el formulario completo. `PUT /v1/admin/tariffs/draft` SUSTITUYE el borrador entero (lo que se omite queda en
 * «Por definir»), así que la petición lleva siempre los seis valores.
 */
export function validateTariffForm(form: TariffForm): TariffValidation {
  const errors: Partial<Record<TariffField, string>> = {};
  const ratePerKmMicros = pick(parseRatePerKm(form.rate), "rate", errors);
  const driverCommissionBps = pick(parseCommission(form.driverCommission), "driverCommission", errors);
  const passengerCommissionBps = pick(parseCommission(form.passengerCommission), "passengerCommission", errors);
  const premiumMonthlyCents = pick(parseCentsAmount(form.premium, "La cuota Premium"), "premium", errors);
  const sharedCostCapCents = pick(parseCentsAmount(form.cap, "El límite de gastos compartidos"), "cap", errors);
  const notes = form.notes.trim();
  if (notes.length > NOTES_MAX_LENGTH) errors.notes = `Las notas admiten como máximo ${NOTES_MAX_LENGTH} caracteres.`;
  if (Object.keys(errors).length > 0) return { valid: false, errors, input: null };
  return {
    valid: true,
    errors,
    input: {
      ratePerKmMicros,
      passengerCommissionBps,
      driverCommissionBps,
      premiumMonthlyCents,
      sharedCostCapCents,
      notes: notes === "" ? null : notes,
    },
  };
}

/** Clave comparable de un formulario: «0,3» y «0,30» son lo mismo; un texto no válido se compara tal cual. */
function normalizedKey(form: TariffForm): string {
  const v = validateTariffForm(form);
  if (v.input !== null) return JSON.stringify(v.input);
  return JSON.stringify([form.rate, form.driverCommission, form.passengerCommission, form.premium, form.cap, form.notes.trim()]);
}

export function isTariffDirty(form: TariffForm, baseline: TariffForm): boolean {
  return normalizedKey(form) !== normalizedKey(baseline);
}

/**
 * Aspecto del formulario según el DATO del borrador (lámina 40a/40b):
 *  · `pending`: comisiones sin definir → campos de selección «Por definir ⌄» (40a).
 *  · `inputs`: hay alguna comisión definida (o la persona acaba de definir una) → campos numéricos con «%» (40b).
 */
export type TariffLook = "pending" | "inputs";

export function tariffLook(draft: AdminTariffVersion | null, forcedInputs: boolean): TariffLook {
  const hasCommission = draft !== null && (draft.passengerCommissionBps !== null || draft.driverCommissionBps !== null);
  return hasCommission || forcedInputs ? "inputs" : "pending";
}

/** Petición del ejemplo con lo que hay escrito. `null` si algún campo no es válido (no se calcula nada a medias). */
export function exampleRequestFor(form: TariffForm, distanceMeters: number): AdminTariffExampleRequest | null {
  const rate = parseRatePerKm(form.rate);
  const driver = parseCommission(form.driverCommission);
  const passenger = parseCommission(form.passengerCommission);
  if (!rate.ok || !driver.ok || !passenger.ok) return null;
  if (!Number.isSafeInteger(distanceMeters) || distanceMeters < EXAMPLE_MIN_METERS || distanceMeters > EXAMPLE_MAX_METERS) return null;
  return {
    distanceMeters,
    ratePerKmMicros: rate.value,
    passengerCommissionBps: passenger.value,
    driverCommissionBps: driver.value,
  };
}

/** `18000` → «18» · `18500` → «18,5». */
export function kmText(meters: number): string {
  const km = meters / 1000;
  if (Number.isInteger(km)) return formatDecimal(km, 0);
  return formatDecimal(km, 3).replace(/0+$/, "");
}

/** Distancia escrita por la persona (en km) → metros; `null` si no es válida. */
export function parseDistanceKm(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,4}(?:[.,]\d{1,3})?$/.test(trimmed)) return null;
  const meters = Math.round(Number(trimmed.replace(",", ".")) * 1000);
  return meters >= EXAMPLE_MIN_METERS && meters <= EXAMPLE_MAX_METERS ? meters : null;
}

/** «18 km × 0,30 €/km» · sin tarifa definida: «18 km × tarifa por definir». */
export function exampleLine(meters: number, rateMicros: number | null, pendingRate: string): string {
  const km = `${kmText(meters)}${NBSP}km`;
  return rateMicros === null ? `${km} × ${pendingRate}` : `${km} × ${ratePerKmToText(rateMicros)}${NBSP}€/km`;
}

/** «Trayecto de 18 km (propuesta)». */
export function exampleTripLine(meters: number, template: string): string {
  return template.replace("{km}", kmText(meters));
}

/** ¿Todos los campos del borrador necesarios para activar la tarifa están definidos? (el servidor lo vuelve a comprobar). */
export function isDraftComplete(draft: AdminTariffVersion | null): boolean {
  return draft !== null && draft.ratePerKmMicros !== null && draft.passengerCommissionBps !== null && draft.driverCommissionBps !== null;
}

// ── Activación (solo con la puerta `ECONOMICS_ACTIVATION` abierta) ───────────────────────────────────────────────

export const APPROVAL_REFERENCE_MIN = 3;
export const APPROVAL_REFERENCE_MAX = 300;

export interface ActivationErrors {
  reference?: string;
  effectiveFrom?: string;
}

export type ActivationValidation = { ok: true; request: AdminTariffPublishRequest } | { ok: false; errors: ActivationErrors };

/**
 * Activar una versión exige la referencia de la decisión económica aprobada (3–300 caracteres) y una fecha de entrada en
 * vigor FUTURA (`dd/mm/aaaa`, día natural de Madrid: rige desde las 00:00 de ese día). El servidor lo vuelve a comprobar.
 */
export function validateActivation(reference: string, dateText: string, nowMs: number): ActivationValidation {
  const errors: ActivationErrors = {};
  const cleanReference = reference.trim();
  if (cleanReference.length < APPROVAL_REFERENCE_MIN || cleanReference.length > APPROVAL_REFERENCE_MAX) {
    errors.reference = "Indica la referencia de la decisión económica aprobada (entre 3 y 300 caracteres).";
  }
  let effectiveFrom = "";
  const date = parseSpanishDate(dateText);
  if (date === null) {
    errors.effectiveFrom = "Escribe una fecha válida, por ejemplo 10/11/2026.";
  } else {
    effectiveFrom = dayStartIso(date);
    if (Date.parse(effectiveFrom) <= nowMs) errors.effectiveFrom = "La fecha de entrada en vigor debe ser futura.";
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, request: { approvalReference: cleanReference, effectiveFrom } };
}
