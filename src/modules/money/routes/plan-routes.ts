import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { authenticate } from "../lib/http.js";
import { getMyPlan, listPlans } from "../plans/plans-service.js";
import { BEARER } from "./helpers.js";
import { errorResponses, myPlanSchema, plansResponseSchema } from "./schemas.js";

const TAG_PLANS = ["Planes"];

export function registerPlanRoutes(app: FastifyInstance, pool: Pool): void {
  app.get("/v1/plans", {
    schema: {
      tags: TAG_PLANS,
      summary: "Planes MVC",
      description:
        "Catálogo público de planes. El plan gratuito es el único activo; Premium Conductor es una «Propuesta» (cuota y comisiones por definir) y la Membresía «no está disponible por el momento». No existe endpoint de compra.",
      response: { 200: plansResponseSchema, ...errorResponses(500) }
    }
  }, async () => ({ items: await listPlans(pool) }));

  app.get("/v1/me/plan", {
    schema: {
      tags: TAG_PLANS,
      security: BEARER,
      summary: "Mi plan actual",
      description: "Todas las cuentas están en el plan gratuito; `purchasable=false` mientras no se apruebe ninguna oferta de pago.",
      response: { 200: myPlanSchema, ...errorResponses(401) }
    }
  }, async request => {
    await authenticate(pool, request);
    return getMyPlan();
  });
}
