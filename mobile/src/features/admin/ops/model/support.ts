/**
 * Atención al cliente (docs/contracts/trust.md §4.4): filtros de la cola, estados, validación de la respuesta y
 * presentación de adjuntos. Funciones puras: se prueban en Node.
 */
import { NBSP, formatDecimal } from "@/i18n";
import type { AdminSupportTicketCategory, AdminSupportTicketRow, AdminSupportTicketStatus } from "@/api/types";

export type SupportStatusFilter = AdminSupportTicketStatus | "all";
export type SupportAssignedFilter = "any" | "me" | "unassigned";
export type SupportCategoryFilter = AdminSupportTicketCategory | "all";

export interface SupportFilter {
  status: SupportStatusFilter;
  assigned: SupportAssignedFilter;
  category: SupportCategoryFilter;
}

export const DEFAULT_SUPPORT_FILTER: SupportFilter = { status: "open", assigned: "any", category: "all" };

export const SUPPORT_STATUSES: readonly SupportStatusFilter[] = ["open", "answered", "closed", "all"];
export const SUPPORT_CATEGORIES: readonly AdminSupportTicketCategory[] = ["trip_issue", "payment_issue", "account_profile"];
export const SUPPORT_ASSIGNED: readonly SupportAssignedFilter[] = ["any", "me", "unassigned"];

export function isDefaultFilter(filter: SupportFilter): boolean {
  return filter.status === DEFAULT_SUPPORT_FILTER.status && filter.assigned === "any" && filter.category === "all";
}

/** Filtros distintos de «todas» para el contador del botón «Filtros». */
export function activeFilterCount(filter: SupportFilter): number {
  return (filter.assigned !== "any" ? 1 : 0) + (filter.category !== "all" ? 1 : 0);
}

export const REPLY_MAX = 4000;

export type ReplyValidation = { ok: true; body: string } | { ok: false; message: string };

export function validateReply(text: string): ReplyValidation {
  const body = text.trim();
  if (body.length === 0) return { ok: false, message: "Escribe una respuesta antes de enviarla." };
  if (body.length > REPLY_MAX) return { ok: false, message: `La respuesta admite como máximo ${formatDecimal(REPLY_MAX, 0)} caracteres.` };
  return { ok: true, body };
}

export const ACCESS_NOTE_MAX = 500;

/** Un adjunto puede abrirse en la propia ventana si es una imagen; el resto se ofrece como enlace de descarga. */
export function isImageType(contentType: string): boolean {
  return contentType.toLowerCase().startsWith("image/");
}

export type AttachmentKind = "image" | "pdf" | "other";

export function attachmentKind(contentType: string): AttachmentKind {
  const type = contentType.toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  return "other";
}

/** `2411724` → «2,3 MB» · `820` → «820 B» · `15360` → «15 KB». */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${Math.round(bytes)}${NBSP}B`;
  if (bytes < 1024 * 1024) return `${formatDecimal(bytes / 1024, bytes < 10 * 1024 ? 1 : 0)}${NBSP}KB`;
  return `${formatDecimal(bytes / (1024 * 1024), 1)}${NBSP}MB`;
}

/** «Cuenta y perfil» → clave de etiqueta y tono de la píldora de estado de una consulta. */
export type TicketTone = "amber" | "blue" | "gray";

export function ticketTone(status: AdminSupportTicketStatus): TicketTone {
  switch (status) {
    case "open":
      return "amber";
    case "answered":
      return "blue";
    case "closed":
      return "gray";
  }
}

export function isMine(ticket: Pick<AdminSupportTicketRow, "assignedTo">, myUserId: string | null): boolean {
  return myUserId !== null && ticket.assignedTo !== null && ticket.assignedTo.id === myUserId;
}

/** Iniciales de una persona («Miguel Torres» → «MT»). */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part !== "");
  if (parts.length === 0) return "?";
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return `${first}${last}`.toLocaleUpperCase("es-ES");
}
