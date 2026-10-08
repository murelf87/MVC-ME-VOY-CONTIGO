import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { apiRequest, ApiError } from "../api/client";
import {
  formatDeparture,
  loadDriverTrips,
  loadPassengerRequests,
  tripStatusLabel,
} from "../api/trips";
import type {
  Conversation,
  DriverRideRequest,
  OwnTrip,
  PassengerRideRequest,
  TripSearchParams,
  TripSearchResult,
} from "../api/types";
import { Card, PrimaryButton } from "../components/UI";
import { CancelPanel, RatingPanel, ReportPanel, refundText } from "../components/TripFeedback";
import { RepeatPanel, mondayOf, weekdaysLabel } from "../components/Recurring";
import { startSharingLocation, type LocationSharing } from "../live/shareLocation";
import { useAuth } from "../session/AuthContext";
import { C } from "../theme";

type Mode = "available" | "mine" | "driver";

function km(meters: number): string {
  return meters >= 1000
    ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)} km`
    : `${meters} m`;
}

function duration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function requestStatus(status: string, bookingStatus?: string | null): { label: string; tone: "blue" | "green" | "amber" | "red" } {
  if (bookingStatus === "completed") return { label: "Viaje realizado", tone: "green" };
  if (bookingStatus === "no_show") return { label: "No presentado", tone: "red" };
  if (bookingStatus === "driver_cancelled") return { label: "Cancelada por el conductor", tone: "red" };
  switch (status) {
    case "pending":
      return { label: "Pendiente del conductor", tone: "amber" };
    case "accepted":
    case "payment_pending":
      return { label: "Aceptada · pago pendiente", tone: "blue" };
    case "confirmed":
      return { label: "Reserva confirmada", tone: "green" };
    case "rejected":
      return { label: "Rechazada", tone: "red" };
    case "cancelled":
      return { label: "Cancelada", tone: "red" };
    case "payment_late":
      return { label: "Pago tardío · revisión", tone: "amber" };
    default:
      return { label: status, tone: "blue" };
  }
}

function euros(cents: number): string {
  return (cents / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" });
}

function canCancel(item: PassengerRideRequest): boolean {
  if (["pending", "accepted", "payment_pending"].includes(item.status)) return true;
  return item.status === "confirmed" && item.booking_status === "confirmed" && !item.picked_up_at && item.trip_status !== "completed";
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

export function TripsScreen({
  searchParams,
  initialMode,
  onLive,
  onChat,
}: {
  searchParams: TripSearchParams | null;
  initialMode?: Mode;
  onLive: (target: { tripId?: string; provinceId?: string }) => void;
  onChat: (conversation: Conversation) => void;
}) {
  const { token, roles } = useAuth();
  const isDriver = roles.includes("driver");
  const [mode, setMode] = useState<Mode>(initialMode ?? "available");
  const [trips, setTrips] = useState<TripSearchResult[]>([]);
  const [mine, setMine] = useState<PassengerRideRequest[]>([]);
  const [ownTrips, setOwnTrips] = useState<OwnTrip[]>([]);
  const [driverRequests, setDriverRequests] = useState<DriverRideRequest[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [requested, setRequested] = useState<Record<string, boolean>>({});
  const [pickupCodes, setPickupCodes] = useState<Record<string, string>>({});
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});
  const [sharing, setSharing] = useState<{ tripId: string; handle: LocationSharing } | null>(null);
  const [sharingNote, setSharingNote] = useState("");
  const [panel, setPanel] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [weekResult, setWeekResult] = useState<Record<string, string>>({});

  const routeLabel = useMemo(() => {
    if (!searchParams) return "";
    return `${searchParams.origin.formattedAddress} → ${searchParams.destination.formattedAddress}`;
  }, [searchParams]);

  const loadSearch = useCallback(async () => {
    if (!searchParams) {
      setTrips([]);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const query = [
        `provinceId=${encodeURIComponent(searchParams.provinceId)}`,
        `originLatitude=${searchParams.origin.location.latitude}`,
        `originLongitude=${searchParams.origin.location.longitude}`,
        `destinationLatitude=${searchParams.destination.location.latitude}`,
        `destinationLongitude=${searchParams.destination.location.longitude}`,
        "radiusM=5000",
        "limit=30",
      ].join("&");
      const response = await apiRequest<{ trips: TripSearchResult[] }>(
        `/v1/trips/search?${query}`
      );
      setTrips(response.trips);
    } catch (e) {
      setError(errorText(e, "No se pudieron buscar viajes."));
    } finally {
      setBusy(false);
    }
  }, [searchParams]);

  const loadMine = useCallback(async () => {
    if (!token) return;
    setBusy(true);
    setError("");
    try {
      setMine(await loadPassengerRequests(token));
    } catch (e) {
      setError(errorText(e, "No se pudieron cargar tus solicitudes."));
    } finally {
      setBusy(false);
    }
  }, [token]);

  const loadDriver = useCallback(async () => {
    if (!token || !isDriver) return;
    setBusy(true);
    setError("");
    try {
      const result = await loadDriverTrips(token);
      setOwnTrips(result.trips);
      setDriverRequests(result.requests);
    } catch (e) {
      setError(errorText(e, "No se pudieron cargar tus viajes de conductor."));
    } finally {
      setBusy(false);
    }
  }, [token, isDriver]);

  useEffect(() => {
    if (mode === "available") void loadSearch();
    if (mode === "mine") void loadMine();
    if (mode === "driver") void loadDriver();
  }, [mode, loadSearch, loadMine, loadDriver]);

  useEffect(() => () => sharing?.handle.stop(), [sharing]);

  async function run(action: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(errorText(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  function requestSeat(trip: TripSearchResult) {
    if (!token) return;
    void run(async () => {
      await apiRequest(`/v1/trips/${trip.tripId}/requests`, {
        method: "POST",
        token,
        body: { fromSegmentSeq: trip.fromSegmentSeq, toSegmentSeq: trip.toSegmentSeq },
      });
      setRequested(current => ({ ...current, [trip.tripId]: true }));
    }, "No se pudo enviar la solicitud de plaza.");
  }

  function decide(requestId: string, decision: "accept" | "reject") {
    if (!token) return;
    void run(async () => {
      await apiRequest(`/v1/ride-requests/${requestId}/decision`, {
        method: "POST",
        token,
        body: { decision },
      });
      await loadDriver();
    }, "No se pudo registrar la decisión.");
  }

  function showPickupCode(bookingId: string) {
    if (!token) return;
    void run(async () => {
      const result = await apiRequest<{ code: string }>(`/v1/bookings/${bookingId}/pickup-code`, {
        method: "POST",
        token,
      });
      setPickupCodes(current => ({ ...current, [bookingId]: result.code }));
    }, "No se pudo generar el código de recogida.");
  }

  function verifyPickup(bookingId: string) {
    if (!token) return;
    const code = (codeInputs[bookingId] ?? "").trim();
    if (!/^[0-9]{6}$/.test(code)) {
      setError("El código de recogida tiene 6 cifras.");
      return;
    }
    void run(async () => {
      await apiRequest(`/v1/bookings/${bookingId}/pickup-verify`, {
        method: "POST",
        token,
        body: { code },
      });
      setCodeInputs(current => ({ ...current, [bookingId]: "" }));
      await loadDriver();
    }, "No se pudo verificar el código.");
  }

  function startTrip(tripId: string) {
    if (!token) return;
    void run(async () => {
      await apiRequest(`/v1/me/trips/${tripId}/start`, { method: "POST", token });
      await loadDriver();
    }, "No se pudo iniciar el viaje.");
  }

  function completeTrip(tripId: string) {
    if (!token) return;
    void run(async () => {
      if (sharing?.tripId === tripId) {
        sharing.handle.stop();
        setSharing(null);
      }
      await apiRequest(`/v1/me/trips/${tripId}/complete`, { method: "POST", token });
      await loadDriver();
    }, "No se pudo finalizar el viaje.");
  }

  function requestWeek(trip: TripSearchResult) {
    if (!token || !trip.seriesId || !trip.departureAt) return;
    void run(async () => {
      try {
        const out = await apiRequest<{ results: Array<{ status: string; departureAt: string; code?: string }> }>(
          `/v1/series/${trip.seriesId}/weekly-requests`,
          {
            method: "POST",
            token,
            body: { weekStart: mondayOf(trip.departureAt!), fromSegmentSeq: trip.fromSegmentSeq, toSegmentSeq: trip.toSegmentSeq },
          }
        );
        const ok = out.results.filter(r => r.status === "requested");
        const full = out.results.filter(r => r.code === "NO_CAPACITY_ON_SEGMENT");
        const day = (iso: string) => new Date(iso).toLocaleDateString("es-ES", { weekday: "long" });
        setWeekResult(c => ({
          ...c,
          [trip.tripId]: `Solicitados ${ok.length} ${ok.length === 1 ? "día" : "días"} (${ok.map(r => day(r.departureAt)).join(", ")}).`
            + (full.length ? ` Sin plaza: ${full.map(r => day(r.departureAt)).join(", ")}.` : ""),
        }));
        setRequested(c => ({ ...c, [trip.tripId]: true }));
      } catch (e) {
        if (e instanceof ApiError && e.code === "WEEK_NOT_BOOKABLE") {
          setWeekResult(c => ({ ...c, [trip.tripId]: "Esa semana ya la tienes solicitada o no quedan plazas." }));
          return;
        }
        throw e;
      }
    }, "No se pudo solicitar la semana.");
  }

  async function repeatTrip(tripId: string, weekdays: number[]) {
    if (!token) return;
    const out = await apiRequest<{ published: string[]; failed: unknown[] }>(`/v1/me/trips/${tripId}/repeat`, {
      method: "POST",
      token,
      body: { weekdays },
    });
    setPanel(null);
    setNotice(`Viaje repetido ${weekdaysLabel(weekdays)}: ${out.published.length} viajes más publicados.`);
    await loadDriver();
  }

  function decideWeek(groupId: string, decision: "accept" | "reject") {
    if (!token) return;
    void run(async () => {
      const out = await apiRequest<{ results: Array<{ status: string }> }>(`/v1/weekly-groups/${groupId}/decision`, {
        method: "POST",
        token,
        body: { decision },
      });
      const done = out.results.filter(r => r.status !== "failed").length;
      setNotice(decision === "accept" ? `Semana aceptada: ${done} ${done === 1 ? "día" : "días"}.` : "Semana rechazada.");
      await loadDriver();
    }, "No se pudo decidir la semana.");
  }

  async function cancelRequest(requestId: string, reason: string) {
    if (!token) return;
    await apiRequest(`/v1/ride-requests/${requestId}/cancel`, { method: "POST", token, body: { reason: reason || null } });
    setPanel(null);
    setNotice("Reserva cancelada.");
    await loadMine();
  }

  async function cancelTrip(tripId: string, reason: string, forceMajeure: boolean) {
    if (!token) return;
    const result = await apiRequest<{ affectedPassengers: number }>(`/v1/me/trips/${tripId}/cancel`, {
      method: "POST",
      token,
      body: { reason, forceMajeure },
    });
    setPanel(null);
    setNotice(result.affectedPassengers
      ? `Viaje cancelado. Avisamos a ${result.affectedPassengers} ${result.affectedPassengers === 1 ? "pasajero" : "pasajeros"}.`
      : "Viaje cancelado.");
    await loadDriver();
  }

  function closeReport(sent: boolean) {
    setPanel(null);
    if (sent) setNotice("Reporte enviado. Soporte lo revisará.");
  }

  function toggleSharing(tripId: string) {
    if (!token) return;
    if (sharing) {
      sharing.handle.stop();
      setSharing(null);
      setSharingNote("");
      if (sharing.tripId === tripId) return;
    }
    void run(async () => {
      const handle = await startSharingLocation(token, tripId, state => {
        setSharingNote(
          "error" in state
            ? state.error
            : `Ubicación enviada a las ${new Date(state.sentAt).toLocaleTimeString("es-ES")}`
        );
      });
      setSharing({ tripId, handle });
      setSharingNote("Esperando la primera posición GPS…");
    }, "No se pudo activar la ubicación.");
  }

  return (
    <ScrollView contentContainerStyle={s.wrap}>
      <Text style={s.title}>Viajes</Text>

      <View style={s.tabs}>
        <Pressable onPress={() => setMode("available")} style={[s.tab, mode === "available" && s.tabActive]}>
          <Text style={[s.tabText, mode === "available" && s.tabTextActive]}>Disponibles</Text>
        </Pressable>
        <Pressable onPress={() => setMode("mine")} style={[s.tab, mode === "mine" && s.tabActive]}>
          <Text style={[s.tabText, mode === "mine" && s.tabTextActive]}>Mis reservas</Text>
        </Pressable>
        {isDriver ? (
          <Pressable onPress={() => setMode("driver")} style={[s.tab, mode === "driver" && s.tabActive]}>
            <Text style={[s.tabText, mode === "driver" && s.tabTextActive]}>Conduzco</Text>
          </Pressable>
        ) : null}
      </View>

      {busy ? <ActivityIndicator color={C.blue} style={{ marginBottom: 12 }} /> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      {notice ? <Pressable onPress={() => setNotice("")}><Text style={s.okNote}>{notice}</Text></Pressable> : null}

      {mode === "available" ? (
        <>
          <Text style={s.subtitle}>
            {searchParams
              ? `${searchParams.provinceName} · resultados reales del backend`
              : "Busca un trayecto desde Inicio para ver disponibilidad real."}
          </Text>

          {searchParams ? (
            <Card style={s.searchSummary}>
              <View style={s.routeLine}>
                <Ionicons name="location" size={19} color={C.blue} />
                <Text style={s.routeText} numberOfLines={3}>{routeLabel}</Text>
              </View>
            </Card>
          ) : null}

          {!busy && searchParams && !trips.length && !error ? (
            <Card style={s.emptyCard}>
              <Ionicons name="car-outline" size={36} color={C.blue} />
              <Text style={s.emptyTitle}>No hay viajes disponibles ahora</Text>
              <Text style={s.emptyText}>MVC no inventa resultados. Prueba otro horario, radio o trayecto.</Text>
            </Card>
          ) : null}

          {trips.map(trip => (
            <Card key={trip.tripId} style={s.tripCard}>
              <View style={s.tripTop}>
                <View style={s.avatar}><Ionicons name="person" size={28} color="#fff" /></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.tripName}>{trip.driverDisplayName || "Conductor MVC"}</Text>
                  <Text style={s.tripMeta}>{formatDeparture(trip.departureAt)}</Text>
                </View>
                <View style={s.badge}><Text style={s.badgeText}>{trip.availableSeats} {trip.availableSeats === 1 ? "plaza" : "plazas"}</Text></View>
              </View>
              {trip.seriesId && trip.seriesWeekdays?.length ? (
                <View style={s.repeatTag}>
                  <Ionicons name="repeat" size={14} color={C.blue} />
                  <Text style={s.repeatText}>Se repite {weekdaysLabel(trip.seriesWeekdays)}</Text>
                </View>
              ) : null}

              <View style={s.dataGrid}>
                <View style={s.dataItem}><Text style={s.dataLabel}>Recorrido</Text><Text style={s.dataValue}>{km(trip.roadDistanceM)}</Text></View>
                <View style={s.dataItem}><Text style={s.dataLabel}>Duración</Text><Text style={s.dataValue}>{duration(trip.estimatedDurationS)}</Text></View>
                <View style={s.dataItem}><Text style={s.dataLabel}>A recogida</Text><Text style={s.dataValue}>{km(trip.pickupDistanceM)}</Text></View>
              </View>
              <View style={s.priceRow}>
                {trip.quote ? (
                  <>
                    <Text style={s.priceValue}>{euros(trip.quote.passengerTotalCents)}</Text>
                    <Text style={s.priceMeta}>
                      {euros(trip.quote.contributionCents)} de aportación por {km(trip.roadDistanceM)} reales
                      {trip.quote.passengerCommissionCents ? ` + ${euros(trip.quote.passengerCommissionCents)} de servicio` : ""}
                    </Text>
                  </>
                ) : (
                  <Text style={s.priceMeta}>Precio pendiente: aún no hay una tarifa aprobada.</Text>
                )}
              </View>

              <PrimaryButton
                title={requested[trip.tripId] ? "Solicitud enviada" : "Solicitar plaza"}
                onPress={() => requestSeat(trip)}
                disabled={busy || requested[trip.tripId]}
              />
              {trip.seriesId && !requested[trip.tripId] ? (
                <Pressable style={s.weekButton} onPress={() => requestWeek(trip)} disabled={busy}>
                  <Ionicons name="calendar-outline" size={17} color={C.blue} />
                  <Text style={s.weekButtonText}>Solicitar toda esa semana</Text>
                </Pressable>
              ) : null}
              {weekResult[trip.tripId] ? <Text style={s.okNote}>{weekResult[trip.tripId]}</Text> : null}
              {requested[trip.tripId] ? (
                <Text style={s.pending}>Pendiente de aceptación del conductor. Aún no es una reserva confirmada.</Text>
              ) : null}
            </Card>
          ))}

          {searchParams ? (
            <Pressable style={s.liveLink} onPress={() => onLive({ provinceId: searchParams.provinceId })}>
              <Ionicons name="map-outline" size={19} color={C.blue} />
              <Text style={s.liveLinkText}>Ver coches en marcha en {searchParams.provinceName}</Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {mode === "mine" ? (
        <>
          <Text style={s.subtitle}>Estados reales de tus solicitudes y reservas.</Text>
          {!busy && !mine.length ? (
            <Card style={s.emptyCard}>
              <Ionicons name="document-text-outline" size={36} color={C.blue} />
              <Text style={s.emptyTitle}>No tienes solicitudes</Text>
            </Card>
          ) : null}
          {mine.map(item => {
            const status = requestStatus(item.status, item.booking_status);
            const bookingActive = item.booking_status === "confirmed";
            const code = item.booking_id ? pickupCodes[item.booking_id] : undefined;
            return (
              <Card key={item.id} style={s.tripCard}>
                <View style={s.requestHeader}>
                  <View style={[s.statusDot, status.tone === "green" && s.green, status.tone === "amber" && s.amber, status.tone === "red" && s.red]} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.tripName}>{status.label}</Text>
                    <Text style={s.tripMeta}>
                      {item.driver_display_name || "Conductor MVC"} · {formatDeparture(item.departure_at)}
                    </Text>
                  </View>
                  <View style={s.badge}><Text style={s.badgeText}>{tripStatusLabel(item.trip_status)}</Text></View>
                </View>
                {item.quote_total_cents != null && !item.refund_status ? (
                  <Text style={s.tripMeta}>Importe acordado: {euros(item.quote_total_cents)}</Text>
                ) : null}
                {item.hold_expires_at ? (
                  <Text style={s.pending}>La plaza está retenida hasta las {new Date(item.hold_expires_at).toLocaleTimeString("es-ES")} a la espera del pago.</Text>
                ) : null}
                {item.picked_up_at && item.booking_status === "confirmed" ? (
                  <Text style={s.okNote}>Recogida verificada por el conductor.</Text>
                ) : null}
                {refundText(item.refund_cents, item.refund_status) ? (
                  <Text style={s.pending}>{refundText(item.refund_cents, item.refund_status)}</Text>
                ) : null}

                {bookingActive || item.booking_status === "completed" ? (
                  <View style={s.actions}>
                    <Pressable
                      style={s.action}
                      onPress={() => onChat({
                        tripId: item.trip_id,
                        peerUserId: item.driver_user_id,
                        peerName: item.driver_display_name || "Conductor MVC",
                        departureAt: item.departure_at,
                        tripStatus: item.trip_status,
                      })}
                    >
                      <Ionicons name="chatbubble-ellipses-outline" size={18} color={C.blue} />
                      <Text style={s.actionText}>Chat</Text>
                    </Pressable>
                    {item.trip_status === "active" ? (
                      <Pressable style={s.action} onPress={() => onLive({ tripId: item.trip_id })}>
                        <Ionicons name="navigate-outline" size={18} color={C.blue} />
                        <Text style={s.actionText}>Seguir coche</Text>
                      </Pressable>
                    ) : null}
                    <Pressable style={[s.action, s.actionNarrow]} onPress={() => setPanel(`report:${item.id}`)} accessibilityLabel="Reportar">
                      <Ionicons name="flag-outline" size={18} color="#C93A3A" />
                    </Pressable>
                  </View>
                ) : null}

                {panel === `report:${item.id}` && token ? (
                  <ReportPanel
                    token={token}
                    tripId={item.trip_id}
                    reportedUserId={item.driver_user_id}
                    peerName={item.driver_display_name || "el conductor"}
                    onClose={closeReport}
                  />
                ) : null}

                {(item.booking_status === "completed" || item.booking_status === "no_show") && item.trip_status === "completed" && item.booking_id && token ? (
                  <RatingPanel
                    token={token}
                    bookingId={item.booking_id}
                    peerName={item.driver_display_name || "tu conductor"}
                    existing={item.my_rating_score}
                    onDone={() => { setNotice("Gracias por tu valoración."); void loadMine(); }}
                  />
                ) : null}

                {canCancel(item) ? (
                  panel === `cancel:${item.id}` ? (
                    <CancelPanel
                      title={item.booking_status === "confirmed" ? "Cancelar reserva" : "Retirar solicitud"}
                      explanation={item.booking_status === "confirmed"
                        ? "Se aplica la política de cancelación que aceptaste al pagar. El reembolso depende de cuánto falte para la salida."
                        : "Todavía no has pagado, así que no hay ningún cargo."}
                      requireReason={false}
                      confirmLabel="Sí, cancelar"
                      onConfirm={reason => cancelRequest(item.id, reason)}
                      onClose={() => setPanel(null)}
                    />
                  ) : (
                    <Pressable style={s.cancelLink} onPress={() => setPanel(`cancel:${item.id}`)}>
                      <Text style={s.cancelLinkText}>{item.booking_status === "confirmed" ? "Cancelar reserva" : "Retirar solicitud"}</Text>
                    </Pressable>
                  )
                ) : null}

                {bookingActive && item.trip_status === "active" && !item.picked_up_at && item.booking_id ? (
                  code ? (
                    <View style={s.codeBox}>
                      <Text style={s.codeLabel}>Enseña este código al conductor al subir</Text>
                      <Text style={s.code}>{code.slice(0, 3)} {code.slice(3)}</Text>
                    </View>
                  ) : (
                    <PrimaryButton title="Mostrar código de recogida" onPress={() => showPickupCode(item.booking_id!)} disabled={busy} />
                  )
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}

      {mode === "driver" ? (
        <>
          <Text style={s.subtitle}>Tus viajes publicados. Aceptar crea una retención temporal de plaza, no una reserva pagada.</Text>
          {!busy && !ownTrips.length ? (
            <Card style={s.emptyCard}>
              <Ionicons name="car-outline" size={36} color={C.blue} />
              <Text style={s.emptyTitle}>No tienes viajes publicados</Text>
              <Text style={s.emptyText}>Publica un trayecto desde la pestaña Publicar.</Text>
            </Card>
          ) : null}
          {ownTrips.map(trip => {
            const requests = driverRequests.filter(item => item.tripId === trip.id);
            const isSharing = sharing?.tripId === trip.id;
            return (
              <Card key={trip.id} style={s.tripCard}>
                <View style={s.requestHeader}>
                  <Ionicons name="car-sport" size={22} color={C.blue} />
                  <View style={{ flex: 1 }}>
                    <Text style={s.tripName}>{formatDeparture(trip.departure_at)}</Text>
                    <Text style={s.tripMeta}>
                      {trip.offered_seats} plazas{trip.route_distance_m ? ` · ${km(trip.route_distance_m)}` : ""}
                      {trip.series_id && trip.series_weekdays?.length ? ` · se repite ${weekdaysLabel(trip.series_weekdays)}` : ""}
                    </Text>
                  </View>
                  <View style={s.badge}><Text style={s.badgeText}>{tripStatusLabel(trip.status)}</Text></View>
                </View>

                {trip.status === "published" ? (
                  <>
                    <PrimaryButton title="Iniciar viaje" onPress={() => startTrip(trip.id)} disabled={busy} />
                    {!trip.series_id && trip.departure_at ? (
                      panel === `repeat:${trip.id}` ? (
                        <RepeatPanel
                          initial={((new Date(trip.departure_at).getDay() + 6) % 7) + 1}
                          onConfirm={days => repeatTrip(trip.id, days)}
                          onClose={() => setPanel(null)}
                        />
                      ) : (
                        <Pressable style={s.weekButton} onPress={() => setPanel(`repeat:${trip.id}`)}>
                          <Ionicons name="repeat" size={17} color={C.blue} />
                          <Text style={s.weekButtonText}>Repetir cada semana</Text>
                        </Pressable>
                      )
                    ) : null}
                    {panel === `canceltrip:${trip.id}` ? (
                      <CancelPanel
                        title="Cancelar viaje"
                        explanation="Se cancelan todas las solicitudes y reservas. Los pasajeros que ya pagaron reciben el reembolso que marque la política vigente."
                        requireReason
                        allowForceMajeure
                        confirmLabel="Cancelar el viaje"
                        onConfirm={(reason, force) => cancelTrip(trip.id, reason, force)}
                        onClose={() => setPanel(null)}
                      />
                    ) : (
                      <Pressable style={s.cancelLink} onPress={() => setPanel(`canceltrip:${trip.id}`)}>
                        <Text style={s.cancelLinkText}>Cancelar viaje</Text>
                      </Pressable>
                    )}
                  </>
                ) : null}
                {trip.status === "active" ? (
                  <>
                    <Pressable style={[s.shareButton, isSharing && s.shareOn]} onPress={() => toggleSharing(trip.id)}>
                      <Ionicons name={isSharing ? "radio" : "radio-outline"} size={19} color={isSharing ? "#fff" : C.blue} />
                      <Text style={[s.shareText, isSharing && { color: "#fff" }]}>
                        {isSharing ? "Compartiendo ubicación · Parar" : "Compartir mi ubicación"}
                      </Text>
                    </Pressable>
                    {isSharing && sharingNote ? <Text style={s.requestMeta}>{sharingNote}</Text> : null}
                  </>
                ) : null}

                {requests.map(item => {
                  const status = requestStatus(item.status, item.booking_status);
                  const awaitingPickup = trip.status === "active" && item.booking_status === "confirmed" && !item.picked_up_at;
                  return (
                    <View key={item.id} style={s.passengerRow}>
                      <View style={s.requestHeader}>
                        <View style={[s.statusDot, status.tone === "green" && s.green, status.tone === "amber" && s.amber, status.tone === "red" && s.red]} />
                        <View style={{ flex: 1 }}>
                          <Text style={s.passengerName}>{item.passenger_display_name || "Pasajero MVC"}</Text>
                          <Text style={s.tripMeta}>
                            {item.picked_up_at && item.booking_status === "confirmed" ? "A bordo" : status.label}
                          </Text>
                        </View>
                        {item.booking_status === "confirmed" || item.booking_status === "completed" ? (
                          <Pressable
                            onPress={() => onChat({
                              tripId: trip.id,
                              peerUserId: item.passenger_user_id,
                              peerName: item.passenger_display_name || "Pasajero MVC",
                              departureAt: trip.departure_at,
                              tripStatus: trip.status,
                            })}
                            style={s.iconButton}
                            accessibilityLabel="Abrir chat"
                          >
                            <Ionicons name="chatbubble-ellipses-outline" size={20} color={C.blue} />
                          </Pressable>
                        ) : null}
                        {item.booking_id ? (
                          <Pressable onPress={() => setPanel(`dreport:${item.id}`)} style={s.iconButton} accessibilityLabel="Reportar">
                            <Ionicons name="flag-outline" size={19} color="#C93A3A" />
                          </Pressable>
                        ) : null}
                      </View>

                      {panel === `dreport:${item.id}` && token ? (
                        <ReportPanel
                          token={token}
                          tripId={trip.id}
                          reportedUserId={item.passenger_user_id}
                          peerName={item.passenger_display_name || "el pasajero"}
                          onClose={closeReport}
                        />
                      ) : null}

                      {trip.status === "completed" && (item.booking_status === "completed" || item.booking_status === "no_show") && item.booking_id && token ? (
                        <RatingPanel
                          token={token}
                          bookingId={item.booking_id}
                          peerName={item.passenger_display_name || "tu pasajero"}
                          existing={item.my_rating_score}
                          onDone={() => { setNotice("Valoración enviada."); void loadDriver(); }}
                        />
                      ) : null}

                      {item.status === "pending" && item.weekly_group_id ? (
                        <Pressable style={s.weekButton} onPress={() => decideWeek(item.weekly_group_id!, "accept")}>
                          <Ionicons name="calendar" size={17} color={C.blue} />
                          <Text style={s.weekButtonText}>Aceptar toda su semana</Text>
                        </Pressable>
                      ) : null}
                      {item.status === "pending" ? (
                        <View style={s.decisions}>
                          <Pressable onPress={() => decide(item.id, "accept")} style={s.accept}>
                            <Ionicons name="checkmark" size={19} color="#fff" />
                            <Text style={s.acceptText}>Aceptar</Text>
                          </Pressable>
                          <Pressable onPress={() => decide(item.id, "reject")} style={s.reject}>
                            <Ionicons name="close" size={19} color={C.blue} />
                            <Text style={s.rejectText}>Rechazar</Text>
                          </Pressable>
                        </View>
                      ) : null}

                      {awaitingPickup && item.booking_id ? (
                        <View style={s.verifyRow}>
                          <TextInput
                            value={codeInputs[item.booking_id] ?? ""}
                            onChangeText={value => setCodeInputs(current => ({ ...current, [item.booking_id!]: value.replace(/\D/g, "").slice(0, 6) }))}
                            placeholder="Código de 6 cifras"
                            keyboardType="number-pad"
                            style={s.codeInput}
                            maxLength={6}
                          />
                          <Pressable onPress={() => verifyPickup(item.booking_id!)} style={s.verifyButton}>
                            <Text style={s.acceptText}>Verificar</Text>
                          </Pressable>
                        </View>
                      ) : null}
                    </View>
                  );
                })}

                {trip.status === "active" ? (
                  <Pressable style={s.finish} onPress={() => completeTrip(trip.id)} disabled={busy}>
                    <Ionicons name="flag" size={18} color={C.navy} />
                    <Text style={s.finishText}>Finalizar viaje</Text>
                  </Pressable>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  wrap: { padding: 18, paddingBottom: 28, backgroundColor: "#fff" },
  title: { fontSize: 25, fontWeight: "900", color: C.navy, textAlign: "center", marginBottom: 8 },
  subtitle: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginBottom: 16 },
  tabs: { flexDirection: "row", gap: 7, marginBottom: 14 },
  tab: { flex: 1, minHeight: 40, borderWidth: 1, borderColor: C.border, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 5 },
  tabActive: { backgroundColor: C.blue, borderColor: C.blue },
  tabText: { fontSize: 11, fontWeight: "900", color: C.navy, textAlign: "center" },
  tabTextActive: { color: "#fff" },
  searchSummary: { marginBottom: 12 },
  tripCard: { marginBottom: 12 },
  tripTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: "#78B89F", alignItems: "center", justifyContent: "center" },
  tripName: { fontSize: 15, fontWeight: "900", color: C.navy },
  tripMeta: { fontSize: 11, color: C.muted, marginTop: 2 },
  badge: { backgroundColor: C.pale, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 6 },
  badgeText: { fontSize: 10, fontWeight: "900", color: C.blue },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { fontSize: 13, fontWeight: "800", color: C.navy, flex: 1 },
  dataGrid: { flexDirection: "row", gap: 8, marginTop: 14 },
  dataItem: { flex: 1, backgroundColor: "#F7FAFF", borderRadius: 12, padding: 10 },
  dataLabel: { fontSize: 9, fontWeight: "800", color: C.muted, textTransform: "uppercase" },
  dataValue: { fontSize: 12, fontWeight: "900", color: C.navy, marginTop: 3 },
  pending: { fontSize: 11, lineHeight: 16, color: "#966112", backgroundColor: "#FFF6E8", padding: 9, borderRadius: 10, marginTop: 10 },
  okNote: { fontSize: 11, lineHeight: 16, color: "#0E7A55", backgroundColor: C.mintPale, padding: 9, borderRadius: 10, marginTop: 10 },
  error: { marginBottom: 12, color: "#9E302D", backgroundColor: "#FFF0EF", padding: 11, borderRadius: 12, fontSize: 12 },
  emptyCard: { alignItems: "center", paddingVertical: 26, marginTop: 8 },
  emptyTitle: { fontSize: 16, fontWeight: "900", color: C.navy, marginTop: 10 },
  emptyText: { fontSize: 12, lineHeight: 18, color: C.muted, textAlign: "center", marginTop: 5 },
  liveLink: { minHeight: 48, borderWidth: 1, borderColor: C.border, borderRadius: 14, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, marginTop: 4 },
  liveLinkText: { fontSize: 12, fontWeight: "800", color: C.blue },
  requestHeader: { flexDirection: "row", alignItems: "center", gap: 9 },
  requestMeta: { fontSize: 11, color: C.muted, marginTop: 8 },
  statusDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: C.blue },
  green: { backgroundColor: C.mint },
  amber: { backgroundColor: "#EAA43A" },
  red: { backgroundColor: "#D84A4A" },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  action: { flex: 1, height: 42, borderRadius: 12, borderWidth: 1, borderColor: C.border, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  actionText: { fontSize: 12, fontWeight: "900", color: C.blue },
  codeBox: { marginTop: 12, backgroundColor: C.navy, borderRadius: 14, padding: 14, alignItems: "center" },
  codeLabel: { fontSize: 11, color: "#BFD0F2", fontWeight: "700" },
  code: { fontSize: 34, letterSpacing: 6, color: "#fff", fontWeight: "900", marginTop: 4, fontVariant: ["tabular-nums"] },
  passengerRow: { borderTopWidth: 1, borderTopColor: C.border, marginTop: 12, paddingTop: 12 },
  passengerName: { fontSize: 14, fontWeight: "900", color: C.navy },
  iconButton: { width: 40, height: 40, borderRadius: 12, borderWidth: 1, borderColor: C.border, alignItems: "center", justifyContent: "center" },
  decisions: { flexDirection: "row", gap: 9, marginTop: 12 },
  accept: { flex: 1, height: 46, borderRadius: 13, backgroundColor: C.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  acceptText: { color: "#fff", fontSize: 12, fontWeight: "900" },
  reject: { flex: 1, height: 46, borderRadius: 13, borderWidth: 1, borderColor: C.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  rejectText: { color: C.blue, fontSize: 12, fontWeight: "900" },
  verifyRow: { flexDirection: "row", gap: 8, marginTop: 12 },
  codeInput: { flex: 1, minWidth: 0, height: 46, borderWidth: 1, borderColor: C.border, borderRadius: 13, paddingHorizontal: 12, fontSize: 16, letterSpacing: 3, color: C.navy },
  verifyButton: { width: 96, flexShrink: 0, height: 46, borderRadius: 13, backgroundColor: C.blue, alignItems: "center", justifyContent: "center" },
  shareButton: { marginTop: 12, minHeight: 46, borderRadius: 13, borderWidth: 1, borderColor: C.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  shareOn: { backgroundColor: "#10A66A", borderColor: "#10A66A" },
  shareText: { fontSize: 13, fontWeight: "900", color: C.blue },
  priceRow: { marginTop: 12, marginBottom: 2 },
  priceValue: { fontSize: 22, fontWeight: "900", color: C.navy, fontVariant: ["tabular-nums"] },
  priceMeta: { fontSize: 11, color: C.muted, lineHeight: 16, marginTop: 2 },
  repeatTag: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 10, alignSelf: "flex-start", backgroundColor: C.pale, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 5 },
  repeatText: { fontSize: 11, fontWeight: "900", color: C.blue },
  weekButton: { marginTop: 10, minHeight: 44, borderRadius: 13, borderWidth: 1, borderColor: C.blue, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  weekButtonText: { fontSize: 13, fontWeight: "900", color: C.blue },
  actionNarrow: { flexGrow: 0, flexShrink: 0, flexBasis: 46, width: 46 },
  cancelLink: { marginTop: 10, alignSelf: "center", paddingVertical: 8, paddingHorizontal: 12 },
  cancelLinkText: { fontSize: 12, fontWeight: "900", color: "#C93A3A" },
  finish: { marginTop: 14, minHeight: 46, borderRadius: 13, backgroundColor: C.pale, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  finishText: { fontSize: 13, fontWeight: "900", color: C.navy },
});
