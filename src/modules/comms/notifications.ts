import type { Pool } from "pg";
import { writeAudit } from "../../lib/audit.js";
import { decodeTimeIdCursor, encodeCursor, iso, isoOrNull, pageLimit, tsUs, tx, type Queryable } from "./common.js";
import type { CommsConfig } from "./config.js";
import { err } from "./errors.js";

export type NotificationCategory = "trip" | "message" | "payment" | "system";
export const NOTIFICATION_CATEGORIES: readonly NotificationCategory[] = ["trip", "message", "payment", "system"];

/**
 * Un aviso es OPCIONAL (el usuario puede desactivarlo) solo si es una alerta de llegada (`arrival_*`) o un aviso de
 * mensaje (categoría `message`). Todo lo demás es esencial. Debe coincidir con el disparador de la migración 060.
 */
export function isEssentialNotification(kind: string, category: string): boolean {
  return !(kind.startsWith("arrival_") || category === "message");
}

export type NotificationDto = {
  id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  essential: boolean;
  read: boolean;
  readAt: string | null;
  createdAt: string;
};

type NotificationRow = {
  id: string;
  category: NotificationCategory;
  kind: string;
  title: string;
  body: string;
  data: unknown;
  read_at: Date | null;
  created_at: Date;
};

function toDto(row: NotificationRow): NotificationDto {
  const data = row.data && typeof row.data === "object" && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
  return {
    id: row.id,
    category: row.category,
    kind: row.kind,
    title: row.title,
    body: row.body,
    data,
    essential: isEssentialNotification(row.kind, row.category),
    read: row.read_at !== null,
    readAt: isoOrNull(row.read_at),
    createdAt: iso(row.created_at)
  };
}

const COLUMNS = "n.id, n.category, n.kind, n.title, n.body, n.data, n.read_at, n.created_at";

export async function listNotifications(
  db: Queryable,
  userId: string,
  input: { category?: NotificationCategory; unread?: boolean; limit?: number; cursor?: string }
): Promise<{ items: NotificationDto[]; nextCursor: string | null; unreadCount: number }> {
  const limit = pageLimit(input.limit);
  const params: unknown[] = [userId];
  let where = "n.user_id = $1 and n.delivery_state = 'delivered'";
  if (input.category) {
    params.push(input.category);
    where += ` and n.category = $${params.length}`;
  }
  if (input.unread) where += " and n.read_at is null";
  if (input.cursor) {
    const cursor = decodeTimeIdCursor(input.cursor);
    params.push(cursor.t, cursor.id);
    where += ` and (n.created_at, n.id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`;
  }
  params.push(limit + 1);
  const rows = await db.query<NotificationRow & { created_us: string }>(
    `select ${COLUMNS}, ${tsUs("n.created_at")} as created_us
       from notifications n
      where ${where}
      order by n.created_at desc, n.id desc
      limit $${params.length}`,
    params
  );
  const page = rows.rows.slice(0, limit);
  const last = page[page.length - 1];
  const nextCursor = rows.rows.length > limit && last ? encodeCursor({ t: last.created_us, id: last.id }) : null;
  const unread = await db.query<{ total: number }>(
    `select count(*)::int as total from notifications
      where user_id = $1 and delivery_state = 'delivered' and read_at is null`,
    [userId]
  );
  return { items: page.map(toDto), nextCursor, unreadCount: unread.rows[0]?.total ?? 0 };
}

export async function unreadCounts(
  db: Queryable,
  userId: string
): Promise<{ total: number; byCategory: Record<NotificationCategory, number> }> {
  const rows = await db.query<{ category: NotificationCategory; total: number }>(
    `select category, count(*)::int as total
       from notifications
      where user_id = $1 and delivery_state = 'delivered' and read_at is null
      group by category`,
    [userId]
  );
  const byCategory: Record<NotificationCategory, number> = { trip: 0, message: 0, payment: 0, system: 0 };
  let total = 0;
  for (const row of rows.rows) {
    byCategory[row.category] = row.total;
    total += row.total;
  }
  return { total, byCategory };
}

export async function markNotificationRead(db: Queryable, userId: string, notificationId: string): Promise<NotificationDto> {
  const updated = await db.query<NotificationRow>(
    `update notifications n
        set read_at = coalesce(n.read_at, now())
      where n.id = $1 and n.user_id = $2 and n.delivery_state = 'delivered'
      returning ${COLUMNS}`,
    [notificationId, userId]
  );
  const row = updated.rows[0];
  if (!row) throw err("NOTIFICATION_NOT_FOUND", 404, "No encontramos esa notificación.");
  return toDto(row);
}

export async function markAllNotificationsRead(
  db: Queryable,
  userId: string,
  category?: NotificationCategory
): Promise<{ updated: number }> {
  const params: unknown[] = [userId];
  let extra = "";
  if (category) {
    params.push(category);
    extra = ` and category = $2`;
  }
  const result = await db.query(
    `update notifications set read_at = now()
      where user_id = $1 and read_at is null and delivery_state = 'delivered'${extra}`,
    params
  );
  return { updated: result.rowCount ?? 0 };
}

/* ───────────── Preferencias ───────────── */

export type PushDeliveryStatusDto = {
  available: boolean;
  provider: string;
  reason: "PROVIDER_DISABLED" | null;
  registeredDevices: number;
};

export type NotificationPreferencesDto = {
  essentialTripNotices: true;
  arrivalAlerts: boolean;
  messages: boolean;
  push: PushDeliveryStatusDto;
  updatedAt: string | null;
};

async function pushStatus(db: Queryable, userId: string, config: CommsConfig): Promise<PushDeliveryStatusDto> {
  const devices = await db.query<{ total: number }>(
    `select count(*)::int as total from push_tokens where user_id = $1 and disabled_at is null`,
    [userId]
  );
  return {
    available: false,
    provider: config.pushProvider,
    reason: "PROVIDER_DISABLED",
    registeredDevices: devices.rows[0]?.total ?? 0
  };
}

export async function getNotificationPreferences(
  db: Queryable,
  userId: string,
  config: CommsConfig
): Promise<NotificationPreferencesDto> {
  const row = (await db.query<{ arrival_alerts: boolean; message_notices: boolean; updated_at: Date }>(
    `select arrival_alerts, message_notices, updated_at from notification_preferences where user_id = $1`,
    [userId]
  )).rows[0];
  return {
    // Siempre true: es una invariante del producto, no un dato configurable.
    essentialTripNotices: true,
    arrivalAlerts: row?.arrival_alerts ?? true,
    messages: row?.message_notices ?? true,
    push: await pushStatus(db, userId, config),
    updatedAt: isoOrNull(row?.updated_at)
  };
}

export async function updateNotificationPreferences(
  pool: Pool,
  userId: string,
  patch: { essentialTripNotices?: boolean | undefined; arrivalAlerts?: boolean | undefined; messages?: boolean | undefined },
  config: CommsConfig
): Promise<NotificationPreferencesDto> {
  // Los avisos esenciales del viaje no se pueden desactivar (capa 1 de 3: servicio; capa 2: CHECK en BD; capa 3: filtro de entrega).
  if (patch.essentialTripNotices === false) {
    throw err("ESSENTIAL_NOTICES_LOCKED", 422, "Los avisos esenciales del viaje no se pueden desactivar.");
  }
  const changed = (["arrivalAlerts", "messages"] as const).filter(key => patch[key] !== undefined);
  if (changed.length > 0) {
    await tx(pool, async client => {
      await client.query(
        `insert into notification_preferences(user_id, arrival_alerts, message_notices)
         values($1, coalesce($2::boolean, true), coalesce($3::boolean, true))
         on conflict (user_id) do update
           set arrival_alerts = coalesce($2::boolean, notification_preferences.arrival_alerts),
               message_notices = coalesce($3::boolean, notification_preferences.message_notices),
               updated_at = now()`,
        [userId, patch.arrivalAlerts ?? null, patch.messages ?? null]
      );
      await writeAudit(client, {
        actorUserId: userId,
        action: "notifications.preferences.updated",
        entityType: "user",
        entityId: userId,
        metadata: { fields: changed, arrivalAlerts: patch.arrivalAlerts ?? null, messages: patch.messages ?? null }
      });
    });
  }
  return getNotificationPreferences(pool, userId, config);
}

/* ───────────── Dispositivos push ───────────── */

export type PushTokenDto = {
  id: string;
  platform: "ios" | "android" | "web";
  provider: "expo" | "fcm" | "apns";
  deviceId: string | null;
  appVersion: string | null;
  createdAt: string;
  lastSeenAt: string;
};

type PushTokenRow = {
  id: string;
  platform: PushTokenDto["platform"];
  provider: PushTokenDto["provider"];
  device_id: string | null;
  app_version: string | null;
  created_at: Date;
  last_seen_at: Date;
};

const PUSH_COLUMNS = "id, platform, provider, device_id, app_version, created_at, last_seen_at";
const MAX_PUSH_TOKENS_PER_USER = 20;

function toPushDto(row: PushTokenRow): PushTokenDto {
  return {
    id: row.id,
    platform: row.platform,
    provider: row.provider,
    deviceId: row.device_id,
    appVersion: row.app_version,
    createdAt: iso(row.created_at),
    lastSeenAt: iso(row.last_seen_at)
  };
}

const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,}\]$/;
const NATIVE_TOKEN_RE = /^[\w:.\-/+=]{16,4096}$/;

export async function registerPushToken(
  pool: Pool,
  userId: string,
  input: {
    token: string;
    platform: PushTokenDto["platform"];
    provider: PushTokenDto["provider"];
    deviceId?: string | undefined;
    appVersion?: string | undefined;
    locale?: string | undefined;
  }
): Promise<{ token: PushTokenDto; created: boolean }> {
  const token = input.token.trim();
  const valid = input.provider === "expo" ? EXPO_TOKEN_RE.test(token) : NATIVE_TOKEN_RE.test(token);
  if (!valid) throw err("PUSH_TOKEN_INVALID", 422, "El token de notificaciones push no tiene un formato válido.");

  return tx(pool, async client => {
    // Un token pertenece a una sola persona: si otra cuenta lo tenía (dispositivo prestado), pasa a quien lo registra ahora.
    const result = await client.query<PushTokenRow & { inserted: boolean }>(
      `insert into push_tokens(user_id, platform, provider, token, device_id, app_version, locale)
       values($1, $2, $3, $4, $5, $6, $7)
       on conflict (provider, token) do update
         set user_id = excluded.user_id, platform = excluded.platform, device_id = excluded.device_id,
             app_version = excluded.app_version, locale = excluded.locale, last_seen_at = now(), disabled_at = null
       returning ${PUSH_COLUMNS}, (xmax = 0) as inserted`,
      [userId, input.platform, input.provider, token, input.deviceId ?? null, input.appVersion ?? null, input.locale ?? null]
    );
    const row = result.rows[0];
    if (!row) throw new Error("push token upsert returned no row");
    if (input.deviceId) {
      // El token del mismo dispositivo rotó: se retira el anterior.
      await client.query(
        `delete from push_tokens where user_id = $1 and device_id = $2 and platform = $3 and id <> $4`,
        [userId, input.deviceId, input.platform, row.id]
      );
    }
    await client.query(
      `delete from push_tokens
        where id in (
          select id from push_tokens where user_id = $1
           order by last_seen_at desc offset $2
        )`,
      [userId, MAX_PUSH_TOKENS_PER_USER]
    );
    return { token: toPushDto(row), created: row.inserted };
  });
}

export async function listPushTokens(db: Queryable, userId: string): Promise<PushTokenDto[]> {
  const rows = await db.query<PushTokenRow>(
    `select ${PUSH_COLUMNS} from push_tokens
      where user_id = $1 and disabled_at is null
      order by last_seen_at desc, id`,
    [userId]
  );
  return rows.rows.map(toPushDto);
}

export async function deletePushToken(db: Queryable, userId: string, tokenId: string): Promise<void> {
  const result = await db.query(`delete from push_tokens where id = $1 and user_id = $2`, [tokenId, userId]);
  if (!result.rowCount) throw err("PUSH_TOKEN_NOT_FOUND", 404, "No encontramos ese dispositivo.");
}
