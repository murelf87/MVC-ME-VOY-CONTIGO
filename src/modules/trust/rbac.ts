import type { UserRole } from "../../auth/session.js";

/**
 * RBAC por recurso del panel de administración (matriz en docs/contracts/trust.md §3).
 * Los roles se leen de la base de datos en CADA petición (resolveSession): revocar un rol surte efecto de inmediato.
 * No existe ningún rol «maestro» ni contraseña: los roles de personal los concede scripts/grant-role.ts (acceso a la BD).
 */
export const STAFF_ROLES = ["admin", "verification_admin", "finance_admin", "support_admin"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ADMIN_RESOURCES = [
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
  "support"
] as const;
export type AdminResource = (typeof ADMIN_RESOURCES)[number];
export type AdminPermission = "none" | "read" | "write";

const A: StaffRole = "admin";
const V: StaffRole = "verification_admin";
const F: StaffRole = "finance_admin";
const S: StaffRole = "support_admin";

type Grant = { read: readonly StaffRole[]; write: readonly StaffRole[] };

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
  support: { read: [A, S], write: [A, S] }
};

const KNOWN_ROLES: readonly UserRole[] = ["passenger", "driver", ...STAFF_ROLES];

/**
 * Normaliza la lista de roles que devuelve `resolveSession`.
 * `array_agg(user_roles.role)` es un array de un tipo enumerado: el controlador `pg` NO lo convierte y lo entrega como
 * texto de Postgres (`{driver,passenger}`). Aquí se acepta tanto un array real como ese literal; los valores desconocidos
 * se descartan (nunca se concede un permiso por un valor inesperado).
 */
export function normalizeRoles(input: unknown): UserRole[] {
  let values: string[] = [];
  if (Array.isArray(input)) values = input.filter((v): v is string => typeof v === "string");
  else if (typeof input === "string") {
    const inner = input.trim().replace(/^\{/, "").replace(/\}$/, "");
    values = inner.length === 0 ? [] : inner.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
  }
  const known = new Set<string>(KNOWN_ROLES);
  return [...new Set(values)].filter((v): v is UserRole => known.has(v));
}

export function staffRolesOf(roles: readonly UserRole[]): StaffRole[] {
  return STAFF_ROLES.filter(role => roles.includes(role));
}

export function permissionFor(roles: readonly UserRole[], resource: AdminResource): AdminPermission {
  const grant = ADMIN_MATRIX[resource];
  if (roles.some(role => (grant.write as readonly string[]).includes(role))) return "write";
  if (roles.some(role => (grant.read as readonly string[]).includes(role))) return "read";
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

/** Roles que NUNCA se asignan por autoservicio. */
export function isStaffRole(role: string): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}
