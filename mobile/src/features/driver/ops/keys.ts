/**
 * Claves de caché de las consultas del paquete `driver-ops`. Todas empiezan por `"driver-ops"` para poder invalidarlas
 * juntas (`queryCache.invalidate(opsKeys.all)`).
 */
import type { QueryKey } from "@/hooks";

export const OPS_ROOT = "driver-ops";

export const opsKeys = {
  all: [OPS_ROOT] as const,
  console: (tripId: string): QueryKey => [OPS_ROOT, "console", tripId],
  routeChange: (id: string): QueryKey => [OPS_ROOT, "route-change", id],
  tripDetail: (tripId: string): QueryKey => [OPS_ROOT, "trip-detail", tripId],
  pendingRequests: (tripId: string): QueryKey => [OPS_ROOT, "pending-requests", tripId],
} as const;
