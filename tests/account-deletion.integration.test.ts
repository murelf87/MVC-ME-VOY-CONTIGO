import test,{after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { createSession,resolveSession } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import { deleteOwnAccount,ownAccountDeletionCheck,purgeQueuedStorage } from "../src/services/account-service.js";
import type { PrivateObjectStorage } from "../src/storage/private-object-storage.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;
const sha=crypto.createHash("sha256").update("x").digest("hex");

beforeEach(async()=>{
  await pool.query(`
    truncate table storage_purge_queue,ledger_entries,ledger_transactions,legal_acceptances,legal_documents,
      user_notifications,user_blocks,trip_location_events,trip_live_state,audit_events,quote_snapshots,payment_compensations,
      bookings,seat_holds,ride_requests,trip_segments,trip_stops,trip_series,trips,private_documents,private_upload_intents,
      vehicles,profiles,user_roles,auth_sessions,auth_email_codes,app_users,provinces
    restart identity cascade`);
});
after(async()=>{ await pool.end(); });

async function person(email:string,roles:string[],name:string){
  const id=(await pool.query(`insert into app_users(email,password_hash) values($1,'scrypt$x') returning id`,[email])).rows[0].id as string;
  await pool.query(`insert into profiles(user_id,display_name,public_photo_key,public_photo_status,identity_status)
    values($1,$2,$3,'approved','verified')`,[id,name,`public/${id}.jpg`]);
  for(const r of roles) await pool.query(`insert into user_roles(user_id,role) values($1,$2)`,[id,r]);
  return id;
}

async function driverWithFiles(){
  const d=await person("ana@mvc.test",["driver","passenger"],"Ana");
  const other=await person("luis@mvc.test",["passenger"],"Luis");
  const v=(await pool.query(`insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status)
    values($1,'SEAT','León','1234ABC',3,'approved','approved') returning id`,[d])).rows[0].id;
  const doc=(await pool.query(`insert into private_documents(owner_user_id,vehicle_id,kind,storage_provider,storage_key,content_type,size_bytes,sha256)
    values($1,$2,'vehicle_insurance','fake',$3,'image/jpeg',10,$4) returning id`,[d,v,`private/${d}/insurance.jpg`,sha])).rows[0].id;
  await pool.query(`update vehicles set insurance_document_id=$2 where id=$1`,[v,doc]);
  await pool.query(`insert into private_upload_intents(owner_user_id,vehicle_id,kind,storage_provider,storage_key,content_type,expected_size_bytes,expires_at)
    values($1,$2,'vehicle_photo','fake',$3,'image/jpeg',10,now()+interval '1 hour')`,[d,v,`private/${d}/photo.jpg`]);
  await pool.query(`insert into user_notifications(user_id,kind) values($1,'trip.started')`,[d]);
  await pool.query(`insert into user_blocks(blocker_user_id,blocked_user_id) values($1,$2)`,[other,d]);
  const province=(await pool.query(`insert into provinces(code,name,source_name,geom)
    values('DEL','Deletion Province','integration-test',ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326))) returning id`)).rows[0].id;
  return {d,other,v,province};
}

test("deleting removes identity, access and private files but keeps an anonymous history",async()=>{
  const s=await driverWithFiles();
  const draft=(await pool.query(`insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats)
    values($1,$2,$3,'work','single','outbound','draft',2) returning id`,[s.d,s.v,s.province])).rows[0].id;
  const client=await pool.connect();
  const {token}=await createSession(client,s.d,600);
  client.release();

  assert.deepEqual(await ownAccountDeletionCheck(pool,auth(s.d,["driver","passenger"])),{canDelete:true,blockers:[]});
  await assert.rejects(()=>deleteOwnAccount(pool,auth(s.d,["driver","passenger"]),{confirm:"si"}),code("ACCOUNT_DELETION_NOT_CONFIRMED"));
  assert.deepEqual(await deleteOwnAccount(pool,auth(s.d,["driver","passenger"]),{confirm:"BORRAR"}),{deleted:true});

  const u=(await pool.query(`select email,password_hash,status,deleted_at from app_users where id=$1`,[s.d])).rows[0];
  assert.equal(u.email,null);
  assert.equal(u.password_hash,null);
  assert.equal(u.status,"deleted");
  assert.ok(u.deleted_at);
  const p=(await pool.query(`select display_name,public_photo_key from profiles where user_id=$1`,[s.d])).rows[0];
  assert.deepEqual(p,{display_name:null,public_photo_key:null});
  await assert.rejects(()=>resolveSession(pool,token));
  const left=async(t:string,col="user_id")=>Number((await pool.query(`select count(*)::int as n from ${t} where ${col}=$1`,[s.d])).rows[0].n);
  assert.equal(await left("user_roles"),0);
  assert.equal(await left("auth_sessions"),0);
  assert.equal(await left("user_notifications"),0);
  assert.equal(await left("user_blocks","blocked_user_id"),0);
  assert.equal(await left("private_documents","owner_user_id"),0);
  assert.equal(await left("private_upload_intents","owner_user_id"),0);
  assert.equal((await pool.query(`select status from trips where id=$1`,[draft])).rows[0].status,"cancelled");
  assert.equal(await left("vehicles","driver_user_id"),1);
  const queued=(await pool.query(`select storage_key from storage_purge_queue order by storage_key`)).rows.map(r=>r.storage_key);
  assert.deepEqual(queued,[`private/${s.d}/insurance.jpg`,`private/${s.d}/photo.jpg`]);
  assert.deepEqual((await pool.query(`select action from audit_events`)).rows.map(r=>r.action),["user.deleted"]);

  // The email is free: signing up again creates a brand-new, unrelated account.
  const again=(await pool.query(`insert into app_users(email) values('ana@mvc.test') returning id`)).rows[0].id;
  assert.notEqual(again,s.d);
  await assert.rejects(()=>deleteOwnAccount(pool,auth(s.d,["driver"]),{confirm:"BORRAR"}),code("ACCOUNT_ALREADY_DELETED"));
});

test("open trips, bookings, unsettled earnings or being the last admin block deletion",async()=>{
  const s=await driverWithFiles();
  const trip=(await pool.query(`insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,offered_seats,
      origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
    values($1,$2,$3,'work','single','outbound','published',2,
      ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(2,2),4326),ST_GeomFromText('LINESTRING(1 1,2 2)',4326),
      150000,6000,'integration-test','deletion-route') returning id`,[s.d,s.v,s.province])).rows[0].id;
  await pool.query(`insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status) values($1,$2,0,1,'confirmed')`,[trip,s.other]);

  const check=await ownAccountDeletionCheck(pool,auth(s.d,["driver"]));
  assert.deepEqual(check.blockers.map(b=>b.code),["OPEN_TRIPS_AS_DRIVER"]);
  assert.deepEqual((await ownAccountDeletionCheck(pool,auth(s.other,["passenger"]))).blockers.map(b=>b.code),["OPEN_BOOKINGS"]);
  await assert.rejects(()=>deleteOwnAccount(pool,auth(s.d,["driver"]),{confirm:"BORRAR"}),
    (e:unknown)=>e instanceof DomainError&&e.code==="ACCOUNT_HAS_OPEN_ACTIVITY"&&e.statusCode===409);
  assert.equal((await pool.query(`select email from app_users where id=$1`,[s.d])).rows[0].email,"ana@mvc.test");

  await pool.query(`update trips set status='completed' where id=$1`,[trip]);
  const txn=(await pool.query(`insert into ledger_transactions(kind,idempotency_key) values('capture','test:capture') returning id`)).rows[0].id;
  await pool.query(`insert into ledger_entries(txn_id,account,user_id,amount_cents) values($1,'provider_clearing',null,500),($1,'driver_pending',$2,-500)`,[txn,s.d]);
  assert.deepEqual((await ownAccountDeletionCheck(pool,auth(s.d,["driver"]))).blockers.map(b=>b.code),["DRIVER_BALANCE_UNSETTLED"]);

  const admin=await person("admin@mvc.test",["admin"],"Admin");
  assert.deepEqual((await ownAccountDeletionCheck(pool,auth(admin,["admin"]))).blockers.map(b=>b.code),["LAST_ADMIN"]);
  await person("admin2@mvc.test",["admin"],"Admin 2");
  assert.deepEqual((await ownAccountDeletionCheck(pool,auth(admin,["admin"]))).blockers,[]);
});

test("queued files are removed from storage and failures stay queued for the next run",async()=>{
  const s=await driverWithFiles();
  await deleteOwnAccount(pool,auth(s.d,["driver","passenger"]),{confirm:"BORRAR"});
  const deleted:string[]=[];
  let fail=true;
  const storage={providerName:"fake",async deleteObject(key:string){
    if(fail&&key.endsWith("photo.jpg")) throw new Error("storage down");
    deleted.push(key);
  }} as unknown as PrivateObjectStorage;
  assert.deepEqual(await purgeQueuedStorage(pool,storage),{purged:1,failed:1});
  fail=false;
  assert.deepEqual(await purgeQueuedStorage(pool,storage),{purged:1,failed:0});
  assert.deepEqual(await purgeQueuedStorage(pool,storage),{purged:0,failed:0});
  assert.equal(deleted.length,2);
});
