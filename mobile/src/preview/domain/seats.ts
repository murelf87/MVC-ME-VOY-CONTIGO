/**
 * Capacidad por tramo (`assertCapacity` / `availableSeatsForRange` del backend).
 *
 * Una plaza está ocupada en un tramo si hay un hold ACTIVO y no caducado, o una reserva `confirmed|completed`, de una
 * solicitud cuyo rango cubre ese tramo (`from_segment_seq <= seq < to_segment_seq`). Una solicitud pendiente NO
 * reserva plaza.
 */
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import type { TripSegmentRow } from "../core/rows";

/** Libera los holds activos ya caducados de un viaje (o de todos). Devuelve cuántos liberó. */
export function releaseExpiredHolds(db: PreviewDb, tripId?: string): number {
  const now = db.nowMs();
  let released = 0;
  for (const hold of db.seatHolds.filter((h) => h.status === "active" && h.expires_at <= now)) {
    if (tripId !== undefined && db.rideRequests.get(hold.request_id)?.trip_id !== tripId) continue;
    db.seatHolds.update(hold.id, { status: "released", released_at: now });
    released += 1;
  }
  return released;
}

export function occupiedOnSegment(db: PreviewDb, tripId: string, seq: number): number {
  const now = db.nowMs();
  let occupied = 0;
  for (const hold of db.seatHolds.all()) {
    if (hold.status !== "active" || hold.expires_at <= now) continue;
    const request = db.rideRequests.get(hold.request_id);
    if (request && request.trip_id === tripId && request.from_segment_seq <= seq && request.to_segment_seq > seq) occupied += 1;
  }
  for (const booking of db.bookings.all()) {
    if (booking.status !== "confirmed" && booking.status !== "completed") continue;
    const request = db.rideRequests.get(booking.request_id);
    if (request && request.trip_id === tripId && request.from_segment_seq <= seq && request.to_segment_seq > seq) occupied += 1;
  }
  return occupied;
}

export function segmentsOf(db: PreviewDb, tripId: string): Array<Readonly<TripSegmentRow>> {
  return db.tripSegments.filter((s) => s.trip_id === tripId).sort((a, b) => a.seq - b.seq);
}

/** Plazas libres en TODO el rango de tramos [from, to): el mínimo de `capacity - ocupadas`. */
export function availableSeatsForRange(db: PreviewDb, tripId: string, fromSegmentSeq: number, toSegmentSeq: number): number {
  const segments = segmentsOf(db, tripId).filter((s) => s.seq >= fromSegmentSeq && s.seq < toSegmentSeq);
  if (segments.length === 0) return 0;
  let min = Number.POSITIVE_INFINITY;
  for (const segment of segments) min = Math.min(min, segment.capacity - occupiedOnSegment(db, tripId, segment.seq));
  return Math.max(0, min);
}

/** `lockRequestedSegments`: los tramos pedidos deben existir y ser contiguos. */
export function requestedSegments(
  db: PreviewDb,
  tripId: string,
  fromSegmentSeq: number,
  toSegmentSeq: number
): Array<Readonly<TripSegmentRow>> {
  const expected = toSegmentSeq - fromSegmentSeq;
  const segments = segmentsOf(db, tripId).filter((s) => s.seq >= fromSegmentSeq && s.seq < toSegmentSeq);
  if (segments.length !== expected) {
    throw new ApiFailure("INVALID_SEGMENT_RANGE", "Requested segment range is not contiguous");
  }
  return segments;
}

export function assertCapacity(db: PreviewDb, tripId: string, segments: ReadonlyArray<Pick<TripSegmentRow, "seq" | "capacity">>): void {
  releaseExpiredHolds(db, tripId);
  for (const segment of segments) {
    if (occupiedOnSegment(db, tripId, segment.seq) >= segment.capacity) {
      throw new ApiFailure("NO_CAPACITY_ON_SEGMENT", "No seat capacity on at least one affected segment", 409);
    }
  }
}
