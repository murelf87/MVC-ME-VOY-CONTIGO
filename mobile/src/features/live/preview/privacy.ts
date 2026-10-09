/**
 * Preferencia de privacidad del viaje en directo (contrato `live.md` §8): si las personas que comparten coche contigo
 * pueden ver tu nombre y foto en «En el coche» (por defecto no: verán «1 pasajero»). SIMULACIÓN (solo vista previa).
 */
import type { LivePrivacyPreferences } from "@/api/types";
import { iso } from "@/preview";
import type { PreviewDb, PreviewRouter } from "@/preview";
import { livePrivacy } from "./rows";

function preferencesOf(db: PreviewDb, userId: string): LivePrivacyPreferences {
  const row = livePrivacy(db).get(userId);
  return { showProfileToCoPassengers: row?.show_profile_to_co_passengers ?? false, updatedAt: iso(row?.updated_at ?? null) };
}

export function registerPrivacy(r: PreviewRouter, db: PreviewDb): void {
  r.get(
    "/v1/me/live-privacy",
    { summary: "Mi preferencia de privacidad en los viajes en directo", tags: ["live"] },
    (req) => preferencesOf(db, req.auth().userId)
  );

  r.put<{ Body: { showProfileToCoPassengers: boolean } }>(
    "/v1/me/live-privacy",
    {
      summary: "Cambiar mi preferencia de privacidad en los viajes en directo",
      tags: ["live"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["showProfileToCoPassengers"],
          properties: { showProfileToCoPassengers: { type: "boolean" } },
        },
      },
    },
    (req) => {
      const me = req.auth();
      livePrivacy(db).put({ id: me.userId, show_profile_to_co_passengers: req.body.showProfileToCoPassengers, updated_at: db.nowMs() });
      return preferencesOf(db, me.userId);
    }
  );
}
