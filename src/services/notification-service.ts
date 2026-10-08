import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";

/**
 * In-app inbox. Rows are written inside the same transaction as the event
 * that causes them, so a rolled-back action never leaves a notice behind.
 * Push delivery (APNs/FCM) is not wired: it needs provider credentials.
 */
export type NotificationKind =
  | "ride_request.received"
  | "ride_request.accepted"
  | "ride_request.rejected"
  | "booking.confirmed"
  | "booking.cancelled_by_passenger"
  | "trip.started"
  | "trip.cancelled"
  | "trip.completed"
  | "report.closed";

export async function notify(
  client:PoolClient|Pool,
  userIds:string|string[],
  kind:NotificationKind,
  tripId:string|null,
  payload:Record<string,unknown>={}
):Promise<void>{
  const ids=[...new Set(Array.isArray(userIds)?userIds:[userIds])];
  if(!ids.length) return;
  await client.query(`
    insert into user_notifications(user_id,kind,trip_id,payload)
    select unnest($1::uuid[]),$2,$3,$4`,[ids,kind,tripId,payload]);
}

/** Display names travel in the payload so the inbox reads well even after profile edits. */
export async function displayName(client:PoolClient|Pool,userId:string):Promise<string|null>{
  const q=await client.query(`select display_name from profiles where user_id=$1`,[userId]);
  return q.rows[0]?.display_name??null;
}

export async function listOwnNotifications(pool:Pool,principal:AuthPrincipal,limit=50){
  const rows=(await pool.query(`
    select n.id,n.kind,n.trip_id,n.payload,n.created_at,n.read_at,t.departure_at,
           coalesce(t.driver_user_id=n.user_id,false) as as_driver
      from user_notifications n left join trips t on t.id=n.trip_id
     where n.user_id=$1 order by n.created_at desc limit $2`,
    [principal.userId,Math.min(Math.max(limit,1),100)])).rows;
  const unread=(await pool.query(`
    select count(*)::int as n from user_notifications where user_id=$1 and read_at is null`,
    [principal.userId])).rows[0].n as number;
  return {notifications:rows,unread};
}

export async function markNotificationsRead(pool:Pool,principal:AuthPrincipal,ids?:string[]){
  const r=await pool.query(`
    update user_notifications set read_at=now()
     where user_id=$1 and read_at is null and ($2::uuid[] is null or id=any($2::uuid[]))`,
    [principal.userId,ids?.length?ids:null]);
  return {marked:r.rowCount??0};
}
