import { useMemo } from "react";
import type { DecideRequestResponse } from "@/api/types/trips";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { decideRideRequest, decideWeeklyReservation, listDriverRequests } from "../api";
import { publishKeys, PUBLISH_ROOT } from "../keys";
import { buildCard, groupCards, type InboxGroups, type RequestCardView } from "../logic/requests";
import { holdStore, useHolds } from "../stores/holdStore";
import type { InboxItem } from "../types";

const PAGE_SIZE = 50;
/** Tope de páginas por carga: una bandeja real no pasa de unas decenas de solicitudes abiertas. */
const MAX_PAGES = 4;

/** Solicitudes abiertas (pendientes y a la espera del pago) de los viajes del conductor, o de uno solo. */
export function useDriverRequests(tripId?: string): UseApiQueryResult<InboxItem[]> {
  return useApiQuery<InboxItem[]>(
    publishKeys.requests(tripId),
    async ({ signal }) => {
      const items: InboxItem[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result = await listDriverRequests({ status: "open", tripId, cursor, limit: PAGE_SIZE }, { signal });
        items.push(...result.items);
        if (result.nextCursor === null) break;
        cursor = result.nextCursor;
      }
      return items;
    },
    { staleTimeMs: 10_000, refetchIntervalMs: 25_000 },
  );
}

export interface InboxView {
  cards: RequestCardView[];
  groups: InboxGroups;
}

/** Tarjetas de la bandeja con la cuenta atrás de las plazas retenidas calculada para `nowMs`. */
export function useInboxView(items: readonly InboxItem[] | undefined, nowMs: number): InboxView {
  const holds = useHolds();
  return useMemo(() => {
    const cards = (items ?? []).map((item) => buildCard(item, { nowMs, holds }));
    return { cards, groups: groupCards(cards) };
  }, [items, holds, nowMs]);
}

export interface DecisionVars {
  id: string;
  kind: "single" | "weekly";
  decision: "accept" | "reject";
}

/**
 * Acepta o rechaza una solicitud (o una reserva semanal ENTERA). Aceptar crea la retención de plaza: se recuerda cuándo
 * caduca para enseñar la cuenta atrás. NUNCA equivale a «pagado»: la reserva se confirma cuando el pasajero paga.
 */
export function useDecideRequest(): UseApiMutationResult<DecideRequestResponse, DecisionVars> {
  return useApiMutation<DecideRequestResponse, DecisionVars>(
    ({ id, kind, decision }, { signal }) =>
      kind === "weekly" ? decideWeeklyReservation(id, decision, { signal }) : decideRideRequest(id, decision, { signal }),
    {
      onSuccess: (result, variables) => {
        if (variables.decision === "accept" && result.hold !== null) holdStore.remember(variables.id, result.hold.expiresAt);
        if (variables.decision === "reject") holdStore.forget(variables.id);
      },
      invalidates: [[PUBLISH_ROOT, "requests"], [PUBLISH_ROOT, "request-detail"], [PUBLISH_ROOT, "weekly-detail"]],
    },
  );
}
