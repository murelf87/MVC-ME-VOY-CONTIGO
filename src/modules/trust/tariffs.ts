import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { buildBreakdown, contributionForRoadDistance, roundHalfUp } from "../../domain/money.js";
import { moneyPending } from "../../lib/dto.js";
import { UUID_RE, clampLimit, decodeCursor, encodeCursor, iso, isoOrNull, moneyIllustrative, sliceOverflow, trustError } from "./common.js";
import type { Db, TrustContext } from "./context.js";

/* Límites de validación de borradores (la UI «Por definir» = null). */
export const MAX_RATE_MICROS_PER_KM = 5_000_000; // 5 €/km
export const MAX_BPS = 10_000;
export const MAX_CENTS_FIELD = 1_000_000;
const MAX_EXAMPLE_DISTANCE_M = 2_000_000;

type TariffRow = {
  id: string;
  version: number;
  status: "draft" | "approved" | "retired";
  rate_micros_per_km: number | null;
  passenger_commission_bps: number | null;
  driver_commission_bps: number | null;
  shared_cost_cap_cents: number | null;
  premium_monthly_cents: number | null;
  effective_from: Date | null;
  notes: string | null;
  approval_reference: string | null;
  created_at: Date;
  updated_at: Date;
  created_by_user_id: string | null;
  updated_by_user_id: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
};

const SELECT = `
  select tv.id, tv.version, tv.status::text as status, tv.rate_micros_per_km, tv.passenger_commission_bps, tv.driver_commission_bps,
         tv.shared_cost_cap_cents, tv.premium_monthly_cents, tv.effective_from, tv.notes, tv.approval_reference,
         tv.created_at, tv.updated_at, tv.created_by_user_id, tv.updated_by_user_id,
         cp.display_name as created_by_name, up.display_name as updated_by_name
    from tariff_versions tv
    left join profiles cp on cp.user_id = tv.created_by_user_id
    left join profiles up on up.user_id = tv.updated_by_user_id`;

export function toTariffVersion(row: TariffRow) {
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
    createdBy: row.created_by_user_id ? { id: row.created_by_user_id, displayName: row.created_by_name } : null,
    updatedBy: row.updated_by_user_id ? { id: row.updated_by_user_id, displayName: row.updated_by_name } : null
  };
}

const ACTIVATION_MESSAGE: Record<"disabled" | "enabled", string> = {
  disabled: "La activación de tarifas está desactivada hasta que exista una decisión económica aprobada.",
  enabled: "La activación de tarifas está habilitada: publicar exige referencia de aprobación y una fecha de entrada en vigor futura."
};

export async function getTariffOverview(ctx: TrustContext) {
  const [active, draft] = await Promise.all([
    ctx.pool.query<TariffRow>(
      `${SELECT} where tv.status = 'approved' and tv.effective_from is not null and tv.effective_from <= now()
        order by tv.effective_from desc, tv.version desc limit 1`
    ),
    ctx.pool.query<TariffRow>(`${SELECT} where tv.status = 'draft' order by tv.version desc limit 1`)
  ]);
  const mode = ctx.config.economicsActivation;
  return {
    active: active.rows[0] ? toTariffVersion(active.rows[0]) : null,
    draft: draft.rows[0] ? toTariffVersion(draft.rows[0]) : null,
    activation: { mode, canPublish: mode === "enabled", message: ACTIVATION_MESSAGE[mode] },
    applyNote: "Los cambios de tarifas afectan solo a futuras reservas. No se modifican reservas confirmadas.",
    auditNote: "Registro en auditoría privada de MVC"
  };
}

export async function listTariffVersions(db: Db, input: { cursor?: string | undefined; limit?: number | undefined }) {
  const limit = clampLimit(input.limit);
  const params: unknown[] = [];
  let keyset = "";
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, { v: "number" });
    params.push(Number(cursor.v));
    keyset = `where tv.version < $1`;
  }
  const rows = await db.query<TariffRow>(`${SELECT} ${keyset} order by tv.version desc limit ${limit + 1}`, params);
  const { page, hasMore } = sliceOverflow(rows.rows, limit);
  const last = page[page.length - 1];
  return { items: page.map(toTariffVersion), nextCursor: hasMore && last ? encodeCursor({ v: last.version }) : null };
}

type DraftInput = {
  ratePerKmMicros: number | null;
  passengerCommissionBps: number | null;
  driverCommissionBps: number | null;
  premiumMonthlyCents: number | null;
  sharedCostCapCents?: number | null | undefined;
  notes?: string | null | undefined;
};

type FieldError = { field: string; message: string };

function intInRange(value: number | null | undefined, max: number): boolean {
  return value === null || value === undefined || (Number.isSafeInteger(value) && value >= 0 && value <= max);
}

export function validateDraft(input: DraftInput): FieldError[] {
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
 * y nunca activa nada: un borrador no es una tarifa en vigor.
 */
export async function saveTariffDraft(ctx: TrustContext, principal: AuthPrincipal, input: DraftInput, requestId: string) {
  const errors = validateDraft(input);
  if (errors.length > 0) throw trustError("TARIFF_INVALID", "Los valores de la tarifa no son válidos.", 422, { fields: errors });
  const notes = input.notes?.trim() ? input.notes.trim() : null;
  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    await client.query(`select pg_advisory_xact_lock(hashtext('trust_tariff_draft'))`);
    const existing = await client.query<{ id: string; version: number }>(
      `select id, version from tariff_versions where status = 'draft' order by version desc limit 1 for update`
    );
    let id: string;
    let version: number;
    let created = false;
    const values = [
      input.ratePerKmMicros,
      input.passengerCommissionBps,
      input.driverCommissionBps,
      input.sharedCostCapCents ?? null,
      input.premiumMonthlyCents,
      notes
    ];
    if (existing.rows[0]) {
      id = existing.rows[0].id;
      version = existing.rows[0].version;
      await client.query(
        `update tariff_versions
            set rate_micros_per_km = $2, passenger_commission_bps = $3, driver_commission_bps = $4,
                shared_cost_cap_cents = $5, premium_monthly_cents = $6, notes = $7,
                updated_by_user_id = $8, updated_at = now()
          where id = $1`,
        [id, ...values, principal.userId]
      );
    } else {
      const next = await client.query<{ next: number }>(`select coalesce(max(version), 0) + 1 as next from tariff_versions`);
      version = Number(next.rows[0]?.next ?? 1);
      const inserted = await client.query<{ id: string }>(
        `insert into tariff_versions(version, status, rate_micros_per_km, passenger_commission_bps, driver_commission_bps,
                                     shared_cost_cap_cents, premium_monthly_cents, notes, created_by_user_id, updated_by_user_id, updated_at)
         values($1,'draft',$2,$3,$4,$5,$6,$7,$8,$8,now()) returning id`,
        [version, ...values, principal.userId]
      );
      id = inserted.rows[0]!.id;
      created = true;
    }
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.tariff_draft.saved",
      entityType: "tariff_version",
      entityId: id,
      requestId,
      metadata: {
        version,
        created,
        ratePerKmMicros: input.ratePerKmMicros,
        passengerCommissionBps: input.passengerCommissionBps,
        driverCommissionBps: input.driverCommissionBps,
        premiumMonthlyCents: input.premiumMonthlyCents,
        sharedCostCapCents: input.sharedCostCapCents ?? null
      }
    });
    await client.query("commit");
    const row = await ctx.pool.query<TariffRow>(`${SELECT} where tv.id = $1`, [id]);
    return { created, version: toTariffVersion(row.rows[0]!) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

/** Cálculo de ejemplo SIN guardar. Importes `illustrative` (texto «Ejemplo») o `pending_definition` si falta un dato. */
export function computeTariffExample(input: {
  distanceMeters: number;
  ratePerKmMicros: number | null;
  passengerCommissionBps: number | null;
  driverCommissionBps: number | null;
}) {
  const errors: FieldError[] = [];
  if (!Number.isSafeInteger(input.distanceMeters) || input.distanceMeters < 1 || input.distanceMeters > MAX_EXAMPLE_DISTANCE_M) {
    errors.push({ field: "distanceMeters", message: `entero entre 1 y ${MAX_EXAMPLE_DISTANCE_M} (metros)` });
  }
  if (!intInRange(input.ratePerKmMicros, MAX_RATE_MICROS_PER_KM)) errors.push({ field: "ratePerKmMicros", message: `entero entre 0 y ${MAX_RATE_MICROS_PER_KM}` });
  if (!intInRange(input.passengerCommissionBps, MAX_BPS)) errors.push({ field: "passengerCommissionBps", message: "entero entre 0 y 10000" });
  if (!intInRange(input.driverCommissionBps, MAX_BPS)) errors.push({ field: "driverCommissionBps", message: "entero entre 0 y 10000" });
  if (errors.length > 0) throw trustError("TARIFF_INVALID", "Los valores del ejemplo no son válidos.", 422, { fields: errors });

  const pending = moneyPending();
  const contributionCents =
    input.ratePerKmMicros === null ? null : contributionForRoadDistance(input.distanceMeters, input.ratePerKmMicros);
  const bpsCents = (bps: number | null): number | null =>
    contributionCents === null || bps === null ? null : Number(roundHalfUp(BigInt(contributionCents) * BigInt(bps), 10_000n));
  const passengerCents = bpsCents(input.passengerCommissionBps);
  const driverCents = bpsCents(input.driverCommissionBps);
  const breakdown =
    contributionCents === null
      ? null
      : buildBreakdown({
          contributionCents,
          ...(passengerCents !== null ? { passengerCommissionCents: passengerCents } : {}),
          ...(driverCents !== null ? { driverCommissionCents: driverCents } : {})
        });
  return {
    distanceMeters: input.distanceMeters,
    ratePerKmMicros: input.ratePerKmMicros,
    contribution: contributionCents === null ? pending : moneyIllustrative(contributionCents),
    passengerCommission: passengerCents === null ? pending : moneyIllustrative(passengerCents),
    driverCommission: driverCents === null ? pending : moneyIllustrative(driverCents),
    passengerTotal: breakdown && passengerCents !== null ? moneyIllustrative(breakdown.passengerTotalCents) : pending,
    driverNet: breakdown && driverCents !== null ? moneyIllustrative(breakdown.driverNetCents) : pending,
    disclaimer: "Antes de gestión y del límite de gastos compartidos.",
    roundingRule: "half_up_cents" as const
  };
}

/**
 * Publicar una tarifa. PUERTA DURA: con `ECONOMICS_ACTIVATION=disabled` (valor por defecto) responde 409 y NO modifica nada;
 * el intento queda auditado. Solo con `enabled`, `approvalReference` y una fecha futura se marca la versión como `approved`.
 * No retira versiones anteriores ni toca reservas confirmadas (la tarifa vigente es la aprobada con mayor `effectiveFrom` ya alcanzado).
 */
export async function publishTariffVersion(
  ctx: TrustContext,
  principal: AuthPrincipal,
  versionId: string,
  input: { approvalReference: string; effectiveFrom: string },
  requestId: string
) {
  const mode = ctx.config.economicsActivation;
  if (mode !== "enabled") {
    await writeAudit(ctx.pool, {
      actorUserId: principal.userId,
      action: "admin.tariff.publish_attempted",
      entityType: "tariff_version",
      entityId: UUID_RE.test(versionId) ? versionId : null,
      requestId,
      metadata: { blocked: true, reason: "ECONOMICS_ACTIVATION_DISABLED", mode }
    });
    throw trustError(
      "ECONOMICS_ACTIVATION_DISABLED",
      "La activación de tarifas está desactivada: no existe una decisión económica aprobada. No se ha modificado nada.",
      409
    );
  }
  const reference = input.approvalReference.trim();
  if (reference.length < 3) {
    throw trustError("APPROVAL_REFERENCE_REQUIRED", "Indica la referencia de la decisión económica aprobada.", 422);
  }
  const effectiveFrom = new Date(input.effectiveFrom);
  if (Number.isNaN(effectiveFrom.getTime()) || effectiveFrom.getTime() <= ctx.now().getTime()) {
    throw trustError("TARIFF_EFFECTIVE_FROM_INVALID", "La fecha de entrada en vigor debe ser futura.", 422);
  }
  if (!UUID_RE.test(versionId)) throw trustError("TARIFF_NOT_FOUND", "No existe esa versión de tarifa.", 404);

  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    const found = await client.query<{
      id: string; version: number; status: string; rate_micros_per_km: number | null;
      passenger_commission_bps: number | null; driver_commission_bps: number | null;
    }>(
      `select id, version, status::text as status, rate_micros_per_km, passenger_commission_bps, driver_commission_bps
         from tariff_versions where id = $1 for update`,
      [versionId]
    );
    const row = found.rows[0];
    if (!row) throw trustError("TARIFF_NOT_FOUND", "No existe esa versión de tarifa.", 404);
    if (row.status !== "draft") throw trustError("TARIFF_NOT_DRAFT", "Solo se puede publicar un borrador.", 409);
    const missing: string[] = [];
    if (row.rate_micros_per_km === null) missing.push("ratePerKmMicros");
    if (row.passenger_commission_bps === null) missing.push("passengerCommissionBps");
    if (row.driver_commission_bps === null) missing.push("driverCommissionBps");
    if (missing.length > 0) {
      throw trustError("TARIFF_DRAFT_INCOMPLETE", "El borrador no está completo: faltan valores por definir.", 422, { missing });
    }
    await client.query(
      `update tariff_versions
          set status = 'approved', effective_from = $2, approval_reference = $3,
              approved_by_user_id = $4, approved_at = now(), updated_by_user_id = $4, updated_at = now()
        where id = $1`,
      [versionId, effectiveFrom.toISOString(), reference, principal.userId]
    );
    await writeAudit(client, {
      actorUserId: principal.userId,
      action: "admin.tariff.published",
      entityType: "tariff_version",
      entityId: versionId,
      requestId,
      metadata: { version: row.version, effectiveFrom: effectiveFrom.toISOString(), approvalReference: reference }
    });
    await client.query("commit");
    const result = await ctx.pool.query<TariffRow>(`${SELECT} where tv.id = $1`, [versionId]);
    return toTariffVersion(result.rows[0]!);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
