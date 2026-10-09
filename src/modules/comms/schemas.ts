/**
 * Schemas JSON de Fastify del módulo `comms`. Producen EXACTAMENTE las formas de mobile/src/api/types/comms.ts:
 * las respuestas son objetos cerrados con todas sus propiedades requeridas (salvo las marcadas como opcionales).
 * Un campo que falte en el schema se perdería en silencio al serializar, por eso las pruebas comparan las claves de cada
 * respuesta con el contrato (tests/comms-http.integration.test.ts).
 * OpenAPI 3.0: los nulos se declaran con `nullable: true`.
 */
export type Schema = Record<string, unknown>;

/* ───────────── Constructores ───────────── */

export function obj(properties: Record<string, Schema>, optional: readonly string[] = []): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties).filter(key => !optional.includes(key)),
    properties
  };
}

export function arr(items: Schema): Schema {
  return { type: "array", items };
}

export function nul(schema: Schema): Schema {
  return { ...schema, nullable: true };
}

export function enumOf(values: readonly string[]): Schema {
  return { type: "string", enum: [...values] };
}

const str: Schema = { type: "string" };
const int: Schema = { type: "integer" };
const num: Schema = { type: "number" };
const bool: Schema = { type: "boolean" };
export const uuid: Schema = { type: "string", format: "uuid" };
const dt: Schema = { type: "string", format: "date-time" };
const anyObject: Schema = { type: "object", additionalProperties: true };

export function pageOf(item: Schema, extra: Record<string, Schema> = {}): Schema {
  return obj({ items: arr(item), nextCursor: nul(str), ...extra });
}

/* ───────────── Errores ───────────── */

export const errorSchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["error", "requestId"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message"],
      properties: { code: str, message: str, details: {} }
    },
    requestId: str
  }
};

export function errorResponses(...statuses: number[]): Record<number, Schema> {
  const out: Record<number, Schema> = {};
  for (const status of statuses) out[status] = errorSchema;
  return out;
}

/* ───────────── Parámetros de entrada ───────────── */

export function paramsOf(...names: string[]): Schema {
  return {
    type: "object",
    required: names,
    properties: Object.fromEntries(names.map(name => [name, uuid]))
  };
}

export const idempotencyHeaderSchema: Schema = {
  type: "object",
  properties: { "idempotency-key": { type: "string", format: "uuid" } }
};

const limitQuery = (max: number, fallback: number): Schema => ({ type: "integer", minimum: 1, maximum: max, default: fallback });
const cursorQuery: Schema = { type: "string", minLength: 1, maxLength: 400 };

export const pageQuerySchema: Schema = {
  type: "object",
  properties: { limit: limitQuery(50, 20), cursor: cursorQuery }
};

/* ───────────── Piezas comunes ───────────── */

export const publicUserSchema = obj({
  id: uuid,
  displayName: str,
  firstName: str,
  photoUrl: nul(str),
  ratingAverage: nul(num),
  ratingCount: int
});

export const moneySchema = obj({
  cents: nul(int),
  currency: enumOf(["EUR"]),
  status: enumOf(["defined", "pending_definition", "illustrative"])
});

const NOTIFICATION_CATEGORIES = ["trip", "message", "payment", "system"] as const;
const TRIP_CATEGORIES = ["work", "university", "fp_academies", "hospital", "sport", "other"] as const;
const ROLES = ["driver", "passenger"] as const;
const USER_ROLES = ["passenger", "driver", "admin", "verification_admin", "finance_admin", "support_admin"] as const;

/* ───────────── Notificaciones ───────────── */

export const notificationSchema = obj({
  id: uuid,
  category: enumOf(NOTIFICATION_CATEGORIES),
  kind: str,
  title: str,
  body: str,
  data: anyObject,
  essential: bool,
  read: bool,
  readAt: nul(dt),
  createdAt: dt
});

export const notificationPageSchema = pageOf(notificationSchema, { unreadCount: int });

export const notificationUnreadCountSchema = obj({
  total: int,
  byCategory: obj({ trip: int, message: int, payment: int, system: int })
});

export const updatedCountSchema = obj({ updated: int });

export const notificationsQuerySchema: Schema = {
  type: "object",
  properties: {
    category: enumOf(NOTIFICATION_CATEGORIES),
    unread: bool,
    limit: limitQuery(50, 20),
    cursor: cursorQuery
  }
};

export const readAllBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  properties: { category: enumOf(NOTIFICATION_CATEGORIES) }
};

export const notificationPreferencesSchema = obj({
  essentialTripNotices: bool,
  arrivalAlerts: bool,
  messages: bool,
  push: obj({ available: bool, provider: str, reason: nul(enumOf(["PROVIDER_DISABLED"])), registeredDevices: int }),
  updatedAt: nul(dt)
});

export const notificationPreferencesPatchSchema: Schema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: { essentialTripNotices: bool, arrivalAlerts: bool, messages: bool }
};

export const pushTokenSchema = obj({
  id: uuid,
  platform: enumOf(["ios", "android", "web"]),
  provider: enumOf(["expo", "fcm", "apns"]),
  deviceId: nul(str),
  appVersion: nul(str),
  createdAt: dt,
  lastSeenAt: dt
});

export const pushTokenPageSchema = pageOf(pushTokenSchema);

export const pushTokenBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["token", "platform", "provider"],
  properties: {
    token: { type: "string", minLength: 16, maxLength: 4096 },
    platform: enumOf(["ios", "android", "web"]),
    provider: enumOf(["expo", "fcm", "apns"]),
    deviceId: { type: "string", minLength: 1, maxLength: 128 },
    appVersion: { type: "string", minLength: 1, maxLength: 32 },
    locale: { type: "string", minLength: 1, maxLength: 16 }
  }
};

/* ───────────── Conversaciones ───────────── */

const lastMessageSchema = obj({
  id: uuid,
  kind: enumOf(["text", "location"]),
  preview: str,
  senderId: uuid,
  mine: bool,
  createdAt: dt
});

const conversationSummaryProps: Record<string, Schema> = {
  id: uuid,
  kind: enumOf(["direct", "group"]),
  title: str,
  subtitle: nul(str),
  peer: nul(publicUserSchema),
  memberCount: nul(int),
  myRole: enumOf(ROLES),
  category: enumOf(TRIP_CATEGORIES),
  provinceName: nul(str),
  tripId: nul(uuid),
  bookingId: nul(uuid),
  lastMessage: nul(lastMessageSchema),
  unreadCount: int,
  lastActivityAt: dt
};

export const conversationSummarySchema = obj(conversationSummaryProps);

export const conversationDetailSchema = obj({
  ...conversationSummaryProps,
  trip: nul(
    obj({
      id: uuid,
      status: enumOf(["draft", "published", "active", "completed", "cancelled"]),
      departureAt: nul(dt),
      arrivalEstimateAt: nul(dt),
      originLabel: nul(str),
      destinationLabel: nul(str)
    })
  ),
  booking: nul(obj({ id: uuid, status: enumOf(["confirmed", "completed"]), seats: int })),
  pickupPoint: nul(obj({ label: nul(str), lat: num, lng: num })),
  contribution: nul(moneySchema),
  routeLabel: nul(str),
  members: nul(arr(obj({ user: publicUserSchema, role: enumOf(ROLES) })))
});

export const conversationPageSchema = pageOf(conversationSummarySchema, { unreadTotal: int });

export const conversationUnreadCountSchema = obj({
  total: int,
  direct: int,
  groups: int,
  conversationsWithUnread: int
});

export const conversationsQuerySchema: Schema = {
  type: "object",
  properties: {
    filter: enumOf(["all", "bookings", "groups"]),
    q: { type: "string", minLength: 2, maxLength: 60 },
    limit: limitQuery(50, 20),
    cursor: cursorQuery
  }
};

export const openDirectBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["tripId", "peerUserId"],
  properties: { tripId: uuid, peerUserId: uuid }
};

export const chatMessageSchema = obj({
  id: uuid,
  seq: int,
  conversationId: uuid,
  senderId: uuid,
  senderName: str,
  mine: bool,
  kind: enumOf(["text", "location"]),
  body: nul(str),
  location: nul(obj({ lat: num, lng: num, label: nul(str) })),
  hidden: bool,
  receipt: nul(
    obj({
      state: enumOf(["sent", "delivered", "read"]),
      recipientCount: int,
      deliveredCount: int,
      readCount: int
    })
  ),
  createdAt: dt
});

export const chatMessagePageSchema = pageOf(chatMessageSchema, { lastReadSeq: int });

export const messagesQuerySchema: Schema = {
  type: "object",
  properties: {
    limit: limitQuery(100, 30),
    cursor: cursorQuery,
    afterSeq: { type: "integer", minimum: 0 }
  }
};

export const sendMessageBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["clientMessageId"],
  properties: {
    clientMessageId: uuid,
    kind: enumOf(["text", "location"]),
    body: { type: "string", maxLength: 4000 },
    location: {
      type: "object",
      additionalProperties: false,
      required: ["lat", "lng"],
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        label: { type: "string", maxLength: 400 }
      }
    }
  }
};

export const markReadBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  properties: { upToSeq: { type: "integer", minimum: 0 } }
};

export const markReadResponseSchema = obj({ conversationId: uuid, lastReadSeq: int, unreadCount: int });

export const callContactSchema = obj({
  available: bool,
  reason: nul(enumOf(["PEER_CALL_DISABLED", "OUTSIDE_TRIP_WINDOW", "PEER_UNAVAILABLE"])),
  peerFirstName: str,
  phoneE164: nul(str),
  availableFrom: nul(dt),
  availableUntil: nul(dt)
});

/* ───────────── Bloqueos y denuncias ───────────── */

export const blockedUserPageSchema = pageOf(obj({ user: publicUserSchema, blockedAt: dt }));

const REPORT_REASONS = ["harassment", "unsafe_behavior", "inappropriate_content", "spam_or_fraud", "no_show", "other"] as const;

export const userReportSchema = obj({
  id: uuid,
  reportedUser: publicUserSchema,
  reason: enumOf(REPORT_REASONS),
  details: nul(str),
  tripId: nul(uuid),
  conversationId: nul(uuid),
  evidenceCount: int,
  status: enumOf(["open", "in_review", "actioned", "dismissed"]),
  createdAt: dt,
  updatedAt: dt,
  resolvedAt: nul(dt)
});

export const userReportPageSchema = pageOf(userReportSchema);

export const createReportBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["reportedUserId", "reason"],
  properties: {
    reportedUserId: uuid,
    reason: enumOf(REPORT_REASONS),
    details: { type: "string", maxLength: 1000 },
    tripId: uuid,
    conversationId: uuid,
    evidenceMessageIds: { type: "array", items: uuid, maxItems: 10 }
  }
};

export const reportMessageBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: { reason: enumOf(REPORT_REASONS), details: { type: "string", maxLength: 1000 } }
};

/* ───────────── Centro de ayuda ───────────── */

export const supportTripPageSchema = pageOf(
  obj({
    tripId: uuid,
    bookingId: nul(uuid),
    role: enumOf(ROLES),
    departureAt: nul(dt),
    originLabel: nul(str),
    destinationLabel: nul(str),
    status: enumOf(["draft", "published", "active", "completed", "cancelled"])
  })
);

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

export const supportUploadIntentBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["contentType", "sizeBytes"],
  properties: {
    contentType: enumOf(IMAGE_TYPES),
    sizeBytes: { type: "integer", minimum: 1, maximum: 10485760 }
  }
};

export const supportUploadIntentSchema = obj({
  intentId: uuid,
  uploadUrl: str,
  headers: { type: "object", additionalProperties: { type: "string" } },
  expiresAt: dt
});

export const supportAttachmentSchema = obj({ id: uuid, contentType: str, sizeBytes: int, createdAt: dt });

export const supportAttachmentDownloadSchema = obj({ url: str, expiresAt: dt });

const SUPPORT_CATEGORIES = ["trip_issue", "payment_issue", "account_profile"] as const;
const SUPPORT_STATUSES = ["open", "answered", "closed"] as const;

const supportSummaryProps: Record<string, Schema> = {
  id: uuid,
  reference: str,
  category: enumOf(SUPPORT_CATEGORIES),
  status: enumOf(SUPPORT_STATUSES),
  bodyPreview: str,
  tripId: nul(uuid),
  bookingId: nul(uuid),
  attachmentCount: int,
  hasStaffReply: bool,
  lastActivityAt: dt,
  createdAt: dt
};

export const supportTicketSummarySchema = obj(supportSummaryProps);

export const supportTicketDetailSchema = obj({
  ...supportSummaryProps,
  body: str,
  messages: arr(
    obj({
      id: uuid,
      authorType: enumOf(["user", "staff"]),
      authorName: str,
      body: str,
      attachments: arr(supportAttachmentSchema),
      createdAt: dt
    })
  ),
  closedAt: nul(dt)
});

export const supportTicketPageSchema = pageOf(supportTicketSummarySchema);

export const supportTicketsQuerySchema: Schema = {
  type: "object",
  properties: { status: enumOf(SUPPORT_STATUSES), limit: limitQuery(50, 20), cursor: cursorQuery }
};

export const createSupportTicketBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["category", "body"],
  properties: {
    category: enumOf(SUPPORT_CATEGORIES),
    body: { type: "string", minLength: 1, maxLength: 500 },
    tripId: uuid,
    bookingId: uuid,
    attachmentIds: { type: "array", items: uuid, maxItems: 4 }
  }
};

export const supportReplyBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["body"],
  properties: {
    body: { type: "string", minLength: 1, maxLength: 1000 },
    attachmentIds: { type: "array", items: uuid, maxItems: 4 }
  }
};

/* ───────────── Ajustes ───────────── */

export const userSettingsSchema = obj({
  shareLiveLocationInTrip: bool,
  fontScale: enumOf(["small", "normal", "large", "extra_large"]),
  language: enumOf(["es"]),
  updatedAt: nul(dt),
  account: obj({
    userId: uuid,
    displayName: nul(str),
    photoUrl: nul(str),
    roles: arr(enumOf(USER_ROLES)),
    phoneE164: nul(str),
    pendingDeletion: nul(obj({ requestId: uuid, scheduledFor: dt }))
  })
});

export const userSettingsPatchSchema: Schema = {
  type: "object",
  additionalProperties: false,
  minProperties: 1,
  properties: {
    shareLiveLocationInTrip: bool,
    fontScale: enumOf(["small", "normal", "large", "extra_large"]),
    language: enumOf(["es"])
  }
};

/* ───────────── Derechos sobre los datos ───────────── */

export const dataExportSchema = obj({
  id: uuid,
  status: enumOf(["queued", "processing", "ready", "failed", "blocked_storage_disabled", "expired"]),
  format: enumOf(["json"]),
  requestedAt: dt,
  completedAt: nul(dt),
  expiresAt: nul(dt),
  sizeBytes: nul(int),
  downloadable: bool,
  errorCode: nul(str)
});

export const dataExportPageSchema = pageOf(dataExportSchema);

export const dataExportDownloadSchema = obj({ url: str, expiresAt: dt });

const blockerSchema = obj({ code: str, message: str, count: int });

export const accountDeletionStateSchema = obj({
  eligible: bool,
  blockers: arr(blockerSchema),
  graceDays: int,
  request: nul(
    obj({
      id: uuid,
      status: enumOf(["scheduled", "blocked", "processing", "completed", "cancelled"]),
      requestedAt: dt,
      scheduledFor: dt,
      cancelledAt: nul(dt),
      completedAt: nul(dt),
      blockers: arr(blockerSchema)
    })
  ),
  plan: obj({
    deleted: arr(str),
    anonymised: arr(str),
    retained: arr(obj({ item: str, reason: str, period: str }))
  })
});

export const requestAccountDeletionBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["confirmation"],
  properties: {
    confirmation: { type: "string", minLength: 1, maxLength: 40 },
    reason: { type: "string", maxLength: 500 }
  }
};
