/**
 * Cabecera de «Mi perfil»: municipio y provincia, valoraciones propias (solo si existen), roles y resumen del estado
 * de verificación. Funciones puras sobre los datos del servidor; no inventan nada: lo que falta, se oculta.
 */
import type { AnyRole, FavoritePlace, Role, TrustVerificationOverview } from "@/api/types";

// ── Municipio y provincia ─────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Municipio que contiene una dirección guardada: `Sevilla (Nervión)` → `Sevilla`; `Torre Sevilla, Sevilla` → `Sevilla`.
 * `null` si no hay texto.
 */
export function municipalityFromAddress(address: string): string | null {
  const parts = address
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  const last = parts[parts.length - 1];
  if (last === undefined) return null;
  const withoutDistrict = last.replace(/\s*\([^)]*\)\s*$/u, "").trim();
  return withoutDistrict === "" ? null : withoutDistrict;
}

/**
 * Línea bajo el nombre: «Sevilla, Sevilla» (municipio de la dirección de casa y provincia). Sin dirección guardada solo
 * se muestra la provincia; sin ninguna de las dos, `null`.
 */
export function locationLine(favorites: readonly Pick<FavoritePlace, "kind" | "address">[], provinceName: string | null): string | null {
  const reference = favorites.find((favorite) => favorite.kind === "home") ?? favorites[0];
  const municipality = reference !== undefined ? municipalityFromAddress(reference.address) : null;
  const province = provinceName !== null && provinceName.trim() !== "" ? provinceName.trim() : null;
  if (municipality !== null && province !== null) return `${municipality}, ${province}`;
  return municipality ?? province;
}

/** Provincia a la que pertenecen los destinos guardados (la del de casa, o la del primero). */
export function provinceIdOfFavorites(favorites: readonly Pick<FavoritePlace, "kind" | "provinceId">[]): string | null {
  const reference = favorites.find((favorite) => favorite.kind === "home" && favorite.provinceId !== null) ?? favorites.find((favorite) => favorite.provinceId !== null);
  return reference?.provinceId ?? null;
}

// ── Valoraciones propias ──────────────────────────────────────────────────────────────────────────────────────────────

export interface OwnRating {
  average: number;
  count: number;
}

/**
 * Valoración propia, SOLO si el servidor la envía. El `GET /me` actual no trae valoraciones: cuando las añada
 * (`rating_average` y `rating_count`) se verán; mientras tanto no se pinta ninguna estrella.
 */
export function readOwnRating(me: unknown): OwnRating | null {
  if (typeof me !== "object" || me === null) return null;
  const record = me as Record<string, unknown>;
  const average = record["rating_average"];
  const count = record["rating_count"];
  if (typeof average !== "number" || !Number.isFinite(average) || average < 0 || average > 5) return null;
  if (typeof count !== "number" || !Number.isInteger(count) || count <= 0) return null;
  return { average, count };
}

// ── Roles ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RoleCardState {
  role: Role;
  /** La persona ya tiene este rol en su cuenta. */
  owned: boolean;
  /** Es el modo con el que usa la app ahora. */
  active: boolean;
}

export const ROLE_ORDER: readonly Role[] = ["passenger", "driver"];

/** Estado de las dos tarjetas «Pasajero» y «Conductor». */
export function roleCards(roles: readonly AnyRole[], activeRole: Role | null): RoleCardState[] {
  return ROLE_ORDER.map((role) => ({ role, owned: roles.includes(role), active: activeRole === role }));
}

/** Tiene los dos modos y por tanto puede alternar entre ellos (Mis viajes, Mi perfil). */
export function hasBothRoles(roles: readonly AnyRole[]): boolean {
  return roles.includes("passenger") && roles.includes("driver");
}

// ── Estado de verificación ────────────────────────────────────────────────────────────────────────────────────────────

export type VerificationNextKind =
  | "photo_missing"
  | "photo_rejected"
  | "check_retry"
  | "check_rejected"
  | "identity_rejected"
  | "in_review";

export interface VerificationSummary {
  /** `ok` todo en orden · `review` algo en revisión · `action` la persona debe hacer algo. */
  tone: "ok" | "review" | "action";
  /** Lo primero que debe hacer o esperar; `null` si todo está en orden. */
  next: VerificationNextKind | null;
}

/** Resumen del estado de verificación (foto, comprobación privada, identidad). Prioriza lo que requiere acción. */
export function summarizeVerification(verification: TrustVerificationOverview): VerificationSummary {
  const photo = verification.photo.state;
  const check = verification.privateCheck.state;
  const identity = verification.identity.status;
  if (photo === "none") return { tone: "action", next: "photo_missing" };
  if (photo === "rejected") return { tone: "action", next: "photo_rejected" };
  if (check === "needs_retry") return { tone: "action", next: "check_retry" };
  if (check === "rejected") return { tone: "action", next: "check_rejected" };
  if (identity === "rejected") return { tone: "action", next: "identity_rejected" };
  if (photo === "in_review" || check === "in_review" || identity === "pending") return { tone: "review", next: "in_review" };
  return { tone: "ok", next: null };
}
