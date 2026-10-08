import type { Pool, PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { DomainError } from "../errors.js";
import type { PrivateObjectStorage } from "../storage/private-object-storage.js";
import { driverBalances } from "./ledger-service.js";

/**
 * Self-service account deletion (required by both app stores).
 *
 * What goes at once: email, password, phone number, name, photos and private documents, sessions, roles, inbox,
 * push devices, blocks and unfinished drafts. What stays, tied to an id that no longer identifies anyone through
 * MVC: trips, bookings, payments, ledger, ratings, reports, chat and GPS history of past trips,
 * because accounting and safety investigations need them. How long those are kept and when they
 * are finally purged is a legal decision still pending (docs/ACCOUNT_DELETION.md).
 */
async function tx<T>(pool:Pool,fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const client=await pool.connect();
  try{
    await client.query("begin");
    const value=await fn(client);
    await client.query("commit");
    return value;
  }catch(error){
    await client.query("rollback");
    throw error;
  }finally{
    client.release();
  }
}

/** Anything that would leave another person stranded or money unsettled if the account vanished now. */
export async function accountDeletionBlockers(db:Pool|PoolClient,userId:string){
  const one=async(sql:string)=>Number((await db.query(sql,[userId])).rows[0].n);
  const blockers:{code:string;count:number}[]=[];
  const add=(code:string,count:number)=>{ if(count>0) blockers.push({code,count}); };
  add("OPEN_TRIPS_AS_DRIVER",await one(`
    select count(*)::int as n from trips where driver_user_id=$1 and status in ('published','active')`));
  add("OPEN_BOOKINGS",await one(`
    select count(*)::int as n from ride_requests r join trips t on t.id=r.trip_id
     where r.passenger_user_id=$1 and r.status in ('pending','accepted','payment_pending','confirmed')
       and t.status in ('draft','published','active')`));
  add("REFUNDS_PENDING",await one(`
    select count(*)::int as n from booking_cancellations c join bookings b on b.id=c.booking_id
      join ride_requests r on r.id=b.request_id
     where r.passenger_user_id=$1 and c.refund_status in ('pending_policy','pending_provider')`)
    +await one(`
    select count(*)::int as n from payment_compensations c join ride_requests r on r.id=c.request_id
     where r.passenger_user_id=$1 and c.status='pending'`));
  const b=await driverBalances(db,userId);
  add("DRIVER_BALANCE_UNSETTLED",(b.pendingCents||b.availableCents||b.inTransitCents)?1:0);
  add("LAST_ADMIN",await one(`
    select case when exists(select 1 from user_roles where user_id=$1 and role='admin')
                 and (select count(*) from user_roles ur join app_users u on u.id=ur.user_id
                       where ur.role='admin' and u.status='active')=1 then 1 else 0 end as n`));
  return blockers;
}

export async function ownAccountDeletionCheck(pool:Pool,principal:AuthPrincipal){
  const blockers=await accountDeletionBlockers(pool,principal.userId);
  return {canDelete:blockers.length===0,blockers};
}

export async function deleteOwnAccount(pool:Pool,principal:AuthPrincipal,input:{confirm:string}){
  if(input.confirm!=="BORRAR"){
    throw new DomainError("ACCOUNT_DELETION_NOT_CONFIRMED","Type BORRAR to confirm",400);
  }
  return tx(pool,async client=>{
    const u=(await client.query(`select id,status from app_users where id=$1 for update`,[principal.userId])).rows[0];
    if(!u||u.status==="deleted") throw new DomainError("ACCOUNT_ALREADY_DELETED","Account already deleted",409);
    if(principal.roles.includes("admin")) await client.query(`lock table user_roles in share row exclusive mode`);
    const blockers=await accountDeletionBlockers(client,principal.userId);
    if(blockers.length){
      throw new DomainError("ACCOUNT_HAS_OPEN_ACTIVITY","Finish or cancel open trips and settle money first",409,{blockers});
    }

    // Files: queue every private object for removal from storage, then forget them here.
    await client.query(`
      insert into storage_purge_queue(storage_provider,storage_key,reason)
      select storage_provider,storage_key,'account_deleted' from private_documents where owner_user_id=$1
      union
      select storage_provider,storage_key,'account_deleted' from private_upload_intents where owner_user_id=$1
      on conflict(storage_provider,storage_key) do nothing`,[principal.userId]);
    await client.query(`
      update vehicles set vehicle_photo_document_id=null,insurance_document_id=null,updated_at=now()
       where driver_user_id=$1`,[principal.userId]);
    await client.query(`delete from private_documents where owner_user_id=$1`,[principal.userId]);
    await client.query(`delete from private_upload_intents where owner_user_id=$1`,[principal.userId]);

    // Identity: no phone, no name, no photo. Ratings and trips now point at an anonymous id.
    await client.query(`
      update profiles set display_name=null,public_photo_key=null,private_selfie_key=null,updated_at=now()
       where user_id=$1`,[principal.userId]);
    await client.query(`delete from auth_email_codes where user_id=$1`,[principal.userId]);
    await client.query(`
      update app_users set status='deleted',phone_e164=null,email=null,password_hash=null,deleted_at=now(),updated_at=now() where id=$1`,[principal.userId]);

    // Access and personal lists.
    await client.query(`delete from auth_sessions where user_id=$1`,[principal.userId]);
    await client.query(`delete from user_roles where user_id=$1`,[principal.userId]);
    await client.query(`delete from user_notifications where user_id=$1`,[principal.userId]);
    await client.query(`delete from push_devices where user_id=$1`,[principal.userId]);
    await client.query(`delete from user_blocks where blocker_user_id=$1 or blocked_user_id=$1`,[principal.userId]);

    // Unfinished things nobody else depends on.
    await client.query(`update trips set status='cancelled',updated_at=now() where driver_user_id=$1 and status='draft'`,[principal.userId]);
    await client.query(`update trip_series set status='ended',updated_at=now() where driver_user_id=$1 and status<>'ended'`,[principal.userId]);
    await client.query(`
      update route_change_proposals set status='cancelled'
       where requester_user_id=$1 and status in ('awaiting_driver','awaiting_passengers')`,[principal.userId]);

    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'user.deleted','user',$2,'{}'::jsonb)`,[principal.userId,principal.userId]);
    return {deleted:true};
  });
}

/** Removes queued private files from storage; safe to run repeatedly. */
export async function purgeQueuedStorage(pool:Pool,storage:PrivateObjectStorage,limit=200){
  const rows=(await pool.query(`
    select id,storage_key from storage_purge_queue
     where purged_at is null and storage_provider=$1 order by id limit $2`,[storage.providerName,limit])).rows;
  let purged=0,failed=0;
  for(const r of rows){
    try{
      await storage.deleteObject(r.storage_key);
      await pool.query(`update storage_purge_queue set purged_at=now(),attempts=attempts+1,last_error=null where id=$1`,[r.id]);
      purged++;
    }catch(e){
      await pool.query(`update storage_purge_queue set attempts=attempts+1,last_error=$2 where id=$1`,
        [r.id,e instanceof Error?e.message.slice(0,500):"unknown"]);
      failed++;
    }
  }
  return {purged,failed};
}
