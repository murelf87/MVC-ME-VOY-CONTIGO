/**
 * «Mis viajes» (pantalla 30) en el backend en memoria de la vista previa (SIMULACIÓN, solo con `EXPO_PUBLIC_PREVIEW=1`).
 * Porta `src/modules/trips/overview-service.ts`: `GET /v1/me/trips/overview?role=&section=&cursor=&limit=`.
 *
 *  - Pasajero: sus solicitudes agrupadas en En curso · Próximos (las semanales se funden en UNA tarjeta recurrente) ·
 *    Historial (paginado por desplazamiento).
 *  - Conductor: sus viajes publicados (las series se funden en una tarjeta recurrente).
 *
 * El estado de cada tarjeta sale de los datos reales (solicitud, reserva, viaje): nada se inventa.
 */
import type { OverviewCard, OverviewStatus, TripCategory, TripOverviewCard, TripsOverview, Weekday, WeeklyReservationCard } from "@/api/types";
import { fail, isoReq, publicUser, type PreviewDb, type RideRequestRow, type TripRow } from "@/preview";
import type { PreviewRouter } from "@/preview";
import { WEEKDAY_ORDER, metaFor, tripMetaTable } from "@/features/search/preview/browseMeta";
import { loadTripGeometry } from "@/features/search/preview/browseGeometry";
import { localTimeOf } from "@/features/search/preview/browseShared";
import { weeklyTable } from "@/features/search/preview/requestWeekly";
import { expireStaleHolds } from "@/preview";

const CATEGORY_LABELS: Record<string, string> = { work: "Trabajo", university: "Universidad", fp_academies: "FP", hospital: "Hospital", sport: "Deporte", other: "Otros" };
const categoryLabel = (category: TripCategory): string => CATEGORY_LABELS[category] ?? "Otros";

const STATUS_LABELS: Record<OverviewStatus["code"], string> = {
  confirmed: "Confirmada",
  pending: "Pendiente",
  payment_pending: "Pago pendiente",
  scheduled: "Programado",
  live: "En curso",
  completed: "Completado",
  cancelled: "Cancelado",
  no_show: "No presentado",
  rejected: "Rechazada",
  expired: "Caducada",
};
const status = (code: OverviewStatus["code"]): OverviewStatus => ({ code, label: STATUS_LABELS[code] });

const SHORT_DAYS: Record<Weekday, string> = { mon: "Lun", tue: "Mar", wed: "Mié", thu: "Jue", fri: "Vie", sat: "Sáb", sun: "Dom" };
function sortWeekdays(days: readonly Weekday[]): Weekday[] {
  return WEEKDAY_ORDER.filter((day) => days.includes(day));
}
function weekdaysLabel(days: readonly Weekday[]): string {
  const sorted = sortWeekdays(days);
  if (sorted.length === 0) return "";
  const first = WEEKDAY_ORDER.indexOf(sorted[0] as Weekday);
  const last = WEEKDAY_ORDER.indexOf(sorted[sorted.length - 1] as Weekday);
  if (sorted.length >= 3 && last - first + 1 === sorted.length) return `${SHORT_DAYS[sorted[0] as Weekday]} - ${SHORT_DAYS[sorted[sorted.length - 1] as Weekday]}`;
  return sorted.map((day) => SHORT_DAYS[day]).join(", ");
}

type Bucket = "in_progress" | "weekly_open" | "upcoming" | "history";

function startsInMinutes(atMs: number, nowMs: number): number | null {
  const diff = Math.ceil((atMs - nowMs) / 60_000);
  return diff >= 0 && diff <= 180 ? diff : null;
}

function bucketOf(db: PreviewDb, request: Readonly<RideRequestRow>, trip: Readonly<TripRow>): Bucket {
  const booking = db.bookings.find((b) => b.request_id === request.id);
  const departure = trip.departure_at ?? 0;
  const confirmed = request.status === "confirmed" && booking?.status === "confirmed";
  const open = confirmed || ((request.status === "pending" || request.status === "accepted" || request.status === "payment_pending") && departure > db.nowMs());
  if (trip.status === "active" && confirmed) return "in_progress";
  if (trip.status === "published" && open) return request.weekly_reservation_id ? "weekly_open" : "upcoming";
  return "history";
}

function passengerStatus(db: PreviewDb, request: Readonly<RideRequestRow>, trip: Readonly<TripRow>, bucket: Bucket): OverviewStatus {
  const booking = db.bookings.find((b) => b.request_id === request.id);
  if (bucket === "in_progress") return status("live");
  if (bucket === "upcoming" || bucket === "weekly_open") {
    if (request.status === "confirmed") return status("confirmed");
    if (request.status === "pending") return status("pending");
    return status("payment_pending");
  }
  if (booking?.status === "completed") return status("completed");
  if (booking?.status === "no_show") return status("no_show");
  if (booking?.status === "cancelled" || booking?.status === "driver_cancelled") return status("cancelled");
  if (trip.status === "cancelled") return status("cancelled");
  if (trip.status === "completed" && request.status === "confirmed") return status("completed");
  switch (request.status) {
    case "rejected":
      return status("rejected");
    case "cancelled":
      return status("cancelled");
    default:
      return status("expired");
  }
}

function ridersOf(db: PreviewDb, tripId: string, excludeUserId: string | null): ReturnType<typeof publicUser>[] {
  const seen = new Set<string>();
  const out: ReturnType<typeof publicUser>[] = [];
  for (const booking of db.bookings.all()) {
    if (booking.status !== "confirmed" && booking.status !== "completed") continue;
    const request = db.rideRequests.get(booking.request_id);
    if (!request || request.trip_id !== tripId || request.passenger_user_id === excludeUserId || seen.has(request.passenger_user_id)) continue;
    seen.add(request.passenger_user_id);
    out.push(publicUser(db, request.passenger_user_id));
  }
  return out;
}

function occupancyOf(db: PreviewDb, trip: Readonly<TripRow>): { occupied: number; total: number } {
  const geo = loadTripGeometry(db, trip, metaFor(db, trip.id));
  const occupied = geo.segments.reduce((max, segment) => Math.max(max, segment.occupied), 0);
  return { occupied, total: trip.offered_seats };
}

function passengerTripCard(db: PreviewDb, userId: string, request: Readonly<RideRequestRow>, trip: Readonly<TripRow>, bucket: Bucket): TripOverviewCard {
  const geo = loadTripGeometry(db, trip, metaFor(db, trip.id));
  const departure = trip.departure_at ?? db.nowMs();
  const toSeq = request.dropoff_stop_seq ?? request.to_segment_seq;
  const pickupAt = departure + (request.pickup_offset_s ?? geo.offsets[request.from_segment_seq] ?? 0) * 1000;
  const arriveAt = departure + (geo.offsets[toSeq] ?? 0) * 1000;
  const toLabel = geo.stops[toSeq]?.label ?? null;
  const booking = db.bookings.find((b) => b.request_id === request.id);
  const confirmed = request.status === "confirmed" && booking?.status === "confirmed";
  const phase: TripOverviewCard["phase"] = bucket === "in_progress" ? "live" : bucket === "history" ? "finished" : "scheduled";
  return {
    kind: "trip",
    id: request.id,
    tripId: trip.id,
    requestId: request.id,
    bookingId: booking?.id ?? null,
    role: "passenger",
    leg: trip.leg,
    departureAt: isoReq(departure),
    category: trip.category,
    title: toLabel ? `${categoryLabel(trip.category)} – ${toLabel}` : categoryLabel(trip.category),
    from: { label: request.pickup_label ?? geo.stops[request.from_segment_seq]?.label ?? null, timeLocal: localTimeOf(pickupAt) },
    to: { label: toLabel, timeLocal: localTimeOf(arriveAt) },
    riders: confirmed ? ridersOf(db, trip.id, userId) : [],
    occupancy: occupancyOf(db, trip),
    status: passengerStatus(db, request, trip, bucket),
    startsInMinutes: phase === "scheduled" ? startsInMinutes(pickupAt, db.nowMs()) : null,
    phase,
    // Sin posición en directo fiable no se inventa un «llegará en X min».
    liveEta: null,
  };
}

function passengerOverview(db: PreviewDb, userId: string, section: string, offset: number, limit: number): TripsOverview {
  expireStaleHolds(db);
  const rows = db.rideRequests
    .filter((r) => r.passenger_user_id === userId)
    .map((request) => ({ request, trip: db.trips.get(request.trip_id) }))
    .filter((x): x is { request: RideRequestRow; trip: TripRow } => x.trip !== undefined)
    // Las ocurrencias semanales canceladas sin reserva no se enseñan (no hubo nada que cancelar).
    .filter(({ request }) => !(request.weekly_reservation_id && request.status === "cancelled" && !db.bookings.find((b) => b.request_id === request.id)))
    .map((x) => ({ ...x, bucket: bucketOf(db, x.request, x.trip) }));
  const byDeparture = (a: { trip: TripRow; request: RideRequestRow }, b: { trip: TripRow; request: RideRequestRow }): number =>
    (a.trip.departure_at ?? 0) - (b.trip.departure_at ?? 0) || (a.request.id < b.request.id ? -1 : 1);

  const open = rows.filter((x) => x.bucket !== "history").sort(byDeparture);
  const history = rows.filter((x) => x.bucket === "history").sort((a, b) => byDeparture(b, a));

  const inProgress: OverviewCard[] = open.filter((x) => x.bucket === "in_progress").map((x) => passengerTripCard(db, userId, x.request, x.trip, x.bucket));
  const singles: OverviewCard[] = open.filter((x) => x.bucket === "upcoming").map((x) => passengerTripCard(db, userId, x.request, x.trip, x.bucket));

  const weeklyCards: WeeklyReservationCard[] = [];
  const weeklyIds = [...new Set(open.filter((x) => x.bucket === "weekly_open").map((x) => x.request.weekly_reservation_id as string))];
  for (const id of weeklyIds) {
    const header = weeklyTable(db).get(id);
    const group = open.filter((x) => x.request.weekly_reservation_id === id && x.bucket === "weekly_open");
    const next = group[0];
    if (!header || !next) continue;
    const card = passengerTripCard(db, userId, next.request, next.trip, "weekly_open");
    const confirmed = group.filter((x) => x.request.status === "confirmed").length;
    const aggregate: OverviewStatus =
      confirmed === group.length
        ? status("confirmed")
        : group.some((x) => x.request.status === "payment_pending" || x.request.status === "accepted")
          ? status("payment_pending")
          : confirmed > 0
            ? status("confirmed")
            : status("pending");
    const weekdays = sortWeekdays(header.weekdays);
    weeklyCards.push({
      kind: "weekly_reservation",
      id: header.id,
      seriesId: header.series_id,
      reservationId: header.id,
      category: next.trip.category,
      title: categoryLabel(next.trip.category),
      from: card.from,
      to: card.to,
      riders: card.riders,
      occupancy: card.occupancy,
      status: aggregate,
      recurrence: { weekdays, recurring: true, label: `${weekdaysLabel(weekdays)} · Recurrente` },
    });
  }
  const upcoming: OverviewCard[] = [...weeklyCards, ...singles];

  const page = history.slice(offset, offset + limit);
  const wantsHistory = section === "all" || section === "history";
  return {
    role: "passenger",
    generatedAt: isoReq(db.nowMs()),
    counts: { upcoming: upcoming.length, inProgress: inProgress.length, history: history.length },
    upcoming: section === "all" || section === "upcoming" ? upcoming : [],
    inProgress: section === "all" || section === "in_progress" ? inProgress : [],
    history: {
      items: wantsHistory ? page.map((x) => passengerTripCard(db, userId, x.request, x.trip, "history")) : [],
      nextCursor: wantsHistory && offset + limit < history.length ? encodeCursor(offset + limit) : null,
    },
  };
}

// ── Conductor ─────────────────────────────────────────────────────────────────────────────────────────────────────────

function driverBucket(db: PreviewDb, trip: Readonly<TripRow>, recurring: boolean): "in_progress" | "upcoming" | "history" | "hidden" {
  const departure = trip.departure_at ?? 0;
  const now = db.nowMs();
  if (trip.status === "active") return "in_progress";
  if (trip.status === "published" && departure > now - 2 * 3_600_000 && (!recurring || departure <= now + 24 * 3_600_000)) return "upcoming";
  if (trip.status === "published" && recurring && departure > now + 24 * 3_600_000) return "hidden";
  return "history";
}

function driverTripCard(db: PreviewDb, trip: Readonly<TripRow>, bucket: "in_progress" | "upcoming" | "history"): TripOverviewCard {
  const geo = loadTripGeometry(db, trip, metaFor(db, trip.id));
  const departure = trip.departure_at ?? db.nowMs();
  const lastSeq = Math.max(0, geo.stops.length - 1);
  const arriveAt = departure + (geo.offsets[lastSeq] ?? 0) * 1000;
  const toLabel = geo.stops[lastSeq]?.label ?? null;
  const phase: TripOverviewCard["phase"] = bucket === "in_progress" ? "live" : bucket === "upcoming" ? "scheduled" : "finished";
  const state: OverviewStatus = bucket === "in_progress" ? status("live") : bucket === "upcoming" ? status("scheduled") : trip.status === "completed" ? status("completed") : trip.status === "cancelled" ? status("cancelled") : status("expired");
  return {
    kind: "trip",
    id: trip.id,
    tripId: trip.id,
    requestId: null,
    bookingId: null,
    role: "driver",
    leg: trip.leg,
    departureAt: isoReq(departure),
    category: trip.category,
    title: toLabel ? `${categoryLabel(trip.category)} – ${toLabel}` : categoryLabel(trip.category),
    from: { label: geo.stops[0]?.label ?? null, timeLocal: localTimeOf(departure) },
    to: { label: toLabel, timeLocal: localTimeOf(arriveAt) },
    riders: ridersOf(db, trip.id, null),
    occupancy: occupancyOf(db, trip),
    status: state,
    startsInMinutes: phase === "scheduled" ? startsInMinutes(departure, db.nowMs()) : null,
    phase,
    liveEta: null,
  };
}

function driverOverview(db: PreviewDb, userId: string, section: string, offset: number, limit: number): TripsOverview {
  const metas = tripMetaTable(db);
  const mine = db.trips.filter((t) => t.driver_user_id === userId && t.status !== "draft");
  const rows = mine.map((trip) => {
    const meta = metas.get(trip.id);
    return { trip, meta, bucket: driverBucket(db, trip, meta?.seriesId != null) };
  });
  const byDeparture = (a: { trip: TripRow }, b: { trip: TripRow }): number => (a.trip.departure_at ?? 0) - (b.trip.departure_at ?? 0) || (a.trip.id < b.trip.id ? -1 : 1);
  const inProgress: OverviewCard[] = rows.filter((x) => x.bucket === "in_progress").sort(byDeparture).map((x) => driverTripCard(db, x.trip, "in_progress"));
  const singles: OverviewCard[] = rows
    .filter((x) => x.bucket === "upcoming" && x.meta?.seriesId == null)
    .sort(byDeparture)
    .map((x) => driverTripCard(db, x.trip, "upcoming"));
  const history = rows.filter((x) => x.bucket === "history").sort((a, b) => byDeparture(b, a));

  // Una tarjeta recurrente por serie activa (con próxima ocurrencia publicada).
  const seriesCards: WeeklyReservationCard[] = [];
  const seriesIds = [...new Set(rows.filter((x) => x.meta?.seriesId != null && x.trip.status === "published").map((x) => x.meta?.seriesId as string))];
  for (const seriesId of seriesIds) {
    const occurrences = rows.filter((x) => x.meta?.seriesId === seriesId && x.trip.status === "published" && (x.trip.departure_at ?? 0) > db.nowMs()).sort(byDeparture);
    const next = occurrences[0];
    if (!next) continue;
    const card = driverTripCard(db, next.trip, "upcoming");
    const weekdays = sortWeekdays(next.meta?.weekdays ?? []);
    seriesCards.push({
      kind: "weekly_reservation",
      id: seriesId,
      seriesId,
      reservationId: null,
      category: next.trip.category,
      title: categoryLabel(next.trip.category),
      from: card.from,
      to: card.to,
      riders: card.riders,
      occupancy: card.occupancy,
      status: status("scheduled"),
      recurrence: { weekdays, recurring: true, label: `${weekdaysLabel(weekdays)} · Recurrente` },
    });
  }
  const upcoming: OverviewCard[] = [...seriesCards, ...singles];
  const page = history.slice(offset, offset + limit);
  const wantsHistory = section === "all" || section === "history";
  return {
    role: "driver",
    generatedAt: isoReq(db.nowMs()),
    counts: { upcoming: upcoming.length, inProgress: inProgress.length, history: history.length },
    upcoming: section === "all" || section === "upcoming" ? upcoming : [],
    inProgress: section === "all" || section === "in_progress" ? inProgress : [],
    history: {
      items: wantsHistory ? page.map((x) => driverTripCard(db, x.trip, "history")) : [],
      nextCursor: wantsHistory && offset + limit < history.length ? encodeCursor(offset + limit) : null,
    },
  };
}

// ── Cursor y entrada ──────────────────────────────────────────────────────────────────────────────────────────────────

function encodeCursor(offset: number): string {
  return btoa(JSON.stringify({ o: offset }));
}
function decodeCursor(cursor: string | undefined): number {
  if (cursor === undefined || cursor === "") return 0;
  try {
    const value = (JSON.parse(atob(cursor)) as { o?: unknown }).o;
    if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  } catch {
    // cae en el error de abajo
  }
  return fail("VALIDATION_ERROR", "El cursor no es válido.", 400);
}

export function registerTripsOverviewPreview(r: PreviewRouter, db: PreviewDb): void {
  r.get<{ Query: { role?: string; section?: string; cursor?: string; limit?: string } }>(
    "/v1/me/trips/overview",
    { summary: "Mis viajes (próximos, en curso e historial)", tags: ["trips"] },
    (req) => {
      const me = req.auth();
      const query = req.query as { role?: string; section?: string; cursor?: string; limit?: string };
      const role = query.role === "driver" ? "driver" : query.role === "passenger" ? "passenger" : fail("VALIDATION_ERROR", "Indica el rol: passenger o driver.", 400);
      const section = query.section ?? "all";
      if (!["all", "upcoming", "in_progress", "history"].includes(section)) return fail("VALIDATION_ERROR", "La sección no es válida.", 400);
      const limit = Math.min(50, Math.max(1, Number(query.limit ?? 20) || 20));
      if (!me.roles.includes(role)) {
        return fail("AUTH_FORBIDDEN", role === "driver" ? "Necesitas el rol de conductor para ver tus viajes como conductor." : "Necesitas el rol de pasajero para ver tus viajes como pasajero.", 403);
      }
      const offset = decodeCursor(query.cursor);
      return role === "driver" ? driverOverview(db, me.userId, section, offset, limit) : passengerOverview(db, me.userId, section, offset, limit);
    },
  );
}
