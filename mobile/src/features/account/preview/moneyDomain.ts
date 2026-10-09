/**
 * Lógica de escritura del backend en memoria de «pagos y cobros» (SIMULACIÓN): alta y baja de métodos de pago.
 *
 * El proveedor es SIMULADO y solo existe en la vista previa. Reproduce el contrato (docs/contracts/money.md §6):
 *  - un `providerToken` con aspecto de número de tarjeta se rechaza sin guardarlo (`400 RAW_CARD_DATA_REJECTED`);
 *  - con el proveedor desactivado todo alta responde `409 PAYMENTS_PROVIDER_DISABLED`;
 *  - solo se aceptan los tokens simulados `tok_sim_*` (otro token → `409 PAYMENT_METHOD_NOT_AVAILABLE`);
 *  - el primer método de cada finalidad es el predeterminado; al quitar el predeterminado lo pasa a ser el más reciente.
 */
import type { PaymentMethod, PaymentMethodKind, PaymentMethodPurpose } from "@/api/types/money";
import { fail, type PreviewDb } from "@/preview";
import { activeMethods, methodDto } from "./moneyViews";
import { moneyTables, readConfig, type MethodRow } from "./moneyRows";

export interface SimulatedToken {
  token: string;
  brand: string | null;
  last4: string;
  country: string;
  expMonth: number | null;
  expYear: number | null;
  title: string;
  maskedLabel: string;
  /** Tipo según la finalidad: una cuenta bancaria es `sepa_debit` para pagar y `bank_account` para cobrar. */
  kindFor: (purpose: PaymentMethodPurpose) => PaymentMethodKind | null;
}

/** Tokens que entrega el «SDK del proveedor» simulado de la vista previa. */
export const SIMULATED_TOKENS: Readonly<Record<string, SimulatedToken>> = {
  tok_sim_visa_4242: {
    token: "tok_sim_visa_4242",
    brand: "Visa",
    last4: "4242",
    country: "ES",
    expMonth: 8,
    expYear: 2028,
    title: "Tarjeta Visa",
    maskedLabel: "•••• 4242",
    kindFor: (purpose) => (purpose === "charge" ? "card" : null),
  },
  tok_sim_mastercard_4444: {
    token: "tok_sim_mastercard_4444",
    brand: "Mastercard",
    last4: "4444",
    country: "ES",
    expMonth: 11,
    expYear: 2027,
    title: "Tarjeta Mastercard",
    maskedLabel: "•••• 4444",
    kindFor: (purpose) => (purpose === "charge" ? "card" : null),
  },
  tok_sim_sepa_4589: {
    token: "tok_sim_sepa_4589",
    brand: null,
    last4: "4589",
    country: "ES",
    expMonth: null,
    expYear: null,
    title: "Cuenta bancaria",
    maskedLabel: "ES** **** **** 4589",
    kindFor: (purpose) => (purpose === "payout" ? "bank_account" : "sepa_debit"),
  },
};

/** Algoritmo de Luhn sobre una cadena de dígitos. */
export function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = digits.charCodeAt(index) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** ¿Parece un número de tarjeta (13–19 dígitos con Luhn válido, con o sin separadores)? */
export function looksLikeCardNumber(token: string): boolean {
  const stripped = token.replace(/[\s-]/g, "");
  return /^\d{13,19}$/.test(stripped) && luhnValid(stripped);
}

export interface AddMethodInput {
  purpose: PaymentMethodPurpose;
  providerToken: string;
  setAsDefault?: boolean;
}

export function addPaymentMethod(db: PreviewDb, userId: string, input: AddMethodInput): PaymentMethod {
  if (looksLikeCardNumber(input.providerToken)) {
    fail("RAW_CARD_DATA_REJECTED", "El token parece un número de tarjeta: no se ha registrado ni guardado.", 400);
  }
  if (!readConfig(db).provider_enabled) fail("PAYMENTS_PROVIDER_DISABLED", "Pagos aún no disponibles", 409);
  const simulated = SIMULATED_TOKENS[input.providerToken];
  const kind = simulated?.kindFor(input.purpose) ?? null;
  if (simulated === undefined || kind === null) {
    return fail("PAYMENT_METHOD_NOT_AVAILABLE", "El proveedor de pagos no ha aceptado este método.", 409);
  }

  return db.tx(() => {
    const table = moneyTables(db).methods;
    const existing = activeMethods(db, userId, input.purpose).find((m) => m.kind === kind && m.last4 === simulated.last4);
    const hasDefault = activeMethods(db, userId, input.purpose).some((m) => m.is_default);
    const makeDefault = input.setAsDefault === true || !hasDefault;
    if (makeDefault) {
      for (const method of activeMethods(db, userId, input.purpose)) {
        if (method.is_default && method.id !== existing?.id) table.update(method.id, { is_default: false });
      }
    }
    if (existing !== undefined) {
      const updated = makeDefault && !existing.is_default ? table.update(existing.id, { is_default: true }) : existing;
      return methodDto(updated);
    }
    const row: MethodRow = {
      id: db.ids.uuid(),
      user_id: userId,
      purpose: input.purpose,
      kind,
      brand: simulated.brand,
      last4: simulated.last4,
      country: simulated.country,
      exp_month: simulated.expMonth,
      exp_year: simulated.expYear,
      title: simulated.title,
      masked_label: simulated.maskedLabel,
      is_default: makeDefault,
      status: "active",
      created_at: db.nowMs(),
      removed_at: null,
    };
    return methodDto(table.insert(row));
  });
}

export function removePaymentMethod(db: PreviewDb, userId: string, methodId: string): { removed: true } {
  const table = moneyTables(db).methods;
  const method = table.get(methodId);
  if (method === undefined || method.user_id !== userId || method.removed_at !== null) {
    return fail("PAYMENT_METHOD_NOT_FOUND", "Payment method not found", 404);
  }
  db.tx(() => {
    table.update(methodId, { removed_at: db.nowMs(), is_default: false });
    if (method.is_default) {
      const next = activeMethods(db, userId, method.purpose)[0];
      if (next !== undefined) table.update(next.id, { is_default: true });
    }
  });
  return { removed: true };
}
