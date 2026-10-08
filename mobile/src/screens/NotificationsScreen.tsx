import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import { formatDeparture } from "../api/trips";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

export type AppNotification = {
  id: string;
  kind: string;
  trip_id: string | null;
  payload: Record<string, any>;
  created_at: string;
  read_at: string | null;
  departure_at: string | null;
  as_driver: boolean;
};

type Inbox = { notifications: AppNotification[]; unread: number };

/** Unread counter for the bell; polls while the app is open (push needs provider credentials). */
export function useUnreadNotifications(token: string | null, intervalMs = 15000) {
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const inbox = await apiRequest<Inbox>("/v1/me/notifications?limit=1", { token });
      setUnread(inbox.unread);
    } catch {
      // A failed poll keeps the last known count.
    }
  }, [token]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [refresh, intervalMs]);
  return { unread, refresh };
}

function mins(seconds: unknown): string {
  return `${Math.max(1, Math.round(Number(seconds || 0) / 60))} min`;
}
function km(meters: unknown): string {
  const m = Number(meters || 0);
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString("es-ES", { maximumFractionDigits: 1 })} km`;
}

function describe(n: AppNotification): { icon: any; title: string; body: string; tone: string } {
  const p = n.payload ?? {};
  const when = n.departure_at ? formatDeparture(n.departure_at) : "";
  switch (n.kind) {
    case "ride_request.received":
      return { icon: "person-add", tone: C.blue, title: `${p.passengerName || "Un pasajero"} quiere plaza`, body: `Viaje del ${when}. Acepta o rechaza en Conduzco.` };
    case "ride_request.accepted":
      return { icon: "checkmark-circle", tone: "#10A66A", title: `${p.driverName || "El conductor"} aceptó tu solicitud`, body: "Tu plaza está retenida mientras se completa el pago." };
    case "ride_request.rejected":
      return { icon: "close-circle", tone: "#C93A3A", title: "Solicitud no aceptada", body: `${p.driverName || "El conductor"} no puede llevarte en el viaje del ${when}.` };
    case "booking.confirmed":
      return n.as_driver
        ? { icon: "ticket", tone: "#10A66A", title: `${p.passengerName || "Un pasajero"} ya tiene plaza`, body: `Reserva pagada para el ${when}.` }
        : { icon: "ticket", tone: "#10A66A", title: "Reserva confirmada", body: `Vas con ${p.driverName || "tu conductor"} el ${when}.` };
    case "booking.cancelled_by_passenger":
      return { icon: "remove-circle", tone: "#C93A3A", title: `${p.passengerName || "Un pasajero"} canceló su plaza`, body: `Viaje del ${when}. La plaza vuelve a estar libre.` };
    case "trip.started":
      return { icon: "car-sport", tone: C.blue, title: `${p.driverName || "Tu conductor"} ha salido`, body: "Sigue el coche en directo y ten listo tu código de recogida." };
    case "trip.cancelled":
      return { icon: "alert-circle", tone: "#C93A3A", title: p.forceMajeure ? "Viaje cancelado por fuerza mayor" : "Viaje cancelado por el conductor", body: p.reason ? `Motivo: ${p.reason}` : `Viaje del ${when}.` };
    case "trip.completed":
      return { icon: "star", tone: "#F5A524", title: "Viaje terminado", body: `¿Qué tal con ${p.driverName || "tu conductor"}? Puedes valorarlo en Mis reservas.` };
    case "report.closed":
      return { icon: "shield-checkmark", tone: C.navy, title: p.status === "resolved" ? "Tu reporte se ha resuelto" : "Tu reporte se ha cerrado", body: p.note || "Soporte de MVC ha revisado el caso." };
    case "route_change.requested":
      return { icon: "git-branch", tone: C.blue, title: `${p.passengerName || "Un pasajero"} pide un desvío`, body: `Te añade ${km(p.addedDistanceM)} y unos ${mins(p.addedDurationS)}. Decide en Conduzco.` };
    case "route_change.proposed":
      return { icon: "time", tone: "#B7791F", title: "Cambio de ruta: necesitamos tu respuesta", body: `${p.driverName || "Tu conductor"} quiere recoger a otra persona. Llegarías unos ${mins(p.extraDelayS)} más tarde; tu precio no cambia. Responde en Mis reservas.` };
    case "route_change.applied":
      return n.as_driver
        ? { icon: "git-merge", tone: "#10A66A", title: "Ruta actualizada", body: `Recoges a ${p.passengerName || "un pasajero"} en el camino.` }
        : p.requestId
          ? { icon: "git-merge", tone: "#10A66A", title: `${p.driverName || "El conductor"} te recoge`, body: "Tu plaza está retenida mientras se completa el pago." }
          : { icon: "git-merge", tone: C.blue, title: "Ruta actualizada", body: `${p.passengerName || "Otra persona"} se une al viaje con el desvío que aceptaste.` };
    case "route_change.rejected":
      return { icon: "close-circle", tone: "#C93A3A", title: "Desvío no aplicado", body: p.reason === "driver" ? "El conductor no puede hacer ese desvío." : p.reason === "passenger" ? "Un pasajero del viaje no aceptó el cambio." : "El viaje cambió antes de confirmarlo." };
    case "trip.driver_arriving":
      return { icon: "navigate", tone: "#10A66A", title: `${p.driverName || "Tu conductor"} está llegando`, body: p.etaS != null ? `Unos ${mins(p.etaS)} para la recogida. Ten listo tu código.` : "Ten listo tu código de recogida." };
    default:
      return { icon: "notifications", tone: C.blue, title: "Aviso de MVC", body: "" };
  }
}

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "ahora";
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(iso).toLocaleDateString("es-ES", { day: "numeric", month: "short" });
}

export function NotificationsScreen({ onOpen }: { onOpen: (n: AppNotification) => void }) {
  const { token } = useAuth();
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setInbox(await apiRequest<Inbox>("/v1/me/notifications", { token }));
      setError("");
    } catch (e) {
      setError(e instanceof ApiError || e instanceof Error ? e.message : "No se pudieron cargar los avisos.");
    }
  }, [token]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 10000);
    return () => clearInterval(timer);
  }, [load]);

  async function markAll() {
    if (!token) return;
    await apiRequest("/v1/me/notifications/read", { method: "POST", token, body: {} }).catch(() => undefined);
    await load();
  }

  async function open(n: AppNotification) {
    if (token && !n.read_at) {
      await apiRequest("/v1/me/notifications/read", { method: "POST", token, body: { ids: [n.id] } }).catch(() => undefined);
    }
    onOpen(n);
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <View style={s.head}>
        <Text style={s.title}>Avisos</Text>
        {inbox?.unread ? (
          <Pressable onPress={() => void markAll()} hitSlop={8}>
            <Text style={s.markAll}>Marcar todo como leído</Text>
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={s.error}>{error}</Text> : null}
      {!inbox && !error ? <ActivityIndicator color={C.blue} style={{ marginTop: 30 }} /> : null}
      {inbox && !inbox.notifications.length ? (
        <View style={s.empty}>
          <Ionicons name="notifications-off-outline" size={36} color={C.blue} />
          <Text style={s.emptyTitle}>Sin avisos todavía</Text>
          <Text style={s.emptyText}>Aquí verás solicitudes, reservas, salidas y cancelaciones.</Text>
        </View>
      ) : null}
      {inbox?.notifications.map(n => {
        const d = describe(n);
        return (
          <Pressable key={n.id} onPress={() => void open(n)} style={[s.item, !n.read_at && s.unread]}>
            <View style={[s.icon, { backgroundColor: d.tone }]}>
              <Ionicons name={d.icon} size={18} color="#fff" />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.itemTitle}>{d.title}</Text>
              {d.body ? <Text style={s.itemBody}>{d.body}</Text> : null}
              <Text style={s.time}>{ago(n.created_at)}</Text>
            </View>
            {!n.read_at ? <View style={s.dot} /> : null}
          </Pressable>
        );
      })}
      <Text style={s.foot}>Las notificaciones push al móvil se activarán cuando se configure el proveedor de envío.</Text>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 28, backgroundColor: "#fff" },
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 },
  title: { fontSize: 25, fontWeight: "900", color: C.navy },
  markAll: { fontSize: 12, fontWeight: "800", color: C.blue },
  error: { marginBottom: 12, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 11, borderRadius: 12, fontSize: 12 },
  empty: { alignItems: "center", paddingVertical: 34 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 10 },
  emptyText: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5 },
  item: { flexDirection: "row", gap: 11, alignItems: "flex-start", padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.border, marginBottom: 8 },
  unread: { backgroundColor: C.pale, borderColor: "#C7DBFF" },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 13, fontWeight: "900", color: C.navy },
  itemBody: { fontSize: 12, lineHeight: 17, color: C.text, marginTop: 2 },
  time: { fontSize: 10, color: C.muted, marginTop: 4, fontWeight: "700" },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: C.blue, marginTop: 4 },
  foot: { fontSize: 11, color: C.muted, textAlign: "center", marginTop: 14, lineHeight: 16 },
});
