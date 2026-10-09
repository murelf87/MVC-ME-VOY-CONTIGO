import type { PublicUserDto } from "../../lib/dto.js";
import type { Db } from "./common.js";
import { tripsSettings } from "./settings.js";

export type RatingSummary = { average: number | null; count: number };
export type RatingSummaryProvider = (db: Db, userIds: readonly string[]) => Promise<Map<string, RatingSummary>>;

let customProvider: RatingSummaryProvider | null = null;

/**
 * Permite a otro módulo (p. ej. `live`) aportar las valoraciones. Si no se registra ninguno, se leen los agregados
 * `profiles.rating_sum/rating_count` cuando existen (migración 030 de `live`); si tampoco existen → null/0 (honesto).
 */
export function registerRatingSummaryProvider(provider: RatingSummaryProvider | null): void {
  customProvider = provider;
}

let ratingColumnsPresent: { value: boolean; checkedAt: number } | null = null;

async function hasRatingColumns(db: Db): Promise<boolean> {
  const now = Date.now();
  if (ratingColumnsPresent && (ratingColumnsPresent.value || now - ratingColumnsPresent.checkedAt < 60_000)) {
    return ratingColumnsPresent.value;
  }
  const result = await db.query<{ n: number }>(
    `select count(*)::int as n
       from information_schema.columns
      where table_schema = current_schema() and table_name = 'profiles' and column_name in ('rating_sum','rating_count')`
  );
  ratingColumnsPresent = { value: (result.rows[0]?.n ?? 0) === 2, checkedAt: now };
  return ratingColumnsPresent.value;
}

/** Solo para pruebas. */
export function resetRatingColumnCache(): void {
  ratingColumnsPresent = null;
}

async function loadRatings(db: Db, userIds: readonly string[]): Promise<Map<string, RatingSummary>> {
  if (customProvider) return customProvider(db, userIds);
  const out = new Map<string, RatingSummary>();
  if (userIds.length === 0 || !(await hasRatingColumns(db))) return out;
  const rows = await db.query<{ user_id: string; rating_sum: number; rating_count: number }>(
    `select user_id, rating_sum, rating_count from profiles where user_id = any($1::uuid[])`,
    [userIds]
  );
  for (const row of rows.rows) {
    out.set(row.user_id, {
      // media con un decimal, mitad hacia arriba (idéntica a round(sum::numeric / count, 1))
      average: row.rating_count > 0 ? Math.round((row.rating_sum * 10) / row.rating_count) / 10 : null,
      count: row.rating_count
    });
  }
  return out;
}

type ProfileRow = {
  user_id: string;
  display_name: string | null;
  public_photo_key: string | null;
  public_photo_status: string | null;
};

function photoUrl(row: ProfileRow): string | null {
  const base = tripsSettings().publicMediaBaseUrl;
  if (!base || !row.public_photo_key || row.public_photo_status !== "approved") return null;
  return `${base}/${row.public_photo_key.split("/").map(encodeURIComponent).join("/")}`;
}

/** Personas tal y como las ve otro usuario: nunca teléfono ni datos privados. */
export async function loadPublicUsers(db: Db, userIds: readonly string[]): Promise<Map<string, PublicUserDto>> {
  const unique = [...new Set(userIds)];
  const out = new Map<string, PublicUserDto>();
  if (unique.length === 0) return out;
  const rows = await db.query<ProfileRow>(
    `select u.id as user_id, p.display_name, p.public_photo_key, p.public_photo_status
       from app_users u left join profiles p on p.user_id = u.id
      where u.id = any($1::uuid[])`,
    [unique]
  );
  const ratings = await loadRatings(db, unique);
  for (const row of rows.rows) {
    const name = (row.display_name ?? "").trim().replace(/\s+/g, " ");
    const displayName = name.length > 0 ? name : "Usuario";
    const rating = ratings.get(row.user_id);
    out.set(row.user_id, {
      id: row.user_id,
      displayName,
      firstName: displayName.split(" ")[0] ?? displayName,
      photoUrl: photoUrl(row),
      ratingAverage: rating?.average ?? null,
      ratingCount: rating?.count ?? 0
    });
  }
  return out;
}

export function publicUserOrUnknown(map: Map<string, PublicUserDto>, userId: string): PublicUserDto {
  return map.get(userId) ?? {
    id: userId, displayName: "Usuario", firstName: "Usuario", photoUrl: null, ratingAverage: null, ratingCount: 0
  };
}
