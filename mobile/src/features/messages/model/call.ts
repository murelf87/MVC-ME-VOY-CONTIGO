/**
 * Estado del botón «Llamar a Ana» (pantalla 26). El teléfono solo lo entrega el servidor a la otra parte de una reserva
 * confirmada, sin bloqueo y dentro de la ventana del viaje (docs/contracts/comms.md §2.9). Fuera de ella el botón NO
 * llama: se explica por qué y desde/hasta cuándo.
 */
import type { PeerCallContact } from "@/api/types";
import { formatDayRelative, formatTime } from "@/i18n";
import { messagesStrings } from "../strings";

const copy = messagesStrings.chat;

export type CallState =
  /** Chat de grupo (no hay llamadas) o aún no se sabe. */
  | { kind: "hidden" }
  | { kind: "loading" }
  | { kind: "available"; name: string; phoneE164: string }
  | { kind: "unavailable"; name: string; reason: "OUTSIDE_TRIP_WINDOW" | "PEER_CALL_DISABLED" | "PEER_UNAVAILABLE"; explanation: string }
  | { kind: "error" };

/** «a las 19:25 de hoy» / «mañana a las 07:13». */
export function whenLabel(iso: string, now: Date | number = new Date()): string {
  const day = formatDayRelative(iso, now);
  const time = formatTime(iso);
  if (day === "Hoy") return `hoy a las ${time}`;
  if (day === "Mañana") return `mañana a las ${time}`;
  if (day === "Ayer") return `ayer a las ${time}`;
  return `el ${day.toLowerCase()} a las ${time}`;
}

export function callStateOf(contact: PeerCallContact | undefined, now: Date | number = new Date()): CallState {
  if (contact === undefined) return { kind: "loading" };
  const name = contact.peerFirstName;
  if (contact.available && contact.phoneE164 !== null && contact.phoneE164 !== "") {
    return { kind: "available", name, phoneE164: contact.phoneE164 };
  }
  const reason = contact.reason ?? "OUTSIDE_TRIP_WINDOW";
  if (reason === "PEER_CALL_DISABLED") return { kind: "unavailable", name, reason, explanation: copy.callDisabled };
  if (reason === "PEER_UNAVAILABLE") return { kind: "unavailable", name, reason, explanation: copy.callPeerGone(name) };
  const nowMs = now instanceof Date ? now.getTime() : now;
  const from = contact.availableFrom === null ? null : Date.parse(contact.availableFrom);
  const until = contact.availableUntil === null ? null : Date.parse(contact.availableUntil);
  if (until !== null && Number.isFinite(until) && nowMs > until) {
    return { kind: "unavailable", name, reason, explanation: copy.callOutsideAfter(name) };
  }
  if (from !== null && Number.isFinite(from) && contact.availableFrom !== null) {
    return { kind: "unavailable", name, reason, explanation: copy.callOutsideBefore(name, whenLabel(contact.availableFrom, now)) };
  }
  return { kind: "unavailable", name, reason, explanation: copy.callOutsideAfter(name) };
}

/** Quita todo lo que no sea un dígito o «+» (el teléfono sale de la API, pero el marcador no debe recibir espacios raros). */
export function dialableNumber(phoneE164: string): string {
  return phoneE164.replace(/[^\d+]/g, "");
}
