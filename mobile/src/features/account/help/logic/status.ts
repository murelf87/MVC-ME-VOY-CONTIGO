/** Lógica pura de «Estado del servicio» (lámina 36): qué decir según lo que se ha podido comprobar desde el móvil. */
export type ProbeState = "checking" | "ok" | "down" | "unknown";

export type ServiceSummary = "checking" | "ok" | "offline" | "server" | "database";

export interface ServiceFacts {
  /** `false` solo cuando el móvil sabe que no tiene Internet. */
  deviceOnline: boolean;
  /** `GET /health/live`. */
  server: ProbeState;
  /** `GET /health/ready` (base de datos y PostGIS). */
  database: ProbeState;
}

/**
 * Resumen honesto: primero lo del móvil (sin Internet no se puede saber nada del servidor), luego el servidor y por
 * último la base de datos. Solo dice «todo bien» si de verdad respondieron las dos comprobaciones.
 */
export function summarizeService(facts: ServiceFacts): ServiceSummary {
  if (!facts.deviceOnline) return "offline";
  if (facts.server === "checking" || facts.database === "checking") return "checking";
  if (facts.server === "down") return "server";
  if (facts.database === "down") return "database";
  if (facts.server === "ok" && facts.database === "ok") return "ok";
  return "checking";
}

/** Una comprobación de salud que falla por falta de red no cuenta como «servidor caído». */
export function probeFromResult(result: "ok" | "unreachable" | "not_ready" | "offline"): { server: ProbeState; database: ProbeState } {
  switch (result) {
    case "ok":
      return { server: "ok", database: "ok" };
    case "not_ready":
      return { server: "ok", database: "down" };
    case "unreachable":
      return { server: "down", database: "unknown" };
    default:
      return { server: "unknown", database: "unknown" };
  }
}
