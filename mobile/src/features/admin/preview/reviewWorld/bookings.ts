/**
 * «Reservas y devoluciones» para Atención al cliente (SIMULACIÓN): `GET /v1/admin/bookings` (trust · A F S), de solo
 * lectura. Espejo de `src/modules/trust/admin-bookings.ts`:
 *
 *  - las reservas salen del módulo de viajes (reserva → solicitud → viaje) y, para cada una, la propuesta de devolución
 *    del módulo de dinero si existe (este módulo NUNCA calcula una devolución: sin propuesta, «Por definir»);
 *  - el periodo cuenta sobre la última actualización de la reserva (Europe/Madrid) y los contadores respetan periodo y
 *    provincia, no la pestaña;
 *  - las devoluciones del panel de finanzas cuya reserva no existe en el módulo de viajes de esta vista previa (son
 *    casos de ejemplo del panel) aparecen igualmente como una reserva cancelada con los datos de su ficha.
 */
import type { AdminBookingParty, AdminBookingRow, AdminBookingsPage, AdminBookingStatus, AdminPeriod, Money } from "@/api/types";
import { publicUser, type PreviewDb } from "@/preview";
import { isoOrNull, sliceOf } from "./common";
import { periodWindow } from "./periods";
import { reviewTables, type MoneyRefundRow, type RefundMetaRow } from "./store";

export interface BookingsQuery {
  provinceId?: string;
  period: AdminPeriod;
  status: "all" | "cancelled" | "refunded";
  cursor?: string;
  limit?: number;
}

const STATUS_LABEL: Record<AdminBookingStatus, string> = {
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  driver_cancelled: "Cancelada por el conductor",
  no_show: "No presentado",
};

const PENDING: Money = { cents: null, currency: "EUR", status: "pending_definition" };

interface BookingFact {
  bookingId: string;
  tripId: string;
  status: AdminBookingStatus;
  passengerId: string;
  driverId: string | null;
  departureAt: number | null;
  originLabel: string | null;
  destinationLabel: string | null;
  cancelledAt: number | null;
  updatedAt: number;
  provinceId: string | null;
  paid: Money;
}

function statusOfOrigin(origin: MoneyRefundRow["origin"]): AdminBookingStatus {
  switch (origin) {
    case "driver_cancellation":
      return "driver_cancelled";
    case "no_show":
      return "no_show";
    default:
      return "cancelled";
  }
}

function provinceIdOfCode(db: PreviewDb, code: string): string | null {
  return db.provinces.find((province) => province.code === code)?.id ?? null;
}

function coreFacts(db: PreviewDb): BookingFact[] {
  const facts: BookingFact[] = [];
  for (const booking of db.bookings.all()) {
    const request = db.rideRequests.get(booking.request_id);
    const trip = request === undefined ? undefined : db.trips.get(request.trip_id);
    if (request === undefined || trip === undefined) continue;
    const stops = db.tripStops.filter((stop) => stop.trip_id === trip.id).sort((a, b) => a.seq - b.seq);
    const cancelled = booking.status === "cancelled" || booking.status === "driver_cancelled" || booking.status === "no_show";
    facts.push({
      bookingId: booking.id,
      tripId: trip.id,
      status: booking.status,
      passengerId: request.passenger_user_id,
      driverId: trip.driver_user_id,
      departureAt: trip.departure_at,
      originLabel: request.pickup_label ?? stops[0]?.label ?? null,
      destinationLabel: stops[stops.length - 1]?.label ?? null,
      cancelledAt: cancelled ? booking.updated_at : null,
      updatedAt: booking.updated_at,
      provinceId: trip.province_id,
      paid: { cents: booking.amount_cents, currency: "EUR", status: "illustrative" },
    });
  }
  return facts;
}

function refundFacts(db: PreviewDb, known: ReadonlySet<string>): BookingFact[] {
  const tables = reviewTables(db);
  const facts: BookingFact[] = [];
  for (const refund of tables.refunds.all()) {
    const bookingId = refund.booking_id ?? refund.request_id;
    if (known.has(bookingId)) continue;
    const meta: Readonly<RefundMetaRow> | undefined = tables.refundMeta.get(refund.id);
    facts.push({
      bookingId,
      tripId: meta?.trip.trip_id ?? refund.request_id,
      status: statusOfOrigin(refund.origin),
      passengerId: refund.user_id,
      driverId: meta?.driver_user_id ?? null,
      departureAt: meta?.trip.departure_at ?? null,
      originLabel: meta?.trip.origin_label ?? null,
      destinationLabel: meta?.trip.destination_label ?? null,
      cancelledAt: meta?.cancelled_at ?? refund.created_at,
      updatedAt: refund.created_at,
      provinceId: meta === undefined ? null : provinceIdOfCode(db, meta.province_code),
      paid: { cents: refund.paid.cents, currency: "EUR", status: refund.paid.status },
    });
  }
  return facts;
}

function party(db: PreviewDb, userId: string | null): AdminBookingParty {
  const user = publicUser(db, userId ?? "");
  return { id: user.id, displayName: user.displayName, firstName: user.firstName, photoUrl: user.photoUrl };
}

function refundStateOf(refund: Readonly<MoneyRefundRow> | undefined, status: AdminBookingStatus): AdminBookingRow["refund"]["status"] {
  if (refund === undefined) return status === "confirmed" || status === "completed" ? "not_applicable" : "pending_definition";
  switch (refund.status) {
    case "refunded":
      return "refunded";
    case "rejected":
    case "not_applicable":
      return "not_applicable";
    case "pending_review":
    case "approved":
    case "executing":
    case "failed":
      return refund.proposed.cents === null ? "pending_definition" : "proposed";
  }
}

function toRow(db: PreviewDb, fact: BookingFact, refund: Readonly<MoneyRefundRow> | undefined): AdminBookingRow {
  const cancelled = fact.status === "cancelled" || fact.status === "driver_cancelled";
  return {
    bookingId: fact.bookingId,
    tripId: fact.tripId,
    status: fact.status,
    statusLabel: STATUS_LABEL[fact.status],
    passenger: party(db, fact.passengerId),
    driver: party(db, fact.driverId),
    tripDepartureAt: isoOrNull(fact.departureAt),
    route: { originLabel: fact.originLabel, destinationLabel: fact.destinationLabel },
    cancelledBy: cancelled ? (fact.status === "driver_cancelled" ? "driver" : "passenger") : null,
    cancelledAt: isoOrNull(fact.cancelledAt),
    money: {
      amountPaid: fact.paid,
      proposedRefund: refund === undefined ? PENDING : { cents: refund.proposed.cents, currency: "EUR", status: refund.proposed.status },
      platformCommission: refund === undefined ? PENDING : { cents: refund.platform_fee.cents, currency: "EUR", status: refund.platform_fee.status },
      finalPassengerCost: refund === undefined ? PENDING : { cents: refund.final_cost.cents, currency: "EUR", status: refund.final_cost.status },
    },
    refund: { status: refundStateOf(refund, fact.status), actionOwner: "money" },
  };
}

/** `GET /v1/admin/bookings`. */
export function listBookings(db: PreviewDb, query: BookingsQuery): AdminBookingsPage {
  const window = periodWindow(db.nowMs(), query.period);
  const core = coreFacts(db);
  const facts = [...core, ...refundFacts(db, new Set(core.map((fact) => fact.bookingId)))];
  const refunds = reviewTables(db).refunds.all();
  const refundOf = (fact: BookingFact): Readonly<MoneyRefundRow> | undefined =>
    refunds.find((refund) => (refund.booking_id ?? refund.request_id) === fact.bookingId);

  const scoped = facts.filter(
    (fact) => fact.updatedAt >= window.from && fact.updatedAt <= window.to && (query.provinceId === undefined || fact.provinceId === query.provinceId),
  );
  const isCancelled = (fact: BookingFact): boolean => fact.status === "cancelled" || fact.status === "driver_cancelled" || fact.status === "no_show";
  const isRefunded = (fact: BookingFact): boolean => refundOf(fact)?.status === "refunded";
  const counts = { all: scoped.length, cancelled: scoped.filter(isCancelled).length, refunded: scoped.filter(isRefunded).length };

  const rows = scoped
    .filter((fact) => (query.status === "cancelled" ? isCancelled(fact) : query.status === "refunded" ? isRefunded(fact) : true))
    .sort((a, b) => (a.updatedAt !== b.updatedAt ? b.updatedAt - a.updatedAt : a.bookingId < b.bookingId ? 1 : -1));
  const page = sliceOf(rows, query.cursor, query.limit);
  return { items: page.items.map((fact) => toRow(db, fact, refundOf(fact))), nextCursor: page.nextCursor, counts };
}
