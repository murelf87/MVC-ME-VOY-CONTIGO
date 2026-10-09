/** `GET|PATCH /v1/me/settings` (comms.md §5): ajustes de la cuenta de la pantalla 34. SIMULACIÓN (solo vista previa). */
import type { PreviewDb, PreviewRouter } from "@/preview";
import { iso, photoUrlFor } from "@/preview";
import { deletionsTable, settingsTable, type FontScaleName } from "./helpStore";

interface SettingsPatchBody {
  shareLiveLocationInTrip?: boolean;
  fontScale?: FontScaleName;
  language?: "es";
}

export function settingsWire(db: PreviewDb, userId: string) {
  const row = settingsTable(db).get(userId);
  const user = db.users.get(userId);
  const profile = db.profiles.get(userId);
  const roles = db.userRoles
    .filter((entry) => entry.user_id === userId)
    .map((entry) => entry.role)
    .sort();
  const pending = deletionsTable(db).find((request) => request.user_id === userId && (request.status === "scheduled" || request.status === "blocked"));
  return {
    shareLiveLocationInTrip: row?.share_live_location_in_trip ?? true,
    fontScale: row?.font_scale ?? "normal",
    language: "es" as const,
    updatedAt: row ? iso(row.updated_at) : null,
    account: {
      userId,
      displayName: profile?.display_name ?? null,
      photoUrl: photoUrlFor(profile),
      roles,
      phoneE164: user?.phone_e164 ?? null,
      pendingDeletion: pending ? { requestId: pending.id, scheduledFor: iso(pending.scheduled_for) } : null,
    },
  };
}

export function registerSettingsPreview(r: PreviewRouter, db: PreviewDb): void {
  r.get("/v1/me/settings", { summary: "Mis ajustes (tamaño de letra, ubicación en viaje) y datos de la cuenta", tags: ["settings"] }, (req) =>
    settingsWire(db, req.auth().userId)
  );

  r.patch<{ Body: SettingsPatchBody }>(
    "/v1/me/settings",
    {
      summary: "Cambiar ajustes (parcial)",
      tags: ["settings"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            shareLiveLocationInTrip: { type: "boolean" },
            fontScale: { type: "string", enum: ["small", "normal", "large", "extra_large"] },
            language: { type: "string", enum: ["es"] },
          },
        },
      },
    },
    (req) => {
      const principal = req.auth();
      const patch = req.body;
      const table = settingsTable(db);
      const existing = table.get(principal.userId);
      const changed = patch.shareLiveLocationInTrip !== undefined || patch.fontScale !== undefined || patch.language !== undefined;
      if (changed) {
        table.put({
          user_id: principal.userId,
          share_live_location_in_trip: patch.shareLiveLocationInTrip ?? existing?.share_live_location_in_trip ?? true,
          font_scale: patch.fontScale ?? existing?.font_scale ?? "normal",
          language: "es",
          updated_at: db.nowMs(),
        });
      }
      return settingsWire(db, principal.userId);
    }
  );
}
