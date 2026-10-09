/**
 * Cancelaciones de la persona que conduce en el backend en memoria de la vista previa (SIMULACIÓN, solo con
 * `EXPO_PUBLIC_PREVIEW=1`).
 *
 *  - `driverCancelBooking`  → `POST /v1/bookings/{bookingId}/driver-cancel` (contrato `docs/contracts/money.md` §8.3, equivale
 *    a `cancelCore` con actor `driver` de `src/modules/money/cancellations/cancel-service.ts`).
 *  - `cancelTripAsDriver`   → `POST /v1/me/trips/{tripId}/cancel`. PROPUESTO: el backend real todavía no cancela un viaje
 *    entero (solo reservas sueltas). Aquí se define como «cancelar cada reserva confirmada con las reglas de `driver-cancel`
 *    + cerrar las solicitudes abiertas + dejar el viaje en `cancelled`», en una sola transacción.
 *
 * Honestidad económica: las consecuencias de la cancelación del conductor NO están definidas. Si había algo pagado se abre
 * una devolución `pending_review` (nunca se resuelve sola) con todos los importes derivados «Por definir»; el importe
 * pagado sale del pago registrado o, si no lo hay, del importe ilustrativo de la reserva.
 */
import type { CancelBookingResponse, DriverCancelBookingRequest, Money, PaymentBookingStatus, RefundView } from "@/api/types";
import {
  ApiFailure,
  iso,
  isoReq,
  moneyDefined,
  moneyIllustrative,
  moneyPending,
  publicUser,
  routeChangeTables,
  writeAudit,
  type PreviewDb,
  type Principal,
} from "@/preview";
import type { CancelTripBody, CancelTripBookingEffect, CancelTripResponse } from "../ops/types";
import { pushOpsNotice } from "./opsNotify";

// ── Filas compartidas (misma forma que `RefundRow` de «pagos y cobros» y `MoneyRefundRow` de mensajes) ──────────────────

interface AmountRow {
  cents: number | null;
  status: "defined" | "pending_definition" | "illustrative";
}

const PENDING: AmountRow = { cents: null, status: "pending_definition" };

interface RefundRow {
  id: string;
  user_id: string;
  status: "pending_review" | "approved" | "executing" | "refunded" | "rejected" | "failed" | "not_applicable";
  origin: "passenger_cancellation" | "driver_cancellation" | "platform_cancellation" | "force_majeure" | "no_show" | "late_payment" | "other";
  booking_id: string | null;
  request_id: string;
  payment_id: string | null;
  paid: AmountRow;
  proposed: AmountRow;
  approved: AmountRow;
  platform_fee: AmountRow;
  final_cost: AmountRow;
  execution_status: "not_started" | "awaiting_provider" | "submitted" | "succeeded" | "failed";
  policy_status: "pending_review" | "approved";
  policy_version: number | null;
  created_at: number;
  decided_at: number | null;
  refunded_at: number | null;
}

/** Solo lo que se lee o cambia de `money_payments` (tabla del paquete «pagos y cobros»). */
interface PaymentRef {
  id: string;
  booking_id: string | null;
  payment_id: string | null;
  amount: AmountRow;
  state: string;
}

const refundsOf = (db: PreviewDb) => db.collection<RefundRow>("money_refunds");
const paymentsOf = (db: PreviewDb) => db.collection<PaymentRef>("money_payments");

function moneyOf(amount: AmountRow): Money {
  if (amount.status === "defined" && amount.cents !== null) return moneyDefined(amount.cents);
  if (amount.status === "illustrative" && amount.cents !== null) return moneyIllustrative(amount.cents);
  return moneyPending();
}

export function refundView(row: Readonly<RefundRow>): RefundView {
  return {
    id: row.id,
    status: row.status,
    origin: row.origin,
    bookingId: row.booking_id,
    requestId: row.request_id,
    paymentId: row.payment_id,
    paid: moneyOf(row.paid),
    proposedRefund: moneyOf(row.proposed),
    approvedRefund: moneyOf(row.approved),
    platformFee: moneyOf(row.platform_fee),
    finalPassengerCost: moneyOf(row.final_cost),
    executionStatus: row.execution_status,
    policy: { status: row.policy_status, version: row.policy_version, effectiveFrom: null, summary: null },
    createdAt: isoReq(row.created_at),
    decidedAt: iso(row.decided_at),
    refundedAt: iso(row.refunded_at),
  };
}

function refundViewByBooking(db: PreviewDb, bookingId: string): RefundView | null {
  const row = refundsOf(db).find((r) => r.booking_id === bookingId && r.origin === "driver_cancellation");
  return row ? refundView(row) : null;
}

// ── Cancelar una reserva ──────────────────────────────────────────────────────────────────────────────────────────────

const STARTED_MESSAGE = "El viaje ya ha empezado y no se puede cancelar desde aquí. Usa «Incidencias» o escribe a soporte.";

function routeLabel(db: PreviewDb, tripId: string): string {
  const stops = db.tripStops.filter((s) => s.trip_id === tripId).sort((a, b) => a.seq - b.seq);
  const first = stops[0]?.label ?? "el origen";
  const last = stops[stops.length - 1]?.label ?? "el destino";
  return `${first} → ${last}`;
}

interface CancelledBooking {
  bookingId: string;
  passengerUserId: string;
  refund: RefundView | null;
}

/** Cancela UNA reserva ya validada (dentro de la transacción del llamador). */
function cancelOneBooking(
  db: PreviewDb,
  driver: Principal,
  bookingId: string,
  input: DriverCancelBookingRequest,
  requestId: string | undefined,
): CancelledBooking {
  const booking = db.bookings.get(bookingId);
  const request = booking ? db.rideRequests.get(booking.request_id) : undefined;
  const trip = request ? db.trips.get(request.trip_id) : undefined;
  if (!booking || !request || !trip) throw new ApiFailure("BOOKING_NOT_FOUND", "Reserva no encontrada.", 404);

  const now = db.nowMs();
  db.bookings.update(booking.id, { status: "driver_cancelled", updated_at: now });
  db.rideRequests.update(request.id, { status: "cancelled", updated_at: now });
  for (const hold of db.seatHolds.filter((h) => h.request_id === request.id && h.status === "active")) {
    db.seatHolds.update(hold.id, { status: "released", released_at: now });
  }

  // Lo pagado: el pago registrado por «pagos y cobros» o, si no lo hay, el importe (ilustrativo) de la reserva.
  const payment = paymentsOf(db).find((p) => p.booking_id === booking.id);
  const paid: AmountRow = payment && payment.amount.cents !== null ? { ...payment.amount } : { cents: booking.amount_cents, status: "illustrative" };

  let refund: RefundView | null = null;
  if ((paid.cents ?? 0) > 0) {
    const existing = refundsOf(db).find((r) => r.booking_id === booking.id && r.origin === "driver_cancellation");
    const row =
      existing ??
      refundsOf(db).insert({
        id: db.ids.uuid(),
        user_id: request.passenger_user_id,
        status: "pending_review",
        origin: "driver_cancellation",
        booking_id: booking.id,
        request_id: request.id,
        payment_id: payment?.payment_id ?? null,
        paid,
        proposed: { ...PENDING },
        approved: { ...PENDING },
        platform_fee: { ...PENDING },
        final_cost: { ...PENDING },
        execution_status: "not_started",
        policy_status: "pending_review",
        policy_version: null,
        created_at: now,
        decided_at: null,
        refunded_at: null,
      });
    refund = refundView(row);
    if (payment && payment.state === "paid") paymentsOf(db).update(payment.id, { state: "under_review" });
  }

  writeAudit(db, {
    actorUserId: driver.userId,
    action: "booking.cancelled_by_driver",
    entityType: "booking",
    entityId: booking.id,
    requestId: requestId ?? null,
    metadata: { requestId: request.id, reason: input.reason, refundId: refund?.id ?? null },
  });

  const driverName = publicUser(db, driver.userId).firstName;
  pushOpsNotice(db, {
    userId: request.passenger_user_id,
    kind: "booking_cancelled_by_driver",
    title: "Tu viaje se ha cancelado",
    body: `${driverName} ha cancelado el viaje (${routeLabel(db, trip.id)}). Hemos abierto una revisión para tramitar lo que corresponda.`,
    data: { bookingId: booking.id, tripId: trip.id, ...(refund ? { refundId: refund.id } : {}) },
  });

  return { bookingId: booking.id, passengerUserId: request.passenger_user_id, refund };
}

/** `POST /v1/bookings/{bookingId}/driver-cancel`: solo la conductora del viaje; reintentar devuelve el resultado previo. */
export function driverCancelBooking(
  db: PreviewDb,
  driver: Principal,
  bookingId: string,
  input: DriverCancelBookingRequest,
  requestId?: string,
): CancelBookingResponse {
  return db.tx(() => {
    const booking = db.bookings.get(bookingId);
    const request = booking ? db.rideRequests.get(booking.request_id) : undefined;
    const trip = request ? db.trips.get(request.trip_id) : undefined;
    if (!booking || !request || !trip || trip.driver_user_id !== driver.userId) {
      throw new ApiFailure("BOOKING_NOT_FOUND", "Reserva no encontrada.", 404);
    }
    if (booking.status === "driver_cancelled") {
      return { booking: { id: booking.id, status: "driver_cancelled" as PaymentBookingStatus }, refund: refundViewByBooking(db, booking.id), alreadyCancelled: true };
    }
    if (booking.status !== "confirmed") {
      throw new ApiFailure("BOOKING_NOT_CANCELLABLE", "Esta reserva ya no se puede cancelar.", 409);
    }
    if (trip.status === "active" || trip.started_at !== null || booking.picked_up_at !== null) {
      throw new ApiFailure("TRIP_ALREADY_STARTED", STARTED_MESSAGE, 409);
    }
    const done = cancelOneBooking(db, driver, booking.id, input, requestId);
    return { booking: { id: booking.id, status: "driver_cancelled" as PaymentBookingStatus }, refund: done.refund, alreadyCancelled: false };
  });
}

// ── Cancelar el viaje entero (PROPUESTO) ──────────────────────────────────────────────────────────────────────────────

const OPEN_REQUEST_STATUSES = new Set(["pending", "accepted", "payment_pending"]);

function tripCancelResponse(db: PreviewDb, tripId: string, effects: CancelTripBookingEffect[], closed: number, already: boolean): CancelTripResponse {
  const trip = db.trips.get(tripId);
  return {
    trip: { id: tripId, status: "cancelled", cancelledAt: isoReq(trip?.updated_at ?? db.nowMs()) },
    bookings: effects,
    closedRequests: closed,
    alreadyCancelled: already,
  };
}

/** `POST /v1/me/trips/{tripId}/cancel` (propuesto). Solo un viaje publicado y sin empezar; reintentar devuelve el resultado previo. */
export function cancelTripAsDriver(
  db: PreviewDb,
  driver: Principal,
  tripId: string,
  input: CancelTripBody,
  requestId?: string,
): CancelTripResponse {
  return db.tx(() => {
    const trip = db.trips.get(tripId);
    if (!trip) throw new ApiFailure("TRIP_NOT_FOUND", "Trip not found", 404);
    if (trip.driver_user_id !== driver.userId) throw new ApiFailure("TRIP_NOT_OWNED", "Only the trip driver may cancel it", 403);

    const requests = db.rideRequests.filter((r) => r.trip_id === tripId);

    if (trip.status === "cancelled") {
      const effects: CancelTripBookingEffect[] = [];
      for (const request of requests) {
        const booking = db.bookings.find((b) => b.request_id === request.id && b.status === "driver_cancelled");
        if (booking) effects.push({ bookingId: booking.id, passenger: publicUser(db, request.passenger_user_id), status: "driver_cancelled", refund: refundViewByBooking(db, booking.id) });
      }
      const closed = requests.filter((r) => r.status === "cancelled" && !db.bookings.find((b) => b.request_id === r.id)).length;
      return tripCancelResponse(db, tripId, effects, closed, true);
    }
    if (trip.status === "active" || trip.started_at !== null) throw new ApiFailure("TRIP_ALREADY_STARTED", STARTED_MESSAGE, 409);
    if (trip.status !== "published") throw new ApiFailure("TRIP_NOT_CANCELLABLE", "Only a published trip can be cancelled", 409);

    const now = db.nowMs();
    const reason = { reason: input.reason, ...(input.note ? { note: input.note } : {}) };
    const driverName = publicUser(db, driver.userId).firstName;
    const route = routeLabel(db, tripId);

    // 1) Reservas confirmadas → `driver_cancelled` (con su devolución en revisión si había algo pagado).
    const effects: CancelTripBookingEffect[] = [];
    for (const request of requests.filter((r) => r.status === "confirmed")) {
      const booking = db.bookings.find((b) => b.request_id === request.id && b.status === "confirmed");
      if (!booking) continue;
      const done = cancelOneBooking(db, driver, booking.id, reason, requestId);
      effects.push({ bookingId: booking.id, passenger: publicUser(db, done.passengerUserId), status: "driver_cancelled", refund: done.refund });
    }

    // 2) Solicitudes abiertas (pendientes, aceptadas sin pagar…) → cerradas, con aviso.
    let closed = 0;
    for (const request of requests.filter((r) => OPEN_REQUEST_STATUSES.has(r.status))) {
      db.rideRequests.update(request.id, { status: "cancelled", updated_at: now });
      for (const hold of db.seatHolds.filter((h) => h.request_id === request.id && h.status === "active")) {
        db.seatHolds.update(hold.id, { status: "released", released_at: now });
      }
      pushOpsNotice(db, {
        userId: request.passenger_user_id,
        kind: "trip_cancelled",
        title: "El viaje se ha cancelado",
        body: `${driverName} ha cancelado el viaje (${route}). Tu solicitud se ha cerrado y no se te cobrará nada por ella.`,
        data: { requestId: request.id, tripId },
      });
      closed += 1;
    }

    // 3) Una propuesta de cambio de ruta pendiente deja de tener sentido.
    const { proposals } = routeChangeTables(db);
    const pending = proposals.find((p) => p.trip_id === tripId && p.status === "pending");
    if (pending) proposals.update(pending.id, { status: "cancelled", resolution: "cancelled_by_driver", resolved_at: now });

    db.trips.update(tripId, { status: "cancelled", updated_at: now });
    writeAudit(db, {
      actorUserId: driver.userId,
      action: "trip.cancelled_by_driver",
      entityType: "trip",
      entityId: tripId,
      requestId: requestId ?? null,
      metadata: { reason: input.reason, bookings: effects.length, closedRequests: closed },
    });
    db.events.emit("trip.cancelled", { tripId });
    return tripCancelResponse(db, tripId, effects, closed, false);
  });
}
