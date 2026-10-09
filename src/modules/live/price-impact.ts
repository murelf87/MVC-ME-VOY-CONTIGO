import { contributionForRoadDistance, roundHalfUp } from "../../domain/money.js";
import { moneyDefined, moneyPending, type MoneyDto } from "../../lib/dto.js";
import type { Db } from "./common.js";

/**
 * Impacto de precio de un cambio de ruta sobre UNA reserva. Reglas:
 *  - Solo varía por kilómetros reales por carretera entre la recogida y el destino del pasajero (motor de dinero, céntimos enteros).
 *  - El tráfico (duración) NUNCA entra aquí. No existe recargo por molestias.
 *  - Sin presupuesto (`quote_snapshots`) con una tarifa aprobada/retirada completa (km + comisión de pasajero), el importe es
 *    `pending_definition`: este módulo jamás inventa un precio.
 *  - Se recalcula con la MISMA tarifa del presupuesto aceptado y la MISMA fórmula que `trips/quote-service.ts`
 *    (aportación por km con tope `shared_cost_cap_cents` + comisión de pasajero en puntos básicos sobre la aportación):
 *    el total «después» = total acordado + (total(km después) − total(km antes)).
 */
export type PricingBasis = {
  agreedTotalCents: number;
  rateMicrosPerKm: number;
  passengerCommissionBps: number;
  sharedCostCapCents: number | null;
};

export type PriceImpact = {
  status: "defined" | "pending_definition";
  beforeCents: number | null;
  afterCents: number | null;
  deltaCents: number | null;
  before: MoneyDto;
  after: MoneyDto;
  delta: MoneyDto;
  changed: boolean;
  /** Cualquier variación de precio es material (hay que aceptarla). */
  material: boolean;
};

export async function loadPricingBasis(db: Db, requestId: string): Promise<PricingBasis | null> {
  const result = await db.query<{
    passenger_total_cents: number;
    rate_micros_per_km: number | null;
    passenger_commission_bps: number | null;
    shared_cost_cap_cents: number | null;
    tariff_status: string | null;
  }>(
    `select q.passenger_total_cents, tv.rate_micros_per_km, tv.passenger_commission_bps, tv.shared_cost_cap_cents,
            tv.status as tariff_status
       from quote_snapshots q
       left join tariff_versions tv on tv.id=q.tariff_version_id
      where q.request_id=$1
      order by q.created_at desc
      limit 1`,
    [requestId]
  );
  const row = result.rows[0];
  if (!row || row.rate_micros_per_km === null || row.passenger_commission_bps === null) return null;
  if (row.tariff_status !== "approved" && row.tariff_status !== "retired") return null;
  return {
    agreedTotalCents: row.passenger_total_cents,
    rateMicrosPerKm: row.rate_micros_per_km,
    passengerCommissionBps: row.passenger_commission_bps,
    sharedCostCapCents: row.shared_cost_cap_cents
  };
}

/** Total del trayecto (aportación + comisión de pasajero) para una distancia por carretera. */
export function totalForDistance(basis: PricingBasis, distanceM: number): number {
  let contribution = contributionForRoadDistance(Math.max(0, Math.round(distanceM)), basis.rateMicrosPerKm);
  if (basis.sharedCostCapCents !== null) contribution = Math.min(contribution, basis.sharedCostCapCents);
  const fee = Number(roundHalfUp(BigInt(contribution) * BigInt(basis.passengerCommissionBps), 10_000n));
  return contribution + fee;
}

export function computePriceImpact(
  basis: PricingBasis | null,
  distanceBeforeM: number,
  distanceAfterM: number
): PriceImpact {
  if (!basis) {
    return {
      status: "pending_definition",
      beforeCents: null, afterCents: null, deltaCents: null,
      before: moneyPending(), after: moneyPending(), delta: moneyPending(),
      changed: false, material: false
    };
  }
  const delta = totalForDistance(basis, distanceAfterM) - totalForDistance(basis, distanceBeforeM);
  const afterCents = Math.max(0, basis.agreedTotalCents + delta);
  return {
    status: "defined",
    beforeCents: basis.agreedTotalCents,
    afterCents,
    deltaCents: afterCents - basis.agreedTotalCents,
    before: moneyDefined(basis.agreedTotalCents),
    after: moneyDefined(afterCents),
    delta: moneyDefined(afterCents - basis.agreedTotalCents),
    changed: afterCents !== basis.agreedTotalCents,
    material: afterCents !== basis.agreedTotalCents
  };
}
