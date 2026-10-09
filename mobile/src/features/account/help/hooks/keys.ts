/** Claves de la caché de consultas del paquete «account-help» (prefijo común para poder invalidarlas juntas). */
export const helpKeys = {
  all: ["account-help"] as const,
  settings: ["account-help", "settings"] as const,
  supportTrips: ["account-help", "support-trips"] as const,
  tickets: ["account-help", "support-tickets"] as const,
  ticketsByStatus: (status: string) => ["account-help", "support-tickets", status] as const,
  ticket: (ticketId: string) => ["account-help", "support-ticket", ticketId] as const,
  exports: ["account-help", "data-exports"] as const,
  deletion: ["account-help", "account-deletion"] as const,
  legalList: ["account-help", "legal-documents"] as const,
  legalDocument: (kind: string, version: number | null) => ["account-help", "legal-document", kind, version ?? "current"] as const,
  health: ["account-help", "health"] as const,
};
