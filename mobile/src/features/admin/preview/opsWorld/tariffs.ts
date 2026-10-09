/**
 * Tarifas (pantalla 40): borrador de trabajo, ejemplo de aportación sin guardar, historial y puerta de activación.
 * Espejo de `src/modules/trust/tariffs.ts`. Importes en céntimos enteros; la tarifa por km, en micro-euros.
 *
 * La activación está BLOQUEADA por `ECONOMICS_ACTIVATION` (ajuste `trust.economicsActivation`, por defecto `disabled`):
 * publicar responde `409 ECONOMICS_ACTIVATION_DISABLED` ANTES de validar nada y deja el intento auditado.
 */
import type {
  AdminTariffDraftInput,
  AdminTariffExample,
  AdminTariffExampleRequest,
  AdminTariffOverview,
  AdminTariffPublishRequest,
  AdminTariffStatus,
  AdminTariffVersion,
} from "@/api/types";
import { fail, moneyIllustrative, moneyPending, writeAudit, type PreviewDb } from "@/preview";
import { actorRef, iso, isoOrNull, roundHalfUp, UUID_RE } from "./common";

export interface TariffRow {
  id: string;
  version: number;
  status: AdminTariffStatus;
  rate_micros_per_km: number | null;
  passenger_commission_bps: number | null;
  driver_commission_bps: number | null;
  shared_cost_cap_cents: number | null;
  premium_monthly_cents: number | null;
  effective_from: number | null;
  notes: string | null;
  approval_reference: string | null;
  created_at: number;
  updated_at: number;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  approved_by_user_id: string | null;
  approved_at: number | null;
  retired_at: number | null;
}

export const tariffsTable = (db: PreviewDb) => db.collection<TariffRow>("trust_tariff_versions");

/** Ajuste de la simulación: `ECONOMICS_ACTIVATION` (`disabled` por defecto, que es el estado real de hoy). */
export const ECONOMICS_SETTING = "trust.economicsActivation";

export function economicsMode(db: PreviewDb): "disabled" | "enabled" {
  return db.getSetting<string>(ECONOMICS_SETTING) === "enabled" ? "enabled" : "disabled";
}

export const MAX_RATE_MICROS_PER_KM = 5_000_000;
export const MAX_BPS = 10_000;
export const MAX_CENTS_FIELD = 1_000_000;
const MAX_EXAMPLE_DISTANCE_M = 2_000_000;

export const APPLY_NOTE = "Los cambios de tarifas afectan solo a futuras reservas. No se modifican reservas confirmadas.";
export const AUDIT_NOTE = "Registro en auditoría privada de MVC";

const ACTIVATION_MESSAGE: Record<"disabled" | "enabled", string> = {
  disabled: "La activación de tarifas está desactivada hasta que exista una decisión económica aprobada.",
  enabled: "La activación de tarifas está habilitada: publicar exige referencia de aprobación y una fecha de entrada en vigor futura.",
};

export function toTariffVersion(db: PreviewDb, row: TariffRow): AdminTariffVersion {
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    ratePerKmMicros: row.rate_micros_per_km,
    passengerCommissionBps: row.passenger_commission_bps,
    driverCommissionBps: row.driver_commission_bps,
    sharedCostCapCents: row.shared_cost_cap_cents,
    premiumMonthlyCents: row.premium_monthly_cents,
    effectiveFrom: isoOrNull(row.effective_from),
    notes: row.notes,
    approvalReference: row.approval_reference,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    createdBy: actorRef(db, row.created_by_user_id),
    updatedBy: actorRef(db, row.updated_by_user_id),
  };
}

function byVersionDesc(rows: readonly TariffRow[]): TariffRow[] {
  return [...rows].sort((a, b) => b.version - a.version);
}

export function getTariffOverview(db: PreviewDb): AdminTariffOverview {
  const now = db.nowMs();
  const rows = tariffsTable(db).all();
  const active = [...rows]
    .filter((row) => row.status === "approved" && row.effective_from !== null && row.effective_from <= now)
    .sort((a, b) => (b.effective_from ?? 0) - (a.effective_from ?? 0) || b.version - a.version)[0];
  const draft = byVersionDesc(rows.filter((row) => row.status === "draft"))[0];
  const mode = economicsMode(db);
  return {
    active: active === undefined ? null : toTariffVersion(db, active),
    draft: draft === undefined ? null : toTariffVersion(db, draft),
    activation: { mode, canPublish: mode === "enabled", message: ACTIVATION_MESSAGE[mode] },
    applyNote: APPLY_NOTE,
    auditNote: AUDIT_NOTE,
  };
}

export function listTariffVersions(db: PreviewDb): AdminTariffVersion[] {
  return byVersionDesc(tariffsTable(db).all()).map((row) => toTariffVersion(db, row));
}

interface FieldError {
  field: string;
  message: string;
}

function intInRange(value: number | null | undefined, max: number): boolean {
  return value === null || value === undefined || (Number.isSafeInteger(value) && value >= 0 && value <= max);
}

export function validateDraft(input: AdminTariffDraftInput): FieldError[] {
  const errors: FieldError[] = [];
  if (!intInRange(input.ratePerKmMicros, MAX_RATE_MICROS_PER_KM)) errors.push({ field: "ratePerKmMicros", message: `entero entre 0 y ${MAX_RATE_MICROS_PER_KM} (micro-euros por km)` });
  if (!intInRange(input.passengerCommissionBps, MAX_BPS)) errors.push({ field: "passengerCommissionBps", message: "entero entre 0 y 10000 (puntos básicos)" });
  if (!intInRange(input.driverCommissionBps, MAX_BPS)) errors.push({ field: "driverCommissionBps", message: "entero entre 0 y 10000 (puntos básicos)" });
  if (!intInRange(input.premiumMonthlyCents, MAX_CENTS_FIELD)) errors.push({ field: "premiumMonthlyCents", message: `entero entre 0 y ${MAX_CENTS_FIELD} (céntimos al mes)` });
  if (!intInRange(input.sharedCostCapCents, MAX_CENTS_FIELD)) errors.push({ field: "sharedCostCapCents", message: `entero entre 0 y ${MAX_CENTS_FIELD} (céntimos)` });
  if (input.notes !== null && input.notes !== undefined && input.notes.trim().length > 1000) errors.push({ field: "notes", message: "como máximo 1000 caracteres" });
  return errors;
}

/**
 * Crea el borrador (versión = máx+1) o actualiza el ÚNICO borrador de trabajo. Nunca toca reservas ni tarifas aprobadas
 * y nunca activa nada: un borrador no es una tarifa en vigor. Devuelve la versión guardada.
 */
export function saveTariffDraft(db: PreviewDb, actorUserId: string, input: AdminTariffDraftInput, requestId: string): AdminTariffVersion {
  const errors = validateDraft(input);
  if (errors.length > 0) fail("TARIFF_INVALID", "Los valores de la tarifa no son válidos.", 422, { fields: errors });
  const notes = input.notes !== null && input.notes !== undefined && input.notes.trim() !== "" ? input.notes.trim() : null;
  const now = db.nowMs();
  return db.tx(() => {
    const table = tariffsTable(db);
    const existing = byVersionDesc(table.filter((row) => row.status === "draft"))[0];
    const patch = {
      rate_micros_per_km: input.ratePerKmMicros,
      passenger_commission_bps: input.passengerCommissionBps,
      driver_commission_bps: input.driverCommissionBps,
      shared_cost_cap_cents: input.sharedCostCapCents ?? null,
      premium_monthly_cents: input.premiumMonthlyCents,
      notes,
      updated_by_user_id: actorUserId,
      updated_at: now,
    };
    let saved: Readonly<TariffRow>;
    let created = false;
    if (existing !== undefined) {
      saved = table.update(existing.id, patch);
    } else {
      created = true;
      const next = table.all().reduce((max, row) => Math.max(max, row.version), 0) + 1;
      saved = table.insert({
        id: db.ids.uuid(),
        version: next,
        status: "draft",
        effective_from: null,
        approval_reference: null,
        created_at: now,
        created_by_user_id: actorUserId,
        approved_by_user_id: null,
        approved_at: null,
        retired_at: null,
        ...patch,
      });
    }
    writeAudit(db, {
      actorUserId,
      action: "admin.tariff_draft.saved",
      entityType: "tariff_version",
      entityId: saved.id,
      requestId,
      metadata: {
        version: saved.version,
        created,
        ratePerKmMicros: input.ratePerKmMicros,
        passengerCommissionBps: input.passengerCommissionBps,
        driverCommissionBps: input.driverCommissionBps,
        premiumMonthlyCents: input.premiumMonthlyCents,
        sharedCostCapCents: input.sharedCostCapCents ?? null,
      },
    });
    return toTariffVersion(db, saved);
  });
}

/** Cálculo de ejemplo SIN guardar. Importes `illustrative` (texto «Ejemplo») o `pending_definition` si falta un dato. */
export function computeTariffExample(input: Required<Pick<AdminTariffExampleRequest, "distanceMeters">> & {
  ratePerKmMicros: number | null;
  passengerCommissionBps: number | null;
  driverCommissionBps: number | null;
}): AdminTariffExample {
  const errors: FieldError[] = [];
  if (!Number.isSafeInteger(input.distanceMeters) || input.distanceMeters < 1 || input.distanceMeters > MAX_EXAMPLE_DISTANCE_M) {
    errors.push({ field: "distanceMeters", message: `entero entre 1 y ${MAX_EXAMPLE_DISTANCE_M} (metros)` });
  }
  if (!intInRange(input.ratePerKmMicros, MAX_RATE_MICROS_PER_KM)) errors.push({ field: "ratePerKmMicros", message: `entero entre 0 y ${MAX_RATE_MICROS_PER_KM}` });
  if (!intInRange(input.passengerCommissionBps, MAX_BPS)) errors.push({ field: "passengerCommissionBps", message: "entero entre 0 y 10000" });
  if (!intInRange(input.driverCommissionBps, MAX_BPS)) errors.push({ field: "driverCommissionBps", message: "entero entre 0 y 10000" });
  if (errors.length > 0) fail("TARIFF_INVALID", "Los valores del ejemplo no son válidos.", 422, { fields: errors });

  const pending = moneyPending();
  // euros = metros/1000 × micro-euros/1 000 000 → céntimos = metros × tarifa / 10 000 000
  const contributionCents = input.ratePerKmMicros === null ? null : roundHalfUp(input.distanceMeters * input.ratePerKmMicros, 10_000_000);
  const commissionOf = (bps: number | null): number | null =>
    contributionCents === null || bps === null ? null : roundHalfUp(contributionCents * bps, 10_000);
  const passengerCents = commissionOf(input.passengerCommissionBps);
  const driverCents = commissionOf(input.driverCommissionBps);
  return {
    distanceMeters: input.distanceMeters,
    ratePerKmMicros: input.ratePerKmMicros,
    contribution: contributionCents === null ? pending : moneyIllustrative(contributionCents),
    passengerCommission: passengerCents === null ? pending : moneyIllustrative(passengerCents),
    driverCommission: driverCents === null ? pending : moneyIllustrative(driverCents),
    passengerTotal: contributionCents !== null && passengerCents !== null ? moneyIllustrative(contributionCents + passengerCents) : pending,
    driverNet: contributionCents !== null && driverCents !== null ? moneyIllustrative(contributionCents - driverCents) : pending,
    disclaimer: "Antes de gestión y del límite de gastos compartidos.",
    roundingRule: "half_up_cents",
  };
}

/**
 * Publicar una tarifa. PUERTA DURA: con `ECONOMICS_ACTIVATION=disabled` (valor por defecto) responde 409 y NO modifica nada;
 * el intento queda auditado (aunque el identificador o el cuerpo sean inválidos). Solo con `enabled`, `approvalReference`
 * y una fecha futura se marca la versión como `approved`; no retira versiones anteriores ni toca reservas confirmadas
 * (la tarifa vigente es la aprobada con mayor `effectiveFrom` ya alcanzado).
 */
export function publishTariffVersion(
  db: PreviewDb,
  actorUserId: string,
  versionId: string,
  input: Partial<AdminTariffPublishRequest>,
  requestId: string,
): AdminTariffVersion {
  const mode = economicsMode(db);
  if (mode !== "enabled") {
    writeAudit(db, {
      actorUserId,
      action: "admin.tariff.publish_attempted",
      entityType: "tariff_version",
      entityId: UUID_RE.test(versionId) ? versionId : null,
      requestId,
      metadata: { blocked: true, reason: "ECONOMICS_ACTIVATION_DISABLED", mode },
    });
    return fail(
      "ECONOMICS_ACTIVATION_DISABLED",
      "La activación de tarifas está desactivada: no existe una decisión económica aprobada. No se ha modificado nada.",
      409,
    );
  }
  const reference = (input.approvalReference ?? "").trim();
  if (reference.length < 3) return fail("APPROVAL_REFERENCE_REQUIRED", "Indica la referencia de la decisión económica aprobada.", 422);
  const effectiveFromMs = Date.parse(input.effectiveFrom ?? "");
  if (Number.isNaN(effectiveFromMs) || effectiveFromMs <= db.nowMs()) {
    return fail("TARIFF_EFFECTIVE_FROM_INVALID", "La fecha de entrada en vigor debe ser futura.", 422);
  }
  if (!UUID_RE.test(versionId)) return fail("TARIFF_NOT_FOUND", "No existe esa versión de tarifa.", 404);
  return db.tx(() => {
    const table = tariffsTable(db);
    const row = table.get(versionId);
    if (row === undefined) return fail("TARIFF_NOT_FOUND", "No existe esa versión de tarifa.", 404);
    if (row.status !== "draft") return fail("TARIFF_NOT_DRAFT", "Solo se puede publicar un borrador.", 409);
    const missing: string[] = [];
    if (row.rate_micros_per_km === null) missing.push("ratePerKmMicros");
    if (row.passenger_commission_bps === null) missing.push("passengerCommissionBps");
    if (row.driver_commission_bps === null) missing.push("driverCommissionBps");
    if (missing.length > 0) return fail("TARIFF_DRAFT_INCOMPLETE", "El borrador no está completo: faltan valores por definir.", 422, { missing });
    const now = db.nowMs();
    const updated = table.update(versionId, {
      status: "approved",
      effective_from: effectiveFromMs,
      approval_reference: reference,
      approved_by_user_id: actorUserId,
      approved_at: now,
      updated_by_user_id: actorUserId,
      updated_at: now,
    });
    writeAudit(db, {
      actorUserId,
      action: "admin.tariff.published",
      entityType: "tariff_version",
      entityId: versionId,
      requestId,
      metadata: { version: row.version, effectiveFrom: iso(effectiveFromMs), approvalReference: reference },
    });
    return toTariffVersion(db, updated);
  });
}
