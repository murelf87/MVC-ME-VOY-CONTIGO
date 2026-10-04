import crypto from "node:crypto";
import type { Pool,PoolClient } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { requireAnyRole } from "../auth/session.js";
import { DomainError } from "../errors.js";

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

function hashCode(salt:string,code:string):string{
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

function secureEqual(a:string,b:string):boolean{
  if(a.length!==b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));
}

export async function startOwnedTrip(pool:Pool,principal:AuthPrincipal,tripId:string){
  requireAnyRole(principal,["driver"]);
  return tx(pool,async client=>{
    const q=await client.query(`select driver_user_id,status from trips where id=$1 for update`,[tripId]);
    const trip=q.rows[0];
    if(!trip) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
    if(trip.driver_user_id!==principal.userId){
      throw new DomainError("TRIP_NOT_OWNED","Only the trip driver may start it",403);
    }
    if(trip.status!=="published"){
      throw new DomainError("TRIP_NOT_STARTABLE","Only a published trip may be started",409);
    }
    const result=await client.query(`
      update trips set status='active',started_at=now(),updated_at=now()
       where id=$1
       returning id,status,started_at
    `,[tripId]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'trip.started','trip',$2,'{}'::jsonb)
    `,[principal.userId,tripId]);
    return result.rows[0];
  });
}

export async function generateOwnPickupCode(
  pool:Pool,
  principal:AuthPrincipal,
  bookingId:string
):Promise<{bookingId:string;code:string;generatedAt:string}>{
  requireAnyRole(principal,["passenger"]);
  return tx(pool,async client=>{
    const q=await client.query(`
      select b.id,b.status,r.passenger_user_id,t.status as trip_status
        from bookings b
        join ride_requests r on r.id=b.request_id
        join trips t on t.id=r.trip_id
       where b.id=$1
       for update of b
    `,[bookingId]);
    const booking=q.rows[0];
    if(!booking) throw new DomainError("BOOKING_NOT_FOUND","Booking not found",404);
    if(booking.passenger_user_id!==principal.userId){
      throw new DomainError("BOOKING_NOT_OWNED","Only the booked passenger may generate the pickup code",403);
    }
    if(booking.status!=="confirmed"){
      throw new DomainError("BOOKING_NOT_PICKUP_ELIGIBLE","Booking is not eligible for pickup verification",409);
    }
    if(booking.trip_status!=="active"){
      throw new DomainError("TRIP_NOT_LIVE","Pickup code is available only while the trip is active",409);
    }

    const code=crypto.randomInt(100000,1000000).toString();
    const salt=crypto.randomBytes(16).toString("base64url");
    const codeHash=hashCode(salt,code);
    const stored=await client.query(`
      insert into booking_pickup_codes(booking_id,salt,code_hash,attempts,max_attempts,generated_at,verified_at)
      values($1,$2,$3,0,5,now(),null)
      on conflict(booking_id) do update
        set salt=excluded.salt,code_hash=excluded.code_hash,attempts=0,max_attempts=5,
            generated_at=now(),verified_at=null
      returning generated_at
    `,[bookingId,salt,codeHash]);

    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'pickup_code.generated','booking',$2,'{}'::jsonb)
    `,[principal.userId,bookingId]);

    return {
      bookingId,
      code,
      generatedAt:new Date(stored.rows[0].generated_at).toISOString()
    };
  });
}

export async function verifyPickupCode(
  pool:Pool,
  principal:AuthPrincipal,
  bookingId:string,
  code:string
){
  requireAnyRole(principal,["driver"]);
  if(!/^\d{6}$/.test(code)){
    throw new DomainError("INVALID_PICKUP_CODE","Pickup code must contain exactly 6 digits");
  }

  return tx(pool,async client=>{
    const q=await client.query(`
      select b.id,b.status,b.picked_up_at,r.trip_id,t.driver_user_id,t.status as trip_status
        from bookings b
        join ride_requests r on r.id=b.request_id
        join trips t on t.id=r.trip_id
       where b.id=$1
       for update of b,t
    `,[bookingId]);
    const booking=q.rows[0];
    if(!booking) throw new DomainError("BOOKING_NOT_FOUND","Booking not found",404);
    if(booking.driver_user_id!==principal.userId){
      throw new DomainError("TRIP_NOT_OWNED","Only the trip driver may verify pickup",403);
    }
    if(booking.trip_status!=="active"){
      throw new DomainError("TRIP_NOT_LIVE","Pickup may only be verified during an active trip",409);
    }
    if(booking.status!=="confirmed"){
      throw new DomainError("BOOKING_NOT_PICKUP_ELIGIBLE","Booking is not eligible for pickup verification",409);
    }
    if(booking.picked_up_at){
      return {bookingId,pickedUpAt:new Date(booking.picked_up_at).toISOString(),alreadyVerified:true};
    }

    const codeQ=await client.query(`
      select * from booking_pickup_codes where booking_id=$1 for update
    `,[bookingId]);
    const stored=codeQ.rows[0];
    if(!stored) throw new DomainError("PICKUP_CODE_NOT_GENERATED","Passenger has not generated a pickup code",409);
    if(stored.verified_at){
      return {bookingId,pickedUpAt:new Date(stored.verified_at).toISOString(),alreadyVerified:true};
    }
    if(stored.attempts>=stored.max_attempts){
      throw new DomainError("PICKUP_ATTEMPTS_EXCEEDED","Maximum pickup code attempts exceeded",429);
    }

    const actual=hashCode(stored.salt,code);
    if(!secureEqual(actual,stored.code_hash)){
      await client.query(`
        update booking_pickup_codes set attempts=attempts+1 where booking_id=$1
      `,[bookingId]);
      throw new DomainError("PICKUP_CODE_INVALID","Pickup code is invalid",401);
    }

    const picked=await client.query(`
      update bookings set picked_up_at=now(),updated_at=now()
       where id=$1 returning picked_up_at
    `,[bookingId]);
    await client.query(`
      update booking_pickup_codes set verified_at=$2 where booking_id=$1
    `,[bookingId,picked.rows[0].picked_up_at]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'pickup.verified','booking',$2,$3::jsonb)
    `,[principal.userId,bookingId,JSON.stringify({tripId:booking.trip_id})]);

    return {
      bookingId,
      pickedUpAt:new Date(picked.rows[0].picked_up_at).toISOString(),
      alreadyVerified:false
    };
  });
}

export async function completeOwnedTrip(pool:Pool,principal:AuthPrincipal,tripId:string){
  requireAnyRole(principal,["driver"]);
  return tx(pool,async client=>{
    const q=await client.query(`select driver_user_id,status from trips where id=$1 for update`,[tripId]);
    const trip=q.rows[0];
    if(!trip) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
    if(trip.driver_user_id!==principal.userId){
      throw new DomainError("TRIP_NOT_OWNED","Only the trip driver may complete it",403);
    }
    if(trip.status!=="active"){
      throw new DomainError("TRIP_NOT_COMPLETABLE","Only an active trip may be completed",409);
    }

    await client.query(`
      update bookings b
         set status=case when b.picked_up_at is null then 'no_show'::booking_status else 'completed'::booking_status end,
             updated_at=now()
        from ride_requests r
       where b.request_id=r.id and r.trip_id=$1 and b.status='confirmed'
    `,[tripId]);
    const done=await client.query(`
      update trips set status='completed',completed_at=now(),updated_at=now()
       where id=$1 returning id,status,completed_at
    `,[tripId]);
    await client.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'trip.completed','trip',$2,'{}'::jsonb)
    `,[principal.userId,tripId]);
    return done.rows[0];
  });
}
