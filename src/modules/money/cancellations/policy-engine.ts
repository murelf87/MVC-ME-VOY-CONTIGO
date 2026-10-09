import type { Queryable } from "../lib/db.js";
import { toIso } from "../lib/db.js";
import type { PaymentBreakdown } from "../ledger/ledger-service.js";
import type { CancellationPolicyRefDto } from "../types.js";

/**
 * Motor de política de cancelación VERSIONADA (tabla `cancellation_policies`).
 *
 * HOY NO EXISTE NINGUNA POLÍTICA APROBADA (decisión jurídica/comercial pendiente): `evaluatePolicy` devuelve siempre
 * `pending_review` y los importes derivados son «Por definir». El motor no contiene ninguna regla de negocio embebida:
 * toda retención (incluida la de la comisión de MVC) es un DATO de una política aprobada (`refundCommissionBps < 10000`),
 * nunca una constante del código. Nunca se afirma «MVC se queda con su comisión» como regla absoluta.
 *
 * El pago guarda la política vigente al pagar (`payments.cancellation_policy_id`): es la que el usuario aceptó. Si era NULL,
 * la cancelación posterior se trata siempre como `pending_review`, aunque después se apruebe una política.
 */
export type PolicyScenario = "passenger_cancellation";

export type PolicyRule = {
  scenario: PolicyScenario;
  /** La regla aplica si faltan al menos estas horas para la salida. Se elige la regla aplicable con mayor umbral. */
  minHoursBeforeDeparture: number;
  refundContributionBps: number;
  refundCommissionBps: number;
  refundProcessingBps: number;
  refundTaxesBps: number;
};

export type LoadedPolicy = {
  id: string;
  version: number;
  status: "approved" | "retired";
  effectiveFrom: Date | string | null;
  summary: string | null;
  rules: PolicyRule[];
};

const isBps = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 10_000;

/** Reglas mal formadas se descartan (la política deja de cubrir ese caso y la propuesta queda en revisión). */
export function parseRules(value: unknown): PolicyRule[] {
  if (!Array.isArray(value)) return [];
  const rules: PolicyRule[] = [];
  for (const item of value) {
    const rule = item as Record<string, unknown> | null;
    if (!rule || typeof rule !== "object") continue;
    if (rule.scenario !== "passenger_cancellation") continue;
    const hours = rule.minHoursBeforeDeparture;
    if (typeof hours !== "number" || !Number.isFinite(hours) || hours < 0) continue;
    if (
      !isBps(rule.refundContributionBps) ||
      !isBps(rule.refundCommissionBps) ||
      !isBps(rule.refundProcessingBps) ||
      !isBps(rule.refundTaxesBps)
    ) {
      continue;
    }
    rules.push({
      scenario: "passenger_cancellation",
      minHoursBeforeDeparture: hours,
      refundContributionBps: rule.refundContributionBps,
      refundCommissionBps: rule.refundCommissionBps,
      refundProcessingBps: rule.refundProcessingBps,
      refundTaxesBps: rule.refundTaxesBps
    });
  }
  return rules;
}

/** Redondeo a favor de la persona consumidora: ceil(cents × bps / 10000), nunca más que `cents`. */
export function refundShare(cents: number, bps: number): number {
  if (bps >= 10_000) return cents;
  return Math.min(cents, Math.floor((cents * bps + 9_999) / 10_000));
}

export type PolicyOutcome =
  | { kind: "pending_review" }
  | {
      kind: "applied";
      policy: LoadedPolicy;
      rule: PolicyRule;
      refund: { contributionCents: number; commissionCents: number; processingCents: number; taxesCents: number; totalCents: number };
      /** Comisión de MVC (la del pasajero) que NO se devuelve según la regla. */
      retainedCommissionCents: number;
    };

export function evaluatePolicy(
  policy: LoadedPolicy | null,
  breakdown: PaymentBreakdown | null,
  hoursBeforeDeparture: number | null,
  scenario: PolicyScenario
): PolicyOutcome {
  if (!policy || !breakdown || hoursBeforeDeparture === null) return { kind: "pending_review" };
  const applicable = policy.rules
    .filter(rule => rule.scenario === scenario && hoursBeforeDeparture >= rule.minHoursBeforeDeparture)
    .sort((a, b) => b.minHoursBeforeDeparture - a.minHoursBeforeDeparture)[0];
  // Una política que no cubre el caso NO decide nada: queda en revisión humana.
  if (!applicable) return { kind: "pending_review" };
  const contributionCents = refundShare(breakdown.contributionCents, applicable.refundContributionBps);
  const commissionCents = refundShare(breakdown.passengerCommissionCents, applicable.refundCommissionBps);
  const processingCents = refundShare(breakdown.processingCents, applicable.refundProcessingBps);
  const taxesCents = refundShare(breakdown.taxesCents, applicable.refundTaxesBps);
  return {
    kind: "applied",
    policy,
    rule: applicable,
    refund: {
      contributionCents,
      commissionCents,
      processingCents,
      taxesCents,
      totalCents: contributionCents + commissionCents + processingCents + taxesCents
    },
    retainedCommissionCents: breakdown.passengerCommissionCents - commissionCents
  };
}

/** Política que el usuario aceptó al pagar (la fila puede haber sido retirada después: sigue aplicando). */
export async function loadAcceptedPolicy(db: Queryable, policyId: string | null): Promise<LoadedPolicy | null> {
  if (!policyId) return null;
  const result = await db.query<{
    id: string;
    version: number;
    status: "approved" | "retired";
    effective_from: Date | string | null;
    summary: string | null;
    rules: unknown;
  }>(
    `select id,version,status,effective_from,summary,rules
       from cancellation_policies where id=$1 and status in ('approved','retired')`,
    [policyId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    effectiveFrom: row.effective_from,
    summary: row.summary,
    rules: parseRules(row.rules)
  };
}

export function policyRef(outcome: PolicyOutcome): CancellationPolicyRefDto {
  if (outcome.kind === "applied") {
    return {
      status: "approved",
      version: outcome.policy.version,
      effectiveFrom: toIso(outcome.policy.effectiveFrom),
      summary: outcome.policy.summary
    };
  }
  return { status: "pending_review", version: null, effectiveFrom: null, summary: null };
}
