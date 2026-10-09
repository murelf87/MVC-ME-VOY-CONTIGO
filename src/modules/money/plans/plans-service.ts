import type { Pool } from "pg";
import type { MoneyDto } from "../../../lib/dto.js";
import { moneyPending } from "../../../lib/dto.js";
import { centsToMoney } from "../lib/people.js";

export type PlanCode = "free" | "premium_driver" | "membership";
export type PlanStatus = "active" | "proposal" | "unavailable";

export interface PlanViewDto {
  code: PlanCode;
  name: string;
  tagline: string;
  status: PlanStatus;
  features: string[];
  economicsNote: { title: string; detail: string } | null;
  availabilityNote: string | null;
  price: MoneyDto;
}

export interface MyPlanDto {
  planCode: PlanCode;
  status: "active";
  purchasable: false;
}

type PlanRow = {
  code: PlanCode;
  name: string;
  tagline: string;
  status: PlanStatus;
  features: unknown;
  economics_title: string | null;
  economics_detail: string | null;
  availability_note: string | null;
  price_cents: number | null;
};

/**
 * Catálogo de planes (pantalla 32). NO existe compra: el plan gratuito es el único activo, Premium Conductor es una
 * «Propuesta» (cuota y comisiones por definir) y la Membresía «no está disponible por el momento».
 */
export async function listPlans(pool: Pool): Promise<PlanViewDto[]> {
  const result = await pool.query<PlanRow>(
    `select code,name,tagline,status,features,economics_title,economics_detail,availability_note,price_cents
       from plans order by position`
  );
  return result.rows.map(row => ({
    code: row.code,
    name: row.name,
    tagline: row.tagline,
    status: row.status,
    features: Array.isArray(row.features) ? row.features.filter((f): f is string => typeof f === "string") : [],
    economicsNote:
      row.economics_title && row.economics_detail ? { title: row.economics_title, detail: row.economics_detail } : null,
    availabilityNote: row.availability_note,
    price: row.price_cents === null ? moneyPending() : centsToMoney(row.price_cents)
  }));
}

/** Todas las cuentas están en el plan gratuito: no hay forma de contratar otro mientras no se apruebe una oferta. */
export function getMyPlan(): MyPlanDto {
  return { planCode: "free", status: "active", purchasable: false };
}
