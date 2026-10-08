import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";
import { notify } from "./notification-service.js";

export const REPORT_CATEGORIES=["safety","behaviour","no_show","vehicle","route","payment","other"] as const;
export type ReportCategory=typeof REPORT_CATEGORIES[number];
const MAX_REPORTS_PER_DAY=10;

/** Only the driver and the passenger of a completed (or no-show) booking can rate each other, once each. */
export async function rateBooking(
  pool:Pool,
  principal:AuthPrincipal,
  input:{bookingId:string;score:number;comment?:string|null}
){
  if(!Number.isInteger(input.score)||input.score<1||input.score>5){
    throw new DomainError("INVALID_RATING","Score must be an integer between 1 and 5");
  }
  const comment=input.comment?.trim()||null;
  if(comment&&comment.length>500) throw new DomainError("INVALID_RATING","Comment must be at most 500 characters");

  const q=await pool.query(`
    select b.id,b.status,r.trip_id,r.passenger_user_id,t.driver_user_id,t.status as trip_status
      from bookings b
      join ride_requests r on r.id=b.request_id
      join trips t on t.id=r.trip_id
     where b.id=$1`,[input.bookingId]);
  const row=q.rows[0];
  if(!row) throw new DomainError("BOOKING_NOT_FOUND","Booking not found",404);

  let rated:string;
  if(principal.userId===row.passenger_user_id) rated=row.driver_user_id;
  else if(principal.userId===row.driver_user_id) rated=row.passenger_user_id;
  else throw new DomainError("BOOKING_NOT_PARTICIPANT","Only the trip participants can rate this booking",403);

  if(!["completed","no_show"].includes(row.status)||row.trip_status!=="completed"){
    throw new DomainError("RATING_NOT_AVAILABLE","Ratings open once the trip is completed",409);
  }

  const inserted=await pool.query(`
    insert into trip_ratings(booking_id,trip_id,rater_user_id,rated_user_id,score,comment)
    values($1,$2,$3,$4,$5,$6)
    on conflict(booking_id,rater_user_id) do nothing
    returning id,booking_id,rated_user_id,score,comment,created_at`,
    [row.id,row.trip_id,principal.userId,rated,input.score,comment]);
  if(!inserted.rowCount) throw new DomainError("RATING_ALREADY_SUBMITTED","You already rated this booking",409);
  return inserted.rows[0];
}

export async function ratingSummary(pool:Pool,userId:string){
  const q=await pool.query(`
    select count(*)::int as count,
           coalesce(round(avg(score)::numeric,1),0)::float8 as average
      from trip_ratings where rated_user_id=$1`,[userId]);
  return {userId,count:q.rows[0].count as number,average:q.rows[0].count?q.rows[0].average as number:null};
}

async function tripParticipants(pool:Pool,tripId:string):Promise<{driver:string;passengers:Set<string>}|null>{
  const t=await pool.query(`select driver_user_id from trips where id=$1`,[tripId]);
  if(!t.rowCount) return null;
  const p=await pool.query(`
    select distinct passenger_user_id from ride_requests
     where trip_id=$1 and status in ('accepted','payment_pending','confirmed','payment_late','cancelled')`,[tripId]);
  return {driver:t.rows[0].driver_user_id,passengers:new Set(p.rows.map(r=>r.passenger_user_id as string))};
}

/** Reports are scoped to a trip both people took part in; support reviews them in the admin panel. */
export async function createIncidentReport(
  pool:Pool,
  principal:AuthPrincipal,
  input:{tripId:string;reportedUserId?:string|null;category:string;description:string;blockUser?:boolean}
){
  if(!(REPORT_CATEGORIES as readonly string[]).includes(input.category)){
    throw new DomainError("INVALID_REPORT","Unknown report category");
  }
  const description=input.description.trim();
  if(description.length<10||description.length>2000){
    throw new DomainError("INVALID_REPORT","Description must contain 10 to 2000 characters");
  }
  const parts=await tripParticipants(pool,input.tripId);
  if(!parts) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  const isMember=(id:string)=>id===parts.driver||parts.passengers.has(id);
  if(!isMember(principal.userId)) throw new DomainError("TRIP_NOT_PARTICIPANT","Only trip participants can report on it",403);
  const reported=input.reportedUserId||null;
  if(reported){
    if(reported===principal.userId) throw new DomainError("INVALID_REPORT","You cannot report yourself");
    if(!isMember(reported)) throw new DomainError("REPORTED_USER_NOT_IN_TRIP","The reported person was not on this trip",400);
    // Passengers only interact with the driver, never with each other.
    if(principal.userId!==parts.driver&&reported!==parts.driver){
      throw new DomainError("REPORTED_USER_NOT_IN_TRIP","Passengers can only report the driver",400);
    }
  }

  const recent=await pool.query(`
    select count(*)::int as n from incident_reports
     where reporter_user_id=$1 and created_at>now()-interval '1 day'`,[principal.userId]);
  if(recent.rows[0].n>=MAX_REPORTS_PER_DAY){
    throw new DomainError("REPORT_RATE_LIMITED","Too many reports in the last 24 hours",429);
  }

  const client=await pool.connect();
  try{
    await client.query("begin");
    const r=await client.query(`
      insert into incident_reports(reporter_user_id,reported_user_id,trip_id,category,description)
      values($1,$2,$3,$4,$5)
      returning id,trip_id,reported_user_id,category,description,status,created_at`,
      [principal.userId,reported,input.tripId,input.category,description]);
    if(input.blockUser&&reported){
      await client.query(`
        insert into user_blocks(blocker_user_id,blocked_user_id) values($1,$2)
        on conflict do nothing`,[principal.userId,reported]);
    }
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'incident_report.created','incident_report',$2,$3)`,
      [principal.userId,r.rows[0].id,{category:input.category,tripId:input.tripId,blocked:Boolean(input.blockUser&&reported)}]);
    await client.query("commit");
    return r.rows[0];
  }catch(e){
    await client.query("rollback");
    throw e;
  }finally{
    client.release();
  }
}

export async function listOwnReports(pool:Pool,principal:AuthPrincipal){
  return (await pool.query(`
    select id,trip_id,reported_user_id,category,description,status,resolution_note,created_at,resolved_at
      from incident_reports where reporter_user_id=$1 order by created_at desc limit 50`,[principal.userId])).rows;
}

export async function listOwnBlocks(pool:Pool,principal:AuthPrincipal){
  return (await pool.query(`
    select b.blocked_user_id as user_id,p.display_name,b.created_at
      from user_blocks b left join profiles p on p.user_id=b.blocked_user_id
     where b.blocker_user_id=$1 order by b.created_at desc`,[principal.userId])).rows;
}

const SUPPORT_ROLES=["admin","support_admin"] as const;

export async function adminListReports(pool:Pool,principal:AuthPrincipal,status?:string){
  requireAnyRole(principal,SUPPORT_ROLES);
  return (await pool.query(`
    select ir.id,ir.trip_id,ir.category,ir.description,ir.status,ir.resolution_note,ir.created_at,ir.resolved_at,
           ir.reporter_user_id,rp.display_name as reporter_display_name,
           ir.reported_user_id,dp.display_name as reported_display_name
      from incident_reports ir
      left join profiles rp on rp.user_id=ir.reporter_user_id
      left join profiles dp on dp.user_id=ir.reported_user_id
     where ($1::report_status is null or ir.status=$1::report_status)
     order by ir.created_at asc limit 200`,[status??null])).rows;
}

export async function adminUpdateReport(
  pool:Pool,
  principal:AuthPrincipal,
  input:{reportId:string;status:"reviewing"|"resolved"|"dismissed";note?:string|null}
){
  requireAnyRole(principal,SUPPORT_ROLES);
  const note=input.note?.trim()||null;
  if(input.status!=="reviewing"&&!note){
    throw new DomainError("RESOLUTION_NOTE_REQUIRED","Closing a report requires a note",400);
  }
  const client=await pool.connect();
  try{
    await client.query("begin");
    const cur=await client.query(`select status,reporter_user_id,trip_id from incident_reports where id=$1 for update`,[input.reportId]);
    if(!cur.rowCount) throw new DomainError("REPORT_NOT_FOUND","Report not found",404);
    if(["resolved","dismissed"].includes(cur.rows[0].status)){
      throw new DomainError("REPORT_CLOSED","Report is already closed",409);
    }
    const closing=input.status!=="reviewing";
    const r=await client.query(`
      update incident_reports
         set status=$2,resolution_note=coalesce($3,resolution_note),
             resolved_by=case when $4 then $5::uuid else resolved_by end,
             resolved_at=case when $4 then now() else resolved_at end,
             updated_at=now()
       where id=$1
       returning id,status,resolution_note,resolved_at`,
      [input.reportId,input.status,note,closing,principal.userId]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'incident_report.status_changed','incident_report',$2,$3)`,
      [principal.userId,input.reportId,{from:cur.rows[0].status,to:input.status}]);
    if(closing){
      await notify(client,cur.rows[0].reporter_user_id,"report.closed",cur.rows[0].trip_id,{
        reportId:input.reportId,status:input.status,note
      });
    }
    await client.query("commit");
    return r.rows[0];
  }catch(e){
    await client.query("rollback");
    throw e;
  }finally{
    client.release();
  }
}
