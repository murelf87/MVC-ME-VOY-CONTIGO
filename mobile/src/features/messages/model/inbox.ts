/**
 * Lógica pura de la bandeja de mensajes (pantalla 25): pestañas, búsqueda, textos de cada fila e insignias.
 * Sin React ni red: se prueba en Node.
 */
import type { ConversationFilter, ConversationSummary } from "@/api/types";
import { formatInboxStamp } from "@/i18n";
import { messagesStrings } from "../strings";

const copy = messagesStrings.inbox;

/** Pestañas de la lámina 25 en su orden: Todos · Mis reservas · Grupos. */
export const INBOX_TABS: ReadonlyArray<{ value: ConversationFilter; label: string }> = [
  { value: "all", label: copy.tabAll },
  { value: "bookings", label: copy.tabBookings },
  { value: "groups", label: copy.tabGroups },
];

export function isConversationFilter(value: unknown): value is ConversationFilter {
  return value === "all" || value === "bookings" || value === "groups";
}

export const MIN_SEARCH_CHARS = 2;
export const MAX_SEARCH_CHARS = 60;

/** Texto de búsqueda listo para enviar (2–60 caracteres, espacios recortados) o `null` si aún no se debe buscar. */
export function normalizeSearch(raw: string): string | null {
  const text = raw.replace(/\s+/g, " ").trim().slice(0, MAX_SEARCH_CHARS).trim();
  return text.length >= MIN_SEARCH_CHARS ? text : null;
}

/** ¿Hay algo escrito pero demasiado corto para buscar? (pista «Escribe al menos 2 letras»). */
export function isSearchTooShort(raw: string): boolean {
  const text = raw.replace(/\s+/g, " ").trim();
  return text.length > 0 && text.length < MIN_SEARCH_CHARS;
}

/** Marca de tiempo de la fila: hoy `07:12`, ayer `Ayer`, este año `16 may`. */
export function rowStamp(conversation: ConversationSummary, now: Date | number = new Date()): string {
  return formatInboxStamp(conversation.lastActivityAt, now);
}

/** Vista previa del último mensaje (o una frase si aún no hay mensajes). En directos, lo mío lleva «Tú: ». */
export function previewOf(conversation: ConversationSummary): string {
  const last = conversation.lastMessage;
  if (last === null) return conversation.kind === "group" ? copy.noMessagesGroup : copy.noMessagesDirect;
  if (conversation.kind === "direct" && last.mine && !last.preview.startsWith(copy.youPrefix)) return `${copy.youPrefix}${last.preview}`;
  return last.preview;
}

/** Texto de la insignia roja: de 1 a 99; más de 99 se escribe «99+». */
export function badgeText(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function hasUnread(conversation: ConversationSummary): boolean {
  return conversation.unreadCount > 0;
}

export function a11yLabelOf(conversation: ConversationSummary, now: Date | number = new Date()): string {
  return copy.rowA11y(conversation.title, conversation.subtitle, previewOf(conversation), rowStamp(conversation, now), conversation.unreadCount);
}

/** Texto del estado «sin resultados» según pestaña y búsqueda. */
export function emptyCopy(filter: ConversationFilter, query: string | null): { title: string; message: string } | null {
  if (query !== null) return { title: copy.searchEmptyTitle, message: copy.searchEmptyMessage(query) };
  if (filter === "bookings") return { title: copy.endTitle, message: copy.filterEmptyBookings };
  if (filter === "groups") return { title: copy.endTitle, message: copy.filterEmptyGroups };
  return null;
}

/** Suma de no leídos de una lista ya cargada (respaldo si el servidor no envía `unreadTotal`). */
export function sumUnread(items: readonly ConversationSummary[]): number {
  return items.reduce((sum, item) => sum + item.unreadCount, 0);
}
