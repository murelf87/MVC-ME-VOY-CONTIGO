/**
 * RBAC del panel para los endpoints de «admin-ops» (espejo de `src/modules/trust/rbac.ts` y de la matriz de
 * `docs/contracts/trust.md` §3). Los roles se leen de la base en CADA petición: quitar un rol (variantes de datos por
 * rol) surte efecto de inmediato. Un intento denegado queda auditado como `admin.access_denied` y responde
 * `403 AUTH_FORBIDDEN`; sin sesión, `401`.
 */
import type { AdminPermission, AdminResource, TrustStaffRole } from "@/api/types";
import { fail, writeAudit, type PreviewDb, type PreviewRequest, type Principal, type RouteTypes, type UserRole } from "@/preview";

/** Lo mínimo que la guardia necesita de la petición (cualquier `PreviewRequest<…>` lo cumple). */
export type GuardRequest = Pick<PreviewRequest<RouteTypes>, "auth" | "requestId" | "method" | "path">;

const STAFF_ROLES: readonly TrustStaffRole[] = ["admin", "verification_admin", "finance_admin", "support_admin"];

const A: TrustStaffRole = "admin";
const F: TrustStaffRole = "finance_admin";
const S: TrustStaffRole = "support_admin";

interface Grant {
  read: readonly TrustStaffRole[];
  write: readonly TrustStaffRole[];
}

/** Solo los recursos que tocan los endpoints de este paquete (la matriz completa vive en el contrato). */
const MATRIX: Readonly<Partial<Record<AdminResource, Grant>>> = {
  tariffs: { read: [A, F], write: [A, F] },
  tariff_activation: { read: [A], write: [A] },
  operations: { read: [A, F, S], write: [A] },
  alerts: { read: [A, F, S], write: [A, S] },
  audit: { read: [A], write: [] },
  legal: { read: [A], write: [A] },
  support: { read: [A, S], write: [A, S] },
};

export function staffRolesOf(roles: readonly UserRole[]): TrustStaffRole[] {
  return STAFF_ROLES.filter((role) => roles.includes(role));
}

export function permissionFor(roles: readonly UserRole[], resource: AdminResource): AdminPermission {
  const grant = MATRIX[resource];
  if (grant === undefined) return "none";
  if (roles.some((role) => (grant.write as readonly string[]).includes(role))) return "write";
  if (roles.some((role) => (grant.read as readonly string[]).includes(role))) return "read";
  return "none";
}

/** `write` implica `read`. */
function permits(permission: AdminPermission, needed: "read" | "write"): boolean {
  if (needed === "read") return permission === "read" || permission === "write";
  return permission === "write";
}

function deny(db: PreviewDb, req: GuardRequest, principal: Principal, resource: string, needed: "read" | "write"): never {
  writeAudit(db, {
    actorUserId: principal.userId,
    action: "admin.access_denied",
    entityType: "admin_resource",
    entityId: resource,
    requestId: req.requestId,
    metadata: { resource, needed, method: req.method, route: req.path, roles: principal.roles },
  });
  return fail("AUTH_FORBIDDEN", "No tienes permiso para esta operación.", 403);
}

/** Sesión + permiso sobre un recurso del panel. Un denegado se audita y responde 403. */
export function authorizeAdmin(db: PreviewDb, req: GuardRequest, resource: AdminResource, needed: "read" | "write"): Principal {
  const principal = req.auth();
  if (!permits(permissionFor(principal.roles, resource), needed)) return deny(db, req, principal, resource, needed);
  return principal;
}

/** Módulo de dinero (`finance_admin` | `admin`): el mismo 403 que el panel, con la misma auditoría. */
export function authorizeFinance(db: PreviewDb, req: GuardRequest): Principal {
  const principal = req.auth();
  if (!principal.roles.some((role) => role === "finance_admin" || role === "admin")) return deny(db, req, principal, "payout_runs", "read");
  return principal;
}
