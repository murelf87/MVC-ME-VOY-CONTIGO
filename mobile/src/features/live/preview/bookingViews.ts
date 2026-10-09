/**
 * Endpoints de lectura del pasajero titular de una reserva (contrato `live.md` §3): 21 «Esperando el coche»,
 * 23 «En el coche» y 24 «Viaje terminado». Cualquier otra persona recibe `404 BOOKING_NOT_FOUND`.
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`).
 */
import { uuidParam } from "@/preview";
import type { PreviewDb, PreviewRouter } from "@/preview";
import { loadBookingContext } from "./engine";
import { buildInCarView, buildLiveView, buildSummaryView } from "./views";

export function registerBookingViews(r: PreviewRouter, db: PreviewDb): void {
  const schema = { params: uuidParam("bookingId") };

  r.get<{ Params: { bookingId: string } }>(
    "/v1/bookings/:bookingId/live",
    { summary: "Estado en directo de mi reserva: coche, llegada estimada y señal (21)", tags: ["live"], schema },
    (req) => {
      const me = req.auth();
      return buildLiveView(db, loadBookingContext(db, req.params.bookingId, me.userId), me.userId);
    }
  );

  r.get<{ Params: { bookingId: string } }>(
    "/v1/bookings/:bookingId/in-car",
    { summary: "Mi viaje a bordo: código, ocupación, trayecto y llegada (23)", tags: ["live"], schema },
    (req) => {
      const me = req.auth();
      return buildInCarView(db, loadBookingContext(db, req.params.bookingId, me.userId), me.userId);
    }
  );

  r.get<{ Params: { bookingId: string } }>(
    "/v1/bookings/:bookingId/summary",
    { summary: "Resumen de mi viaje terminado: trayecto, duración, pago y valoración (24)", tags: ["live"], schema },
    (req) => {
      const me = req.auth();
      return buildSummaryView(db, loadBookingContext(db, req.params.bookingId, me.userId), me.userId);
    }
  );
}
