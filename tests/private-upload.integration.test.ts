import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import pg from "pg";
import "../src/db/types.js";
import type { AuthPrincipal } from "../src/auth/session.js";
import type { InsuranceOcrProvider } from "../src/documents/insurance-ocr-provider.js";
import { completePrivateUploadIntent,createPrivateUploadIntent } from "../src/documents/private-upload-service.js";
import { DomainError } from "../src/errors.js";
import type { PrivateObjectInfo,PrivateObjectStorage,UploadUrlResult } from "../src/storage/private-object-storage.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

class FakeStorage implements PrivateObjectStorage {
  readonly providerName="fake";
  objects=new Map<string,{bytes:Uint8Array;contentType:string}>();
  async createUploadUrl(input:{key:string;contentType:string;expiresInSeconds:number}):Promise<UploadUrlResult>{
    return {url:`https://upload.invalid/${input.key}`,expiresAt:new Date(Date.now()+input.expiresInSeconds*1000).toISOString(),headers:{"content-type":input.contentType}};
  }
  async headObject(key:string):Promise<PrivateObjectInfo>{
    const value=this.objects.get(key);
    if(!value) throw new Error("missing object");
    return {sizeBytes:value.bytes.byteLength,contentType:value.contentType};
  }
  async readObject(key:string,maxBytes:number):Promise<Uint8Array>{
    const value=this.objects.get(key);
    if(!value) throw new Error("missing object");
    if(value.bytes.byteLength>maxBytes) throw new Error("too large");
    return value.bytes;
  }
  async createDownloadUrl(key:string):Promise<string>{return `https://download.invalid/${key}`;}
}

class FakeOcr implements InsuranceOcrProvider {
  readonly providerName="fake_ocr";
  async analyzeImage():Promise<{provider:string;text:string}>{
    return {provider:this.providerName,text:"Póliza de seguro. Vencimiento 31/12/2099."};
  }
}

function principal(userId:string,roles:any[]):AuthPrincipal{
  return {sessionId:crypto.randomUUID(),userId,roles,expiresAt:new Date(Date.now()+3600000).toISOString()};
}

async function seedDriver(){
  const driver=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  await pool.query(`insert into profiles(user_id) values($1)`,[driver]);
  await pool.query(`insert into user_roles(user_id,role) values($1,\'driver\')`,[driver]);
  const vehicle=(await pool.query(`
    insert into vehicles(driver_user_id,make,model,plate,passenger_seats)
    values($1,\'Seat\',\'Leon\',$2,4) returning id
  `,[driver,`UP-${crypto.randomUUID().slice(0,8)}`])).rows[0].id;
  return {driver,vehicle};
}

before(async()=>{await pool.query("select 1 from private_upload_intents limit 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table private_upload_intents,private_documents,audit_events,vehicles,profiles,
      user_roles,auth_sessions,auth_challenges,app_users restart identity cascade
  `);
});
after(async()=>{await pool.end()});

test("driver creates and completes a private vehicle photo upload",async()=>{
  const {driver,vehicle}=await seedDriver();
  const storage=new FakeStorage();
  const bytes=new TextEncoder().encode("photo-bytes");
  const intent=await createPrivateUploadIntent(pool,principal(driver,["driver"]),storage,600,{
    kind:"vehicle_photo",vehicleId:vehicle,contentType:"image/jpeg",sizeBytes:bytes.byteLength
  });
  const row=(await pool.query(`select storage_key from private_upload_intents where id=$1`,[intent.intentId])).rows[0];
  storage.objects.set(row.storage_key,{bytes,contentType:"image/jpeg"});
  const completed=await completePrivateUploadIntent(pool,principal(driver,["driver"]),storage,new FakeOcr(),intent.intentId);
  assert.equal(completed.document.kind,"vehicle_photo");
  assert.equal(completed.document.sha256,crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(completed.document.review_status,"pending");
});

test("insurance image OCR detects the expiry date for review",async()=>{
  const {driver,vehicle}=await seedDriver();
  const storage=new FakeStorage();
  const bytes=new TextEncoder().encode("insurance-image");
  const intent=await createPrivateUploadIntent(pool,principal(driver,["driver"]),storage,600,{
    kind:"vehicle_insurance",vehicleId:vehicle,contentType:"image/jpeg",sizeBytes:bytes.byteLength
  });
  const row=(await pool.query(`select storage_key from private_upload_intents where id=$1`,[intent.intentId])).rows[0];
  storage.objects.set(row.storage_key,{bytes,contentType:"image/jpeg"});
  const completed=await completePrivateUploadIntent(pool,principal(driver,["driver"]),storage,new FakeOcr(),intent.intentId);
  assert.equal(completed.analysis.analysis_status,"succeeded");
  assert.equal(new Date(completed.analysis.detected_expires_on).toISOString().slice(0,10),"2099-12-31");
  assert.ok(Number(completed.analysis.analysis_confidence)>=0.75);
});

test("another driver cannot create an upload for a vehicle they do not own",async()=>{
  const owner=await seedDriver();
  const other=await seedDriver();
  const storage=new FakeStorage();
  await assert.rejects(
    ()=>createPrivateUploadIntent(pool,principal(other.driver,["driver"]),storage,600,{
      kind:"vehicle_photo",vehicleId:owner.vehicle,contentType:"image/jpeg",sizeBytes:10
    }),
    (e:unknown)=>e instanceof DomainError&&e.code==="VEHICLE_NOT_OWNED"
  );
});

test("completion rejects a file whose uploaded size differs from the intent",async()=>{
  const {driver,vehicle}=await seedDriver();
  const storage=new FakeStorage();
  const intent=await createPrivateUploadIntent(pool,principal(driver,["driver"]),storage,600,{
    kind:"vehicle_photo",vehicleId:vehicle,contentType:"image/jpeg",sizeBytes:100
  });
  const row=(await pool.query(`select storage_key from private_upload_intents where id=$1`,[intent.intentId])).rows[0];
  storage.objects.set(row.storage_key,{bytes:new Uint8Array(5),contentType:"image/jpeg"});
  await assert.rejects(
    ()=>completePrivateUploadIntent(pool,principal(driver,["driver"]),storage,new FakeOcr(),intent.intentId),
    (e:unknown)=>e instanceof DomainError&&e.code==="UPLOADED_FILE_SIZE_MISMATCH"
  );
});