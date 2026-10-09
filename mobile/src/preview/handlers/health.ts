/** `GET /health/live` y `GET /health/ready` (los únicos con schema de respuesta en `docs/openapi.json`). */
import type { PreviewDb } from "../core/db";
import type { PreviewRouter } from "../core/router";

export function registerHealth(r: PreviewRouter, _db: PreviewDb): void {
  r.get(
    "/health/live",
    {
      summary: "Liveness",
      schema: {
        response: {
          200: { type: "object", properties: { status: { type: "string" } }, required: ["status"] },
        },
      },
    },
    () => ({ status: "ok" })
  );

  r.get(
    "/health/ready",
    {
      summary: "Readiness",
      schema: {
        response: {
          200: {
            type: "object",
            properties: { status: { type: "string" }, postgis: { type: "string" } },
            required: ["status"],
          },
          503: {
            type: "object",
            properties: { status: { type: "string" }, error: { type: "string" } },
            required: ["status"],
          },
        },
      },
    },
    // No hay base de datos: se declara con claridad que es la simulación en memoria.
    () => ({ status: "ready", postgis: "preview-sim (simulación en memoria)" })
  );
}
