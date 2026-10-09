/**
 * Usuarios, perfiles y roles (tablas `app_users`, `profiles`, `user_roles`) y su forma pública.
 */
import { resolvePreviewAsset } from "../core/assets";
import { ApiFailure } from "../core/errors";
import type { PreviewDb } from "../core/db";
import type { IdentityStatus, ProfileReviewStatus, ProfileRow, UserRow } from "../core/rows";
import type { SelfServiceRole, UserRole } from "../core/types";

const E164 = /^\+[1-9][0-9]{7,14}$/;

/** `normalizeE164` de `src/auth/phone.ts`. */
export function normalizeE164(input: string): string {
  const value = input.trim().replace(/[\s()-]/g, "");
  if (!E164.test(value)) {
    throw new ApiFailure(
      "INVALID_PHONE_E164",
      "Phone number must be supplied in E.164 format, for example +34600111222"
    );
  }
  return value;
}

/** `normalizeRequestedRoles` de `src/auth/phone.ts`. */
export function normalizeRequestedRoles(input: unknown): SelfServiceRole[] {
  if (input === undefined) return ["passenger"];
  if (!Array.isArray(input)) throw new ApiFailure("INVALID_SELF_SERVICE_ROLES", "roles must be an array");
  const roles = [...new Set(input)];
  if (roles.length < 1 || roles.length > 2) {
    throw new ApiFailure("INVALID_SELF_SERVICE_ROLES", "Select passenger, driver, or both");
  }
  for (const role of roles) {
    if (role !== "passenger" && role !== "driver") {
      throw new ApiFailure(
        "INVALID_SELF_SERVICE_ROLES",
        "Only passenger and driver roles may be requested during self-service registration"
      );
    }
  }
  return roles as SelfServiceRole[];
}

export interface NewUserInput {
  id?: string;
  phone: string;
  roles: readonly UserRole[];
  displayName?: string | null;
  publicPhotoKey?: string | null;
  publicPhotoStatus?: ProfileReviewStatus;
  identityStatus?: IdentityStatus;
  presenceStatus?: string | null;
  createdAt?: number;
}

/** Crea usuario + perfil + roles (lo usan los sembrados y el registro por teléfono). */
export function createUser(db: PreviewDb, input: NewUserInput): UserRow {
  const now = input.createdAt ?? db.nowMs();
  const user = db.users.insert({
    id: input.id ?? db.ids.uuid(),
    phone_e164: normalizeE164(input.phone),
    status: "active",
    created_at: now,
    updated_at: now,
  });
  ensureProfile(db, user.id, {
    display_name: input.displayName ?? null,
    public_photo_key: input.publicPhotoKey ?? null,
    public_photo_status: input.publicPhotoStatus ?? "pending",
    identity_status: input.identityStatus ?? "unverified",
    presence_status: input.presenceStatus ?? null,
    created_at: now,
  });
  for (const role of input.roles) addRole(db, user.id, role, now);
  return user;
}

export function ensureProfile(
  db: PreviewDb,
  userId: string,
  fields: Partial<Omit<ProfileRow, "user_id" | "updated_at">> = {}
): Readonly<ProfileRow> {
  const existing = db.profiles.get(userId);
  if (existing) return existing;
  const now = fields.created_at ?? db.nowMs();
  return db.profiles.insert({
    user_id: userId,
    display_name: fields.display_name ?? null,
    public_photo_key: fields.public_photo_key ?? null,
    public_photo_status: fields.public_photo_status ?? "pending",
    identity_status: fields.identity_status ?? "unverified",
    presence_status: fields.presence_status ?? null,
    created_at: now,
    updated_at: now,
  });
}

export function addRole(db: PreviewDb, userId: string, role: UserRole, at = db.nowMs()): void {
  const id = `${userId}:${role}`;
  if (db.userRoles.has(id)) return;
  db.userRoles.insert({ id, user_id: userId, role, created_at: at });
}

/** Estadísticas públicas (valoración) de un usuario: tabla auxiliar de la vista previa. */
export interface UserStatsRow {
  /** = user_id */
  id: string;
  rating_average: number | null;
  rating_count: number;
  trips_completed: number;
}

export function userStats(db: PreviewDb) {
  return db.collection<UserStatsRow>("user_stats");
}

export interface PublicUserDto {
  id: string;
  displayName: string;
  firstName: string;
  photoUrl: string | null;
  ratingAverage: number | null;
  ratingCount: number;
}

/**
 * URL pública de la foto de perfil aprobada. En la vista previa son recortes de las láminas: la fila guarda la clave
 * `preview-asset://avatar/<id>` y `core/assets.ts` la convierte en la URL del recurso empaquetado.
 */
export function photoUrlFor(profile: Readonly<ProfileRow> | undefined): string | null {
  if (!profile || profile.public_photo_status !== "approved" || !profile.public_photo_key) return null;
  return resolvePreviewAsset(profile.public_photo_key);
}

export function firstNameOf(displayName: string | null | undefined): string {
  const trimmed = (displayName ?? "").trim();
  return trimmed ? (trimmed.split(/\s+/)[0] ?? trimmed) : "";
}

/** `PublicUser` del contrato (`mobile/src/api/types/common.ts`). Nunca expone teléfono ni datos privados. */
export function publicUser(db: PreviewDb, userId: string): PublicUserDto {
  const profile = db.profiles.get(userId);
  const stats = userStats(db).get(userId);
  const displayName = profile?.display_name?.trim() || "Usuario MVC";
  return {
    id: userId,
    displayName,
    firstName: firstNameOf(displayName) || "Usuario",
    photoUrl: photoUrlFor(profile),
    ratingAverage: stats?.rating_average ?? null,
    ratingCount: stats?.rating_count ?? 0,
  };
}

export function requireUser(db: PreviewDb, userId: string): Readonly<UserRow> {
  const user = db.users.get(userId);
  if (!user) throw new ApiFailure("USER_NOT_FOUND", "User not found", 404);
  return user;
}
