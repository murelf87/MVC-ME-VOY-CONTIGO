/**
 * Contacto con la persona que conduce desde las pantallas en directo. El teléfono solo lo entrega el servidor a la otra
 * parte de una reserva confirmada, sin bloqueo y dentro de la ventana del viaje; fuera de ella NO se llama y se explica
 * el motivo (y, si se conoce, cuándo se podrá).
 */
import type { PeerCallContact } from "@/api/types";
import { formatTime } from "@/i18n";
import { liveStrings } from "../strings";

const copy = liveStrings.contact;

export interface ContactNotice {
  tone: "info" | "warning" | "error";
  message: string;
}

/** Aviso a mostrar si NO se puede llamar; `null` si el servidor entregó un teléfono utilizable. */
export function callNotice(contact: PeerCallContact, driverName: string): ContactNotice | null {
  if (contact.available && contact.phoneE164 !== null && contact.phoneE164.trim() !== "") return null;
  switch (contact.reason) {
    case "OUTSIDE_TRIP_WINDOW":
      return {
        tone: "info",
        message: copy.callOutside(contact.availableFrom === null ? null : formatTime(contact.availableFrom), contact.availableUntil === null ? null : formatTime(contact.availableUntil)),
      };
    case "PEER_CALL_DISABLED":
      return { tone: "info", message: copy.callDisabled(driverName) };
    case "PEER_UNAVAILABLE":
      return { tone: "warning", message: copy.callPeerUnavailable(driverName) };
    default:
      return { tone: "warning", message: copy.callUnknown };
  }
}

/** Teléfono a marcar, si lo hay. */
export function dialablePhone(contact: PeerCallContact): string | null {
  return contact.available && contact.phoneE164 !== null && contact.phoneE164.trim() !== "" ? contact.phoneE164 : null;
}
