/**
 * Bandeja de mensajes (pantalla 25): lista paginada por cursor de `GET /v1/conversations`, con pestaña, búsqueda con
 * espera y sondeo suave para que las insignias de «no leído» se mantengan al día mientras la pantalla está a la vista.
 */
import type { ConversationFilter, ConversationSummary } from "@/api/types";
import { useDebouncedValue, usePaginatedQuery, type UsePaginatedQueryResult } from "@/hooks";
import { listConversations } from "../api";
import { isSearchTooShort, normalizeSearch, sumUnread } from "../model/inbox";
import { conversationsKey } from "./keys";

/** Espera tras la última tecla antes de buscar. */
export const SEARCH_DEBOUNCE_MS = 350;
/** La bandeja se refresca sola cada 20 s mientras se está viendo. */
export const INBOX_POLL_MS = 20_000;
const PAGE_SIZE = 20;

export interface ConversationListState extends Omit<UsePaginatedQueryResult<ConversationSummary>, "pages"> {
  /** Búsqueda que se está aplicando (ya normalizada) o `null`. */
  query: string | null;
  /** Hay algo escrito pero aún no basta para buscar (menos de 2 letras). */
  searchTooShort: boolean;
  /** Se está esperando a que la persona deje de escribir. */
  debouncing: boolean;
  /** Total de mensajes sin leer en TODAS las conversaciones (lo da el servidor; si no, la suma de lo cargado). */
  unreadTotal: number;
}

function unreadTotalOf(pages: ReadonlyArray<object>, items: readonly ConversationSummary[]): number {
  const first = pages[0] as { unreadTotal?: unknown } | undefined;
  return typeof first?.unreadTotal === "number" ? first.unreadTotal : sumUnread(items);
}

export function useConversationList(filter: ConversationFilter, rawQuery: string): ConversationListState {
  const debounced = useDebouncedValue(rawQuery, SEARCH_DEBOUNCE_MS);
  const query = normalizeSearch(debounced);
  const { pages, ...list } = usePaginatedQuery<ConversationSummary>(
    conversationsKey(filter, query),
    ({ cursor, signal }) => listConversations({ filter, q: query, cursor, limit: PAGE_SIZE }, { signal }),
    { refetchIntervalMs: INBOX_POLL_MS, staleTimeMs: 10_000 },
  );
  return {
    ...list,
    query,
    searchTooShort: isSearchTooShort(rawQuery),
    debouncing: debounced !== rawQuery,
    unreadTotal: unreadTotalOf(pages, list.items),
  };
}
