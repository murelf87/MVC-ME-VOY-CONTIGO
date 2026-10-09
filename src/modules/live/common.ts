import type { Pool, PoolClient } from "pg";
import type { PublicUserDto } from "../../lib/dto.js";
import { liveSettings } from "./config.js";
import type { GeoPoint, IsoDateTime } from "./types.js";

export type Db = Pick<PoolClient, "query"> | Pick<Pool, "query">;

export async function tx<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function iso(value: Date): IsoDateTime {
  return value.toISOString();
}

export function isoOrNull(value: Date | null | undefined): IsoDateTime | null {
  return value ? value.toISOString() : null;
}

export function point(lat: number | string, lng: number | string): GeoPoint {
  return { lat: Number(lat), lng: Number(lng) };
}

export function ageSecondsOf(recordedAt: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - recordedAt.getTime()) / 1000));
}

/** Radio de incertidumbre (m) de una posición aproximada: la cuadrícula de 0,01° tiene un error máximo de ~0,7 km. */
export const APPROXIMATE_RADIUS_M = 1000;

/**
 * Cuadrícula de ~1 km (0,01°). Se usa SIEMPRE que la posición de una persona no debe darse con precisión: enlace de
 * «Compartir viaje (privado)» y conductor con «Compartir ubicación en viaje» desactivado.
 */
export function approximateCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
}

export type PublicUserRow = {
  user_id: string;
  display_name: string | null;
  public_photo_key: string | null;
  public_photo_status: string | null;
  rating_sum: number | null;
  rating_count: number | null;
};

/** Persona tal y como la ve otro usuario: nunca teléfono ni datos privados. */
export function toPublicUser(row: PublicUserRow): PublicUserDto {
  const name = (row.display_name ?? "").trim().replace(/\s+/g, " ");
  const displayName = name.length > 0 ? name : "Usuario";
  const firstName = displayName.split(" ")[0] ?? displayName;
  const count = row.rating_count ?? 0;
  const base = liveSettings().publicPhotoBaseUrl;
  const photoUrl =
    base && row.public_photo_key && row.public_photo_status === "approved"
      ? `${base}/${row.public_photo_key.split("/").map(encodeURIComponent).join("/")}`
      : null;
  return {
    id: row.user_id,
    displayName,
    firstName,
    photoUrl,
    // media con un decimal, mitad hacia arriba (idéntico a round(sum::numeric / count, 1) de SQL)
    ratingAverage: count > 0 ? Math.round(((row.rating_sum ?? 0) * 10) / count) / 10 : null,
    ratingCount: count
  };
}

export async function loadPublicUsers(db: Db, userIds: readonly string[]): Promise<Map<string, PublicUserDto>> {
  const unique = [...new Set(userIds)];
  const result = new Map<string, PublicUserDto>();
  if (unique.length === 0) return result;
  const rows = await db.query<PublicUserRow>(
    `select u.id as user_id, p.display_name, p.public_photo_key, p.public_photo_status, p.rating_sum, p.rating_count
       from app_users u
       left join profiles p on p.user_id=u.id
      where u.id = any($1::uuid[])`,
    [unique]
  );
  for (const row of rows.rows) result.set(row.user_id, toPublicUser(row));
  return result;
}

export async function loadPublicUser(db: Db, userId: string): Promise<PublicUserDto> {
  const found = (await loadPublicUsers(db, [userId])).get(userId);
  if (!found) {
    // Usuario inexistente: nunca debería ocurrir con claves foráneas; devolver un perfil vacío honesto.
    return toPublicUser({
      user_id: userId, display_name: null, public_photo_key: null, public_photo_status: null,
      rating_sum: null, rating_count: null
    });
  }
  return found;
}

/** true si hay bloqueo en cualquiera de los dos sentidos. */
export async function usersBlocked(db: Db, a: string, b: string): Promise<boolean> {
  const result = await db.query(
    `select 1 from user_blocks
      where (blocker_user_id=$1 and blocked_user_id=$2) or (blocker_user_id=$2 and blocked_user_id=$1)
      limit 1`,
    [a, b]
  );
  return Boolean(result.rowCount);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Distancia en línea recta (m) entre dos coordenadas (haversine). Solo para umbrales de «ha llegado», nunca para ETA. */
export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Convierte el GeoJSON (LineString o Point) devuelto por PostGIS en puntos {lat,lng}. */
export function geoJsonToPoints(geoJson: string | null): GeoPoint[] {
  if (!geoJson) return [];
  const parsed = JSON.parse(geoJson) as { type: string; coordinates: unknown };
  if (parsed.type === "LineString") {
    return (parsed.coordinates as Array<[number, number]>).map(([lng, lat]) => point(lat, lng));
  }
  if (parsed.type === "Point") {
    const [lng, lat] = parsed.coordinates as [number, number];
    return [point(lat, lng)];
  }
  return [];
}
