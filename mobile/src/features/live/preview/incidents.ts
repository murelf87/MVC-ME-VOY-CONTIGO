/**
 * Incidencias de un viaje (contrato `live.md` §5.2–§5.4): crear, listar las propias, ver el detalle y adjuntar imágenes
 * al almacenamiento privado (intención de subida + confirmación). SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 * El estado de la incidencia (`open → in_review → resolved | dismissed`) lo mueve el equipo de confianza y seguridad, no
 * quien la crea: aquí el usuario solo crea y consulta.
 */
import type { LiveIncidentAttachment, LiveIncidentCategory, LiveIncidentReport } from "@/api/types";
import { STORAGE_PROVIDER_NAME, fail, iso, isoReq, reply, signedUrl, uuidParam } from "@/preview";
import type { JsonSchema, PreviewDb, PreviewRouter } from "@/preview";
import { liveAttachments, liveIncidents, privateStorageConfigured, type LiveAttachmentRow, type LiveIncidentRow, type RaterRole } from "./rows";

export const DESCRIPTION_MIN_LENGTH = 10;
export const DESCRIPTION_MAX_LENGTH = 2000;
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const UPLOAD_TTL_MS = 10 * 60_000;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const ATTACHMENT_TYPES: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

const CATEGORIES: readonly LiveIncidentCategory[] = [
  "safety",
  "driver_behavior",
  "passenger_behavior",
  "vehicle",
  "route_or_schedule",
  "payment",
  "lost_item",
  "other",
];

const idempotencyHeaders: JsonSchema = {
  type: "object",
  properties: { "idempotency-key": { type: "string", pattern: "^[A-Za-z0-9_.:-]{8,80}$" } },
};

const pageQuery: JsonSchema = {
  type: "object",
  properties: {
    limit: { type: "integer", minimum: 1, maximum: MAX_PAGE_SIZE },
    cursor: { type: "string", maxLength: 100 },
  },
};

/** Los adjuntos que cuentan: los subidos y los pendientes cuya URL firmada sigue vigente. */
function countedAttachments(db: PreviewDb, reportId: string): Array<Readonly<LiveAttachmentRow>> {
  const now = db.nowMs();
  return liveAttachments(db).filter((a) => a.report_id === reportId && (a.status === "uploaded" || a.expires_at > now));
}

export function attachmentWire(row: Readonly<LiveAttachmentRow>): LiveIncidentAttachment {
  return {
    id: row.id,
    contentType: row.content_type,
    sizeBytes: row.size_bytes ?? row.expected_size_bytes,
    status: row.status,
    createdAt: isoReq(row.created_at),
  };
}

export function incidentWire(db: PreviewDb, row: Readonly<LiveIncidentRow>): LiveIncidentReport {
  return {
    id: row.id,
    tripId: row.trip_id,
    bookingId: row.booking_id,
    category: row.category,
    description: row.description,
    status: row.status,
    reporterRole: row.reporter_role,
    createdAt: isoReq(row.created_at),
    updatedAt: isoReq(row.updated_at),
    attachments: countedAttachments(db, row.id)
      .sort((a, b) => a.created_at - b.created_at)
      .map(attachmentWire),
  };
}

function ownReport(db: PreviewDb, reportId: string, userId: string): Readonly<LiveIncidentRow> {
  const report = liveIncidents(db).get(reportId);
  if (!report || report.reporter_user_id !== userId) fail("INCIDENT_NOT_FOUND", "Incident report not found", 404);
  return report;
}

function requirePrivateStorage(db: PreviewDb): void {
  if (!privateStorageConfigured(db)) {
    fail("PRIVATE_STORAGE_NOT_CONFIGURED", "El almacenamiento privado no está configurado en este servidor.", 503);
  }
}

// ---- cursores opacos --------------------------------------------------------------------------------------------

function encodeCursor(offset: number): string {
  return `o1.${offset}`;
}

function decodeCursor(cursor: string): number {
  const match = /^o1\.(\d{1,9})$/.exec(cursor);
  if (!match) fail("INVALID_CURSOR", "El cursor no es válido.", 400);
  return Number(match[1]);
}

/** Más reciente primero; con el reloj detenido empatan y lo insertado después sale antes. */
function newestFirst<T extends { created_at: number }>(rows: readonly T[]): T[] {
  return [...rows].reverse().sort((a, b) => b.created_at - a.created_at);
}

export function registerIncidents(r: PreviewRouter, db: PreviewDb): void {
  r.post<{ Body: { tripId: string; bookingId?: string; category: LiveIncidentCategory; description: string } }>(
    "/v1/incident-reports",
    {
      summary: "Reportar una incidencia de un viaje",
      tags: ["live"],
      schema: {
        headers: idempotencyHeaders,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["tripId", "category", "description"],
          properties: {
            tripId: { type: "string", format: "uuid" },
            bookingId: { type: "string", format: "uuid" },
            category: { type: "string", enum: CATEGORIES },
            description: { type: "string" },
          },
        },
      },
    },
    (req) => {
      const me = req.auth();
      const { tripId, category } = req.body;
      const description = req.body.description.trim();
      const length = Array.from(description).length;
      if (length < DESCRIPTION_MIN_LENGTH || length > DESCRIPTION_MAX_LENGTH) {
        fail(
          "INCIDENT_DESCRIPTION_INVALID",
          `La descripción debe tener entre ${DESCRIPTION_MIN_LENGTH} y ${DESCRIPTION_MAX_LENGTH} caracteres.`,
          400,
          { min: DESCRIPTION_MIN_LENGTH, max: DESCRIPTION_MAX_LENGTH }
        );
      }
      const key = req.header("idempotency-key") ?? null;
      const reports = liveIncidents(db);
      if (key !== null) {
        const previous = reports.find((x) => x.reporter_user_id === me.userId && x.idempotency_key === key);
        if (previous) {
          if (previous.trip_id !== tripId) {
            fail("IDEMPOTENCY_KEY_REUSED", "Esa Idempotency-Key ya se usó para otra incidencia.", 409);
          }
          return incidentWire(db, previous);
        }
      }

      const trip = db.trips.get(tripId);
      if (!trip) fail("TRIP_NOT_FOUND", "Trip not found", 404);
      const tripBookings = db.bookings.filter((b) => db.rideRequests.get(b.request_id)?.trip_id === trip.id);
      const mine = tripBookings.filter((b) => db.rideRequests.get(b.request_id)?.passenger_user_id === me.userId);
      const isDriver = trip.driver_user_id === me.userId;
      if (!isDriver && mine.length === 0) fail("INCIDENT_NOT_PARTICIPANT", "Solo pueden reportar quienes participaron en el viaje.", 403);

      const wanted = req.body.bookingId;
      let bookingId: string | null = null;
      if (wanted !== undefined) {
        const pool = isDriver ? tripBookings : mine;
        if (!pool.some((b) => b.id === wanted)) fail("INCIDENT_BOOKING_MISMATCH", "La reserva indicada no es de este viaje.", 422);
        bookingId = wanted;
      } else if (!isDriver) {
        const latest = newestFirst(mine.map((b) => ({ id: b.id, created_at: b.created_at })))[0];
        bookingId = latest?.id ?? null;
      }

      const now = db.nowMs();
      const role: RaterRole = isDriver ? "driver" : "passenger";
      const row = reports.insert({
        id: db.ids.uuid(),
        reporter_user_id: me.userId,
        reporter_role: role,
        trip_id: trip.id,
        booking_id: bookingId,
        category,
        description,
        status: "open",
        idempotency_key: key,
        created_at: now,
        updated_at: now,
        resolved_at: null,
      });
      return reply.created(incidentWire(db, row));
    }
  );

  r.get<{ Query: { limit?: number; cursor?: string } }>(
    "/v1/me/incident-reports",
    { summary: "Mis incidencias (más recientes primero)", tags: ["live"], schema: { querystring: pageQuery } },
    (req) => {
      const me = req.auth();
      const all = newestFirst(liveIncidents(db).filter((x) => x.reporter_user_id === me.userId));
      const limit = req.query.limit ?? DEFAULT_PAGE_SIZE;
      const offset = req.query.cursor === undefined || req.query.cursor === "" ? 0 : decodeCursor(req.query.cursor);
      const items = all.slice(offset, offset + limit).map((row) => incidentWire(db, row));
      const next = offset + items.length;
      return { items, nextCursor: next < all.length ? encodeCursor(next) : null };
    }
  );

  r.get<{ Params: { reportId: string } }>(
    "/v1/me/incident-reports/:reportId",
    { summary: "Detalle de una incidencia propia", tags: ["live"], schema: { params: uuidParam("reportId") } },
    (req) => incidentWire(db, ownReport(db, req.params.reportId, req.auth().userId))
  );

  r.post<{ Params: { reportId: string }; Body: { contentType: string; sizeBytes: number } }>(
    "/v1/incident-reports/:reportId/attachments",
    {
      summary: "Intención de subida de una imagen privada de la incidencia",
      tags: ["live"],
      schema: {
        params: uuidParam("reportId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["contentType", "sizeBytes"],
          // Sin `enum` ni `minimum`: el contrato pide 422 INCIDENT_ATTACHMENT_TYPE / _SIZE, no un VALIDATION_ERROR.
          properties: { contentType: { type: "string" }, sizeBytes: { type: "number" } },
        },
      },
    },
    (req) => {
      const me = req.auth();
      const report = ownReport(db, req.params.reportId, me.userId);
      requirePrivateStorage(db);
      if (report.status === "resolved" || report.status === "dismissed") {
        fail("INCIDENT_CLOSED", "La incidencia ya está cerrada: no admite más adjuntos.", 409);
      }
      const { contentType, sizeBytes } = req.body;
      const extension = ATTACHMENT_TYPES[contentType];
      if (extension === undefined) fail("INCIDENT_ATTACHMENT_TYPE", "Solo se pueden adjuntar imágenes JPG, PNG, WebP o HEIC.", 422, { contentType });
      if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_ATTACHMENT_BYTES) {
        fail("INCIDENT_ATTACHMENT_SIZE", "La imagen debe pesar entre 1 byte y 10 MiB.", 422, { maxBytes: MAX_ATTACHMENT_BYTES });
      }
      if (countedAttachments(db, report.id).length >= MAX_ATTACHMENTS) {
        fail("INCIDENT_ATTACHMENT_LIMIT", `Una incidencia admite como máximo ${MAX_ATTACHMENTS} imágenes.`, 409, { max: MAX_ATTACHMENTS });
      }

      const now = db.nowMs();
      const expiresAt = now + UPLOAD_TTL_MS;
      const id = db.ids.uuid();
      const storageKey = ["users", me.userId, "incidents", report.id, `${id}.${extension}`].join("/");
      liveAttachments(db).insert({
        id,
        report_id: report.id,
        owner_user_id: me.userId,
        storage_key: storageKey,
        content_type: contentType,
        expected_size_bytes: sizeBytes,
        size_bytes: null,
        status: "pending",
        expires_at: expiresAt,
        created_at: now,
        completed_at: null,
      });
      // El «S3» simulado del núcleo solo acepta el PUT de claves con una intención del núcleo (`private_upload_intents`):
      // se registra también allí (sin vehículo) para que `PUT uploadUrl` funcione. Nada más la lee.
      db.uploadIntents.insert({
        id: db.ids.uuid(),
        owner_user_id: me.userId,
        vehicle_id: "",
        kind: "vehicle_photo",
        storage_provider: STORAGE_PROVIDER_NAME,
        storage_key: storageKey,
        content_type: contentType,
        expected_size_bytes: sizeBytes,
        expires_at: expiresAt,
        completed_at: null,
        created_at: now,
      });
      return reply.created({
        attachmentId: id,
        uploadUrl: signedUrl("upload", storageKey, expiresAt),
        headers: { "content-type": contentType },
        expiresAt: iso(expiresAt),
      });
    }
  );

  r.post<{ Params: { reportId: string; attachmentId: string } }>(
    "/v1/incident-reports/:reportId/attachments/:attachmentId/complete",
    {
      summary: "Confirmar que la imagen se subió",
      tags: ["live"],
      schema: { params: { type: "object", required: ["reportId", "attachmentId"], properties: { reportId: { type: "string", format: "uuid" }, attachmentId: { type: "string", format: "uuid" } } } },
    },
    (req) => {
      const me = req.auth();
      const report = ownReport(db, req.params.reportId, me.userId);
      requirePrivateStorage(db);
      const attachments = liveAttachments(db);
      const attachment = attachments.get(req.params.attachmentId);
      if (!attachment || attachment.report_id !== report.id) fail("INCIDENT_ATTACHMENT_NOT_FOUND", "Incident attachment not found", 404);
      if (attachment.status === "uploaded") return attachmentWire(attachment);
      if (report.status === "resolved" || report.status === "dismissed") {
        fail("INCIDENT_CLOSED", "La incidencia ya está cerrada: no admite más adjuntos.", 409);
      }
      const now = db.nowMs();
      if (attachment.expires_at < now) fail("INCIDENT_ATTACHMENT_EXPIRED", "La subida ha caducado. Vuelve a elegir la imagen.", 410);
      const blob = db.blobs.get(attachment.storage_key);
      if (!blob) fail("INCIDENT_ATTACHMENT_MISMATCH", "La imagen todavía no ha llegado al servidor. Vuelve a subirla.", 422);
      if (blob.sizeBytes !== attachment.expected_size_bytes || blob.contentType.split(";")[0] !== attachment.content_type) {
        fail("INCIDENT_ATTACHMENT_MISMATCH", "El tamaño o el tipo de la imagen no coinciden con lo indicado.", 422, {
          expectedBytes: attachment.expected_size_bytes,
          receivedBytes: blob.sizeBytes,
        });
      }
      const done = attachments.update(attachment.id, { status: "uploaded", size_bytes: blob.sizeBytes, completed_at: now });
      liveIncidents(db).update(report.id, { updated_at: now });
      return attachmentWire(done);
    }
  );
}
