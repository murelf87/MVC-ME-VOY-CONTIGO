/**
 * Qué puede ver y hacer la persona del personal (RBAC). Se parte de lo que dicen los roles de la sesión y, en cuanto
 * llega, manda `GET /v1/admin/me` (el servidor decide; cada llamada se vuelve a comprobar y un 403 muestra «Sin permiso»).
 * Si `/me` falla, no se muestra ningún error: se sigue con la deducción por roles.
 */
import { useMemo } from "react";
import { useApiQuery } from "@/hooks";
import { useAuth } from "@/session";
import { getAdminMe } from "../api";
import { accessFromMe, accessFromRoles, type OpsAccess } from "../model/permissions";
import { ADMIN_ME_KEY } from "./keys";

export function useAdminAccess(): OpsAccess {
  const { me, roles } = useAuth();
  const fromRoles = useMemo(() => accessFromRoles(roles, me?.display_name ?? null), [roles, me?.display_name]);
  const query = useApiQuery(ADMIN_ME_KEY, ({ signal }) => getAdminMe({ signal }), { staleTimeMs: 60_000, refetchOnFocus: false });
  return useMemo(() => (query.data !== undefined ? accessFromMe(query.data) : fromRoles), [query.data, fromRoles]);
}
