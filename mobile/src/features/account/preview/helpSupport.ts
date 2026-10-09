/**
 * Centro de ayuda (comms.md §4): selector de viajes, subida privada de imágenes, consultas y su hilo.
 * SIMULACIÓN (solo vista previa). Las subidas usan el «S3 privado» simulado del núcleo (`storage.mvc-preview.invalid`).
 */
import type { PreviewDb, PreviewRouter } from "@/preview";
import { STORAGE_PROVIDER_NAME, fail, iso, reply, sha256Hex, signedUrl, uuidParam } from "@/preview";
import type { TripRow } from "@/preview";
import {
  attachmentsTable,
  pageOf,
  pageQuerySchema,
  requireStorage,
  supportIntentsTable,
  ticketMessagesTable,
  ticketsTable,
  type AttachmentRow,
  type TicketCategory,
  type TicketMessageRow,
  type TicketRow,
  type TicketStatus,
} from "./helpStore";

const ALLOWED_TYPES: readonly string[] = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const UPLOAD_TTL_MS = 600_000;
const DOWNLOAD_TTL_MS = 300_000;
const MAX_ATTACHMENTS = 4;
const MAX_OPEN_TICKETS = 10;
const MAX_TICKETS_PER_DAY = 5;
const DAY_MS = 86_400_000;
const STAFF_NAME = "Equipo MVC";

function extensionFor(contentType: string): string {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/heic":
      return "heic";
    case "image/heif":
      return "heif";
    default:
      return "bin";
  }
}

/** Firma de archivo mínima: JPEG, PNG y WebP deben empezar como tales (HEIC/HEIF no se comprueba). */
function looksLikeImage(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (contentType === "image/webp") {
    return bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45;
  }
  return true;
}

// ── Viajes en los que participó la persona ────────────────────────────────────────────────────────────────────────────

interface ParticipatedTrip {
  trip: Readonly<TripRow>;
  role: "driver" | "passenger";
  bookingId: string | null;
}

function participatedTrips(db: PreviewDb, userId: string): ParticipatedTrip[] {
  const out: ParticipatedTrip[] = [];
  for (const trip of db.trips.filter((row) => row.driver_user_id === userId && row.status !== "draft")) {
    out.push({ trip, role: "driver", bookingId: null });
  }
  for (const booking of db.bookings.all()) {
    const request = db.rideRequests.get(booking.request_id);
    if (!request || request.passenger_user_id !== userId) continue;
    const trip = db.trips.get(request.trip_id);
    if (!trip || trip.status === "draft") continue;
    out.push({ trip, role: "passenger", bookingId: booking.id });
  }
  return out.sort((a, b) => (b.trip.departure_at ?? -Infinity) - (a.trip.departure_at ?? -Infinity));
}

function stopLabel(db: PreviewDb, tripId: string, kind: "origin" | "destination"): string | null {
  return db.tripStops.find((stop) => stop.trip_id === tripId && stop.kind === kind)?.label ?? null;
}

function tripOptionWire(db: PreviewDb, item: ParticipatedTrip) {
  return {
    tripId: item.trip.id,
    bookingId: item.bookingId,
    role: item.role,
    departureAt: iso(item.trip.departure_at),
    originLabel: stopLabel(db, item.trip.id, "origin"),
    destinationLabel: stopLabel(db, item.trip.id, "destination"),
    status: item.trip.status,
  };
}

// ── Consultas ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function messagesOf(db: PreviewDb, ticketId: string): Array<Readonly<TicketMessageRow>> {
  return ticketMessagesTable(db)
    .filter((message) => message.ticket_id === ticketId)
    .sort((a, b) => a.created_at - b.created_at);
}

function attachmentsOfTicket(db: PreviewDb, ticketId: string): Array<Readonly<AttachmentRow>> {
  return attachmentsTable(db).filter((attachment) => attachment.ticket_id === ticketId);
}

/** Estado visible: `closed` es explícito; el resto se deduce del último mensaje (el equipo respondió → `answered`). */
function visibleStatus(ticket: Readonly<TicketRow>, messages: ReadonlyArray<Readonly<TicketMessageRow>>): TicketStatus {
  if (ticket.status === "closed") return "closed";
  const last = messages[messages.length - 1];
  if (last === undefined) return ticket.status;
  return last.author_type === "staff" ? "answered" : "open";
}

function lastActivity(ticket: Readonly<TicketRow>, messages: ReadonlyArray<Readonly<TicketMessageRow>>): number {
  const last = messages[messages.length - 1]?.created_at ?? ticket.created_at;
  return Math.max(last, ticket.closed_at ?? 0, ticket.created_at);
}

function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length <= 140 ? flat : `${flat.slice(0, 137)}…`;
}

function attachmentWire(attachment: Readonly<AttachmentRow>) {
  return { id: attachment.id, contentType: attachment.content_type, sizeBytes: attachment.size_bytes, createdAt: iso(attachment.created_at) };
}

function summaryWire(db: PreviewDb, ticket: Readonly<TicketRow>) {
  const messages = messagesOf(db, ticket.id);
  return {
    id: ticket.id,
    reference: ticket.reference,
    category: ticket.category,
    status: visibleStatus(ticket, messages),
    bodyPreview: preview(ticket.body),
    tripId: ticket.trip_id,
    bookingId: ticket.booking_id,
    attachmentCount: attachmentsOfTicket(db, ticket.id).length,
    hasStaffReply: messages.some((message) => message.author_type === "staff"),
    lastActivityAt: iso(lastActivity(ticket, messages)),
    createdAt: iso(ticket.created_at),
  };
}

function authorName(db: PreviewDb, message: Readonly<TicketMessageRow>): string {
  if (message.author_type === "staff") return STAFF_NAME;
  return db.profiles.get(message.author_user_id)?.display_name ?? "Tú";
}

export function ticketDetailWire(db: PreviewDb, ticket: Readonly<TicketRow>) {
  const messages = messagesOf(db, ticket.id);
  const attachments = attachmentsOfTicket(db, ticket.id);
  return {
    ...summaryWire(db, ticket),
    body: ticket.body,
    messages: messages.map((message) => ({
      id: message.id,
      authorType: message.author_type,
      authorName: authorName(db, message),
      body: message.body,
      attachments: attachments.filter((attachment) => attachment.message_id === message.id).map(attachmentWire),
      createdAt: iso(message.created_at),
    })),
    closedAt: iso(ticket.closed_at),
  };
}

function ownTicket(db: PreviewDb, userId: string, ticketId: string): Readonly<TicketRow> {
  const ticket = ticketsTable(db).get(ticketId);
  if (!ticket || ticket.user_id !== userId) fail("SUPPORT_TICKET_NOT_FOUND", "No encontramos esta consulta.", 404);
  return ticket;
}

/** `MVC-2026-000123`: correlativo por año (la simulación arranca en 123, como el ejemplo del contrato). */
export function nextTicketReference(db: PreviewDb): string {
  const year = new Date(db.nowMs()).getUTCFullYear();
  let max = 122;
  for (const ticket of ticketsTable(db).all()) {
    const match = /^MVC-\d{4}-(\d{6})$/.exec(ticket.reference);
    if (match?.[1] !== undefined) max = Math.max(max, Number(match[1]));
  }
  return `MVC-${year}-${String(max + 1).padStart(6, "0")}`;
}

/** Comprueba y devuelve los adjuntos que se vinculan a un mensaje (de la persona, ya completados y sin vincular). */
function takeAttachments(db: PreviewDb, userId: string, ids: readonly string[] | undefined): Array<Readonly<AttachmentRow>> {
  const unique = [...new Set(ids ?? [])];
  if (unique.length > MAX_ATTACHMENTS) fail("SUPPORT_ATTACHMENT_LIMIT", `Puedes adjuntar hasta ${MAX_ATTACHMENTS} imágenes.`, 422);
  const table = attachmentsTable(db);
  return unique.map((id) => {
    const attachment = table.get(id);
    if (!attachment || attachment.owner_user_id !== userId || attachment.ticket_id !== null) {
      return fail("SUPPORT_ATTACHMENT_INVALID", "Alguna imagen no es válida o ya se usó en otra consulta.", 422);
    }
    return attachment;
  });
}

interface CreateTicketBody {
  category: TicketCategory;
  body: string;
  tripId?: string;
  bookingId?: string;
  attachmentIds?: string[];
}

interface ReplyBody {
  body: string;
  attachmentIds?: string[];
}

function validationError(path: string, message: string): never {
  return fail("VALIDATION_ERROR", message, 400, [{ path, message }]);
}

export function registerSupportPreview(r: PreviewRouter, db: PreviewDb): void {
  r.get<{ Query: { limit?: number; cursor?: string } }>(
    "/v1/me/support/trips",
    { summary: "Viajes en los que participé (selector del Centro de ayuda)", tags: ["support"], schema: { querystring: pageQuerySchema } },
    (req) => pageOf(participatedTrips(db, req.auth().userId).map((item) => tripOptionWire(db, item)), req.query)
  );

  // ── Adjuntos ──────────────────────────────────────────────────────────────────────────────────────────────────────

  r.post<{ Body: { contentType: string; sizeBytes: number } }>(
    "/v1/me/support/uploads/intents",
    {
      summary: "Pedir URL firmada para subir una imagen de una consulta",
      tags: ["support"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["contentType", "sizeBytes"],
          properties: { contentType: { type: "string", minLength: 3, maxLength: 120 }, sizeBytes: { type: "integer", minimum: 1 } },
        },
      },
    },
    (req) => {
      const principal = req.auth();
      requireStorage(db);
      const { contentType, sizeBytes } = req.body;
      if (!ALLOWED_TYPES.includes(contentType)) {
        fail("PRIVATE_UPLOAD_TYPE_NOT_ALLOWED", "Solo se pueden adjuntar imágenes JPG, PNG, WebP o HEIC.", 422, { contentType });
      }
      if (sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) {
        fail("PRIVATE_UPLOAD_SIZE_INVALID", "La imagen debe pesar entre 1 byte y 10 MiB.", 422);
      }
      const id = db.ids.uuid();
      const key = ["users", principal.userId, "support", `${id}.${extensionFor(contentType)}`].join("/");
      const now = db.nowMs();
      const expiresAt = now + UPLOAD_TTL_MS;
      supportIntentsTable(db).insert({
        id,
        owner_user_id: principal.userId,
        storage_provider: STORAGE_PROVIDER_NAME,
        storage_key: key,
        content_type: contentType,
        expected_size_bytes: sizeBytes,
        expires_at: expiresAt,
        completed_at: null,
        attachment_id: null,
        created_at: now,
      });
      // El «S3» simulado del núcleo solo acepta el PUT de claves con una intención del núcleo (`private_upload_intents`):
      // se registra también allí (sin vehículo) para que `PUT uploadUrl` funcione. Nada más la lee.
      db.uploadIntents.insert({
        id: db.ids.uuid(),
        owner_user_id: principal.userId,
        vehicle_id: "",
        kind: "vehicle_photo",
        storage_provider: STORAGE_PROVIDER_NAME,
        storage_key: key,
        content_type: contentType,
        expected_size_bytes: sizeBytes,
        expires_at: expiresAt,
        completed_at: null,
        created_at: now,
      });
      return reply.created({ intentId: id, uploadUrl: signedUrl("upload", key, expiresAt), headers: { "content-type": contentType }, expiresAt: iso(expiresAt) });
    }
  );

  r.post<{ Params: { intentId: string } }>(
    "/v1/me/support/uploads/:intentId/complete",
    { summary: "Confirmar una subida y registrar el adjunto", tags: ["support"], schema: { params: uuidParam("intentId") } },
    (req) => {
      const principal = req.auth();
      requireStorage(db);
      const intents = supportIntentsTable(db);
      const intent = intents.get(req.params.intentId);
      if (!intent || intent.owner_user_id !== principal.userId) fail("UPLOAD_INTENT_NOT_FOUND", "No encontramos esa subida.", 404);
      const attachments = attachmentsTable(db);
      if (intent.completed_at !== null && intent.attachment_id !== null) {
        const existing = attachments.get(intent.attachment_id);
        if (existing) return reply.ok(attachmentWire(existing));
      }
      if (intent.expires_at < db.nowMs()) fail("UPLOAD_INTENT_EXPIRED", "La subida ha caducado. Vuelve a elegir la imagen.", 410);
      const blob = db.blobs.get(intent.storage_key);
      if (!blob) fail("UPLOAD_OBJECT_MISSING", "La imagen todavía no ha llegado al servidor. Vuelve a subirla.", 409);
      if (blob.sizeBytes !== intent.expected_size_bytes) {
        fail("UPLOADED_FILE_SIZE_MISMATCH", "El tamaño de la imagen no coincide con el indicado.", 422, { expected: intent.expected_size_bytes, actual: blob.sizeBytes });
      }
      if (blob.contentType.split(";")[0] !== intent.content_type) {
        fail("UPLOADED_FILE_TYPE_MISMATCH", "El tipo de archivo no coincide con el indicado.", 422);
      }
      const bytes = blob.bytes ?? new Uint8Array(blob.sizeBytes);
      if (blob.bytes !== null && !looksLikeImage(intent.content_type, bytes)) {
        fail("UPLOADED_FILE_TYPE_MISMATCH", "El archivo no parece una imagen válida.", 422);
      }
      const now = db.nowMs();
      const created = attachments.insert({
        id: db.ids.uuid(),
        owner_user_id: principal.userId,
        ticket_id: null,
        message_id: null,
        storage_provider: intent.storage_provider,
        storage_key: intent.storage_key,
        content_type: intent.content_type,
        size_bytes: bytes.byteLength,
        sha256: sha256Hex(bytes),
        created_at: now,
      });
      intents.update(intent.id, { completed_at: now, attachment_id: created.id });
      return reply.created(attachmentWire(created));
    }
  );

  r.get<{ Params: { attachmentId: string } }>(
    "/v1/me/support/attachments/:attachmentId/download",
    { summary: "URL firmada (5 min) para ver un adjunto propio", tags: ["support"], schema: { params: uuidParam("attachmentId") } },
    (req) => {
      const principal = req.auth();
      const attachment = attachmentsTable(db).get(req.params.attachmentId);
      if (!attachment || attachment.owner_user_id !== principal.userId) {
        fail("SUPPORT_ATTACHMENT_NOT_FOUND", "No encontramos esa imagen.", 404);
      }
      const expiresAt = db.nowMs() + DOWNLOAD_TTL_MS;
      return { url: signedUrl("download", attachment.storage_key, expiresAt), expiresAt: iso(expiresAt) };
    }
  );

  // ── Consultas ─────────────────────────────────────────────────────────────────────────────────────────────────────

  r.post<{ Body: CreateTicketBody }>(
    "/v1/me/support/tickets",
    {
      summary: "Enviar una consulta al equipo de MVC",
      tags: ["support"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["category", "body"],
          properties: {
            category: { type: "string", enum: ["trip_issue", "payment_issue", "account_profile"] },
            body: { type: "string", minLength: 1, maxLength: 500 },
            tripId: { type: "string", format: "uuid" },
            bookingId: { type: "string", format: "uuid" },
            attachmentIds: { type: "array", items: { type: "string", format: "uuid" } },
          },
        },
      },
    },
    (req) => {
      const principal = req.auth();
      const input = req.body;
      const text = input.body.trim();
      if (text.length < 1) validationError("/body", "Escribe tu consulta.");
      const tickets = ticketsTable(db);
      const key = req.header("idempotency-key") ?? null;
      const fingerprint = sha256Hex(new TextEncoder().encode(JSON.stringify([input.category, text, input.tripId ?? null, input.bookingId ?? null, input.attachmentIds ?? []])));
      if (key !== null) {
        const prior = tickets.find((ticket) => ticket.user_id === principal.userId && ticket.idempotency_key === key);
        if (prior) {
          if (prior.idempotency_hash !== fingerprint) fail("SUPPORT_IDEMPOTENCY_CONFLICT", "Ya enviaste otra consulta con esa misma clave.", 409);
          return reply.ok(ticketDetailWire(db, prior));
        }
      }

      const mine = tickets.filter((ticket) => ticket.user_id === principal.userId);
      const open = mine.filter((ticket) => ticket.status !== "closed").length;
      const today = mine.filter((ticket) => ticket.created_at > db.nowMs() - DAY_MS).length;
      if (open >= MAX_OPEN_TICKETS || today >= MAX_TICKETS_PER_DAY) {
        fail("SUPPORT_TICKET_LIMIT", "Has alcanzado el límite de consultas abiertas. Espera a que respondamos o cierra alguna.", 429);
      }

      const trips = participatedTrips(db, principal.userId);
      let tripId = input.tripId ?? null;
      let bookingId = input.bookingId ?? null;
      if (bookingId !== null) {
        const match = trips.find((item) => item.bookingId === bookingId);
        if (!match) fail("SUPPORT_LINK_FORBIDDEN", "No puedes vincular una reserva que no es tuya.", 403);
        tripId ??= match.trip.id;
      }
      if (tripId !== null && !trips.some((item) => item.trip.id === tripId)) {
        fail("SUPPORT_LINK_FORBIDDEN", "No puedes vincular un viaje en el que no has participado.", 403);
      }
      const attachments = takeAttachments(db, principal.userId, input.attachmentIds);

      return db.tx(() => {
        const now = db.nowMs();
        const ticket = tickets.insert({
          id: db.ids.uuid(),
          reference: nextTicketReference(db),
          user_id: principal.userId,
          category: input.category,
          status: "open",
          trip_id: tripId,
          booking_id: bookingId,
          body: text,
          assigned_to_user_id: null,
          last_user_message_at: now,
          last_staff_message_at: null,
          closed_at: null,
          closed_by: null,
          created_at: now,
          updated_at: now,
          idempotency_key: key,
          idempotency_hash: fingerprint,
        });
        const message = ticketMessagesTable(db).insert({
          id: db.ids.uuid(),
          ticket_id: ticket.id,
          author_type: "user",
          author_user_id: principal.userId,
          body: text,
          created_at: now,
        });
        for (const attachment of attachments) attachmentsTable(db).update(attachment.id, { ticket_id: ticket.id, message_id: message.id });
        return reply.created(ticketDetailWire(db, ticket));
      });
    }
  );

  r.get<{ Query: { status?: TicketStatus; limit?: number; cursor?: string } }>(
    "/v1/me/support/tickets",
    {
      summary: "Mis consultas (recientes primero)",
      tags: ["support"],
      schema: {
        querystring: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["open", "answered", "closed"] },
            limit: { type: "integer", minimum: 1, maximum: 50 },
            cursor: { type: "string", maxLength: 200 },
          },
        },
      },
    },
    (req) => {
      const principal = req.auth();
      const rows = ticketsTable(db)
        .filter((ticket) => ticket.user_id === principal.userId)
        .map((ticket) => ({ ticket, summary: summaryWire(db, ticket) }))
        .filter((entry) => req.query.status === undefined || entry.summary.status === req.query.status);
      // Más reciente primero; con el reloj parado los empates salen en orden inverso de creación.
      const ordered = rows
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => Date.parse(b.entry.summary.lastActivityAt ?? "") - Date.parse(a.entry.summary.lastActivityAt ?? "") || b.index - a.index)
        .map((item) => item.entry.summary);
      return pageOf(ordered, req.query);
    }
  );

  r.get<{ Params: { ticketId: string } }>(
    "/v1/me/support/tickets/:ticketId",
    { summary: "Hilo de una consulta", tags: ["support"], schema: { params: uuidParam("ticketId") } },
    (req) => ticketDetailWire(db, ownTicket(db, req.auth().userId, req.params.ticketId))
  );

  r.post<{ Params: { ticketId: string }; Body: ReplyBody }>(
    "/v1/me/support/tickets/:ticketId/replies",
    {
      summary: "Responder en una consulta",
      tags: ["support"],
      schema: {
        params: uuidParam("ticketId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["body"],
          properties: {
            body: { type: "string", minLength: 1, maxLength: 1000 },
            attachmentIds: { type: "array", items: { type: "string", format: "uuid" } },
          },
        },
      },
    },
    (req) => {
      const principal = req.auth();
      const ticket = ownTicket(db, principal.userId, req.params.ticketId);
      const text = req.body.body.trim();
      if (text.length < 1) validationError("/body", "Escribe tu respuesta.");
      if (ticket.status === "closed") fail("SUPPORT_TICKET_CLOSED", "Esta consulta está cerrada. Abre una nueva si necesitas algo más.", 409);
      const attachments = takeAttachments(db, principal.userId, req.body.attachmentIds);
      return db.tx(() => {
        const now = db.nowMs();
        const message = ticketMessagesTable(db).insert({
          id: db.ids.uuid(),
          ticket_id: ticket.id,
          author_type: "user",
          author_user_id: principal.userId,
          body: text,
          created_at: now,
        });
        for (const attachment of attachments) attachmentsTable(db).update(attachment.id, { ticket_id: ticket.id, message_id: message.id });
        const updated = ticketsTable(db).update(ticket.id, { status: "open", last_user_message_at: now, updated_at: now });
        return reply.created(ticketDetailWire(db, updated));
      });
    }
  );

  r.post<{ Params: { ticketId: string } }>(
    "/v1/me/support/tickets/:ticketId/close",
    { summary: "Cerrar una consulta (idempotente)", tags: ["support"], schema: { params: uuidParam("ticketId") } },
    (req) => {
      const ticket = ownTicket(db, req.auth().userId, req.params.ticketId);
      if (ticket.status === "closed") return ticketDetailWire(db, ticket);
      const now = db.nowMs();
      return ticketDetailWire(db, ticketsTable(db).update(ticket.id, { status: "closed", closed_at: now, closed_by: "user", updated_at: now }));
    }
  );
}
