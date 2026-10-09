/**
 * Reglas de alerta en tiempo real (pantalla 40, «Alertas en tiempo real»): parámetros editables, validación y resúmenes.
 * Rangos del servidor (docs/contracts/trust.md §4.3): `thresholdCount` 1–1000 · `windowMinutes` 5–1440 ·
 * `maxPendingMinutes` 1–1440, todos enteros. Funciones puras: se prueban en Node.
 */
import { NBSP, formatDuration, pluralize } from "@/i18n";
import type { AdminAlertKind, AdminAlertRule, AdminAlertRuleParams, AdminOperationsUpdate } from "@/api/types";

export type ParamKey = keyof AdminAlertRuleParams;

export interface ParamSpec {
  key: ParamKey;
  min: number;
  max: number;
}

export const RULE_KINDS: readonly AdminAlertKind[] = ["unusual_cancellations", "schedule_price_changes", "route_incidents"];

export const RULE_PARAM_SPECS: Readonly<Record<AdminAlertKind, readonly ParamSpec[]>> = {
  unusual_cancellations: [
    { key: "thresholdCount", min: 1, max: 1000 },
    { key: "windowMinutes", min: 5, max: 1440 },
  ],
  schedule_price_changes: [{ key: "maxPendingMinutes", min: 1, max: 1440 }],
  route_incidents: [
    { key: "thresholdCount", min: 1, max: 1000 },
    { key: "windowMinutes", min: 5, max: 1440 },
  ],
};

/** Lo que hay escrito en los campos de una regla (texto). */
export type ParamDraft = Partial<Record<ParamKey, string>>;

export function paramsToDraft(kind: AdminAlertKind, params: AdminAlertRuleParams): ParamDraft {
  const draft: ParamDraft = {};
  for (const spec of RULE_PARAM_SPECS[kind]) {
    const value = params[spec.key];
    draft[spec.key] = value === undefined ? "" : String(value);
  }
  return draft;
}

export type ParamErrors = Partial<Record<ParamKey, string>>;

export type ParamsValidation = { ok: true; params: AdminAlertRuleParams } | { ok: false; errors: ParamErrors };

export function validateParams(kind: AdminAlertKind, draft: ParamDraft): ParamsValidation {
  const errors: ParamErrors = {};
  const params: AdminAlertRuleParams = {};
  for (const spec of RULE_PARAM_SPECS[kind]) {
    const raw = (draft[spec.key] ?? "").trim();
    if (!/^\d{1,5}$/.test(raw)) {
      errors[spec.key] = `Escribe un número entero entre ${spec.min} y ${spec.max}.`;
      continue;
    }
    const value = Number(raw);
    if (value < spec.min || value > spec.max) {
      errors[spec.key] = `Debe estar entre ${spec.min} y ${spec.max}.`;
      continue;
    }
    params[spec.key] = value;
  }
  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, params };
}

export function sameParams(kind: AdminAlertKind, a: AdminAlertRuleParams, b: AdminAlertRuleParams): boolean {
  return RULE_PARAM_SPECS[kind].every((spec) => a[spec.key] === b[spec.key]);
}

/** «A partir de 5 cancelaciones en 1 h» · «Si una propuesta lleva más de 30 min sin respuesta». */
export function ruleSummary(rule: Pick<AdminAlertRule, "kind" | "params">): string {
  const { kind, params } = rule;
  switch (kind) {
    case "unusual_cancellations":
      return `A partir de ${pluralize(params.thresholdCount ?? 0, "cancelación", "cancelaciones")} en ${formatDuration(params.windowMinutes ?? 0)}`;
    case "route_incidents":
      return `A partir de ${pluralize(params.thresholdCount ?? 0, "incidencia", "incidencias")} en ${formatDuration(params.windowMinutes ?? 0)}`;
    case "schedule_price_changes":
      return `Si una propuesta lleva más de ${formatDuration(params.maxPendingMinutes ?? 0)} sin respuesta`;
  }
}

/** Cambio de una regla: interruptor y/o parámetros. */
export function ruleUpdate(
  kind: AdminAlertKind,
  change: { enabled?: boolean; params?: AdminAlertRuleParams },
): AdminOperationsUpdate {
  const entry: { kind: AdminAlertKind; enabled?: boolean; params?: AdminAlertRuleParams } = { kind };
  if (change.enabled !== undefined) entry.enabled = change.enabled;
  if (change.params !== undefined) entry.params = change.params;
  return { rules: [entry] };
}

/** Cuántas reglas están activas, para el resumen «2 de 3 reglas activas». */
export function activeRuleCount(rules: readonly AdminAlertRule[]): number {
  return rules.filter((rule) => rule.enabled).length;
}

/** `5 min` con espacio de no separación. */
export function minutesText(minutes: number): string {
  return `${minutes}${NBSP}min`;
}
