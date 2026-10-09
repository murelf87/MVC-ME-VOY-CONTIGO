/**
 * Avisos de la persona en el backend en memoria de la vista previa (SIMULACIÓN, solo con `EXPO_PUBLIC_PREVIEW=1`).
 * Contrato `docs/contracts/comms.md` §1: lista con filtro y cursor, contadores, marcar leída(s), preferencias y registro de
 * dispositivos push.
 *
 * Reglas fieles al backend real:
 *  - «Avisos esenciales del viaje» NO se pueden desactivar (`422 ESSENTIAL_NOTICES_LOCKED`) y los avisos esenciales nunca se
 *    suprimen. Opcionales = `arrival_*` y la categoría `message`; si la persona los desactiva no se listan ni se cuentan.
 *  - No hay proveedor push: `push.available=false`, `reason="PROVIDER_DISABLED"`. Registrar un dispositivo se guarda (el token
 *    es único y pasa a quien lo registra) pero hoy no se envía nada fuera de la app.
 */
import type {
  AppNotification,
  NotificationCategory,
  NotificationPage,
  NotificationPreferences,
  NotificationPreferencesPatch,
  NotificationReadAllRequest,
  NotificationReadAllResponse,
  NotificationUnreadCount,
  PushTokenInfo,
  PushTokenRegistration,
} from "@/api/types";
import { fail, isoReq, reply, uuidParam } from "@/preview";
import type { JsonSchema, PreviewDb, PreviewRouter } from "@/preview";
import { tablesOf, type NotificationRow, type PreferencesRow, type PushTokenRow } from "./rows";

const CATEGORIES: readonly NotificationCategory[] = ["trip", "message", "payment", "system"];
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

const pageQuery: JsonSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: [...CATEGORIES] },
    unread: { type: "boolean" },
    limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
    cursor: { type: "string", maxLength: 100 },
  },
};

const encodeCursor = (offset: number): string => `n1.${offset}`;
function decodeCursor(cursor: string): number {
  const match = /^n1\.(\d{1,9})$/.exec(cursor);
  if (!match) return fail("INVALID_CURSOR", "El cursor no es válido.", 400);
  return Number(match[1]);
}

// ── Preferencias ──────────────────────────────────────────────────────────────────────────────────────────────────────

export function preferencesOf(db: PreviewDb, userId: string): Readonly<PreferencesRow> {
  return tablesOf(db).preferences.get(userId) ?? { user_id: userId, arrival_alerts: true, messages: true, updated_at: 0 };
}

function preferencesWire(db: PreviewDb, userId: string): NotificationPreferences {
  const prefs = preferencesOf(db, userId);
  return {
    essentialTripNotices: true,
    arrivalAlerts: prefs.arrival_alerts,
    messages: prefs.messages,
    push: { available: false, provider: "disabled", reason: "PROVIDER_DISABLED", registeredDevices: tablesOf(db).pushTokens.filter((t) => t.user_id === userId).length },
    updatedAt: prefs.updated_at === 0 ? null : isoReq(prefs.updated_at),
  };
}

/** `true` si el aviso se ve (no está suprimido y la persona no ha desactivado ese tipo opcional). */
function visibleTo(db: PreviewDb, row: Readonly<NotificationRow>): boolean {
  if (row.delivery_state === "suppressed") return false;
  if (row.essential) return true;
  const prefs = preferencesOf(db, row.user_id);
  if (row.kind.startsWith("arrival_")) return prefs.arrival_alerts;
  if (row.category === "message") return prefs.messages;
  return true;
}

function wire(row: Readonly<NotificationRow>): AppNotification {
  return {
    id: row.id,
    category: row.category,
    kind: row.kind,
    title: row.title,
    body: row.body,
    data: row.data as AppNotification["data"],
    essential: row.essential,
    read: row.read_at !== null,
    readAt: row.read_at === null ? null : isoReq(row.read_at),
    createdAt: isoReq(row.created_at),
  };
}

/** Los avisos visibles de la persona, los más recientes primero (con el reloj parado, lo insertado después sale antes). */
function mineOf(db: PreviewDb, userId: string): Array<Readonly<NotificationRow>> {
  const rows = tablesOf(db).notifications.filter((n) => n.user_id === userId && visibleTo(db, n));
  return [...rows].reverse().sort((a, b) => b.created_at - a.created_at);
}

function counts(db: PreviewDb, userId: string): NotificationUnreadCount {
  const byCategory: Record<NotificationCategory, number> = { trip: 0, message: 0, payment: 0, system: 0 };
  let total = 0;
  for (const row of mineOf(db, userId)) {
    if (row.read_at !== null) continue;
    byCategory[row.category] += 1;
    total += 1;
  }
  return { total, byCategory };
}

// ── Push ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

function pushWire(row: Readonly<PushTokenRow>): PushTokenInfo {
  return {
    id: row.id,
    platform: row.platform,
    provider: row.provider,
    deviceId: row.device_id,
    appVersion: row.app_version,
    createdAt: isoReq(row.created_at),
    lastSeenAt: isoReq(row.last_seen_at),
  };
}

const EXPO_TOKEN = /^Expo(nent)?PushToken\[[^\]]+\]$/;

export function registerNotifications(r: PreviewRouter, db: PreviewDb): void {
  const t = (): ReturnType<typeof tablesOf> => tablesOf(db);

  r.get<{ Query: { category?: NotificationCategory; unread?: boolean; limit?: number; cursor?: string } }>(
    "/v1/notifications",
    { summary: "Mis avisos (más recientes primero)", tags: ["comms"], schema: { querystring: pageQuery } },
    (req): NotificationPage => {
      const me = req.auth().userId;
      const { category, unread, cursor } = req.query;
      const limit = req.query.limit ?? DEFAULT_LIMIT;
      const offset = cursor === undefined || cursor === "" ? 0 : decodeCursor(cursor);
      const all = mineOf(db, me).filter((n) => (category === undefined || n.category === category) && (unread !== true || n.read_at === null));
      const items = all.slice(offset, offset + limit).map(wire);
      const next = offset + items.length;
      return { items, nextCursor: next < all.length ? encodeCursor(next) : null, unreadCount: counts(db, me).total };
    },
  );

  r.get("/v1/notifications/unread-count", { summary: "Contadores de avisos sin leer", tags: ["comms"] }, (req): NotificationUnreadCount => counts(db, req.auth().userId));

  r.post<{ Params: { notificationId: string } }>(
    "/v1/notifications/:notificationId/read",
    { summary: "Marcar un aviso como leído (idempotente)", tags: ["comms"], schema: { params: uuidParam("notificationId") } },
    (req): AppNotification => {
      const row = t().notifications.get(req.params.notificationId);
      if (!row || row.user_id !== req.auth().userId) return fail("NOTIFICATION_NOT_FOUND", "El aviso no existe.", 404);
      return wire(row.read_at === null ? t().notifications.update(row.id, { read_at: db.nowMs() }) : row);
    },
  );

  r.post<{ Body: NotificationReadAllRequest | undefined }>(
    "/v1/notifications/read-all",
    {
      summary: "Marcar todos los avisos como leídos",
      tags: ["comms"],
      schema: { body: { type: "object", additionalProperties: false, properties: { category: { type: "string", enum: [...CATEGORIES] } } } },
    },
    (req): NotificationReadAllResponse => {
      const me = req.auth().userId;
      const category = req.body?.category;
      const now = db.nowMs();
      let updated = 0;
      for (const row of mineOf(db, me)) {
        if (row.read_at !== null || (category !== undefined && row.category !== category)) continue;
        t().notifications.update(row.id, { read_at: now });
        updated += 1;
      }
      return { updated };
    },
  );

  r.get("/v1/me/notification-preferences", { summary: "Preferencias de avisos", tags: ["comms"] }, (req): NotificationPreferences => preferencesWire(db, req.auth().userId));

  r.patch<{ Body: NotificationPreferencesPatch }>(
    "/v1/me/notification-preferences",
    {
      summary: "Cambiar preferencias de avisos",
      tags: ["comms"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: { essentialTripNotices: { type: "boolean" }, arrivalAlerts: { type: "boolean" }, messages: { type: "boolean" } },
        },
      },
    },
    (req): NotificationPreferences => {
      const me = req.auth().userId;
      const patch = req.body;
      if (patch.essentialTripNotices === false) return fail("ESSENTIAL_NOTICES_LOCKED", "Los avisos esenciales del viaje no se pueden desactivar.", 422);
      const current = preferencesOf(db, me);
      const next: PreferencesRow = {
        user_id: me,
        arrival_alerts: patch.arrivalAlerts ?? current.arrival_alerts,
        messages: patch.messages ?? current.messages,
        updated_at: db.nowMs(),
      };
      if (t().preferences.has(me)) t().preferences.update(me, next);
      else t().preferences.insert(next);
      return preferencesWire(db, me);
    },
  );

  r.post<{ Body: PushTokenRegistration }>(
    "/v1/me/push-tokens",
    {
      summary: "Registrar el dispositivo para avisos push",
      tags: ["comms"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["token", "platform", "provider"],
          properties: {
            token: { type: "string" },
            platform: { type: "string", enum: ["ios", "android", "web"] },
            provider: { type: "string", enum: ["expo", "fcm", "apns"] },
            deviceId: { type: "string", maxLength: 100 },
            appVersion: { type: "string", maxLength: 40 },
            locale: { type: "string", maxLength: 20 },
          },
        },
      },
    },
    (req) => {
      const me = req.auth().userId;
      const body = req.body;
      if (body.token.length < 16 || body.token.length > 4096 || (body.provider === "expo" && !EXPO_TOKEN.test(body.token))) {
        return fail("PUSH_TOKEN_INVALID", "El identificador del dispositivo no es válido.", 422);
      }
      const now = db.nowMs();
      const existing = t().pushTokens.find((x) => x.token === body.token);
      if (existing) {
        return pushWire(
          t().pushTokens.update(existing.id, {
            user_id: me,
            platform: body.platform,
            provider: body.provider,
            device_id: body.deviceId ?? existing.device_id,
            app_version: body.appVersion ?? existing.app_version,
            locale: body.locale ?? existing.locale,
            last_seen_at: now,
          }),
        );
      }
      const row = t().pushTokens.insert({
        id: db.ids.uuid(),
        user_id: me,
        token: body.token,
        platform: body.platform,
        provider: body.provider,
        device_id: body.deviceId ?? null,
        app_version: body.appVersion ?? null,
        locale: body.locale ?? null,
        created_at: now,
        last_seen_at: now,
      });
      return reply.created(pushWire(row));
    },
  );

  r.get<{ Query: { limit?: number; cursor?: string } }>(
    "/v1/me/push-tokens",
    { summary: "Mis dispositivos registrados", tags: ["comms"], schema: { querystring: { type: "object", properties: { limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT }, cursor: { type: "string" } } } } },
    (req) => {
      const rows = t().pushTokens.filter((x) => x.user_id === req.auth().userId).sort((a, b) => b.created_at - a.created_at);
      return { items: rows.slice(0, req.query.limit ?? DEFAULT_LIMIT).map(pushWire), nextCursor: null };
    },
  );

  r.delete<{ Params: { tokenId: string } }>(
    "/v1/me/push-tokens/:tokenId",
    { summary: "Dar de baja un dispositivo", tags: ["comms"], schema: { params: uuidParam("tokenId") } },
    (req) => {
      const row = t().pushTokens.get(req.params.tokenId);
      if (!row || row.user_id !== req.auth().userId) return fail("PUSH_TOKEN_NOT_FOUND", "El dispositivo no existe.", 404);
      t().pushTokens.delete(row.id);
      return reply.noContent();
    },
  );
}
