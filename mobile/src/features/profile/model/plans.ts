/**
 * «Planes MVC»: de `GET /v1/plans` y `GET /v1/me/plan` a las tarjetas de la lámina 32. Todo sale del servidor (nombre,
 * etiqueta, estado, funciones, notas); lo único que decide la app es el aspecto según el estado del plan. No existe
 * compra: ninguna tarjeta ofrece pagar.
 */
import type { IconName } from "@/icons";
import type { PlanCode, PlanStatus, PlanView } from "@/api/types";
import { profileStrings } from "../strings";

const copy = profileStrings.plans;

/** Aspecto de la tarjeta: activo (azul), en estudio (verde) o no disponible (gris, con candado). */
export type PlanLook = "active" | "proposal" | "unavailable";

export interface PlanCardView {
  code: PlanCode;
  look: PlanLook;
  icon: IconName;
  /** Nombre con el sufijo «(Propuesta)» de los planes no disponibles. */
  name: string;
  tagline: string;
  /** «Propuesta» junto al nombre (plan en estudio). */
  tag: string | null;
  /** Es el plan de la persona (visto verde). */
  current: boolean;
  /** Los planes no disponibles no listan funciones: solo su nota. */
  features: string[];
  economicsNote: { title: string; detail: string } | null;
  availabilityNote: string | null;
  a11yLabel: string;
}

const PLAN_ICON: Record<PlanCode, IconName> = {
  free: "person",
  premium_driver: "car",
  membership: "crown",
};

export function lookOf(status: PlanStatus): PlanLook {
  switch (status) {
    case "active":
      return "active";
    case "proposal":
      return "proposal";
    case "unavailable":
      return "unavailable";
  }
}

/** «Membresía» → «Membresía (Propuesta)» sin duplicar el sufijo si el servidor ya lo trae. */
export function withProposalSuffix(name: string): string {
  const trimmed = name.trim();
  return trimmed.toLowerCase().endsWith(copy.unavailableSuffix.toLowerCase()) ? trimmed : `${trimmed} ${copy.unavailableSuffix}`;
}

export function buildPlanCards(plans: readonly PlanView[], currentCode: PlanCode | null): PlanCardView[] {
  return plans.map((plan) => {
    const look = lookOf(plan.status);
    const name = look === "unavailable" ? withProposalSuffix(plan.name) : plan.name;
    const current = currentCode !== null && plan.code === currentCode;
    const tag = look === "proposal" ? copy.proposalTag : null;
    const features = look === "unavailable" ? [] : [...plan.features];
    const parts = [name, plan.tagline];
    if (current) parts.push(copy.currentPlan);
    if (tag !== null) parts.push(tag);
    if (plan.economicsNote !== null) parts.push(`${plan.economicsNote.title}. ${plan.economicsNote.detail}`);
    if (plan.availabilityNote !== null) parts.push(plan.availabilityNote);
    return {
      code: plan.code,
      look,
      icon: PLAN_ICON[plan.code],
      name,
      tagline: plan.tagline,
      tag,
      current,
      features,
      economicsNote: plan.economicsNote,
      availabilityNote: plan.availabilityNote,
      a11yLabel: parts.join(". "),
    };
  });
}
