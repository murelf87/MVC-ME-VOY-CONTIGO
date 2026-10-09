import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "@/api";
import { useAppNavigation } from "@/navigation";
import { callPhone } from "@/platform";
import { getDriverCallContact, openDriverConversation } from "../api";
import { callNotice, dialablePhone, type ContactNotice } from "../model/contact";
import { liveStrings } from "../strings";

const copy = liveStrings.contact;

export interface ContactDriverOptions {
  tripId: string;
  /** Persona con la que hablar: la que conduce (`chat.peerUserId`). */
  peerUserId: string;
  /** `chat.available`: `false` si hay un bloqueo entre las dos personas o la reserva ya no está activa. */
  chatAvailable: boolean;
  driverName: string;
}

export type ContactBusy = "chat" | "call" | null;

export interface ContactDriverController {
  /** Petición en curso (bloquea el doble toque). */
  busy: ContactBusy;
  /** Último aviso: por qué no se puede llamar/escribir o qué falló. */
  notice: ContactNotice | null;
  /** Abre el chat de la reserva. `true` si se navegó al chat. */
  openChat(): Promise<boolean>;
  /** Abre el marcador del móvil con el teléfono que entrega el servidor. `true` si se abrió. */
  call(): Promise<boolean>;
  clearNotice(): void;
}

/**
 * Contacto con la persona que conduce: chat (`POST /v1/conversations/direct` + pantalla `BookingChat`) y llamada
 * (`GET /v1/conversations/{id}/call-contact`). El teléfono solo lo da el servidor dentro de la ventana del viaje; fuera de
 * ella se explica el motivo, nunca se esconde el botón sin decir por qué.
 */
export function useContactDriver({ tripId, peerUserId, chatAvailable, driverName }: ContactDriverOptions): ContactDriverController {
  const navigation = useAppNavigation();
  const [busy, setBusy] = useState<ContactBusy>(null);
  const [notice, setNotice] = useState<ContactNotice | null>(null);
  const busyRef = useRef<ContactBusy>(null);
  const conversationRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const begin = useCallback((kind: Exclude<ContactBusy, null>): boolean => {
    if (busyRef.current !== null) return false;
    busyRef.current = kind;
    setBusy(kind);
    setNotice(null);
    return true;
  }, []);

  const end = useCallback((next: ContactNotice | null): void => {
    busyRef.current = null;
    if (!mountedRef.current) return;
    setBusy(null);
    if (next !== null) setNotice(next);
  }, []);

  const ensureConversation = useCallback(async (): Promise<string> => {
    if (conversationRef.current !== null) return conversationRef.current;
    const detail = await openDriverConversation({ tripId, peerUserId });
    conversationRef.current = detail.id;
    return detail.id;
  }, [tripId, peerUserId]);

  const openChat = useCallback(async (): Promise<boolean> => {
    if (!begin("chat")) return false;
    if (!chatAvailable) {
      end({ tone: "info", message: copy.chatUnavailable });
      return false;
    }
    try {
      const conversationId = await ensureConversation();
      end(null);
      navigation.navigate("BookingChat", { conversationId });
      return true;
    } catch (error) {
      end({ tone: "error", message: describeError(error).message || copy.chatFailed });
      return false;
    }
  }, [begin, end, chatAvailable, ensureConversation, navigation]);

  const call = useCallback(async (): Promise<boolean> => {
    if (!begin("call")) return false;
    if (!chatAvailable) {
      end({ tone: "info", message: copy.callPeerUnavailable(driverName) });
      return false;
    }
    try {
      const conversationId = await ensureConversation();
      const contact = await getDriverCallContact(conversationId);
      const blocked = callNotice(contact, driverName);
      const phone = dialablePhone(contact);
      if (blocked !== null || phone === null) {
        end(blocked ?? { tone: "warning", message: copy.callUnknown });
        return false;
      }
      const result = await callPhone(phone);
      if (result !== "opened") {
        end({ tone: "error", message: copy.callOpenFailed });
        return false;
      }
      end(null);
      return true;
    } catch (error) {
      end({ tone: "error", message: describeError(error).message || copy.callUnknown });
      return false;
    }
  }, [begin, end, chatAvailable, driverName, ensureConversation]);

  const clearNotice = useCallback((): void => setNotice(null), []);

  return { busy, notice, openChat, call, clearNotice };
}
