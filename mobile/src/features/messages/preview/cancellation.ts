/**
 * Cancelar una reserva como pasajero (pantalla 28) en el backend en memoria de la vista previa (SIMULACIÓN, solo con
 * `EXPO_PUBLIC_PREVIEW=1`). Contrato `docs/contracts/money.md` (cancelaciones).
 *
 *   GET  /v1/bookings/:bookingId/cancellation-preview  → motivos, importes y si se puede cancelar
 *   POST /v1/bookings/:bookingId/cancel                → cancela (Idempotency-Key OBLIGATORIA; repetir devuelve lo mismo)
 *
 * Honestidad económica: NO hay política de cancelación aprobada, así que lo que se devuelva es una PROPUESTA «Por definir»
 * que revisa Administración; nunca se promete ni se ejecuta un reembolso solo.
 */
import type { CancelBookingRequest, CancelBookingResponse, CancellationBlockCode, CancellationPreview, PassengerCancellationReason, PaymentBookingStatus } from "@/api/types";
import { PASSENGER_CANCELLATION_REASON_LABELS } from "@/api/types";
import { refundView } from "@/features/driver/preview/opsCancel";
import { fail, isoReq, moneyIllustrative, moneyPending, publicUser, uuidParam, writeAudit } from "@/preview";
import type { PreviewDb, PreviewRouter } from "@/preview";
import { seatsOfBooking } from "./access";
import { tablesOf } from "./rows";

const REASONS = Object.keys(PASSENGER_CANCELLATION_REASON_LABELS) as PassengerCancellationReason[];
export const LEGAL_NOTICE = "Si corresponde, los reembolsos obligatorios por ley se realizarán según la normativa vigente.";

interface Ctx {
  booking: NonNullable<ReturnType<PreviewDb["bookings"]["get"]>>;
  request: NonNullable<ReturnType<PreviewDb["rideRequests"]["get"]>>;
  trip: NonNullable<ReturnType<PreviewDb["trips"]["get"]>>;
}

function loadOwn(db: PreviewDb, bookingId: string, userId: string): Ctx {
  const booking = db.bookings.get(bookingId);
  const request = booking ? db.rideRequests.get(booking.request_id) : undefined;
  const trip = request ? db.trips.get(request.trip_id) : undefined;
  if (!booking || !request || !trip || request.passenger_user_id !== userId) return fail("BOOKING_NOT_FOUND", "La reserva no existe.", 404);
  return { booking, request, trip };
}

function blockOf(ctx: Ctx): { code: CancellationBlockCode; message: string } | null {
  if (ctx.booking.status === "cancelled" || ctx.booking.status === "driver_cancelled") return { code: "BOOKING_ALREADY_CANCELLED", message: "Esta reserva ya está cancelada." };
  if (ctx.booking.status !== "confirmed") return { code: "BOOKING_NOT_CANCELLABLE", message: "Esta reserva ya no se puede cancelar." };
  if (ctx.trip.status === "active" || ctx.trip.started_at !== null || ctx.booking.picked_up_at !== null) {
    return { code: "TRIP_ALREADY_STARTED", message: "El viaje ya ha empezado y no se puede cancelar desde aquí. Usa «Incidencias» o escribe a soporte." };
  }
  return null;
}

function paidCents(db: PreviewDb, ctx: Ctx): number {
  const payment = db.collection<{ booking_id: string | null; amount: { cents: number | null } }>("money_payments").find((p) => p.booking_id === ctx.booking.id);
  return payment?.amount.cents ?? ctx.booking.amount_cents;
}

function previewOf(db: PreviewDb, ctx: Ctx): CancellationPreview {
  const stops = db.tripStops.filter((s) => s.trip_id === ctx.trip.id).sort((a, b) => a.seq - b.seq);
  const paid = paidCents(db, ctx);
  return {
    booking: {
      id: ctx.booking.id,
      status: ctx.booking.status as PaymentBookingStatus,
      seats: seatsOfBooking(db, ctx.booking.id),
      trip: {
        tripId: ctx.trip.id,
        departureAt: ctx.trip.departure_at === null ? null : isoReq(ctx.trip.departure_at),
        originLabel: stops[ctx.request.from_segment_seq]?.label ?? ctx.request.pickup_label ?? null,
        destinationLabel: stops[ctx.request.dropoff_stop_seq ?? ctx.request.to_segment_seq]?.label ?? null,
      },
      driver: publicUser(db, ctx.trip.driver_user_id),
      paid: moneyIllustrative(paid),
    },
    ...(() => {
      const blocked = blockOf(ctx);
      return { canCancel: blocked === null, blocked };
    })(),
    scenario: "passenger_cancellation",
    reasons: REASONS,
    policy: { status: "pending_review", version: null, effectiveFrom: null, summary: null },
    lines: [
      { key: "trip_contribution", amount: moneyIllustrative(paid), noteCode: "subject_to_conditions" },
      { key: "platform_fee", amount: moneyPending(), noteCode: "policy_pending_review" },
    ],
    proposedRefund: moneyPending(),
    decisionMode: "admin_review",
    legalNotice: LEGAL_NOTICE,
  };
}

function previousRefund(db: PreviewDb, bookingId: string) {
  const row = tablesOf(db).refunds.find((r) => r.booking_id === bookingId && r.origin === "passenger_cancellation");
  return row ? refundView(row) : null;
}

export function registerCancellation(r: PreviewRouter, db: PreviewDb): void {
  r.get<{ Params: { bookingId: string } }>(
    "/v1/bookings/:bookingId/cancellation-preview",
    { summary: "Qué pasaría si cancelas esta reserva (pantalla 28)", tags: ["money"], schema: { params: uuidParam("bookingId") } },
    (req): CancellationPreview => previewOf(db, loadOwn(db, req.params.bookingId, req.auth().userId)),
  );

  r.post<{ Params: { bookingId: string }; Body: CancelBookingRequest }>(
    "/v1/bookings/:bookingId/cancel",
    {
      summary: "Cancelar mi reserva",
      tags: ["money"],
      idempotent: "required",
      schema: {
        params: uuidParam("bookingId"),
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: { reason: { type: "string", enum: REASONS }, note: { type: "string", maxLength: 500 } },
        },
      },
    },
    (req): CancelBookingResponse =>
      db.tx(() => {
        const me = req.auth();
        const ctx = loadOwn(db, req.params.bookingId, me.userId);
        if (ctx.booking.status === "cancelled") return { booking: { id: ctx.booking.id, status: "cancelled" as PaymentBookingStatus }, refund: previousRefund(db, ctx.booking.id), alreadyCancelled: true };
        const blocked = blockOf(ctx);
        if (blocked) return fail(blocked.code, blocked.message, 409);

        const now = db.nowMs();
        db.bookings.update(ctx.booking.id, { status: "cancelled", updated_at: now });
        db.rideRequests.update(ctx.request.id, { status: "cancelled", updated_at: now });
        for (const hold of db.seatHolds.filter((h) => h.request_id === ctx.request.id && h.status === "active")) {
          db.seatHolds.update(hold.id, { status: "released", released_at: now });
        }

        const paid = paidCents(db, ctx);
        let refund = null;
        if (paid > 0) {
          const payment = db.collection<{ id: string; booking_id: string | null; payment_id: string | null; state: string }>("money_payments").find((p) => p.booking_id === ctx.booking.id);
          const pending = { cents: null, status: "pending_definition" } as const;
          const row = tablesOf(db).refunds.insert({
            id: db.ids.uuid(),
            user_id: me.userId,
            status: "pending_review",
            origin: "passenger_cancellation",
            booking_id: ctx.booking.id,
            request_id: ctx.request.id,
            payment_id: payment?.payment_id ?? null,
            paid: { cents: paid, status: "illustrative" },
            proposed: { ...pending },
            approved: { ...pending },
            platform_fee: { ...pending },
            final_cost: { ...pending },
            execution_status: "not_started",
            policy_status: "pending_review",
            policy_version: null,
            created_at: now,
            decided_at: null,
            refunded_at: null,
          });
          refund = refundView(row);
          if (payment && payment.state === "paid") db.collection<{ id: string; state: string }>("money_payments").update(payment.id, { state: "under_review" });
        }

        writeAudit(db, {
          actorUserId: me.userId,
          action: "booking.cancelled_by_passenger",
          entityType: "booking",
          entityId: ctx.booking.id,
          requestId: req.requestId ?? null,
          metadata: { reason: req.body.reason, refundId: refund?.id ?? null },
        });

        const passengerName = publicUser(db, me.userId).firstName;
        tablesOf(db).notifications.insert({
          id: db.ids.uuid(),
          user_id: ctx.trip.driver_user_id,
          category: "trip",
          kind: "booking_cancelled",
          title: "Una reserva se ha cancelado",
          body: `${passengerName} ha cancelado su plaza. Ya está libre para otra persona.`,
          data: { bookingId: ctx.booking.id, tripId: ctx.trip.id },
          essential: true,
          read_at: null,
          created_at: now,
          delivery_state: "delivered",
        });
        return { booking: { id: ctx.booking.id, status: "cancelled" as PaymentBookingStatus }, refund, alreadyCancelled: false };
      }),
  );
}
