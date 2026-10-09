/**
 * Datos de ejemplo del slice `profile` (SIMULACIÓN): destinos y rutina de la lámina 31.
 * Torre Sevilla · Universidad Pablo de Olavide · Nervión (Sevilla). Coordenadas aproximadas, solo para la vista previa.
 */
import { SEED_USER_IDS, madridDate, profileUserId } from "@/preview";
import type { PreviewDb, PreviewProfileId } from "@/preview";
import type { Weekday } from "@/api/types";
import { addDaysToDate, isoWeekdayOf } from "@/preview";
import { entries, favorites, offers, suspensions, type FavoriteRow } from "./routine";

export const PROFILE_SEED_VARIANTS: Readonly<Record<string, string>> = {
  "profile-routine": "Lámina 31: destinos Trabajo, Campus y Casa, rutina Casa → Campus de lunes a viernes 07:30 y plaza semanal (1 plaza). Persona conductora.",
  "profile-routine-empty": "Sin destinos ni rutina: estados vacíos de la lámina 31.",
  "profile-routine-places": "Tres destinos y ninguna fila de rutina.",
  "profile-routine-suspended": "Igual que «profile-routine» con la próxima semana suspendida.",
  "profile-favorites-full": "20 destinos guardados (límite): «Añadir» responde 409 FAVORITES_LIMIT_REACHED.",
};

const PLACES = [
  { kind: "work", name: "Trabajo", address: "Torre Sevilla, Sevilla", lat: 37.4047, lng: -6.0035 },
  { kind: "campus", name: "Campus", address: "U. Pablo de Olavide, Sevilla", lat: 37.3547, lng: -5.9358 },
  { kind: "home", name: "Casa", address: "Sevilla (Nervión)", lat: 37.3826, lng: -5.9697 },
] as const;

function addPlaces(db: PreviewDb, userId: string): FavoriteRow[] {
  const province = db.provinces.all()[0]?.id ?? null;
  const base = db.nowMs() - 20 * 86_400_000;
  return PLACES.map((p, i) => favorites(db).insert({ id: db.ids.uuid(), user_id: userId, ...p, province_id: province, created_at: base + i * 1000 }));
}

export function seedProfileSlice(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  if (!(seed in PROFILE_SEED_VARIANTS)) return;
  const userId = profileUserId(profile) ?? SEED_USER_IDS.ana;
  if (seed === "profile-routine-empty") return;
  const places = addPlaces(db, userId);
  if (seed === "profile-favorites-full") {
    const province = db.provinces.all()[0]?.id ?? null;
    for (let i = places.length; i < 20; i += 1) {
      favorites(db).insert({ id: db.ids.uuid(), user_id: userId, kind: "other", name: `Destino ${i + 1}`, address: `Calle ${i + 1}, Sevilla`, lat: 37.38 + i * 0.001, lng: -5.98, province_id: province, created_at: db.nowMs() + i });
    }
    return;
  }
  if (seed === "profile-routine-places") return;
  const home = places.find((p) => p.kind === "home");
  const campus = places.find((p) => p.kind === "campus");
  if (home === undefined || campus === undefined) return;
  const days: Weekday[] = ["mon", "tue", "wed", "thu", "fri"];
  days.forEach((weekday, i) => entries(db).insert({ id: db.ids.uuid(), user_id: userId, weekday, time: "07:30", from_place_id: home.id, to_place_id: campus.id, enabled: true, created_at: db.nowMs() + i }));
  offers(db).insert({ id: userId, enabled: true, seats: 1 });
  if (seed === "profile-routine-suspended") {
    const today = madridDate(db.nowMs());
    const next = addDaysToDate(today, 8 - isoWeekdayOf(today));
    suspensions(db).insert({ id: `${userId}:${next}`, user_id: userId, week_start: next, created_at: db.nowMs() });
  }
}
