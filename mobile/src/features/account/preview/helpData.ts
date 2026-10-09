/**
 * Derechos sobre los datos (comms.md §6): exportación de datos y eliminación de cuenta con periodo de gracia.
 * SIMULACIÓN (solo vista previa). Nada se borra de verdad: la «ejecución» de la eliminación no existe aquí.
 */
import type { PreviewDb, PreviewRouter } from "@/preview";
import { fail, iso, paymentCompensations, reply, signedUrl, uuidParam } from "@/preview";
import {
  deletionsTable,
  exportsTable,
  pageOf,
  pageQuerySchema,
  storageDisabled,
  ticketsTable,
  type DeletionRow,
  type ExportRow,
} from "./helpStore";
import { settingsWire } from "./helpSettings";

const DAY_MS = 86_400_000;
const EXPORT_TTL_MS = 7 * DAY_MS;
const DOWNLOAD_TTL_MS = 300_000;
const GRACE_DAYS = 14;
/** Lecturas que tarda la simulación en pasar de «en cola» a «lista» (el reloj de la vista previa puede estar parado). */
const POLLS_UNTIL_PROCESSING = 1;
const POLLS_UNTIL_READY = 3;

// ── Exportación ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function buildExportJson(db: PreviewDb, userId: string): Uint8Array {
  const user = db.users.get(userId);
  const profile = db.profiles.get(userId);
  const roles = db.userRoles.filter((entry) => entry.user_id === userId).map((entry) => entry.role);
  const tickets = ticketsTable(db).filter((ticket) => ticket.user_id === userId);
  const document = {
    schemaVersion: 1,
    preview: "Archivo de ejemplo de la vista previa de diseño: no contiene datos reales.",
    generatedAt: iso(db.nowMs()),
    subject: { id: userId, phoneE164: user?.phone_e164 ?? null, status: user?.status ?? null, roles },
    profile: { displayName: profile?.display_name ?? null },
    settings: settingsWire(db, userId),
    supportTickets: tickets.map((ticket) => ({ reference: ticket.reference, category: ticket.category, status: ticket.status, createdAt: iso(ticket.created_at) })),
    notIncluded: [
      { module: "money", reason: "Pagos, reembolsos, recibos y liquidaciones todavía no se incluyen en la exportación." },
      { module: "trips", reason: "Lugares favoritos, rutina y reservas semanales todavía no se incluyen en la exportación." },
    ],
  };
  return new TextEncoder().encode(JSON.stringify(document, null, 2));
}

/** Hace avanzar la simulación del trabajo (cada lectura = un paso) y caduca lo que ya pasó de plazo. */
function advanceExport(db: PreviewDb, row: Readonly<ExportRow>): Readonly<ExportRow> {
  const table = exportsTable(db);
  const now = db.nowMs();
  if (row.status === "ready" && row.expires_at !== null && row.expires_at <= now) {
    if (row.storage_key !== null) db.blobs.delete(row.storage_key);
    return table.update(row.id, { status: "expired" });
  }
  if (row.status !== "queued" && row.status !== "processing") return row;
  const polls = row.polls + 1;
  if (polls >= POLLS_UNTIL_READY) {
    const bytes = buildExportJson(db, row.user_id);
    const key = ["users", row.user_id, "exports", `${row.id}.json`].join("/");
    db.blobs.put(key, bytes, "application/json", now);
    return table.update(row.id, {
      status: "ready",
      polls,
      completed_at: now,
      expires_at: now + EXPORT_TTL_MS,
      size_bytes: bytes.byteLength,
      storage_key: key,
    });
  }
  return table.update(row.id, { polls, status: polls >= POLLS_UNTIL_PROCESSING ? "processing" : "queued" });
}

function exportWire(db: PreviewDb, row: Readonly<ExportRow>) {
  return {
    id: row.id,
    status: row.status,
    format: "json" as const,
    requestedAt: iso(row.requested_at),
    completedAt: iso(row.completed_at),
    expiresAt: iso(row.expires_at),
    sizeBytes: row.size_bytes,
    downloadable: row.status === "ready" && (row.expires_at ?? 0) > db.nowMs(),
    errorCode: row.error_code,
  };
}

function ownExport(db: PreviewDb, userId: string, exportId: string): Readonly<ExportRow> {
  const row = exportsTable(db).get(exportId);
  if (!row || row.user_id !== userId) fail("EXPORT_NOT_FOUND", "No encontramos esa solicitud.", 404);
  return advanceExport(db, row);
}

function registerExports(r: PreviewRouter, db: PreviewDb): void {
  r.post(
    "/v1/me/data-exports",
    { summary: "Pedir una copia de mis datos (JSON)", tags: ["privacy"] },
    (req) => {
      const principal = req.auth();
      const table = exportsTable(db);
      const key = req.header("idempotency-key") ?? null;
      const mine = table.filter((row) => row.user_id === principal.userId).map((row) => advanceExport(db, row));
      if (key !== null) {
        const same = mine.find((row) => row.idempotency_key === key);
        if (same) return reply.ok(exportWire(db, same));
      }
      const running = mine.find((row) => row.status === "queued" || row.status === "processing");
      if (running) return reply.ok(exportWire(db, running));
      const now = db.nowMs();
      const row: ExportRow = {
        id: db.ids.uuid(),
        user_id: principal.userId,
        status: "queued",
        requested_at: now,
        completed_at: null,
        expires_at: null,
        size_bytes: null,
        storage_key: null,
        error_code: null,
        polls: 0,
        idempotency_key: key,
      };
      if (storageDisabled(db)) {
        return reply.accepted(
          exportWire(db, table.insert({ ...row, status: "blocked_storage_disabled", error_code: "PRIVATE_STORAGE_NOT_CONFIGURED" }))
        );
      }
      const recent = mine.some((entry) => (entry.status === "ready" || entry.status === "expired") && entry.requested_at > now - DAY_MS);
      if (recent) fail("EXPORT_RATE_LIMITED", "Solo puedes pedir una copia de tus datos cada 24 horas.", 429);
      return reply.accepted(exportWire(db, table.insert(row)));
    }
  );

  r.get<{ Query: { limit?: number; cursor?: string } }>(
    "/v1/me/data-exports",
    { summary: "Mis solicitudes de exportación", tags: ["privacy"], schema: { querystring: pageQuerySchema } },
    (req) => {
      const principal = req.auth();
      const rows = exportsTable(db)
        .filter((row) => row.user_id === principal.userId)
        .map((row) => advanceExport(db, row));
      const ordered = rows
        .map((row, index) => ({ row, index }))
        .sort((a, b) => b.row.requested_at - a.row.requested_at || b.index - a.index)
        .map((item) => exportWire(db, item.row));
      return pageOf(ordered, req.query);
    }
  );

  r.get<{ Params: { exportId: string } }>(
    "/v1/me/data-exports/:exportId",
    { summary: "Estado de una exportación", tags: ["privacy"], schema: { params: uuidParam("exportId") } },
    (req) => exportWire(db, ownExport(db, req.auth().userId, req.params.exportId))
  );

  r.get<{ Params: { exportId: string } }>(
    "/v1/me/data-exports/:exportId/download",
    { summary: "Enlace firmado (5 min) para descargar la exportación", tags: ["privacy"], schema: { params: uuidParam("exportId") } },
    (req) => {
      const row = ownExport(db, req.auth().userId, req.params.exportId);
      if (row.status === "expired") fail("EXPORT_EXPIRED", "La copia ha caducado. Pide otra.", 410);
      if (row.status !== "ready" || row.storage_key === null) fail("EXPORT_NOT_READY", "La copia todavía no está lista.", 409);
      const expiresAt = db.nowMs() + DOWNLOAD_TTL_MS;
      return { url: signedUrl("download", row.storage_key, expiresAt), expiresAt: iso(expiresAt) };
    }
  );
}

// ── Eliminación de cuenta ─────────────────────────────────────────────────────────────────────────────────────────────

interface Blocker {
  code: string;
  message: string;
  count: number;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

/** Bloqueos reales de las tablas base (comms.md §6.2). `money`/`trips` no registran los suyos (§11). */
export function deletionBlockers(db: PreviewDb, userId: string): Blocker[] {
  const now = db.nowMs();
  const out: Blocker[] = [];

  const driving = db.trips.filter(
    (trip) => trip.driver_user_id === userId && (trip.status === "active" || (trip.status === "published" && (trip.departure_at === null || trip.departure_at >= now)))
  ).length;
  if (driving > 0) {
    out.push({
      code: "ACTIVE_TRIP_AS_DRIVER",
      message: `Tienes ${driving} ${plural(driving, "viaje publicado o en curso", "viajes publicados o en curso")} como conductor. Cancélalo${driving === 1 ? "" : "s"} o complétalo${driving === 1 ? "" : "s"} antes de eliminar la cuenta.`,
      count: driving,
    });
  }

  const upcoming = db.bookings.filter((booking) => {
    if (booking.status !== "confirmed") return false;
    const request = db.rideRequests.get(booking.request_id);
    if (!request || request.passenger_user_id !== userId) return false;
    const trip = db.trips.get(request.trip_id);
    return trip !== undefined && trip.status !== "completed" && trip.status !== "cancelled";
  }).length;
  if (upcoming > 0) {
    out.push({
      code: "UPCOMING_BOOKING_AS_PASSENGER",
      message: `Tienes ${upcoming} ${plural(upcoming, "reserva confirmada pendiente", "reservas confirmadas pendientes")} de realizar. Cancélala${upcoming === 1 ? "" : "s"} o complétala${upcoming === 1 ? "" : "s"} antes de eliminar la cuenta.`,
      count: upcoming,
    });
  }

  const open = db.rideRequests.filter(
    (request) => request.passenger_user_id === userId && (request.status === "pending" || request.status === "accepted" || request.status === "payment_pending")
  ).length;
  if (open > 0) {
    out.push({
      code: "OPEN_RIDE_REQUEST",
      message: `Tienes ${open} ${plural(open, "solicitud de plaza abierta", "solicitudes de plaza abiertas")}. Espera a que se resuelva${open === 1 ? "" : "n"} o retírala${open === 1 ? "" : "s"} antes de eliminar la cuenta.`,
      count: open,
    });
  }

  const compensations = paymentCompensations(db).filter(
    (entry) => entry.status === "pending" && db.rideRequests.get(entry.request_id)?.passenger_user_id === userId
  ).length;
  if (compensations > 0) {
    out.push({
      code: "PENDING_PAYMENT_COMPENSATION",
      message: `Tienes ${compensations} ${plural(compensations, "devolución de pago pendiente", "devoluciones de pago pendientes")}. Espera a que se complete${compensations === 1 ? "" : "n"} antes de eliminar la cuenta.`,
      count: compensations,
    });
  }
  return out;
}

const DELETION_PLAN = {
  deleted: [
    "Teléfono y sesiones abiertas",
    "Foto de perfil, selfie y documentos privados",
    "Vehículos y sus documentos",
    "Notificaciones, dispositivos push y ajustes",
    "Contenido de tus mensajes",
  ],
  anonymised: [
    "Tu nombre público pasa a «Usuario eliminado» en viajes y chats de otras personas",
    "Reservas y viajes pasados (se conservan sin vincularlos a ti)",
  ],
  retained: [
    { item: "Registros de pago y facturación", reason: "Obligación legal (fiscal y contable)", period: "6 años" },
    { item: "Denuncias presentadas o recibidas y su prueba", reason: "Seguridad de las personas usuarias y defensa de reclamaciones", period: "hasta 3 años desde su cierre" },
  ],
};

function activeRequest(db: PreviewDb, userId: string): Readonly<DeletionRow> | undefined {
  return deletionsTable(db).find((row) => row.user_id === userId && (row.status === "scheduled" || row.status === "blocked" || row.status === "processing"));
}

/** `scheduled ⇄ blocked`: se revisa al consultar (en el backend lo hace el trabajo periódico). */
function reviewActiveRequest(db: PreviewDb, userId: string): Readonly<DeletionRow> | undefined {
  const row = activeRequest(db, userId);
  if (!row || row.status === "processing") return row;
  const blockers = deletionBlockers(db, userId);
  const status = blockers.length > 0 ? "blocked" : "scheduled";
  if (row.status !== status || row.blockers.length !== blockers.length) return deletionsTable(db).update(row.id, { status, blockers });
  return row;
}

function requestWire(row: Readonly<DeletionRow>) {
  return {
    id: row.id,
    status: row.status,
    requestedAt: iso(row.requested_at),
    scheduledFor: iso(row.scheduled_for),
    cancelledAt: iso(row.cancelled_at),
    completedAt: iso(row.completed_at),
    blockers: row.blockers,
  };
}

function latestRequest(db: PreviewDb, userId: string): Readonly<DeletionRow> | undefined {
  const active = reviewActiveRequest(db, userId);
  if (active) return active;
  const all = deletionsTable(db).filter((row) => row.user_id === userId);
  return all.sort((a, b) => b.requested_at - a.requested_at)[0];
}

export function deletionStateWire(db: PreviewDb, userId: string) {
  const blockers = deletionBlockers(db, userId);
  const request = latestRequest(db, userId);
  return { eligible: blockers.length === 0, blockers, graceDays: GRACE_DAYS, request: request ? requestWire(request) : null, plan: DELETION_PLAN };
}

function registerDeletion(r: PreviewRouter, db: PreviewDb): void {
  r.get("/v1/me/account-deletion", { summary: "Estado de la eliminación de cuenta: bloqueos, plazo y plan", tags: ["privacy"] }, (req) =>
    deletionStateWire(db, req.auth().userId)
  );

  r.post<{ Body: { confirmation: string; reason?: string } }>(
    "/v1/me/account-deletion",
    {
      summary: "Solicitar la eliminación de la cuenta (periodo de gracia de 14 días)",
      tags: ["privacy"],
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["confirmation"],
          properties: { confirmation: { type: "string", maxLength: 40 }, reason: { type: "string", maxLength: 500 } },
        },
      },
    },
    (req) => {
      const principal = req.auth();
      if (req.body.confirmation !== "ELIMINAR") {
        fail("ACCOUNT_DELETION_CONFIRMATION_REQUIRED", "Escribe ELIMINAR para confirmar la eliminación de tu cuenta.", 422);
      }
      if (reviewActiveRequest(db, principal.userId)) return reply.ok(deletionStateWire(db, principal.userId));
      const blockers = deletionBlockers(db, principal.userId);
      if (blockers.length > 0) {
        fail("ACCOUNT_DELETION_BLOCKED", "Ahora mismo no puedes eliminar tu cuenta: hay algo pendiente.", 409, { blockers });
      }
      const now = db.nowMs();
      deletionsTable(db).insert({
        id: db.ids.uuid(),
        user_id: principal.userId,
        status: "scheduled",
        requested_at: now,
        scheduled_for: now + GRACE_DAYS * DAY_MS,
        cancelled_at: null,
        completed_at: null,
        reason: req.body.reason?.trim() || null,
        blockers: [],
      });
      return reply.created(deletionStateWire(db, principal.userId));
    }
  );

  r.post(
    "/v1/me/account-deletion/cancel",
    { summary: "Cancelar la eliminación durante el periodo de gracia", tags: ["privacy"] },
    (req) => {
      const principal = req.auth();
      const row = activeRequest(db, principal.userId);
      if (!row) fail("ACCOUNT_DELETION_NOT_FOUND", "No hay ninguna solicitud de eliminación vigente.", 404);
      if (row.status === "processing") fail("ACCOUNT_DELETION_IN_PROGRESS", "La eliminación ya ha empezado y no se puede cancelar.", 409);
      deletionsTable(db).update(row.id, { status: "cancelled", cancelled_at: db.nowMs() });
      return deletionStateWire(db, principal.userId);
    }
  );
}

export function registerDataPreview(r: PreviewRouter, db: PreviewDb): void {
  registerExports(r, db);
  registerDeletion(r, db);
}
