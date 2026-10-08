import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import {
  adminListAudit,
  adminOverview,
  adminReviewProfile,
  adminSearchUsers,
  adminSetRole,
  adminSetUserStatus,
  adminVerificationQueue
} from "../src/services/admin-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;

async function user(name:string,email:string,identity="unverified"){
  const id=(await pool.query(`insert into app_users(email) values($1) returning id`,[email])).rows[0].id;
  await pool.query(`insert into profiles(user_id,display_name,identity_status) values($1,$2,$3)`,[id,name,identity]);
  return id as string;
}

before(async()=>{await pool.query("select 1 from audit_events limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table user_notifications,incident_reports,trip_ratings,booking_cancellations,audit_events,
      private_documents,vehicles,auth_sessions,profiles,user_roles,app_users restart identity cascade`);
});
after(async()=>{await pool.end()});

test("overview only shows the areas each staff role may act on",async()=>{
  const a=await user("Admin","admin@mvc.test");
  const v=await user("Verif","verif@mvc.test");
  const full=await adminOverview(pool,auth(a,["admin"]));
  assert.ok(full.verification&&full.finance&&full.support);
  const ver=await adminOverview(pool,auth(v,["verification_admin"]));
  assert.ok(ver.verification);
  assert.equal(ver.finance,null);
  assert.equal(ver.support,null);
  await assert.rejects(()=>adminOverview(pool,auth(v,["driver","passenger"])),code("AUTH_FORBIDDEN"));
});

test("verification queue lists pending identities with masked emails, and reviews are audited",async()=>{
  const v=await user("Verif","verif@mvc.test");
  const luis=await user("Luis","luis.garcia@mvc.test","pending");
  const q=await adminVerificationQueue(pool,auth(v,["verification_admin"]));
  assert.equal(q.profiles.length,1);
  assert.equal(q.profiles[0].email,"lu•••••••••@mvc.test");
  await assert.rejects(()=>adminReviewProfile(pool,auth(v,["verification_admin"]),{userId:luis,area:"identity",decision:"rejected"}),code("REVIEW_REASON_REQUIRED"));
  const r=await adminReviewProfile(pool,auth(v,["verification_admin"]),{userId:luis,area:"identity",decision:"approved"});
  assert.equal(r.identity_status,"verified");
  await assert.rejects(()=>adminReviewProfile(pool,auth(v,["verification_admin"]),{userId:v,area:"identity",decision:"approved"}),code("SELF_REVIEW_FORBIDDEN"));
  const ev=await pool.query(`select action,actor_user_id from audit_events where entity_id=$1`,[luis]);
  assert.deepEqual(ev.rows,[{action:"profile.reviewed",actor_user_id:v}]);
});

test("suspending a user revokes their sessions; only admins can, and never themselves",async()=>{
  const a=await user("Admin","admin@mvc.test");
  const s=await user("Soporte","soporte@mvc.test");
  const luis=await user("Luis","luis.garcia@mvc.test");
  await pool.query(`insert into auth_sessions(user_id,token_hash,expires_at) values($1,$2,now()+interval '1 day')`,[luis,"a".repeat(64)]);
  await assert.rejects(()=>adminSetUserStatus(pool,auth(s,["support_admin"]),{userId:luis,status:"suspended",reason:"Fraude"}),code("AUTH_FORBIDDEN"));
  await assert.rejects(()=>adminSetUserStatus(pool,auth(a,["admin"]),{userId:a,status:"suspended",reason:"Prueba"}),code("SELF_SUSPEND_FORBIDDEN"));
  await adminSetUserStatus(pool,auth(a,["admin"]),{userId:luis,status:"suspended",reason:"Reportes reiterados"});
  const sess=await pool.query(`select revoked_at from auth_sessions where user_id=$1`,[luis]);
  assert.ok(sess.rows[0].revoked_at);
  const found=await adminSearchUsers(pool,auth(s,["support_admin"]),"garcia");
  assert.equal(found[0].status,"suspended");
});

test("roles are granted by admins only and an admin cannot demote themselves",async()=>{
  const a=await user("Admin","admin@mvc.test");
  const luis=await user("Luis","luis.garcia@mvc.test");
  const out=await adminSetRole(pool,auth(a,["admin"]),{userId:luis,role:"support_admin",grant:true});
  assert.deepEqual(out.roles,["support_admin"]);
  await assert.rejects(()=>adminSetRole(pool,auth(luis,["support_admin"]),{userId:luis,role:"admin",grant:true}),code("AUTH_FORBIDDEN"));
  await assert.rejects(()=>adminSetRole(pool,auth(a,["admin"]),{userId:a,role:"admin",grant:false}),code("SELF_DEMOTION_FORBIDDEN"));
  const log=await adminListAudit(pool,auth(a,["admin"]),{entityType:"user"});
  assert.equal(log[0].action,"role.granted");
  await assert.rejects(()=>adminListAudit(pool,auth(luis,["support_admin"]),{}),code("AUTH_FORBIDDEN"));
});

