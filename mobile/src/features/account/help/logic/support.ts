/**
 * Lógica pura del Centro de ayuda (lámina 35) y de las consultas: validación en español, selector de viaje,
 * adjuntos y estado de una consulta. Sin React ni red: se prueba en Node.
 *
 * Reglas del contrato (docs/contracts/comms.md §4):
 *  - `body` 1–500 caracteres tras recortar (respuesta: 1–1000); hasta 4 adjuntos; imágenes jpeg/png/webp/heic/heif ≤ 10 MiB.
 *  - Estados: open → (equipo responde) answered → (usuario responde) open; open|answered → closed. Cerrada es final.
 */
import type {
  SupportAttachmentContentType,
  SupportCategory,
  SupportTicketDetail,
  SupportTicketStatus,
  SupportTicketSummary,
  SupportTripOption,
} from "@/api/types";
import { formatDayShort, formatRelative } from "@/i18n";
import { helpStrings } from "../strings";

export const TICKET_BODY_MAX = 500;
export const REPLY_BODY_MAX = 1000;
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const SUPPORT_CATEGORIES: readonly SupportCategory[] = ["trip_issue", "payment_issue", "account_profile"];

export function isSupportCategory(value: unknown): value is SupportCategory {
  return typeof value === "string" && (SUPPORT_CATEGORIES as readonly string[]).includes(value);
}

// ── Validación ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface TicketFormInput {
  category: SupportCategory | null;
  body: string;
  /** Imágenes que aún se están subiendo. */
  uploadingCount?: number;
}

export interface TicketFormErrors {
  category?: string;
  body?: string;
  attachments?: string;
}

export function validateTicketForm(input: TicketFormInput): TicketFormErrors {
  const errors: TicketFormErrors = {};
  if (input.category === null) errors.category = helpStrings.help.validation.category;
  const body = input.body.trim();
  if (body.length === 0) errors.body = helpStrings.help.validation.bodyEmpty;
  else if (body.length > TICKET_BODY_MAX) errors.body = helpStrings.help.validation.bodyTooLong;
  if ((input.uploadingCount ?? 0) > 0) errors.attachments = helpStrings.help.validation.attachmentsPending;
  return errors;
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

export function validateReplyBody(body: string): string | null {
  const trimmed = body.trim();
  if (trimmed.length === 0) return helpStrings.tickets.replyEmpty;
  if (trimmed.length > REPLY_BODY_MAX) return helpStrings.tickets.replyTooLong;
  return null;
}

// ── Viajes del selector ──────────────────────────────────────────────────────────────────────────────────────────

/** `Vie, 16 may · Sevilla → Camas` (la app formatea el viaje; el servidor solo manda fecha y etiquetas). */
export function describeTripOption(option: Pick<SupportTripOption, "departureAt" | "originLabel" | "destinationLabel">): string {
  const day = option.departureAt ? formatDayShort(option.departureAt) : "";
  const origin = option.originLabel?.trim() || helpStrings.help.tripUnknownPlace;
  const destination = option.destinationLabel?.trim() || helpStrings.help.tripUnknownPlace;
  return `${day === "" ? helpStrings.help.tripUnknownDay : day} · ${origin} → ${destination}`;
}

export function tripRoleLabel(role: SupportTripOption["role"]): string {
  return role === "driver" ? helpStrings.help.tripRoleDriver : helpStrings.help.tripRolePassenger;
}

// ── Adjuntos ─────────────────────────────────────────────────────────────────────────────────────────────────────

const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

/** Normaliza el tipo MIME que da el selector de fotos (`image/jpg` → `image/jpeg`); `null` si no se admite. */
export function normalizeImageMime(mime: string | null | undefined): SupportAttachmentContentType | null {
  if (!mime) return null;
  const lower = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const fixed = lower === "image/jpg" || lower === "image/pjpeg" ? "image/jpeg" : lower;
  return ALLOWED_IMAGE_TYPES.has(fixed) ? (fixed as SupportAttachmentContentType) : null;
}

export type ImageCheck = { ok: true; contentType: SupportAttachmentContentType } | { ok: false; reason: "type" | "size" };

export function checkImage(mime: string | null | undefined, sizeBytes: number | null | undefined): ImageCheck {
  const contentType = normalizeImageMime(mime);
  if (contentType === null) return { ok: false, reason: "type" };
  if (sizeBytes === null || sizeBytes === undefined || !Number.isFinite(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) {
    return { ok: false, reason: "size" };
  }
  return { ok: true, contentType };
}

/** `482 KB`, `1,3 MB`. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  return `${(Math.round(mb * 10) / 10).toString().replace(".", ",")} MB`;
}

// ── Consultas ────────────────────────────────────────────────────────────────────────────────────────────────────

export type TicketTone = "blue" | "green" | "gray";

export function ticketStatusTone(status: SupportTicketStatus): TicketTone {
  switch (status) {
    case "open":
      return "blue";
    case "answered":
      return "green";
    case "closed":
      return "gray";
  }
}

export function ticketCanReply(ticket: Pick<SupportTicketDetail, "status">): boolean {
  return ticket.status !== "closed";
}

export function ticketCanClose(ticket: Pick<SupportTicketDetail, "status">): boolean {
  return ticket.status !== "closed";
}

export function ticketLastActivity(ticket: Pick<SupportTicketSummary, "lastActivityAt">, now: Date | number = new Date()): string {
  return helpStrings.tickets.lastActivity(formatRelative(ticket.lastActivityAt, now));
}

/** Convierte el detalle en el resumen que muestra la lista (para actualizar la caché sin volver a pedirla). */
export function summaryOf(ticket: SupportTicketDetail): SupportTicketSummary {
  return {
    id: ticket.id,
    reference: ticket.reference,
    category: ticket.category,
    status: ticket.status,
    bodyPreview: ticket.bodyPreview,
    tripId: ticket.tripId,
    bookingId: ticket.bookingId,
    attachmentCount: ticket.attachmentCount,
    hasStaffReply: ticket.hasStaffReply,
    lastActivityAt: ticket.lastActivityAt,
    createdAt: ticket.createdAt,
  };
}

export type TicketFilter = SupportTicketStatus | "all";
export const TICKET_FILTERS: readonly TicketFilter[] = ["all", "open", "answered", "closed"];

export function ticketFilterLabel(filter: TicketFilter): string {
  switch (filter) {
    case "all":
      return helpStrings.tickets.filterAll;
    case "open":
      return helpStrings.tickets.filterOpen;
    case "answered":
      return helpStrings.tickets.filterAnswered;
    case "closed":
      return helpStrings.tickets.filterClosed;
  }
}
