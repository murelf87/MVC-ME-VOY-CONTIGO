/**
 * Permisos del personal para las pantallas de tarifas, operación, alertas, auditoría, legal, atención y liquidaciones.
 *
 * El servidor manda (docs/contracts/trust.md §3): `GET /v1/admin/me` devuelve `permissions` por recurso y cada llamada se
 * vuelve a comprobar (403 `AUTH_FORBIDDEN` → estado «Sin permiso»). La matriz de aquí es el ESPEJO de
 * `src/modules/trust/rbac.ts` y solo sirve para decidir qué se muestra mientras `/me` no ha llegado (o no existe).
 *
 *   A = admin · V = verification_admin · F = finance_admin · S = support_admin
 *
 * Funciones puras: se prueban en Node.
 */
import type { AdminMe, AdminPermission, AdminResource, TrustStaffRole } from "@/api/types";

interface Rule {
  read: readonly TrustStaffRole[];
  write: readonly TrustStaffRole[];
}

const A: TrustStaffRole = "admin";
const V: TrustStaffRole = "verification_admin";
const F: TrustStaffRole = "finance_admin";
const S: TrustStaffRole = "support_admin";

export const ADMIN_MATRIX: Readonly<Record<AdminResource, Rule>> = {
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

const RESOURCES = Object.keys(ADMIN_MATRIX) as AdminResource[];

export function permissionFromRoles(roles: readonly string[], resource: AdminResource): AdminPermission {
  const rule = ADMIN_MATRIX[resource];
  if (rule.write.some((role) => roles.includes(role))) return "write";
  if (rule.read.some((role) => roles.includes(role))) return "read";
  return "none";
}

export function permissionsFromRoles(roles: readonly string[]): Record<AdminResource, AdminPermission> {
  const result = {} as Record<AdminResource, AdminPermission>;
  for (const resource of RESOURCES) result[resource] = permissionFromRoles(roles, resource);
  return result;
}

/** Liquidaciones (docs/contracts/money.md §8.6): solo Finanzas y Administración. */
export function canUsePayouts(roles: readonly string[]): boolean {
  return roles.includes(A) || roles.includes(F);
}

/** Lo que una persona del personal puede ver y hacer en estas pantallas. */
export interface OpsAccess {
  roles: readonly TrustStaffRole[];
  displayName: string | null;
  /** `true` cuando proviene de `GET /v1/admin/me`; `false` si es la deducción local por roles. */
  confirmed: boolean;
  permissions: Readonly<Record<AdminResource, AdminPermission>>;
  readTariffs: boolean;
  writeTariffs: boolean;
  /** Activar una tarifa (solo Administración y, además, la puerta `ECONOMICS_ACTIVATION`). */
  activateTariffs: boolean;
  readOperations: boolean;
  writeOperations: boolean;
  readAlerts: boolean;
  writeAlerts: boolean;
  readAudit: boolean;
  readLegal: boolean;
  writeLegal: boolean;
  readSupport: boolean;
  writeSupport: boolean;
  payouts: boolean;
}

const RANK: Record<AdminPermission, number> = { none: 0, read: 1, write: 2 };

function buildAccess(
  roles: readonly TrustStaffRole[],
  displayName: string | null,
  permissions: Record<AdminResource, AdminPermission>,
  confirmed: boolean,
): OpsAccess {
  const can = (resource: AdminResource, level: AdminPermission): boolean => RANK[permissions[resource]] >= RANK[level];
  return {
    roles,
    displayName,
    confirmed,
    permissions,
    readTariffs: can("tariffs", "read"),
    writeTariffs: can("tariffs", "write"),
    activateTariffs: can("tariff_activation", "write"),
    readOperations: can("operations", "read"),
    writeOperations: can("operations", "write"),
    readAlerts: can("alerts", "read"),
    writeAlerts: can("alerts", "write"),
    readAudit: can("audit", "read"),
    readLegal: can("legal", "read"),
    writeLegal: can("legal", "write"),
    readSupport: can("support", "read"),
    writeSupport: can("support", "write"),
    payouts: canUsePayouts(roles),
  };
}

const STAFF: readonly TrustStaffRole[] = [A, V, F, S];

export function staffRolesOf(roles: readonly string[]): TrustStaffRole[] {
  return STAFF.filter((role) => roles.includes(role));
}

/** Acceso deducido de los roles de la sesión (mientras `/me` no responde). */
export function accessFromRoles(roles: readonly string[], displayName: string | null): OpsAccess {
  const staff = staffRolesOf(roles);
  return buildAccess(staff, displayName, permissionsFromRoles(staff), false);
}

/** Acceso confirmado por el servidor (`GET /v1/admin/me`). */
export function accessFromMe(me: AdminMe): OpsAccess {
  return buildAccess(me.roles, me.displayName, me.permissions, true);
}

/** Solo para pruebas y estados de error: sin ningún permiso. */
export function noAccess(): OpsAccess {
  return buildAccess([], null, permissionsFromRoles([]), false);
}

// ── Pestañas del panel ────────────────────────────────────────────────────────────────────────────────────────────

export type OpsTab = "tariffs" | "operations" | "alerts" | "audit";

export const OPS_TABS: readonly OpsTab[] = ["tariffs", "operations", "alerts", "audit"];

export function canReadTab(access: OpsAccess, tab: OpsTab): boolean {
  switch (tab) {
    case "tariffs":
      return access.readTariffs;
    case "operations":
      return access.readOperations;
    case "alerts":
      return access.readAlerts;
    case "audit":
      return access.readAudit;
  }
}

/** La pestaña pedida si se puede leer; si no, la primera que sí; si ninguna, la pedida (mostrará «Sin permiso»). */
export function firstAllowedTab(access: OpsAccess, requested: OpsTab): OpsTab {
  if (canReadTab(access, requested)) return requested;
  return OPS_TABS.find((tab) => canReadTab(access, tab)) ?? requested;
}

/** Inicial del avatar de la cabecera («Administración MVC» → «A»); sin nombre, «A» de Administración. */
export function avatarInitial(displayName: string | null): string {
  const first = (displayName ?? "").trim().charAt(0);
  return first === "" ? "A" : first.toLocaleUpperCase("es-ES");
}
