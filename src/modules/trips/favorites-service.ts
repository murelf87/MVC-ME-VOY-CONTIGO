import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { encodeCursor, iso, offsetFromCursor, tx, type Db } from "./common.js";
import { err } from "./errors.js";
import { LIMITS } from "./settings.js";
import type { CreateFavoriteBody, FavoritePlace, Page, UpdateFavoriteBody } from "./types.js";

type FavoriteRow = {
  id: string;
  kind: FavoritePlace["kind"];
  name: string;
  address: string;
  lat: number;
  lng: number;
  province_id: string | null;
  created_at: Date;
};

export const FAVORITE_SELECT = `
  select f.id, f.kind, f.name, f.address, ST_Y(f.geom) as lat, ST_X(f.geom) as lng, f.province_id, f.created_at
    from favorite_places f`;

export function toFavorite(row: FavoriteRow): FavoritePlace {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    address: row.address,
    location: { lat: Number(row.lat), lng: Number(row.lng) },
    provinceId: row.province_id,
    createdAt: iso(row.created_at)
  };
}

function clean(value: string, max: number, label: string): string {
  const text = value.trim().replace(/\s+/g, " ");
  if (text.length < 1 || text.length > max) throw err("VALIDATION_ERROR", 400, `${label} debe tener entre 1 y ${max} caracteres.`);
  return text;
}

async function provinceAt(db: Db, lat: number, lng: number): Promise<string> {
  const found = await db.query<{ id: string }>(
    `select id from provinces where ST_CoveredBy(ST_SetSRID(ST_Point($1,$2),4326), geom) limit 1`, [lng, lat]
  );
  const id = found.rows[0]?.id;
  if (!id) throw err("FAVORITE_OUTSIDE_PROVINCES", 422, "Ese lugar no está en ninguna provincia disponible todavía.");
  return id;
}

export async function listFavorites(
  pool: Pool, principal: AuthPrincipal, query: { cursor?: string | undefined; limit: number }
): Promise<Page<FavoritePlace>> {
  const offset = offsetFromCursor(query.cursor);
  const rows = await pool.query<FavoriteRow>(
    `${FAVORITE_SELECT} where f.user_id = $1 order by f.created_at, f.id offset $2 limit $3`,
    [principal.userId, offset, query.limit + 1]
  );
  return {
    items: rows.rows.slice(0, query.limit).map(toFavorite),
    nextCursor: rows.rows.length > query.limit ? encodeCursor({ o: offset + query.limit }) : null
  };
}

export async function createFavorite(pool: Pool, principal: AuthPrincipal, body: CreateFavoriteBody): Promise<FavoritePlace> {
  const name = clean(body.name, 60, "El nombre");
  const address = clean(body.address, 200, "La dirección");
  return tx(pool, async client => {
    // Bloqueo por usuario: dos altas simultáneas no superan el máximo.
    await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`favorites:${principal.userId}`]);
    const count = await client.query<{ n: number }>(`select count(*)::int as n from favorite_places where user_id = $1`, [principal.userId]);
    if ((count.rows[0]?.n ?? 0) >= LIMITS.maxFavorites) {
      throw err("FAVORITES_LIMIT_REACHED", 409, `Puedes guardar hasta ${LIMITS.maxFavorites} destinos.`);
    }
    const provinceId = await provinceAt(client, body.lat, body.lng);
    const inserted = await client.query<FavoriteRow>(
      `insert into favorite_places(user_id, kind, name, address, geom, province_id)
       values($1,$2,$3,$4,ST_SetSRID(ST_Point($6,$5),4326),$7)
       returning id, kind, name, address, ST_Y(geom) as lat, ST_X(geom) as lng, province_id, created_at`,
      [principal.userId, body.kind, name, address, body.lat, body.lng, provinceId]
    );
    const row = inserted.rows[0]!;
    await writeAudit(client, {
      actorUserId: principal.userId, action: "favorite.created", entityType: "favorite_place", entityId: row.id, metadata: { kind: body.kind }
    });
    return toFavorite(row);
  });
}

export async function updateFavorite(
  pool: Pool, principal: AuthPrincipal, favoriteId: string, body: UpdateFavoriteBody
): Promise<FavoritePlace> {
  const hasCoords = body.lat !== undefined || body.lng !== undefined;
  if (body.kind === undefined && body.name === undefined && body.address === undefined && !hasCoords) {
    throw err("EMPTY_UPDATE", 422, "Indica al menos un campo que cambiar.");
  }
  if ((body.lat === undefined) !== (body.lng === undefined)) {
    throw err("INVALID_REQUEST_SHAPE", 422, "Para mover el lugar indica la latitud y la longitud.");
  }
  return tx(pool, async client => {
    const current = await client.query<FavoriteRow>(`${FAVORITE_SELECT} where f.id = $1 and f.user_id = $2 for update of f`, [favoriteId, principal.userId]);
    const row = current.rows[0];
    if (!row) throw err("FAVORITE_NOT_FOUND", 404, "El destino no existe.");
    const name = body.name !== undefined ? clean(body.name, 60, "El nombre") : row.name;
    const address = body.address !== undefined ? clean(body.address, 200, "La dirección") : row.address;
    const lat = body.lat ?? Number(row.lat);
    const lng = body.lng ?? Number(row.lng);
    const provinceId = hasCoords ? await provinceAt(client, lat, lng) : row.province_id;
    const updated = await client.query<FavoriteRow>(
      `update favorite_places
          set kind = $3, name = $4, address = $5, geom = ST_SetSRID(ST_Point($7,$6),4326), province_id = $8, updated_at = now()
        where id = $1 and user_id = $2
        returning id, kind, name, address, ST_Y(geom) as lat, ST_X(geom) as lng, province_id, created_at`,
      [favoriteId, principal.userId, body.kind ?? row.kind, name, address, lat, lng, provinceId]
    );
    return toFavorite(updated.rows[0]!);
  });
}

export async function deleteFavorite(pool: Pool, principal: AuthPrincipal, favoriteId: string): Promise<void> {
  await tx(pool, async client => {
    const found = await client.query<{ id: string }>(
      `select id from favorite_places where id = $1 and user_id = $2 for update`, [favoriteId, principal.userId]
    );
    if (!found.rowCount) throw err("FAVORITE_NOT_FOUND", 404, "El destino no existe.");
    const uses = await client.query<{ id: string }>(
      `select id from routine_entries where user_id = $1 and (from_place_id = $2 or to_place_id = $2) order by id`,
      [principal.userId, favoriteId]
    );
    if (uses.rowCount) {
      throw err("FAVORITE_IN_USE", 409, "Este destino se usa en tu rutina semanal. Quítalo de la rutina antes de eliminarlo.", {
        entryIds: uses.rows.map(row => row.id)
      });
    }
    await client.query(`delete from favorite_places where id = $1 and user_id = $2`, [favoriteId, principal.userId]);
    await writeAudit(client, { actorUserId: principal.userId, action: "favorite.deleted", entityType: "favorite_place", entityId: favoriteId });
  });
}
