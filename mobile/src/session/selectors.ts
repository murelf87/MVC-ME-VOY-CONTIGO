/**
 * Selectores puros sobre `me` y los roles. Sin React ni red: se prueban en Node.
 */
import type { AnyRole, MeProfile, Role, StaffRole } from "@/api/types";
import type { ActiveRole } from "./types";

export const STAFF_ROLES: readonly StaffRole[] = ["admin", "verification_admin", "finance_admin", "support_admin"];

export function isStaffRole(role: AnyRole): role is StaffRole {
  return (STAFF_ROLES as readonly string[]).includes(role);
}

/** Personal = tiene algún rol administrativo (admin, verification_admin, finance_admin, support_admin). */
export function hasStaffRole(roles: readonly AnyRole[]): boolean {
  return roles.some(isStaffRole);
}

export function selfServiceRoles(roles: readonly AnyRole[]): Role[] {
  return roles.filter((role): role is Role => role === "passenger" || role === "driver");
}

/**
 * Rol activo coherente con los roles reales: respeta la preferencia guardada si el usuario sigue teniéndola;
 * si no, pasajero antes que conductor. `null` si no tiene ningún rol de autoservicio (p. ej. solo personal).
 */
export function resolveActiveRole(roles: readonly AnyRole[], preferred: ActiveRole | null): ActiveRole | null {
  const own = selfServiceRoles(roles);
  if (preferred && own.includes(preferred)) return preferred;
  if (own.includes("passenger")) return "passenger";
  if (own.includes("driver")) return "driver";
  return null;
}

export type OnboardingRequirement = "role" | "photo";

/**
 * Qué le falta al usuario para considerarse «dado de alta» (derivado de `/me`, nunca de banderas locales):
 *  - role:  no tiene pasajero ni conductor (y no es personal) → ChooseRole.
 *  - photo: sin foto pública subida, o la subida fue rechazada → ProfilePhoto («Obligatoria para ambos perfiles»).
 * El personal administrativo sin rol de viajero no necesita ninguno de los dos.
 */
export function getOnboardingRequirements(me: MeProfile): OnboardingRequirement[] {
  const hasTravelRole = selfServiceRoles(me.roles).length > 0;
  if (!hasTravelRole && hasStaffRole(me.roles)) return [];
  const missing: OnboardingRequirement[] = [];
  if (!hasTravelRole) missing.push("role");
  if (!me.public_photo_key || me.public_photo_status === "rejected") missing.push("photo");
  return missing;
}

/** Primer nombre para saludos («Hola, Ana»); null si aún no hay nombre. */
export function getFirstName(me: MeProfile | null): string | null {
  const name = me?.display_name?.trim();
  if (!name) return null;
  return name.split(/\s+/)[0] ?? null;
}
