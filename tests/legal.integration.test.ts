import test,{after,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import { createRideRequest } from "../src/services/request-service.js";
import {
  acceptLegalDocuments,adminCreateLegalDocument,adminListLegalDocuments,adminPublishLegalDocument,
  currentLegalDocuments,ownLegalStatus
} from "../src/services/legal-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

function auth(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}
const code=(c:string)=>(e:unknown)=>e instanceof DomainError&&e.code===c;
const user=async()=>(await pool.query(`insert into app_users default values returning id`)).rows[0].id as string;
// Placeholder texts for tests only; MVC never ships legal wording of its own.
const draft=(kind:"terms"|"privacy",n:number)=>({kind,title:`Texto de prueba ${kind} ${n}`,body:`Cuerpo de prueba ${n}`});

beforeEach(async()=>{
  await pool.query(`truncate table legal_acceptances,legal_documents,audit_events,user_roles,app_users restart identity cascade`);
});
after(async()=>{ await pool.end(); });

test("with nothing published nobody is asked to accept anything and booking is not blocked by it",async()=>{
  const p=await user();
  assert.deepEqual((await ownLegalStatus(pool,auth(p,["passenger"]))).pending,[]);
  await assert.rejects(()=>createRideRequest(pool,auth(p,["passenger"]),{tripId:crypto.randomUUID(),fromSegmentSeq:0,toSegmentSeq:1}),
    code("TRIP_NOT_FOUND"));
});

test("only admins write and publish; publishing asks everyone to accept before booking",async()=>{
  const admin=await user(),finance=await user(),p=await user();
  await assert.rejects(()=>adminCreateLegalDocument(pool,auth(finance,["finance_admin"]),draft("terms",1)),code("AUTH_FORBIDDEN"));
  const t1=await adminCreateLegalDocument(pool,auth(admin,["admin"]),draft("terms",1));
  assert.equal(t1.version,1);
  assert.equal(t1.status,"draft");
  assert.deepEqual(await currentLegalDocuments(pool),[]);
  await assert.rejects(()=>acceptLegalDocuments(pool,auth(p,["passenger"]),[t1.id]),code("LEGAL_DOCUMENT_NOT_CURRENT"));

  await adminPublishLegalDocument(pool,auth(admin,["admin"]),t1.id);
  const pending=(await ownLegalStatus(pool,auth(p,["passenger"]))).pending;
  assert.deepEqual(pending.map((d:any)=>d.id),[t1.id]);
  await assert.rejects(()=>createRideRequest(pool,auth(p,["passenger"]),{tripId:crypto.randomUUID(),fromSegmentSeq:0,toSegmentSeq:1}),
    (e:unknown)=>e instanceof DomainError&&e.code==="LEGAL_ACCEPTANCE_REQUIRED"&&e.statusCode===409);

  const after1=await acceptLegalDocuments(pool,auth(p,["passenger"]),[t1.id,t1.id]);
  assert.deepEqual(after1.pending,[]);
  await assert.rejects(()=>createRideRequest(pool,auth(p,["passenger"]),{tripId:crypto.randomUUID(),fromSegmentSeq:0,toSegmentSeq:1}),
    code("TRIP_NOT_FOUND"));
  const audit=(await pool.query(`select action from audit_events order by id`)).rows.map(r=>r.action);
  assert.deepEqual(audit,["legal_document.created","legal_document.published"]);
});

test("a new version retires the old one and must be accepted again; published text cannot be rewritten",async()=>{
  const admin=await user(),p=await user();
  const a=auth(admin,["admin"]);
  const t1=await adminCreateLegalDocument(pool,a,draft("terms",1));
  await adminPublishLegalDocument(pool,a,t1.id);
  await acceptLegalDocuments(pool,auth(p,["passenger"]),[t1.id]);

  const t2=await adminCreateLegalDocument(pool,a,draft("terms",2));
  assert.equal(t2.version,2);
  await adminPublishLegalDocument(pool,a,t2.id);
  await assert.rejects(()=>adminPublishLegalDocument(pool,a,t2.id),code("LEGAL_DOCUMENT_NOT_DRAFT"));
  const docs=await adminListLegalDocuments(pool,a);
  assert.deepEqual(docs.map((d:any)=>[d.version,d.status,d.acceptances]),[[2,"published",0],[1,"retired",1]]);
  assert.deepEqual((await ownLegalStatus(pool,auth(p,["passenger"]))).pending.map((d:any)=>d.version),[2]);
  await assert.rejects(()=>acceptLegalDocuments(pool,auth(p,["passenger"]),[t1.id]),code("LEGAL_DOCUMENT_NOT_CURRENT"));

  await assert.rejects(()=>pool.query(`update legal_documents set body='otro' where id=$1`,[t1.id]),/MVC_LEGAL_DOCUMENT_IMMUTABLE/);
  const privacy=await adminCreateLegalDocument(pool,a,draft("privacy",1));
  assert.equal(privacy.version,1);
});
