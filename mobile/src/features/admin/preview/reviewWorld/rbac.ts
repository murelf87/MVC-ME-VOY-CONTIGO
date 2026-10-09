/**
 * RBAC por recurso del panel (espejo de `src/modules/trust/rbac.ts` y de la matriz de `docs/contracts/trust.md` §3).
 * Los roles se leen de la base en CADA petición: quitar un rol surte efecto de inmediato (así las variantes de datos por
 * rol funcionan sin volver a iniciar sesión). Un intento denegado queda auditado como `admin.access_denied` y responde
 * `403 AUTH_FORBIDDEN`; sin sesión, `401`.
 */
import type { AdminMe, AdminPermission, AdminResource, TrustStaffRole } from "@/api/types";
import { fail, writeAudit, type PreviewDb, type PreviewRequest, type Principal, type RouteTypes, type UserRole } from "@/preview";
import { nameParts } from "./common";

/** Lo mínimo que la guardia necesita de la petición (cualquier `PreviewRequest<…>` lo cumple). */
export type GuardRequest = Pick<PreviewRequest<RouteTypes>, "auth" | "requestId" | "method" | "path">;

export const STAFF_ROLES: readonly TrustStaffRole[] = ["admin", "verification_admin", "finance_admin", "support_admin"];

export const ADMIN_RESOURCES: readonly AdminResource[] = [
  "summary",
  "finance_kpis",
  "review",
  "evidence",
  "bookings",
  "tariffs",
  "tariff_activation",
  "operations",
  "alerts",
  "audit",
  "legal",
  "support",
];

const A: TrustStaffRole = "admin";
const V: TrustStaffRole = "verification_admin";
const F: TrustStaffRole = "finance_admin";
const S: TrustStaffRole = "support_admin";

interface Grant {
  read: readonly TrustStaffRole[];
  write: readonly TrustStaffRole[];
}

export const ADMIN_MATRIX: Readonly<Record<AdminResource, Grant>> = {
  summary: { read: [A, F, S], write: [] },
  finance_kpis: { read: [A, F], write: [] },
  review: { read: [A, V], write: [A, V] },
  evidence: { read: [A, V], write: [A, V] },
  bookings: { read: [A, F, S], write: [] },
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
  const grant = ADMIN_MATRIX[resource];
  if (roles.some((role) => (grant.write as readonly string[]).includes(role))) return "write";
  if (roles.some((role) => (grant.read as readonly string[]).includes(role))) return "read";
  return "none";
}

export function permissionsFor(roles: readonly UserRole[]): Record<AdminResource, AdminPermission> {
  const out = {} as Record<AdminResource, AdminPermission>;
  for (const resource of ADMIN_RESOURCES) out[resource] = permissionFor(roles, resource);
  return out;
}

/** `write` implica `read`. */
export function permits(permission: AdminPermission, needed: "read" | "write"): boolean {
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
export function authorizeAdmin(
  db: PreviewDb,
  req: GuardRequest,
  resource: AdminResource,
  needed: "read" | "write",
): Principal {
  const principal = req.auth();
  if (!permits(permissionFor(principal.roles, resource), needed)) return deny(db, req, principal, resource, needed);
  return principal;
}

/** Cualquier rol de personal. */
export function authorizeStaff(db: PreviewDb, req: GuardRequest): Principal {
  const principal = req.auth();
  if (staffRolesOf(principal.roles).length === 0) return deny(db, req, principal, "admin_panel", "read");
  return principal;
}

/** Guardia del módulo de dinero (`finance_admin` | `admin`): el mismo 403 que el panel, con la misma auditoría. */
export function authorizeFinance(db: PreviewDb, req: GuardRequest): Principal {
  const principal = req.auth();
  if (!principal.roles.some((role) => role === "finance_admin" || role === "admin")) return deny(db, req, principal, "refund_proposals", "read");
  return principal;
}

/** `GET /v1/admin/me`. */
export function adminMe(db: PreviewDb, principal: Principal): AdminMe {
  const profile = db.profiles.get(principal.userId);
  return {
    userId: principal.userId,
    displayName: profile?.display_name === undefined || profile.display_name === null ? null : nameParts(profile.display_name).displayName,
    roles: staffRolesOf(principal.roles),
    permissions: permissionsFor(principal.roles),
  };
}
