import test,{after,before,beforeEach} from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DomainError } from "../src/errors.js";
import { assertVehicleCanDrive } from "../src/vehicles/compliance-service.js";

const {Pool}=pg;
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool=new Pool({connectionString:databaseUrl});

async function seedVehicle(input?:{photo?:string;insurance?:string;expiresOn?:string|null;}){
  const user=(await pool.query(`insert into app_users default values returning id`)).rows[0].id;
  const vehicle=(await pool.query(`
    insert into vehicles(
      driver_user_id,make,model,plate,passenger_seats,
      vehicle_photo_status,insurance_status,insurance_expires_on
    ) values($1,\'Seat\',\'Leon\',$2,4,$3,$4,$5::date)
    returning id
  `,[
    user,
    `CMP-${Math.floor(Math.random()*1000000)}`,
    input?.photo ?? "pending",
    input?.insurance ?? "pending",
    input?.expiresOn ?? null
  ])).rows[0].id;
  return vehicle;
}

before(async()=>{await pool.query("select 1")});
beforeEach(async()=>{
  await pool.query(`
    truncate table private_documents,audit_events,vehicles,profiles,user_roles,
      auth_sessions,auth_challenges,app_users restart identity cascade
  `);
});
after(async()=>{await pool.end()});

test("vehicle photo is mandatory before driving",async()=>{
  const vehicle=await seedVehicle({photo:"pending",insurance:"approved",expiresOn:"2099-12-31"});
  const client=await pool.connect();
  try{
    await assert.rejects(
      ()=>assertVehicleCanDrive(client,vehicle),
      (e:unknown)=>e instanceof DomainError&&e.code==="VEHICLE_PHOTO_REQUIRED"
    );
  }finally{client.release()}
});

test("expired insurance blocks the driver",async()=>{
  const vehicle=await seedVehicle({photo:"approved",insurance:"approved",expiresOn:"2020-01-01"});
  const client=await pool.connect();
  try{
    await assert.rejects(
      ()=>assertVehicleCanDrive(client,vehicle),
      (e:unknown)=>e instanceof DomainError&&e.code==="VEHICLE_INSURANCE_EXPIRED"
    );
  }finally{client.release()}
});

test("approved photo and current insurance permit driving",async()=>{
  const vehicle=await seedVehicle({photo:"approved",insurance:"approved",expiresOn:"2099-12-31"});
  const client=await pool.connect();
  try{
    const state=await assertVehicleCanDrive(client,vehicle);
    assert.equal(state.vehicleId,vehicle);
    assert.equal(state.insuranceExpiresOn,"2099-12-31");
  }finally{client.release()}
});