/**
 * Claves de caché de las consultas del paquete «publicar rutas». Todas empiezan por `"driver-publish"` para poder
 * invalidarlas juntas (`queryCache.invalidate(publishKeys.all)`).
 */
import type { QueryKey } from "@/hooks";

export const PUBLISH_ROOT = "driver-publish";

export const publishKeys = {
  all: [PUBLISH_ROOT] as const,
  vehicles: [PUBLISH_ROOT, "vehicles"] as const,
  documents: [PUBLISH_ROOT, "documents"] as const,
  readiness: [PUBLISH_ROOT, "readiness"] as const,
  categories: [PUBLISH_ROOT, "categories"] as const,
  requests: (tripId?: string): QueryKey => [PUBLISH_ROOT, "requests", tripId ?? "all"],
  province: (lat: number, lng: number): QueryKey => [PUBLISH_ROOT, "province", lat.toFixed(3), lng.toFixed(3)],
  plan: (body: unknown): QueryKey => [PUBLISH_ROOT, "plan", body],
} as const;
