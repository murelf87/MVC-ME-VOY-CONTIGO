import type { Pool } from "pg";
import { isoOrNull, type Db } from "./common.js";
import type { LivePrivacyPreferences } from "./types.js";

/** Se vuelve true en cuanto se comprueba que existe `user_settings`; la tabla no desaparece, así que no se repite la consulta. */
let userSettingsKnown = false;

/**
 * Ajuste «Compartir ubicación en viaje — solo durante el trayecto activo» de una persona. Lo escribe `comms`
 * (`user_settings.share_live_location_in_trip`, migración 063; regla de producto en docs/contracts/comms.md §5 «Ajustes»).
 * `false` ⇒ los demás participantes solo ven su posición APROXIMADA.
 *  · Sin fila → true (valor por defecto del ajuste).
 *  · Sin la tabla (comms sin desplegar) nadie ha podido desactivarlo → true; no es un fallo silencioso de privacidad.
 */
export async function sharesPreciseLocation(db: Db, userId: string): Promise<boolean> {
  if (!userSettingsKnown) {
    const present = (await db.query<{ present: boolean }>(`select to_regclass('user_settings') is not null as present`)).rows[0];
    if (present?.present !== true) return true;
    userSettingsKnown = true;
  }
  const row = (await db.query<{ value: boolean }>(
    `select coalesce((select share_live_location_in_trip from user_settings where user_id=$1), true) as value`, [userId]
  )).rows[0];
  return row?.value !== false;
}

/** Por defecto un copasajero aparece como «1 pasajero» (sin nombre ni foto) hasta que él mismo lo cambie. */
export async function getLivePrivacy(pool: Pool, userId: string): Promise<LivePrivacyPreferences> {
  const row = (await pool.query<{ show_profile_to_copassengers: boolean; updated_at: Date }>(
    `select show_profile_to_copassengers, updated_at from live_privacy_preferences where user_id=$1`, [userId]
  )).rows[0];
  return {
    showProfileToCoPassengers: row ? row.show_profile_to_copassengers : false,
    updatedAt: row ? isoOrNull(row.updated_at) : null
  };
}

export async function setLivePrivacy(
  pool: Pool, userId: string, showProfileToCoPassengers: boolean, now: Date = new Date()
): Promise<LivePrivacyPreferences> {
  const row = (await pool.query<{ show_profile_to_copassengers: boolean; updated_at: Date }>(
    `insert into live_privacy_preferences(user_id, show_profile_to_copassengers, updated_at) values($1,$2,$3)
     on conflict (user_id) do update
       set show_profile_to_copassengers=excluded.show_profile_to_copassengers, updated_at=excluded.updated_at
     returning show_profile_to_copassengers, updated_at`,
    [userId, showProfileToCoPassengers, now]
  )).rows[0];
  if (!row) throw new Error("live privacy upsert returned no row");
  return { showProfileToCoPassengers: row.show_profile_to_copassengers, updatedAt: isoOrNull(row.updated_at) };
}
