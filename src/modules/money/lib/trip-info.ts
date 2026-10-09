import type { Queryable } from "./db.js";
import { STOP_LABEL_JOINS, tripRef } from "./people.js";
import type { MoneyTripRefDto } from "../types.js";

export type RequestTripInfo = {
  requestId: string;
  requestStatus: string;
  passengerUserId: string;
  driverUserId: string;
  provinceId: string;
  tripStatus: string;
  tripStarted: boolean;
  trip: MoneyTripRefDto;
};

type Row = {
  request_id: string;
  request_status: string;
  passenger_user_id: string;
  driver_user_id: string;
  province_id: string;
  trip_status: string;
  trip_started: boolean;
  trip_id: string;
  departure_at: Date | string | null;
  origin_label: string | null;
  destination_label: string | null;
};

/** Datos del viaje de una solicitud (solo lectura de tablas base: `ride_requests`, `trips`, `trip_stops`). */
export async function loadRequestTripInfo(db: Queryable, requestId: string): Promise<RequestTripInfo | null> {
  const result = await db.query<Row>(
    `select r.id as request_id, r.status::text as request_status, r.passenger_user_id,
            t.id as trip_id, t.driver_user_id, t.province_id, t.status::text as trip_status, t.departure_at,
            (t.status::text = 'active' or t.started_at is not null) as trip_started,
            so.label as origin_label, sd.label as destination_label
       from ride_requests r
       join trips t on t.id=r.trip_id
       ${STOP_LABEL_JOINS}
      where r.id=$1`,
    [requestId]
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    requestId: row.request_id,
    requestStatus: row.request_status,
    passengerUserId: row.passenger_user_id,
    driverUserId: row.driver_user_id,
    provinceId: row.province_id,
    tripStatus: row.trip_status,
    tripStarted: row.trip_started,
    trip: tripRef({
      trip_id: row.trip_id,
      departure_at: row.departure_at,
      origin_label: row.origin_label,
      destination_label: row.destination_label
    })
  };
}
