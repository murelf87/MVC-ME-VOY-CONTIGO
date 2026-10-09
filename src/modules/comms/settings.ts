import { writeAudit } from "../../lib/audit.js";
import { iso, isoOrNull, toPublicUser, type Queryable } from "./common.js";
import type { CommsConfig } from "./config.js";

export type FontScale = "small" | "normal" | "large" | "extra_large";

export type UserSettingsDto = {
  shareLiveLocationInTrip: boolean;
  fontScale: FontScale;
  language: "es";
  updatedAt: string | null;
  account: {
    userId: string;
    displayName: string | null;
    photoUrl: string | null;
    roles: string[];
    phoneE164: string | null;
    pendingDeletion: { requestId: string; scheduledFor: string } | null;
  };
};

export type UserSettingsPatch = {
  shareLiveLocationInTrip?: boolean | undefined;
  fontScale?: FontScale | undefined;
  language?: "es" | undefined;
};

export async function getUserSettings(db: Queryable, userId: string, config: CommsConfig): Promise<UserSettingsDto> {
  const [settings, account, pending] = await Promise.all([
    db.query<{ share_live_location_in_trip: boolean; font_scale: FontScale; language: "es"; updated_at: Date }>(
      `select share_live_location_in_trip, font_scale, language, updated_at from user_settings where user_id = $1`,
      [userId]
    ),
    db.query<{
      user_id: string;
      phone_e164: string | null;
      display_name: string | null;
      public_photo_key: string | null;
      public_photo_status: string | null;
      user_status: string;
      roles: string[];
    }>(
      `select u.id as user_id, u.phone_e164, p.display_name, p.public_photo_key, p.public_photo_status::text as public_photo_status,
              u.status::text as user_status,
              coalesce(array(select r.role::text from user_roles r where r.user_id = u.id order by r.role::text), '{}') as roles
         from app_users u left join profiles p on p.user_id = u.id
        where u.id = $1`,
      [userId]
    ),
    db.query<{ id: string; scheduled_for: Date }>(
      `select id, scheduled_for from account_deletion_requests
        where user_id = $1 and status in ('scheduled','blocked','processing')
        order by requested_at desc limit 1`,
      [userId]
    )
  ]);
  const row = settings.rows[0];
  const acc = account.rows[0];
  const pendingRow = pending.rows[0];
  return {
    shareLiveLocationInTrip: row?.share_live_location_in_trip ?? true,
    fontScale: row?.font_scale ?? "normal",
    language: row?.language ?? "es",
    updatedAt: isoOrNull(row?.updated_at),
    account: {
      userId,
      displayName: acc?.display_name?.trim() || null,
      photoUrl: acc
        ? toPublicUser(
            {
              user_id: userId,
              display_name: acc.display_name,
              public_photo_key: acc.public_photo_key,
              public_photo_status: acc.public_photo_status,
              user_status: acc.user_status
            },
            config
          ).photoUrl
        : null,
      roles: acc?.roles ?? [],
      phoneE164: acc?.phone_e164 ?? null,
      pendingDeletion: pendingRow ? { requestId: pendingRow.id, scheduledFor: iso(pendingRow.scheduled_for) } : null
    }
  };
}

export async function updateUserSettings(db: Queryable, userId: string, patch: UserSettingsPatch, config: CommsConfig): Promise<UserSettingsDto> {
  const changed = (Object.keys(patch) as Array<keyof UserSettingsPatch>).filter(key => patch[key] !== undefined);
  if (changed.length > 0) {
    await db.query(
      `insert into user_settings(user_id, share_live_location_in_trip, font_scale, language)
       values ($1, coalesce($2::boolean, true), coalesce($3::text, 'normal'), coalesce($4::text, 'es'))
       on conflict (user_id) do update set
         share_live_location_in_trip = coalesce($2::boolean, user_settings.share_live_location_in_trip),
         font_scale = coalesce($3::text, user_settings.font_scale),
         language = coalesce($4::text, user_settings.language),
         updated_at = now()`,
      [userId, patch.shareLiveLocationInTrip ?? null, patch.fontScale ?? null, patch.language ?? null]
    );
    await writeAudit(db, {
      actorUserId: userId,
      action: "settings.updated",
      entityType: "user_settings",
      entityId: userId,
      metadata: {
        changed,
        ...(patch.shareLiveLocationInTrip !== undefined ? { shareLiveLocationInTrip: patch.shareLiveLocationInTrip } : {})
      }
    });
  }
  return getUserSettings(db, userId, config);
}

/** Lectura para otros módulos (live): ¿puede mostrarse la posición precisa de este usuario a los demás participantes? */
export async function getShareLiveLocationInTrip(db: Queryable, userId: string): Promise<boolean> {
  const result = await db.query<{ value: boolean }>(
    `select coalesce((select share_live_location_in_trip from user_settings where user_id = $1), true) as value`,
    [userId]
  );
  return result.rows[0]?.value ?? true;
}
