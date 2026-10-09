import { useCallback, useState } from "react";
import type { ConversationDetail } from "@/api/types";
import { useApiMutation } from "@/hooks";
import { useAppNavigation } from "@/navigation";
import { openPassengerChat } from "../api";
import type { OpsErrorView } from "../logic/errors";
import { describeOps } from "./describe";

export interface OpenPassengerChatState {
  /**
   * Abre el chat con ese pasajero (lo crea si no existía) y navega a él. Devuelve `null` si todo fue bien o el error ya
   * traducido para el conductor (chat cerrado, sin conexión…) para que la pantalla lo cuente.
   */
  open(passengerUserId: string): Promise<OpsErrorView | null>;
  isPending: boolean;
  /** Pasajero cuyo chat se está abriendo ahora. */
  pendingFor: string | null;
}

/** «Escribir a Laura»: `POST /v1/conversations/direct` y después la pantalla de chat de la reserva. */
export function useOpenPassengerChat(tripId: string): OpenPassengerChatState {
  const navigation = useAppNavigation();
  const [pendingFor, setPendingFor] = useState<string | null>(null);
  const mutation = useApiMutation<ConversationDetail, string>((passengerUserId, { signal }) => openPassengerChat(tripId, passengerUserId, { signal }));
  const { mutateAsync } = mutation;
  const open = useCallback(
    async (passengerUserId: string): Promise<OpsErrorView | null> => {
      setPendingFor(passengerUserId);
      try {
        const detail = await mutateAsync(passengerUserId);
        navigation.navigate("BookingChat", { conversationId: detail.id });
        return null;
      } catch (error) {
        return describeOps(error);
      } finally {
        setPendingFor(null);
      }
    },
    [mutateAsync, navigation],
  );
  return { open, isPending: mutation.isPending, pendingFor };
}
