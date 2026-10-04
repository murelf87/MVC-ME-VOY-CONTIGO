import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import {
  blockUser,
  listTripDirectMessages,
  sendTripDirectMessage,
  unblockUser
} from "../src/chat/chat-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}

async function seed(){
  const driver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const passenger=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const otherPassenger=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const pending=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  for(const id of [driver,passenger,otherPassenger,pending]){
    await pool.query(`insert into profiles(user_id) values($1)`,[id]);
  }
  const province=(await pool.query(`
    insert into provinces(code,name,source_name,geom)
    values('CHT','Chat Province','integration-test',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
    returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats)
    values($1,'Test','Car','CHAT-1',4) returning id`,[driver])).rows[0].id;
  const trip=(await pool.query(`
    insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats)
    values($1,$2,$3,'work','single','outbound','draft',4) returning id`,[driver,vehicle,province])).rows[0].id;

  for(const p of [passenger,otherPassenger]){
    const request=(await pool.query(`
      insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
      values($1,$2,0,1,'confirmed') returning id`,[trip,p])).rows[0].id;
    await pool.query(`
      insert into bookings(request_id,provider_payment_id,amount_cents,status)
      values($1,$2,100,'confirmed')`,[request,`chat-pay-${crypto.randomUUID()}`]);
  }
  await pool.query(`
    insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
    values($1,$2,0,1,'pending')`,[trip,pending]);

  return {driver,passenger,otherPassenger,pending,trip};
}

before(async()=>{await pool.query("select 1 from trip_direct_messages limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table trip_direct_messages,user_blocks,trip_live_state,trip_location_events,
      private_documents,audit_events,route_change_acceptances,route_change_proposals,
      quote_snapshots,tariff_versions,payment_compensations,bookings,seat_holds,ride_requests,
      trip_segments,trip_stops,trips,vehicles,profiles,user_roles,auth_sessions,auth_challenges,
      app_users,province_dataset_imports,provinces restart identity cascade`);
});
after(async()=>{await pool.end()});

test("confirmed passenger and driver can exchange direct trip messages",async()=>{
  const s=await seed();
  const sent=await sendTripDirectMessage(pool,auth(s.passenger,["passenger"]),{
    tripId:s.trip,peerUserId:s.driver,clientMessageId:crypto.randomUUID(),body:"Estoy en el punto de recogida"
  });
  assert.equal(sent.duplicate,false);
  const messages=await listTripDirectMessages(pool,auth(s.driver,["driver"]),{
    tripId:s.trip,peerUserId:s.passenger
  });
  assert.equal(messages.length,1);
  assert.equal(messages[0].body,"Estoy en el punto de recogida");
});

test("pending passenger cannot access trip chat",async()=>{
  const s=await seed();
  await assert.rejects(
    ()=>sendTripDirectMessage(pool,auth(s.pending,["passenger"]),{
      tripId:s.trip,peerUserId:s.driver,clientMessageId:crypto.randomUUID(),body:"Hola"
    }),
    (e:unknown)=>e instanceof DomainError&&e.code==="CHAT_FORBIDDEN"
  );
});

test("passengers cannot open direct trip chat with each other",async()=>{
  const s=await seed();
  await assert.rejects(
    ()=>listTripDirectMessages(pool,auth(s.passenger,["passenger"]),{
      tripId:s.trip,peerUserId:s.otherPassenger
    }),
    (e:unknown)=>e instanceof DomainError&&e.code==="CHAT_FORBIDDEN"
  );
});

test("clientMessageId makes message send idempotent and detects conflicting reuse",async()=>{
  const s=await seed();
  const id=crypto.randomUUID();
  const input={tripId:s.trip,peerUserId:s.driver,clientMessageId:id,body:"Mensaje único"};
  const a=await sendTripDirectMessage(pool,auth(s.passenger,["passenger"]),input);
  const b=await sendTripDirectMessage(pool,auth(s.passenger,["passenger"]),input);
  assert.equal(a.id,b.id);
  assert.equal(b.duplicate,true);
  await assert.rejects(
    ()=>sendTripDirectMessage(pool,auth(s.passenger,["passenger"]),{...input,body:"Texto distinto"}),
    (e:unknown)=>e instanceof DomainError&&e.code==="CHAT_IDEMPOTENCY_CONFLICT"
  );
});

test("block in either direction disables trip chat until blocker removes it",async()=>{
  const s=await seed();
  await blockUser(pool,auth(s.passenger,["passenger"]),s.driver);
  await assert.rejects(
    ()=>sendTripDirectMessage(pool,auth(s.driver,["driver"]),{
      tripId:s.trip,peerUserId:s.passenger,clientMessageId:crypto.randomUUID(),body:"No debe enviarse"
    }),
    (e:unknown)=>e instanceof DomainError&&e.code==="CHAT_BLOCKED"
  );
  await unblockUser(pool,auth(s.passenger,["passenger"]),s.driver);
  const sent=await sendTripDirectMessage(pool,auth(s.driver,["driver"]),{
    tripId:s.trip,peerUserId:s.passenger,clientMessageId:crypto.randomUUID(),body:"Disponible de nuevo"
  });
  assert.equal(sent.duplicate,false);
});
