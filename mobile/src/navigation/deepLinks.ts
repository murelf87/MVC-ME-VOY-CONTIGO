/**
 * Enlaces profundos (`mvc://…`) y avisos con `data`: de texto a una ruta con sus parámetros. Puro.
 *
 *   mvc://trip/<tripId>                  → TripDetail      { tripId }
 *   mvc://request/<requestId>            → RequestStatusPayment { requestId }
 *   mvc://chat/<conversationId>          → BookingChat     { conversationId }
 *   mvc://notifications                  → Notifications
 *
 * Los identificadores se validan (letras, números, `-` y `_`, máximo 64): nada de lo que llegue por un enlace se
 * interpreta como ruta ni como código.
 */
import type { ReturnTarget } from "./returnTo";

export const APP_SCHEME = "mvc";

const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

function safeId(value: string | undefined): string | null {
  if (!value) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return ID_PATTERN.test(decoded) ? decoded : null;
}

/** `mvc://trip/abc?x=1` → ["trip", "abc"]; `null` si no es de nuestro esquema. */
export function parseAppUrl(url: string): string[] | null {
  const match = /^([a-z][a-z0-9+.-]*):\/{0,3}([^?#]*)/i.exec(url.trim());
  if (!match || match[1]?.toLowerCase() !== APP_SCHEME) return null;
  return (match[2] ?? "").split("/").filter((segment) => segment.length > 0);
}

export function parseDeepLink(url: string): ReturnTarget | null {
  const segments = parseAppUrl(url);
  if (!segments || segments.length === 0) return null;
  const [kind, id, ...rest] = segments;
  if (rest.length > 0) return null;
  switch (kind) {
    case "trip": {
      const tripId = safeId(id);
      return tripId ? { name: "TripDetail", params: { tripId } } : null;
    }
    case "request": {
      const requestId = safeId(id);
      return requestId ? { name: "RequestStatusPayment", params: { requestId } } : null;
    }
    case "chat": {
      const conversationId = safeId(id);
      return conversationId ? { name: "BookingChat", params: { conversationId } } : null;
    }
    case "notifications":
      return id === undefined ? { name: "Notifications" } : null;
    default:
      return null;
  }
}

function stringField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === "string" ? safeId(value) : null;
}

/**
 * A qué pantalla lleva un aviso (`AppNotification.data` / `data` de una push). Por orden de especificidad:
 * conversación → chat · solicitud → estado de la solicitud · reserva → esperando el coche · viaje → detalle ·
 * ticket → centro de ayuda · otro → bandeja de notificaciones.
 */
export function resolveNotificationTarget(data: Record<string, unknown>): ReturnTarget {
  const conversationId = stringField(data, "conversationId");
  if (conversationId) return { name: "BookingChat", params: { conversationId } };
  const requestId = stringField(data, "requestId");
  if (requestId) return { name: "RequestStatusPayment", params: { requestId } };
  const bookingId = stringField(data, "bookingId");
  if (bookingId) return { name: "WaitingForCar", params: { bookingId } };
  const tripId = stringField(data, "tripId");
  if (tripId) return { name: "TripDetail", params: { tripId } };
  const ticketId = stringField(data, "ticketId");
  if (ticketId) return { name: "HelpCenter", params: { ticketId } };
  return { name: "Notifications" };
}
