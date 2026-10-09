import { moneyDefined, moneyPending } from "../../lib/dto.js";
import { clampLimit, decodeCursor, encodeCursor, iso, isoOrNull, nameParts, sliceOverflow } from "./common.js";
import type { TrustContext } from "./context.js";
import { resolveWindow, type Period } from "./period.js";
import { publicPhotoUrl } from "./public-photo-url.js";
import { loadProvince, tableExists } from "./summary.js";

export type BookingStatusFilter = "all" | "cancelled" | "refunded";

type BookingRow = {
  booking_id: string;
  status: "confirmed" | "completed" | "cancelled" | "driver_cancelled" | "no_show";
  amount_cents: number;
  updated_at: Date;
  updated_at_text: string;
  trip_id: string;
  departure_at: Date | null;
  passenger_user_id: string;
  driver_user_id: string;
  p_name: string | null;
  p_key: string | null;
  p_status: string | null;
  d_name: string | null;
  d_key: string | null;
  d_status: string | null;
  origin_label: string | null;
  dest_label: string | null;
};

type RefundRow = {
  booking_id: string;
  status: string;
  paid_cents: number;
  proposed_cents: number | null;
  approved_cents: number | null;
  retained_commission_cents: number | null;
  cancelled_at: Date | null;
};

const STATUS_LABEL: Record<BookingRow["status"], string> = {
  confirmed: "Confirmada",
  completed: "Completada",
  cancelled: "Cancelada",
  driver_cancelled: "Cancelada por el conductor",
  no_show: "No presentado"
};

const CANCELLED_SQL = `b.status in ('cancelled','driver_cancelled')`;

/** Devoluciones de be-money, si su tabla existe. Si no existe (o falla la lectura) no se inventa nada: «Por definir». */
async function loadRefunds(ctx: TrustContext, bookingIds: string[]): Promise<Map<string, RefundRow> | null> {
  if (bookingIds.length === 0) return new Map();
  if (!(await tableExists(ctx.pool, "refund_requests"))) return null;
  try {
    const rows = await ctx.pool.query<RefundRow>(
      `select distinct on (booking_id) booking_id, status, paid_cents, proposed_cents, approved_cents, retained_commission_cents, cancelled_at
         from refund_requests
        where booking_id = any($1::uuid[])
        order by booking_id, created_at desc`,
      [bookingIds]
    );
    return new Map(rows.rows.map(r => [r.booking_id, r]));
  } catch {
    return null;
  }
}

export async function listAdminBookings(
  ctx: TrustContext,
  input: { provinceId?: string | undefined; period: Period; status: BookingStatusFilter; cursor?: string | undefined; limit?: number | undefined }
) {
  const province = await loadProvince(ctx.pool, input.provinceId);
  const window = resolveWindow(input.period, ctx.now());
  const limit = clampLimit(input.limit);
  const refundsAvailable = await tableExists(ctx.pool, "refund_requests");
  const baseParams: unknown[] = [window.from, window.to, province?.id ?? null];

  const refundedSql = `exists (select 1 from refund_requests rf where rf.booking_id = b.id and rf.status = 'refunded')`;
  const baseWhere = `b.updated_at >= $1 and b.updated_at < $2 and ($3::uuid is null or t.province_id = $3::uuid)`;
  const from = `from bookings b
     join ride_requests rr on rr.id = b.request_id
     join trips t on t.id = rr.trip_id`;

  const countsSql = `select count(*)::text as all_n,
        count(*) filter (where ${CANCELLED_SQL})::text as cancelled_n
        ${refundsAvailable ? `, count(*) filter (where ${refundedSql})::text as refunded_n` : ""}
      ${from} where ${baseWhere}`;
  const countsRow = (await ctx.pool.query<{ all_n: string; cancelled_n: string; refunded_n?: string }>(countsSql, baseParams)).rows[0];
  const counts = {
    all: Number(countsRow?.all_n ?? 0),
    cancelled: Number(countsRow?.cancelled_n ?? 0),
    refunded: refundsAvailable ? Number(countsRow?.refunded_n ?? 0) : null
  };

  let statusSql = "";
  if (input.status === "cancelled") statusSql = `and ${CANCELLED_SQL}`;
  if (input.status === "refunded") statusSql = refundsAvailable ? `and ${refundedSql}` : `and false`;

  const params = [...baseParams];
  let keyset = "";
  if (input.cursor) {
    const cursor = decodeCursor(input.cursor, { t: "iso", id: "uuid" });
    params.push(String(cursor.t), String(cursor.id));
    keyset = `and (b.updated_at, b.id) < ($4::timestamptz, $5::uuid)`;
  }
  const rows = await ctx.pool.query<BookingRow>(
    `select b.id as booking_id, b.status::text as status, b.amount_cents, b.updated_at,
            to_char(b.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at_text,
            rr.trip_id, t.departure_at, rr.passenger_user_id, t.driver_user_id,
            pp.display_name as p_name, pp.public_photo_key as p_key, pp.public_photo_status::text as p_status,
            dp.display_name as d_name, dp.public_photo_key as d_key, dp.public_photo_status::text as d_status,
            (select s.label from trip_stops s where s.trip_id = t.id and s.kind = 'origin' order by s.seq limit 1) as origin_label,
            (select s.label from trip_stops s where s.trip_id = t.id and s.kind = 'destination' order by s.seq desc limit 1) as dest_label
       ${from}
       left join profiles pp on pp.user_id = rr.passenger_user_id
       left join profiles dp on dp.user_id = t.driver_user_id
      where ${baseWhere} ${statusSql} ${keyset}
      order by b.updated_at desc, b.id desc
      limit ${limit + 1}`,
    params
  );
  const { page, hasMore } = sliceOverflow(rows.rows, limit);
  const refunds = await loadRefunds(ctx, page.map(r => r.booking_id));
  const last = page[page.length - 1];

  const party = (id: string, name: string | null, key: string | null, status: string | null) => ({
    id,
    ...nameParts(name),
    photoUrl: publicPhotoUrl(id, key, status)
  });

  const items = page.map(r => {
    const refund = refunds?.get(r.booking_id);
    const cancelled = r.status === "cancelled" || r.status === "driver_cancelled";
    const proposed = refund && refund.proposed_cents !== null ? refund.proposed_cents : null;
    let refundStatus: "not_applicable" | "pending_definition" | "proposed" | "refunded";
    if (refund?.status === "refunded") refundStatus = "refunded";
    else if (refund) refundStatus = proposed !== null ? "proposed" : "pending_definition";
    else refundStatus = cancelled ? "pending_definition" : "not_applicable";
    return {
      bookingId: r.booking_id,
      tripId: r.trip_id,
      status: r.status,
      statusLabel: STATUS_LABEL[r.status],
      passenger: party(r.passenger_user_id, r.p_name, r.p_key, r.p_status),
      driver: party(r.driver_user_id, r.d_name, r.d_key, r.d_status),
      tripDepartureAt: isoOrNull(r.departure_at),
      route: { originLabel: r.origin_label, destinationLabel: r.dest_label },
      cancelledBy: r.status === "cancelled" ? ("passenger" as const) : r.status === "driver_cancelled" ? ("driver" as const) : null,
      cancelledAt: cancelled ? iso(refund?.cancelled_at ?? r.updated_at) : null,
      money: {
        amountPaid: moneyDefined(Number(r.amount_cents)),
        proposedRefund: proposed !== null ? moneyDefined(proposed) : moneyPending(),
        platformCommission: refund && refund.retained_commission_cents !== null ? moneyDefined(refund.retained_commission_cents) : moneyPending(),
        finalPassengerCost:
          refund && proposed !== null ? moneyDefined(Number(refund.paid_cents) - Number(refund.approved_cents ?? proposed)) : moneyPending()
      },
      refund: { status: refundStatus, actionOwner: "money" as const }
    };
  });
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ t: last.updated_at_text, id: last.booking_id }) : null,
    counts
  };
}
