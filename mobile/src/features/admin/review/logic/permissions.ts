/**
 * Permisos del personal (docs/contracts/trust.md §3). El servidor manda: `GET /v1/admin/me` devuelve las 12 claves de
 * `AdminResource` con `none | read | write` y los roles. Aquí solo se interpretan para decidir qué se MUESTRA; cada
 * llamada vuelve a comprobarse en el servidor (403 → estado «Sin permiso»).
 *
 * Funciones puras: se prueban en Node.
 */
import type { AdminMe, AdminPermission, AdminResource, TrustStaffRole } from "@/api/types";
import type { AppRouteName } from "@/navigation/types";
import { reviewStrings } from "../strings";

const RANK: Record<AdminPermission, number> = { none: 0, read: 1, write: 2 };

const ROLE_ORDER: readonly TrustStaffRole[] = ["admin", "verification_admin", "finance_admin", "support_admin"];

export function permissionOf(me: AdminMe | null | undefined, resource: AdminResource): AdminPermission {
  return me?.permissions[resource] ?? "none";
}

export function canRead(me: AdminMe | null | undefined, resource: AdminResource): boolean {
  return RANK[permissionOf(me, resource)] >= RANK.read;
}

export function canWrite(me: AdminMe | null | undefined, resource: AdminResource): boolean {
  return RANK[permissionOf(me, resource)] >= RANK.write;
}

export function hasStaffRole(me: AdminMe | null | undefined, ...roles: TrustStaffRole[]): boolean {
  if (me === null || me === undefined) return false;
  return roles.some((role) => me.roles.includes(role));
}

/** Finanzas y Administración: las únicas con acceso al módulo de devoluciones (docs/contracts/money.md §8.5). */
export function hasFinanceAccess(me: AdminMe | null | undefined): boolean {
  return hasStaffRole(me, "admin", "finance_admin");
}

/** De dónde sale la lista de la pantalla 39 para este rol. */
export type BookingsSource = "refunds" | "bookings" | "none";

export function bookingsSource(me: AdminMe | null | undefined): BookingsSource {
  if (hasFinanceAccess(me)) return "refunds";
  if (canRead(me, "bookings")) return "bookings";
  return "none";
}

/** «Administración y Verificación» · «Finanzas» · «Atención al cliente, Finanzas y Verificación». */
export function rolesText(me: AdminMe | null | undefined): string {
  if (me === null || me === undefined) return reviewStrings.access.noRoles;
  const labels = ROLE_ORDER.filter((role) => me.roles.includes(role)).map((role) => reviewStrings.access.roleLabels[role]);
  if (labels.length === 0) return reviewStrings.access.noRoles;
  if (labels.length === 1) return labels[0] ?? reviewStrings.access.noRoles;
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1] ?? ""}`;
}

/** Inicial del avatar de la cabecera («A»). */
export function staffInitial(me: AdminMe | null | undefined): string {
  const name = me?.displayName?.trim() ?? "";
  const first = name.charAt(0);
  return first === "" ? "A" : first.toLocaleUpperCase("es-ES");
}

export function staffFirstName(me: AdminMe | null | undefined): string | null {
  const name = me?.displayName?.trim() ?? "";
  if (name === "") return null;
  return name.split(/\s+/)[0] ?? null;
}

/** Recursos con etiqueta para el resumen «Qué puedes hacer», en el orden de la matriz del contrato. */
export const RESOURCE_ORDER: readonly AdminResource[] = [
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

export interface PermissionLine {
  resource: AdminResource;
  label: string;
  permission: AdminPermission;
  permissionLabel: string;
}

export function permissionLines(me: AdminMe | null | undefined): PermissionLine[] {
  return RESOURCE_ORDER.map((resource) => {
    const permission = permissionOf(me, resource);
    return {
      resource,
      label: reviewStrings.access.areaLabels[resource],
      permission,
      permissionLabel: reviewStrings.access.permissionLabels[permission],
    };
  });
}

// ── Secciones del inicio del panel ────────────────────────────────────────────────────────────────────────────────

export type HomeSectionKey = "summary" | "users" | "bookings" | "tariffs" | "payouts" | "alerts" | "audit" | "legal" | "support";

export interface HomeSection {
  key: HomeSectionKey;
  route: AppRouteName;
  title: string;
  subtitle: string;
}

const HOME_ORDER: readonly HomeSectionKey[] = ["summary", "users", "bookings", "tariffs", "payouts", "alerts", "support", "legal", "audit"];

const HOME_ROUTE: Record<HomeSectionKey, AppRouteName> = {
  summary: "AdminSummary",
  users: "AdminUsersReview",
  bookings: "AdminBookingsRefunds",
  tariffs: "AdminTariffsOps",
  payouts: "AdminPayoutRuns",
  alerts: "AdminAlerts",
  audit: "AdminAuditLog",
  legal: "AdminLegalDocs",
  support: "AdminSupportQueue",
};

function isVisible(me: AdminMe, key: HomeSectionKey): boolean {
  switch (key) {
    case "summary":
      return canRead(me, "summary");
    case "users":
      return canRead(me, "review");
    case "bookings":
      return bookingsSource(me) !== "none";
    case "tariffs":
      return canRead(me, "tariffs") || canRead(me, "operations");
    case "payouts":
      return hasFinanceAccess(me);
    case "alerts":
      return canRead(me, "alerts");
    case "audit":
      return canRead(me, "audit");
    case "legal":
      return canRead(me, "legal");
    case "support":
      return canRead(me, "support");
  }
}

/** Solo las secciones que el rol puede ver, en el orden del panel. */
export function homeSections(me: AdminMe | null | undefined): HomeSection[] {
  if (me === null || me === undefined) return [];
  return HOME_ORDER.filter((key) => isVisible(me, key)).map((key) => ({
    key,
    route: HOME_ROUTE[key],
    title: reviewStrings.home.cards[key].title,
    subtitle: reviewStrings.home.cards[key].subtitle,
  }));
}
