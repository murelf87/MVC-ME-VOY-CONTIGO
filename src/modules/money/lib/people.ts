import { moneyDefined, moneyPending, type MoneyDto, type PublicUserDto } from "../../../lib/dto.js";
import { publicPhotoUrl } from "../../trust/public-photo-url.js";
import type { Queryable } from "./db.js";
import { toIso } from "./db.js";
import type { MoneyTripRefDto } from "../types.js";

/** Importe definido, o «Por definir» si el servidor no puede derivarlo (null). Nunca inventa un 0. */
export function centsToMoney(cents: number | null | undefined): MoneyDto {
  return cents === null || cents === undefined ? moneyPending() : moneyDefined(cents);
}

const NBSP = " ";

/** «4,00 €» (es-ES) para textos de notificaciones. */
export function formatEuros(cents: number): string {
  const euros = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100)
    .toString()
    .padStart(2, "0");
  const grouped = Math.abs(euros).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = cents < 0 ? "-" : "";
  return `${sign}${grouped},${rest}${NBSP}€`;
}

export function unknownUser(id: string): PublicUserDto {
  return { id, displayName: "Usuario MVC", firstName: "Usuario", photoUrl: null, ratingAverage: null, ratingCount: 0 };
}

/**
 * Datos públicos de otras personas (nunca teléfono ni datos privados).
 * `photoUrl` usa el servicio del módulo `trust` (`publicPhotoUrl`: solo fotos APROBADAS; null si no hay).
 * La valoración (`ratingAverage`/`ratingCount`) no se lee desde `money`: se devuelve null / 0 (los totales de valoración
 * los calcula el módulo `live`; no se duplica esa lógica aquí). Todo se centraliza en este punto para cambiarlo en un solo sitio.
 */
export async function loadPublicUsers(
  db: Queryable,
  ids: ReadonlyArray<string | null | undefined>
): Promise<Map<string, PublicUserDto>> {
  const unique = [...new Set(ids.filter((id): id is string => typeof id === "string"))];
  const users = new Map<string, PublicUserDto>();
  if (unique.length === 0) return users;
  const result = await db.query<{
    id: string;
    display_name: string | null;
    public_photo_key: string | null;
    public_photo_status: string | null;
  }>(
    `select u.id, p.display_name, p.public_photo_key, p.public_photo_status::text as public_photo_status
       from app_users u left join profiles p on p.user_id=u.id
      where u.id = any($1::uuid[])`,
    [unique]
  );
  for (const row of result.rows) {
    const displayName = row.display_name?.trim() || "Usuario MVC";
    users.set(row.id, {
      id: row.id,
      displayName,
      firstName: displayName.split(/\s+/)[0] ?? displayName,
      photoUrl: publicPhotoUrl(row.id, row.public_photo_key, row.public_photo_status),
      ratingAverage: null,
      ratingCount: 0
    });
  }
  return users;
}

export function userFrom(users: Map<string, PublicUserDto>, id: string): PublicUserDto {
  return users.get(id) ?? unknownUser(id);
}

export type TripRefRow = {
  trip_id: string;
  departure_at: Date | string | null;
  origin_label: string | null;
  destination_label: string | null;
};

/** SQL común: etiquetas de los puntos de recogida/bajada de una solicitud (`r`) sobre `trip_stops`. */
export const STOP_LABEL_JOINS = `
  left join trip_stops so on so.trip_id=r.trip_id and so.seq=r.from_segment_seq
  left join trip_stops sd on sd.trip_id=r.trip_id and sd.seq=r.to_segment_seq`;

export function tripRef(row: TripRefRow): MoneyTripRefDto {
  return {
    tripId: row.trip_id,
    departureAt: toIso(row.departure_at),
    originLabel: row.origin_label,
    destinationLabel: row.destination_label
  };
}
