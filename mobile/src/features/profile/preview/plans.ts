/**
 * Planes (pantalla 32) en el backend en memoria de la vista previa. Mismos textos que la migración `045_money_plans.sql`.
 * NO existe compra: el plan gratuito es el único activo, Premium Conductor es una «Propuesta» y la Membresía no está
 * disponible. `GET /v1/plans` · `GET /v1/me/plan`.
 */
import type { MyPlanResponse, PlanView, PlansResponse } from "@/api/types";
import { moneyDefined, moneyPending } from "@/preview";
import type { PreviewDb, PreviewRouter } from "@/preview";

export function planCatalog(): PlanView[] {
  return [
    {
      code: "free",
      name: "Cuenta gratuita",
      tagline: "Uso ocasional",
      status: "active",
      features: ["Buscar y reservar plazas", "Guardar destinos y rutina", "Mensajería con otros usuarios", "Gestionar tus viajes básicos"],
      economicsNote: null,
      availabilityNote: null,
      price: moneyDefined(0),
    },
    {
      code: "premium_driver",
      name: "Premium Conductor",
      tagline: "Para rutas regulares",
      status: "proposal",
      features: ["Gestionar tus plazas semanales", "Visibilidad en rutas frecuentes", "Historial de viajes y pasajeros", "Liquidación mensual de trayectos", "Soporte prioritario"],
      economicsNote: { title: "Cuota y comisiones por definir", detail: "Propuesta en fase de estudio." },
      availabilityNote: null,
      price: moneyPending(),
    },
    {
      code: "membership",
      name: "Membresía",
      tagline: "Próximamente",
      status: "unavailable",
      features: [],
      economicsNote: null,
      availabilityNote: "Más opciones y ventajas para usuarios frecuentes. Esta funcionalidad no está disponible por el momento.",
      price: moneyPending(),
    },
  ];
}

export function registerPlansPreview(r: PreviewRouter, _db: PreviewDb): void {
  r.get("/v1/plans", { summary: "Planes de MVC", tags: ["money"] }, (): PlansResponse => ({ items: planCatalog() }));
  r.get("/v1/me/plan", { summary: "Mi plan", tags: ["money"] }, (req): MyPlanResponse => {
    req.auth();
    return { planCode: "free", status: "active", purchasable: false };
  });
}
