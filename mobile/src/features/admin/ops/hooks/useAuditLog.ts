/** Visor de auditoría (solo administración): eventos con metadatos ya depurados de datos personales por el servidor. */
import type { AdminAuditEvent } from "@/api/types";
import { usePaginatedQuery, type UsePaginatedQueryResult } from "@/hooks";
import { listAuditEvents } from "../api";
import type { AuditQuery } from "../model/audit";
import { auditKey } from "./keys";

export function useAuditEvents(query: AuditQuery, enabled: boolean): UsePaginatedQueryResult<AdminAuditEvent> {
  return usePaginatedQuery<AdminAuditEvent>(
    auditKey(query),
    ({ cursor, signal }) => listAuditEvents({ ...query, cursor, limit: 25 }, { signal }),
    { enabled, staleTimeMs: 10_000 },
  );
}
