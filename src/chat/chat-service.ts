import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { DomainError } from "../errors.js";

async function confirmedPassenger(
  pool:Pool,
  tripId:string,
  userId:string
):Promise<boolean>{
  const result=await pool.query(`
    select 1
      from bookings b
      join ride_requests r on r.id=b.request_id
     where r.trip_id=$1
       and r.passenger_user_id=$2
       and r.status='confirmed'
       and b.status in ('confirmed','completed')
     limit 1
  `,[tripId,userId]);
  return Boolean(result.rowCount);
}

async function assertTripDirectConversation(
  pool:Pool,
  principal:AuthPrincipal,
  tripId:string,
  peerUserId:string
):Promise<void>{
  if(principal.userId===peerUserId){
    throw new DomainError("CHAT_SELF_FORBIDDEN","Cannot open a trip chat with yourself",400);
  }

  const trip=await pool.query(`select driver_user_id from trips where id=$1`,[tripId]);
  if(!trip.rowCount) throw new DomainError("TRIP_NOT_FOUND","Trip not found",404);
  const driverUserId=trip.rows[0].driver_user_id as string;

  const principalIsDriver=principal.userId===driverUserId;
  const peerIsDriver=peerUserId===driverUserId;

  let allowed=false;
  if(principalIsDriver && !peerIsDriver){
    allowed=await confirmedPassenger(pool,tripId,peerUserId);
  }else if(peerIsDriver && !principalIsDriver){
    allowed=await confirmedPassenger(pool,tripId,principal.userId);
  }

  if(!allowed){
    throw new DomainError(
      "CHAT_FORBIDDEN",
      "Trip chat is only available between the driver and a confirmed passenger",
      403
    );
  }

  const block=await pool.query(`
    select 1 from user_blocks
     where (blocker_user_id=$1 and blocked_user_id=$2)
        or (blocker_user_id=$2 and blocked_user_id=$1)
     limit 1
  `,[principal.userId,peerUserId]);
  if(block.rowCount){
    throw new DomainError("CHAT_BLOCKED","Chat is unavailable because one participant blocked the other",403);
  }
}

function normalizeBody(value:string):string{
  const body=value.trim();
  if(body.length<1||body.length>2000){
    throw new DomainError("INVALID_CHAT_MESSAGE","Message must contain 1 to 2000 characters");
  }
  return body;
}

export async function sendTripDirectMessage(
  pool:Pool,
  principal:AuthPrincipal,
  input:{tripId:string;peerUserId:string;clientMessageId:string;body:string}
){
  await assertTripDirectConversation(pool,principal,input.tripId,input.peerUserId);
  const body=normalizeBody(input.body);

  const inserted=await pool.query(`
    insert into trip_direct_messages(
      trip_id,sender_user_id,recipient_user_id,client_message_id,body
    ) values($1,$2,$3,$4,$5)
    on conflict(sender_user_id,client_message_id) do nothing
    returning id,trip_id,sender_user_id,recipient_user_id,client_message_id,body,created_at
  `,[input.tripId,principal.userId,input.peerUserId,input.clientMessageId,body]);

  if(inserted.rowCount){
    const row=inserted.rows[0];
    await pool.query(`
      insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
      values($1,'chat.message.sent','trip_direct_message',$2,$3::jsonb)
    `,[principal.userId,row.id,JSON.stringify({tripId:input.tripId,recipientUserId:input.peerUserId})]);
    return {...row,duplicate:false};
  }

  const existing=await pool.query(`
    select id,trip_id,sender_user_id,recipient_user_id,client_message_id,body,created_at
      from trip_direct_messages
     where sender_user_id=$1 and client_message_id=$2
  `,[principal.userId,input.clientMessageId]);
  const row=existing.rows[0];
  if(!row) throw new Error("duplicate chat message disappeared");
  if(row.trip_id!==input.tripId||row.recipient_user_id!==input.peerUserId||row.body!==body){
    throw new DomainError("CHAT_IDEMPOTENCY_CONFLICT","clientMessageId was already used for different content",409);
  }
  return {...row,duplicate:true};
}

export async function listTripDirectMessages(
  pool:Pool,
  principal:AuthPrincipal,
  input:{tripId:string;peerUserId:string;limit?:number}
){
  await assertTripDirectConversation(pool,principal,input.tripId,input.peerUserId);
  const limit=input.limit ?? 50;
  if(!Number.isInteger(limit)||limit<1||limit>100){
    throw new DomainError("INVALID_CHAT_LIMIT","Chat limit must be between 1 and 100");
  }
  return (await pool.query(`
    select * from (
      select id,trip_id,sender_user_id,recipient_user_id,client_message_id,body,created_at
        from trip_direct_messages
       where trip_id=$1
         and (
           (sender_user_id=$2 and recipient_user_id=$3)
           or
           (sender_user_id=$3 and recipient_user_id=$2)
         )
       order by created_at desc,id desc
       limit $4
    ) latest
     order by created_at asc,id asc
  `,[input.tripId,principal.userId,input.peerUserId,limit])).rows;
}

export async function blockUser(
  pool:Pool,
  principal:AuthPrincipal,
  blockedUserId:string
):Promise<void>{
  if(principal.userId===blockedUserId){
    throw new DomainError("BLOCK_SELF_FORBIDDEN","Cannot block yourself");
  }
  const exists=await pool.query(`select 1 from app_users where id=$1`,[blockedUserId]);
  if(!exists.rowCount) throw new DomainError("USER_NOT_FOUND","User not found",404);

  await pool.query(`
    insert into user_blocks(blocker_user_id,blocked_user_id)
    values($1,$2) on conflict do nothing
  `,[principal.userId,blockedUserId]);
  await pool.query(`
    insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values($1,'user.blocked','user',$2,'{}'::jsonb)
  `,[principal.userId,blockedUserId]);
}

export async function unblockUser(
  pool:Pool,
  principal:AuthPrincipal,
  blockedUserId:string
):Promise<void>{
  await pool.query(`
    delete from user_blocks where blocker_user_id=$1 and blocked_user_id=$2
  `,[principal.userId,blockedUserId]);
  await pool.query(`
    insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
    values($1,'user.unblocked','user',$2,'{}'::jsonb)
  `,[principal.userId,blockedUserId]);
}
