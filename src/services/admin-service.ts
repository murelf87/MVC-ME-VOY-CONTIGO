import type { Pool } from "pg";
import type { AuthPrincipal, UserRole } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";

export const ADMIN_ROLES=["admin","verification_admin","finance_admin","support_admin"] as const;
type AdminRole=typeof ADMIN_ROLES[number];

function has(principal:AuthPrincipal,roles:readonly UserRole[]){
  return principal.roles.some(r=>roles.includes(r));
}

/** Phone numbers are shown masked in admin lists; support rarely needs the full number. */
export function maskPhone(phone:string|null):string|null{
  if(!phone) return null;
  return phone.length<=6?phone:`${phone.slice(0,5)}${"•".repeat(Math.max(0,phone.length-8))}${phone.slice(-3)}`;
}

async function audit(pool:Pool,actor:string,action:string,entityType:string,entityId:string,metadata:Record<string,unknown>){
  await pool.query(`
    insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values($1,$2,$3,$4,$5)`,[actor,action,entityType,entityId,metadata]);
}

/** Each counter is only returned to roles allowed to act on it. */
export async function adminOverview(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,ADMIN_ROLES);
  const q=(await pool.query(`
    select
      (select count(*)::int from vehicles
        where 'pending' in (review_status,documentation_status,vehicle_photo_status,insurance_status)) as pending_vehicles,
      (select count(*)::int from private_documents where review_status='pending') as pending_documents,
      (select count(*)::int from profiles
        where public_photo_status='pending' and public_photo_key is not null
           or identity_status='pending') as pending_profiles,
      (select count(*)::int from incident_reports where status in ('open','reviewing')) as open_reports,
      (select count(*)::int from booking_cancellations where refund_status in ('pending_policy','pending_provider')) as pending_refunds,
      (select count(*)::int from payment_compensations where status='pending') as pending_compensations,
      (select count(*)::int from trips where status='active') as active_trips,
      (select count(*)::int from trips where status='published') as published_trips,
      (select count(*)::int from app_users where status='active') as active_users,
      (select version from cancellation_policy_versions where status='active') as active_policy_version,
      (select version from tariff_versions where status='approved') as approved_tariff_version`)).rows[0];
  const verification=has(principal,["admin","verification_admin"]);
  const finance=has(principal,["admin","finance_admin"]);
  const support=has(principal,["admin","support_admin"]);
  return {
    roles:principal.roles.filter(r=>(ADMIN_ROLES as readonly string[]).includes(r)),
    verification:verification?{pendingVehicles:q.pending_vehicles,pendingDocuments:q.pending_documents,pendingProfiles:q.pending_profiles}:null,
    support:support?{openReports:q.open_reports,activeTrips:q.active_trips,publishedTrips:q.published_trips,activeUsers:q.active_users}:null,
    finance:finance?{pendingRefunds:q.pending_refunds,pendingCompensations:q.pending_compensations,activePolicyVersion:q.active_policy_version,approvedTariffVersion:q.approved_tariff_version}:null
  };
}

export async function adminVerificationQueue(pool:Pool,principal:AuthPrincipal){
  requireAnyRole(principal,["admin","verification_admin"]);
  const vehicles=(await pool.query(`
    select v.id,v.make,v.model,v.plate,v.passenger_seats,v.review_status,v.documentation_status,
           v.vehicle_photo_status,v.insurance_status,v.insurance_expires_on,v.created_at,
           v.driver_user_id,p.display_name as driver_display_name
      from vehicles v left join profiles p on p.user_id=v.driver_user_id
     where 'pending' in (v.review_status,v.documentation_status,v.vehicle_photo_status,v.insurance_status)
     order by v.created_at asc limit 100`)).rows;
  const documents=(await pool.query(`
    select d.id,d.kind,d.vehicle_id,d.content_type,d.size_bytes,d.created_at,
           d.owner_user_id,p.display_name as owner_display_name
      from private_documents d left join profiles p on p.user_id=d.owner_user_id
     where d.review_status='pending' order by d.created_at asc limit 100`)).rows;
  const profiles=(await pool.query(`
    select p.user_id,p.display_name,p.public_photo_status,p.identity_status,p.updated_at,u.phone_e164
      from profiles p join app_users u on u.id=p.user_id
     where (p.public_photo_status='pending' and p.public_photo_key is not null) or p.identity_status='pending'
     order by p.updated_at asc limit 100`)).rows.map(r=>({...r,phone_e164:maskPhone(r.phone_e164)}));
  return {vehicles,documents,profiles};
}

export async function adminReviewProfile(
  pool:Pool,principal:AuthPrincipal,
  input:{userId:string;area:"photo"|"identity";decision:"approved"|"rejected";reason?:string|null}
){
  requireAnyRole(principal,["admin","verification_admin"]);
  if(input.userId===principal.userId) throw new DomainError("SELF_REVIEW_FORBIDDEN","You cannot review your own profile",403);
  const reason=input.reason?.trim()||null;
  if(input.decision==="rejected"&&(!reason||reason.length<3)){
    throw new DomainError("REVIEW_REASON_REQUIRED","A rejection reason is required");
  }
  const sql=input.area==="photo"
    ?`update profiles set public_photo_status=$2::profile_review_status,updated_at=now() where user_id=$1
       returning user_id,public_photo_status,identity_status`
    :`update profiles set identity_status=(case when $2='approved' then 'verified' else 'rejected' end)::identity_status,updated_at=now()
       where user_id=$1 returning user_id,public_photo_status,identity_status`;
  const r=await pool.query(sql,[input.userId,input.decision]);
  if(!r.rowCount) throw new DomainError("USER_NOT_FOUND","User not found",404);
  await audit(pool,principal.userId,"profile.reviewed","user",input.userId,{area:input.area,decision:input.decision,reason});
  return r.rows[0];
}

export async function adminSearchUsers(pool:Pool,principal:AuthPrincipal,query?:string){
  requireAnyRole(principal,["admin","support_admin","verification_admin"]);
  const qtext=(query??"").trim();
  const digits=qtext.replace(/\D/g,"");
  const rows=(await pool.query(`
    select u.id,u.phone_e164,u.status,u.created_at,p.display_name,p.public_photo_status,p.identity_status,
           coalesce(array_agg(ur.role::text order by ur.role::text) filter (where ur.role is not null),'{}'::text[]) as roles,
           (select count(*)::int from incident_reports ir where ir.reported_user_id=u.id) as reports_against,
           (select round(avg(score)::numeric,1)::float8 from trip_ratings tr where tr.rated_user_id=u.id) as rating
      from app_users u
      left join profiles p on p.user_id=u.id
      left join user_roles ur on ur.user_id=u.id
     where $1='' or p.display_name ilike '%'||$1||'%' or ($2<>'' and u.phone_e164 like '%'||$2)
     group by u.id,p.user_id
     order by u.created_at desc limit 50`,[qtext,digits.length>=3?digits:""])).rows;
  return rows.map(r=>({...r,phone_e164:maskPhone(r.phone_e164)}));
}

export async function adminSetUserStatus(
  pool:Pool,principal:AuthPrincipal,input:{userId:string;status:"active"|"suspended";reason:string}
){
  requireAnyRole(principal,["admin"]);
  if(input.userId===principal.userId) throw new DomainError("SELF_SUSPEND_FORBIDDEN","You cannot change your own status",403);
  const reason=input.reason.trim();
  if(reason.length<3) throw new DomainError("REASON_REQUIRED","A reason is required");
  const r=await pool.query(`
    update app_users set status=$2::user_status,updated_at=now() where id=$1 and status<>'deleted'
    returning id,status`,[input.userId,input.status]);
  if(!r.rowCount) throw new DomainError("USER_NOT_FOUND","User not found",404);
  if(input.status==="suspended"){
    await pool.query(`update auth_sessions set revoked_at=coalesce(revoked_at,now()) where user_id=$1`,[input.userId]);
  }
  await audit(pool,principal.userId,`user.${input.status==="suspended"?"suspended":"reactivated"}`,"user",input.userId,{reason});
  return r.rows[0];
}

/** Only full admins grant staff roles, and nobody can remove their own admin role (no lock-out). */
export async function adminSetRole(
  pool:Pool,principal:AuthPrincipal,input:{userId:string;role:AdminRole;grant:boolean}
){
  requireAnyRole(principal,["admin"]);
  if(!(ADMIN_ROLES as readonly string[]).includes(input.role)) throw new DomainError("INVALID_ROLE","Unknown staff role");
  if(!input.grant&&input.userId===principal.userId&&input.role==="admin"){
    throw new DomainError("SELF_DEMOTION_FORBIDDEN","You cannot remove your own admin role",403);
  }
  const exists=await pool.query(`select 1 from app_users where id=$1`,[input.userId]);
  if(!exists.rowCount) throw new DomainError("USER_NOT_FOUND","User not found",404);
  if(input.grant){
    await pool.query(`insert into user_roles(user_id,role) values($1,$2) on conflict do nothing`,[input.userId,input.role]);
  }else{
    await pool.query(`delete from user_roles where user_id=$1 and role=$2`,[input.userId,input.role]);
  }
  await audit(pool,principal.userId,input.grant?"role.granted":"role.revoked","user",input.userId,{role:input.role});
  const roles=(await pool.query(`select role::text from user_roles where user_id=$1 order by role`,[input.userId])).rows.map(r=>r.role);
  return {userId:input.userId,roles};
}

export async function adminListTrips(pool:Pool,principal:AuthPrincipal,status?:string){
  requireAnyRole(principal,["admin","support_admin"]);
  return (await pool.query(`
    select t.id,t.status,t.departure_at,t.offered_seats,t.route_distance_m,t.started_at,t.completed_at,
           t.driver_user_id,p.display_name as driver_display_name,pr.name as province_name,
           (select count(*)::int from ride_requests r where r.trip_id=t.id) as requests,
           (select count(*)::int from bookings b join ride_requests r on r.id=b.request_id
             where r.trip_id=t.id and b.status in ('confirmed','completed')) as bookings
      from trips t
      left join profiles p on p.user_id=t.driver_user_id
      left join provinces pr on pr.id=t.province_id
     where ($1::trip_status is null or t.status=$1::trip_status) and t.status<>'draft'
     order by coalesce(t.departure_at,t.created_at) desc limit 100`,[status??null])).rows;
}

export async function adminListAudit(pool:Pool,principal:AuthPrincipal,input:{entityType?:string;limit?:number}){
  requireAnyRole(principal,["admin"]);
  const limit=Math.min(Math.max(input.limit??100,1),200);
  return (await pool.query(`
    select a.id,a.action,a.entity_type,a.entity_id,a.metadata,a.created_at,
           a.actor_user_id,p.display_name as actor_display_name
      from audit_events a left join profiles p on p.user_id=a.actor_user_id
     where ($1::text is null or a.entity_type=$1)
     order by a.id desc limit $2`,[input.entityType??null,limit])).rows;
}
