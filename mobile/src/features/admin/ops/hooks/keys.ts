/**
 * Claves de la caché de consultas del paquete «admin-ops». Un prefijo invalida todo lo que cuelga de él:
 * `queryCache.invalidate(ADMIN_TARIFFS)` refresca la tarifa, el historial de versiones y los ejemplos.
 */
import type { AdminAlertKind, AdminAlertStatus, LegalDocumentKind, PayoutStatus } from "@/api/types";
import type { AuditQuery } from "../model/audit";
import type { SupportFilter } from "../model/support";

/** La misma clave que usa el paquete admin-review: comparten la caché de permisos. */
export const ADMIN_ME_KEY = ["admin", "me"] as const;

export const ADMIN_TARIFFS = ["admin", "tariffs"] as const;
export const TARIFF_OVERVIEW_KEY = ["admin", "tariffs", "overview"] as const;
export const TARIFF_VERSIONS_KEY = ["admin", "tariffs", "versions"] as const;

export function tariffExampleKey(request: object): readonly unknown[] {
  return ["admin", "tariffs", "example", request];
}

export const ADMIN_OPERATIONS = ["admin", "operations"] as const;

export const ADMIN_ALERTS = ["admin", "alerts"] as const;

export function alertsKey(status: AdminAlertStatus | "all", kind: AdminAlertKind | null): readonly unknown[] {
  return ["admin", "alerts", status, kind ?? "all"];
}

export const ADMIN_AUDIT = ["admin", "audit"] as const;

export function auditKey(query: AuditQuery): readonly unknown[] {
  return ["admin", "audit", query.action ?? "", query.actorUserId ?? "", query.entityType ?? "", query.entityId ?? "", query.from ?? "", query.to ?? ""];
}

export const ADMIN_LEGAL = ["admin", "legal"] as const;
export const LEGAL_LIST_KEY = ["admin", "legal", "list"] as const;

export function legalVersionKey(kind: LegalDocumentKind, version: number): readonly unknown[] {
  return ["admin", "legal", "version", kind, version];
}

export const ADMIN_SUPPORT = ["admin", "support"] as const;

export function supportListKey(filter: SupportFilter): readonly unknown[] {
  return ["admin", "support", "list", filter.status, filter.assigned, filter.category];
}

export function supportTicketKey(ticketId: string): readonly unknown[] {
  return ["admin", "support", "ticket", ticketId];
}

export const ADMIN_PAYOUTS = ["admin", "payouts"] as const;

export function payoutRunsKey(period: string | null, status: PayoutStatus | null): readonly unknown[] {
  return ["admin", "payouts", "runs", period ?? "all", status ?? "all"];
}

export const PAYOUT_AVAILABILITY_KEY = ["admin", "payouts", "availability"] as const;
