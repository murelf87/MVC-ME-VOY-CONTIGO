/**
 * Datos sembrados de «ajustes, ayuda y datos» (paquete `account-help`). SIMULACIÓN (solo vista previa).
 *
 * Todas las variantes se llaman `help-…` y parten del mundo base de «default». Las que sirven a las láminas 34–36 dejan a
 * la conductora como en el diseño («Ana García», +34 600 123 456) y le añaden el viaje completado del viernes 16 de mayo
 * de 2025, Sevilla → Camas, que es el que enseña el selector de «Centro de ayuda». Las horas son relativas a «ahora»
 * del reloj virtual, así que valen con cualquier reloj. Los ids son estables (no consumen azar).
 */
import type { PreviewDb, PreviewProfileId } from "@/preview";
import {
  SEED_IDS,
  SEED_USER_IDS,
  SEED_VEHICLE_IDS,
  STORAGE_PROVIDER_NAME,
  insertTripWithPlan,
  madridDateTimeMs,
  planFor,
  profileUserId,
  registerSeedRef,
  seedConfirmedRider,
  sha256Hex,
  stableUuid,
} from "@/preview";
import { buildExportJson, deletionBlockers } from "./helpData";
import {
  STORAGE_OFF_SETTING,
  attachmentsTable,
  deletionsTable,
  exportsTable,
  ticketMessagesTable,
  ticketsTable,
  type TicketCategory,
} from "./helpStore";

const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Variantes de datos del paquete (los nombres no pueden repetirse con las del núcleo ni con las de otros paquetes). */
export const HELP_SEED_VARIANTS: Readonly<Record<string, string>> = {
  "help-settings": "Ajustes: Ana García (+34 600 123 456), conductora y pasajera, sin consultas ni solicitudes de datos (lámina 34a).",
  "help-settings-driver": "Ajustes: como «help-settings» pero Ana solo tiene el rol de conductora, «Conductora» (lámina 35b).",
  "help-center": "Centro de ayuda: Ana con el viaje completado del viernes 16 de mayo de 2025 Sevilla → Camas y sin consultas.",
  "help-tickets": "Mis consultas: una abierta con una imagen adjunta, una respondida por el equipo y una cerrada.",
  "help-tickets-limit": "Mis consultas: 10 abiertas (la siguiente devuelve SUPPORT_TICKET_LIMIT).",
  "help-exports": "Mis datos: una exportación lista para descargar (caduca en 5 días) y otra ya caducada.",
  "help-exports-busy": "Mis datos: una exportación preparándose (pasa a lista tras unas lecturas).",
  "help-delete-scheduled": "Eliminar cuenta: solicitud programada con plazo de gracia (11 días restantes), cancelable.",
  "help-delete-blocked": "Eliminar cuenta: solicitud en espera porque hay viajes pendientes (con Ana; con Miguel no hay bloqueos).",
  "help-storage-off": "Almacenamiento privado sin configurar: adjuntos y exportación de datos no disponibles (503).",
};

function isHelpVariant(seed: string): boolean {
  return Object.prototype.hasOwnProperty.call(HELP_SEED_VARIANTS, seed);
}

// ── Identidad y viaje de las láminas ──────────────────────────────────────────────────────────────────────────────────

export const CAMAS_TRIP_ID = stableUuid("trip:help:camas-2025-05-16");
const CAMAS_TRIP_DATE = "2025-05-16";
const SEVILLA = { latitude: 37.3891, longitude: -5.9845, label: "Sevilla" };
const CAMAS = { latitude: 37.4036, longitude: -6.0328, label: "Camas" };

/** La lámina 34 muestra «Ana García» y «+34 600 123 456» (en el reparto base es «Ana García López» +34 611 000 101). */
function seedLaminaIdentity(db: PreviewDb): void {
  db.profiles.update(SEED_USER_IDS.ana, { display_name: "Ana García" });
  db.users.update(SEED_USER_IDS.ana, { phone_e164: "+34600123456" });
}

/** Viaje completado de Ana (con Miguel de pasajero): para el selector «Selecciona un viaje (opcional)» de ambos perfiles. */
function seedCamasTrip(db: PreviewDb): void {
  const departureAt = madridDateTimeMs(CAMAS_TRIP_DATE, "08:05");
  const plan = planFor(db, [SEVILLA, CAMAS], [{ distanceM: 9300, durationS: 1080 }], departureAt);
  const trip = insertTripWithPlan(
    db,
    {
      id: CAMAS_TRIP_ID,
      driverUserId: SEED_USER_IDS.ana,
      vehicleId: SEED_VEHICLE_IDS.anaArona,
      provinceId: SEED_IDS.province,
      category: "work",
      leg: "outbound",
      departureAtMs: departureAt,
      flexibilityMinutes: 10,
      maxDetourM: 2000,
      offeredSeats: 3,
      origin: SEVILLA,
      destination: CAMAS,
      status: "completed",
      stopLabels: [SEVILLA.label, CAMAS.label],
    },
    plan
  );
  const startedAt = departureAt + MIN;
  const completedAt = departureAt + 1_080_000;
  db.trips.update(trip.id, { started_at: startedAt, completed_at: completedAt, created_at: departureAt - 3 * DAY, updated_at: completedAt });
  seedConfirmedRider(db, trip, { user: "miguel", from: 0, to: 1 }, { pickedUp: true, status: "completed", bookedAt: departureAt - 18 * HOUR });
}

// ── Consultas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const REF_OPEN = "MVC-2026-000122";
const REF_ANSWERED = "MVC-2026-000121";
const REF_CLOSED = "MVC-2026-000118";

interface SeedReply {
  from: "user" | "staff";
  body: string;
  agoMs: number;
}

interface SeedAttachment {
  /** Índice del mensaje del hilo al que se adjunta (0 = la consulta original). */
  onMessage: number;
  contentType: string;
  sizeBytes: number;
}

interface TicketSpec {
  reference: string;
  category: TicketCategory;
  body: string;
  createdAgoMs: number;
  linkTrip?: boolean;
  replies?: readonly SeedReply[];
  closed?: { by: "user" | "staff"; agoMs: number };
  attachments?: readonly SeedAttachment[];
}

function extensionOf(contentType: string): string {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/heic" || contentType === "image/heif") return "heic";
  return "jpg";
}

function seedTicket(db: PreviewDb, userId: string, spec: TicketSpec): void {
  const now = db.nowMs();
  const ticketId = stableUuid(`help:ticket:${spec.reference}`);
  const createdAt = now - spec.createdAgoMs;
  const replies = spec.replies ?? [];
  const lastStaff = [...replies].reverse().find((reply) => reply.from === "staff");
  const lastUser = [...replies].reverse().find((reply) => reply.from === "user");
  const closedAt = spec.closed ? now - spec.closed.agoMs : null;
  const lastActivity = Math.max(createdAt, closedAt ?? 0, ...replies.map((reply) => now - reply.agoMs));
  ticketsTable(db).insert({
    id: ticketId,
    reference: spec.reference,
    user_id: userId,
    category: spec.category,
    status: spec.closed ? "closed" : lastStaff && (!lastUser || lastStaff.agoMs < lastUser.agoMs) ? "answered" : "open",
    trip_id: spec.linkTrip ? CAMAS_TRIP_ID : null,
    booking_id: null,
    body: spec.body,
    assigned_to_user_id: lastStaff ? SEED_USER_IDS.staff : null,
    last_user_message_at: lastUser ? now - lastUser.agoMs : createdAt,
    last_staff_message_at: lastStaff ? now - lastStaff.agoMs : null,
    closed_at: closedAt,
    closed_by: spec.closed?.by ?? null,
    created_at: createdAt,
    updated_at: lastActivity,
  });

  const messages = ticketMessagesTable(db);
  const messageIds: string[] = [];
  const first = messages.insert({
    id: stableUuid(`help:message:${spec.reference}:0`),
    ticket_id: ticketId,
    author_type: "user",
    author_user_id: userId,
    body: spec.body,
    created_at: createdAt,
  });
  messageIds.push(first.id);
  replies.forEach((entry, index) => {
    const row = messages.insert({
      id: stableUuid(`help:message:${spec.reference}:${index + 1}`),
      ticket_id: ticketId,
      author_type: entry.from,
      author_user_id: entry.from === "staff" ? SEED_USER_IDS.staff : userId,
      body: entry.body,
      created_at: now - entry.agoMs,
    });
    messageIds.push(row.id);
  });

  (spec.attachments ?? []).forEach((attachment, index) => {
    const id = stableUuid(`help:attachment:${spec.reference}:${index}`);
    const key = ["users", userId, "support", `${id}.${extensionOf(attachment.contentType)}`].join("/");
    db.blobs.putMetadataOnly({ key, sizeBytes: attachment.sizeBytes, contentType: attachment.contentType, uploadedAt: createdAt });
    attachmentsTable(db).insert({
      id,
      owner_user_id: userId,
      ticket_id: ticketId,
      message_id: messageIds[attachment.onMessage] ?? first.id,
      storage_provider: STORAGE_PROVIDER_NAME,
      storage_key: key,
      content_type: attachment.contentType,
      size_bytes: attachment.sizeBytes,
      sha256: sha256Hex(key),
      created_at: createdAt,
    });
  });
}

function seedThreeTickets(db: PreviewDb, userId: string): void {
  seedTicket(db, userId, {
    reference: REF_CLOSED,
    category: "account_profile",
    body: "Quiero cambiar mi foto de perfil, pero no me deja subirla.",
    createdAgoMs: 9 * DAY + 2 * HOUR,
    replies: [
      {
        from: "staff",
        body: "Hola. Hemos comprobado que tu foto estaba en revisión y ya consta como aprobada. Cerramos la consulta; escríbenos de nuevo si lo necesitas.",
        agoMs: 8 * DAY,
      },
    ],
    closed: { by: "staff", agoMs: 7 * DAY + 20 * HOUR },
  });
  seedTicket(db, userId, {
    reference: REF_ANSWERED,
    category: "payment_issue",
    body: "No veo en mi historial el importe del viaje a Camas del 16 de mayo. ¿Me podéis confirmar cómo figura?",
    createdAgoMs: 2 * DAY + 3 * HOUR,
    linkTrip: true,
    replies: [
      {
        from: "staff",
        body: "Hola. Hemos revisado tu consulta y el viaje consta como completado. Si en tu historial ves algo distinto, responde a este mensaje con una captura y lo revisamos de nuevo.",
        agoMs: 19 * HOUR,
      },
    ],
  });
  seedTicket(db, userId, {
    reference: REF_OPEN,
    category: "trip_issue",
    body: "El viaje del 16 de mayo a Camas terminó antes de lo previsto y no pude valorar a la otra persona. ¿Podéis revisarlo?",
    createdAgoMs: 11 * HOUR + 40 * MIN,
    linkTrip: true,
    attachments: [{ onMessage: 0, contentType: "image/jpeg", sizeBytes: 842_113 }],
  });
}

const LIMIT_BODIES: readonly string[] = [
  "No me llega el SMS de verificación al cambiar de móvil.",
  "El punto de recogida aparece mal en el mapa.",
  "No puedo subir la foto del permiso de conducir.",
  "Mi reserva figura como pendiente pero el viaje ya terminó.",
  "La persona que conducía canceló y no veo la devolución.",
  "No me deja valorar a la otra persona del viaje.",
  "Quiero cambiar el nombre que aparece en mi perfil.",
  "El chat del viaje no muestra mis mensajes.",
  "Me aparece un aviso de que mi vehículo no está verificado.",
  "No encuentro la opción de eliminar un viaje publicado.",
];

function seedTicketLimit(db: PreviewDb, userId: string): void {
  const categories: readonly TicketCategory[] = ["trip_issue", "payment_issue", "account_profile"];
  LIMIT_BODIES.forEach((body, index) => {
    seedTicket(db, userId, {
      reference: `MVC-2026-${String(101 + index).padStart(6, "0")}`,
      category: categories[index % categories.length] ?? "trip_issue",
      body,
      createdAgoMs: (2 + index) * DAY + HOUR,
    });
  });
}

// ── Exportaciones y eliminación ───────────────────────────────────────────────────────────────────────────────────────

function seedExportsReadyAndExpired(db: PreviewDb, userId: string): void {
  const now = db.nowMs();
  const readyId = stableUuid(`help:export:ready:${userId}`);
  const readyKey = ["users", userId, "exports", `${readyId}.json`].join("/");
  const bytes = buildExportJson(db, userId);
  const completedAt = now - 2 * DAY;
  db.blobs.put(readyKey, bytes, "application/json", completedAt);
  exportsTable(db).insert({
    id: readyId,
    user_id: userId,
    status: "ready",
    requested_at: completedAt - 4 * MIN,
    completed_at: completedAt,
    expires_at: completedAt + 7 * DAY,
    size_bytes: bytes.byteLength,
    storage_key: readyKey,
    error_code: null,
    polls: 3,
    idempotency_key: null,
  });
  exportsTable(db).insert({
    id: stableUuid(`help:export:expired:${userId}`),
    user_id: userId,
    status: "expired",
    requested_at: now - 12 * DAY - 3 * MIN,
    completed_at: now - 12 * DAY,
    expires_at: now - 5 * DAY,
    size_bytes: 3_412,
    storage_key: null,
    error_code: null,
    polls: 3,
    idempotency_key: null,
  });
}

function seedExportProcessing(db: PreviewDb, userId: string): void {
  exportsTable(db).insert({
    id: stableUuid(`help:export:busy:${userId}`),
    user_id: userId,
    status: "processing",
    requested_at: db.nowMs() - 40_000,
    completed_at: null,
    expires_at: null,
    size_bytes: null,
    storage_key: null,
    error_code: null,
    polls: 1,
    idempotency_key: null,
  });
}

function seedDeletionRequest(db: PreviewDb, userId: string, kind: "scheduled" | "blocked"): void {
  const now = db.nowMs();
  const requestedAt = kind === "scheduled" ? now - 3 * DAY : now - DAY;
  deletionsTable(db).insert({
    id: stableUuid(`help:deletion:${kind}:${userId}`),
    user_id: userId,
    status: kind,
    requested_at: requestedAt,
    scheduled_for: requestedAt + 14 * DAY,
    cancelled_at: null,
    completed_at: null,
    reason: null,
    blockers: kind === "blocked" ? deletionBlockers(db, userId) : [],
  });
}

// ── Punto de entrada ──────────────────────────────────────────────────────────────────────────────────────────────────

export function seedHelpWorld(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  if (!isHelpVariant(seed)) return;
  seedLaminaIdentity(db);
  seedCamasTrip(db);
  const userId = profileUserId(profile);
  switch (seed) {
    case "help-settings-driver":
      db.userRoles.delete(`${SEED_USER_IDS.ana}:passenger`);
      return;
    case "help-storage-off":
      db.setSetting(STORAGE_OFF_SETTING, true);
      return;
    case "help-tickets":
      if (userId !== null) seedThreeTickets(db, userId);
      return;
    case "help-tickets-limit":
      if (userId !== null) seedTicketLimit(db, userId);
      return;
    case "help-exports":
      if (userId !== null) seedExportsReadyAndExpired(db, userId);
      return;
    case "help-exports-busy":
      if (userId !== null) seedExportProcessing(db, userId);
      return;
    case "help-delete-scheduled":
      if (userId !== null) seedDeletionRequest(db, userId, "scheduled");
      return;
    case "help-delete-blocked":
      if (userId !== null) seedDeletionRequest(db, userId, "blocked");
      return;
    default:
      return;
  }
}

function ticketIdByReference(db: PreviewDb, reference: string): string | undefined {
  return ticketsTable(db).find((ticket) => ticket.reference === reference)?.id;
}

/** Referencias simbólicas para los escenarios de diseño: `{ "$ref": "help.tripCamas" }`. */
export function registerHelpRefs(): void {
  registerSeedRef("help.tripCamas", (db) => (db.trips.has(CAMAS_TRIP_ID) ? CAMAS_TRIP_ID : undefined));
  registerSeedRef("help.ticketOpen", (db) => ticketIdByReference(db, REF_OPEN));
  registerSeedRef("help.ticketAnswered", (db) => ticketIdByReference(db, REF_ANSWERED));
  registerSeedRef("help.ticketClosed", (db) => ticketIdByReference(db, REF_CLOSED));
}
