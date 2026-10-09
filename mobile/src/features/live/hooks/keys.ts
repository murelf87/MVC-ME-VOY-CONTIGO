/** Claves de la caché de consultas del slice `live` (prefijo común `["live", …]` para invalidar en bloque). */
export const liveKeys = {
  all: ["live"] as const,
  booking: (bookingId: string) => ["live", "booking", bookingId] as const,
  status: (bookingId: string) => ["live", "booking", bookingId, "live"] as const,
  inCar: (bookingId: string) => ["live", "booking", bookingId, "in-car"] as const,
  summary: (bookingId: string) => ["live", "booking", bookingId, "summary"] as const,
  share: (bookingId: string) => ["live", "booking", bookingId, "share"] as const,
  routeChange: (proposalId: string) => ["live", "route-change", proposalId] as const,
  sharedTrip: (token: string) => ["live", "shared-trip", token] as const,
  incidents: ["live", "incidents"] as const,
  incident: (reportId: string) => ["live", "incident", reportId] as const,
  privacy: ["live", "privacy"] as const,
};
