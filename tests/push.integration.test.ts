import test,{after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { notify } from "../src/services/notification-service.js";
import {
  deliverPendingPushes,disabledPushProvider,registerPushDevice,unregisterPushDevice,type PushProvider
} from "../src/services/push-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});
const auth=(userId:string):AuthPrincipal=>({sessionId:crypto.randomUUID(),userId,roles:["passenger"],expiresAt:new Date(Date.now()+3600000).toISOString()});
const user=async()=>(await pool.query(`insert into app_users default values returning id`)).rows[0].id as string;
const outbox=async()=>(await pool.query(`select status,attempts,last_error from push_outbox order by id`)).rows;

beforeEach(async()=>{
  await pool.query(`truncate table push_outbox,push_devices,user_notifications,app_users restart identity cascade`);
});
after(async()=>{ await pool.end(); });

test("a notice is queued once per active device, in the same transaction as the notice",async()=>{
  const a=await user(),b=await user();
  await registerPushDevice(pool,auth(a),{platform:"ios",token:"ios-token-aaaaaaaa"});
  await registerPushDevice(pool,auth(a),{platform:"android",token:"android-token-aaaa"});
  await notify(pool,[a,b],"trip.started",null,{driverName:"Ana"});
  assert.equal((await outbox()).length,2);

  const client=await pool.connect();
  try{
    await client.query("begin");
    await notify(client,a,"trip.completed",null);
    await client.query("rollback");
  }finally{ client.release(); }
  assert.equal((await outbox()).length,2);

  await unregisterPushDevice(pool,auth(a),"android-token-aaaa");
  await notify(pool,a,"trip.completed",null);
  assert.equal((await outbox()).length,3);
});

test("a token signed in on another account moves to that account",async()=>{
  const a=await user(),b=await user();
  await registerPushDevice(pool,auth(a),{platform:"ios",token:"shared-phone-token"});
  await registerPushDevice(pool,auth(b),{platform:"ios",token:"shared-phone-token"});
  await notify(pool,a,"trip.started",null);
  assert.equal((await outbox()).length,0);
  await notify(pool,b,"trip.started",null);
  assert.equal((await outbox()).length,1);
  assert.deepEqual(await unregisterPushDevice(pool,auth(a),"shared-phone-token"),{unregistered:false});
});

test("without a provider nothing is sent and old notices expire; with one, bad tokens are switched off",async()=>{
  const a=await user();
  await registerPushDevice(pool,auth(a),{platform:"ios",token:"good-token-xxxxxx"});
  await registerPushDevice(pool,auth(a),{platform:"android",token:"dead-token-xxxxxx"});
  await notify(pool,a,"trip.driver_arriving",null,{driverName:"Ana"});
  assert.deepEqual(await deliverPendingPushes(pool,disabledPushProvider),{sent:0,failed:0,expired:0});
  assert.deepEqual((await outbox()).map(r=>r.status),["pending","pending"]);

  const sent:string[]=[];
  const provider:PushProvider={name:"fake",async send(m){
    if(m.token.startsWith("dead")) return {ok:false,error:"unregistered",tokenInvalid:true};
    sent.push(`${m.title}|${m.body}`);
    return {ok:true};
  }};
  assert.deepEqual(await deliverPendingPushes(pool,provider),{sent:1,failed:1,expired:0});
  assert.deepEqual(sent,["Tu conductor está llegando|Prepárate en el punto de recogida."]);
  assert.deepEqual((await outbox()).map(r=>r.status),["sent","failed"]);
  assert.ok((await pool.query(`select disabled_at from push_devices where token='dead-token-xxxxxx'`)).rows[0].disabled_at);

  await notify(pool,a,"trip.completed",null);
  await pool.query(`update push_outbox set created_at=now()-interval '2 hours' where status='pending'`);
  assert.deepEqual(await deliverPendingPushes(pool,disabledPushProvider),{sent:0,failed:0,expired:1});
});
