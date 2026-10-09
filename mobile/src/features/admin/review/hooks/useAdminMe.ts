/**
 * Quién soy en el panel y qué puedo hacer (`GET /v1/admin/me`). Todas las pantallas del paquete lo consultan: lo que el
 * rol no puede leer no se muestra y lo que el servidor deniega se pinta como «Sin permiso».
 */
import { useMemo } from "react";
import type { AdminMe, AdminResource, Province } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getAdminMe, listAdminProvinces } from "../api";
import { ADMIN_ME, ADMIN_PROVINCES } from "../keys";
import { bookingsSource, canRead, canWrite, hasFinanceAccess, type BookingsSource } from "../logic/permissions";

export interface AdminAccess {
  query: UseApiQueryResult<AdminMe>;
  /** `null` mientras no ha llegado (o si el servidor lo ha denegado). */
  me: AdminMe | null;
  canRead: (resource: AdminResource) => boolean;
  canWrite: (resource: AdminResource) => boolean;
  /** Administración o Finanzas: único acceso al módulo de devoluciones. */
  hasFinance: boolean;
  bookingsSource: BookingsSource;
}

export function useAdminMe(): AdminAccess {
  const query = useApiQuery(ADMIN_ME, ({ signal }) => getAdminMe({ signal }), { staleTimeMs: 60_000 });
  const me = query.data ?? null;
  return useMemo(
    () => ({
      query,
      me,
      canRead: (resource: AdminResource) => canRead(me, resource),
      canWrite: (resource: AdminResource) => canWrite(me, resource),
      hasFinance: hasFinanceAccess(me),
      bookingsSource: bookingsSource(me),
    }),
    [query, me],
  );
}

/** Provincias disponibles (para el filtro de 37 y 39). */
export function useAdminProvinces(): UseApiQueryResult<Province[]> {
  return useApiQuery(ADMIN_PROVINCES, ({ signal }) => listAdminProvinces({ signal }), { staleTimeMs: 10 * 60_000 });
}
