import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import type { AuthPrincipal } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import { updateOwnProfile } from "../src/profiles/profile-service.js";
import {
  createVehicle,
  reviewVehicle,
  updateOwnVehicle
} from "../src/vehicles/vehicle-service.js";
import {
  listOwnPrivateDocuments,
  registerVerifiedPrivateDocument,
  reviewPrivateDocument
} from "../src/documents/document-service.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

async function user(roles: string[]): Promise<AuthPrincipal> {
  const row = (await pool.query(`insert into app_users default values returning id`)).rows[0];
  await pool.query(`insert into profiles(user_id) values($1)`, [row.id]);
  for (const role of roles) {
    await pool.query(`insert into user_roles(user_id,role) values($1,$2::user_role)`, [row.id,role]);
  }
  return {
    sessionId: crypto.randomUUID(),
    userId: row.id,
    roles: roles as any,
    expiresAt: new Date(Date.now()+3600000).toISOString()
  };
}

before(async () => {
  await pool.query("select 1 from private_documents limit 1");
});

beforeEach(async () => {
  await pool.query(`
    truncate table
      private_documents,audit_events,route_change_responses,route_change_proposals,
      quote_snapshots,tariff_versions,payment_compensations,bookings,seat_holds,ride_requests,
      trip_segments,trip_stops,trips,vehicles,profiles,user_roles,auth_sessions,auth_challenges,
      app_users,province_dataset_imports,provinces
    restart identity cascade`);
});

after(async () => {
  await pool.end();
});

test("profile owner can update only their own profile service target", async () => {
  const a = await user(["passenger"]);
  const b = await user(["passenger"]);
  await updateOwnProfile(pool,a,{displayName:" Ana   López "});
  const rows = await pool.query(`select user_id,display_name from profiles order by user_id`);
  const mine = rows.rows.find(row => row.user_id === a.userId);
  const other = rows.rows.find(row => row.user_id === b.userId);
  assert.equal(mine.display_name,"Ana López");
  assert.equal(other.display_name,null);
});

test("passenger cannot create a vehicle without driver role", async () => {
  const passenger = await user(["passenger"]);
  await assert.rejects(
    () => createVehicle(pool,passenger,{make:"Seat",model:"León",plate:"1234 ABC",passengerSeats:4}),
    (error: unknown) => error instanceof DomainError && error.code === "AUTH_FORBIDDEN"
  );
});

test("driver can create vehicle but another driver cannot edit it", async () => {
  const owner = await user(["driver"]);
  const other = await user(["driver"]);
  const vehicle = await createVehicle(pool,owner,{
    make:"Seat",model:"León",plate:"1234 ABC",passengerSeats:4
  });
  assert.equal(vehicle.review_status,"pending");

  await assert.rejects(
    () => updateOwnVehicle(pool,other,vehicle.id,{
      make:"Seat",model:"León",plate:"1234 ABC",passengerSeats:4
    }),
    (error: unknown) => error instanceof DomainError && error.code === "VEHICLE_NOT_OWNED"
  );
});

test("material vehicle update resets vehicle and documentation review", async () => {
  const driver = await user(["driver"]);
  const reviewer = await user(["verification_admin"]);
  const vehicle = await createVehicle(pool,driver,{
    make:"Seat",model:"León",plate:"1234 ABC",passengerSeats:4
  });
  await reviewVehicle(pool,reviewer,vehicle.id,{area:"vehicle",decision:"approved"});
  await reviewVehicle(pool,reviewer,vehicle.id,{area:"documentation",decision:"approved"});

  const updated = await updateOwnVehicle(pool,driver,vehicle.id,{
    make:"Seat",model:"León FR",plate:"1234 ABC",passengerSeats:4
  });
  assert.equal(updated.review_status,"pending");
  assert.equal(updated.documentation_status,"pending");
});

test("only verification roles can review vehicles", async () => {
  const driver = await user(["driver"]);
  const vehicle = await createVehicle(pool,driver,{
    make:"Seat",model:"León",plate:"1234 ABC",passengerSeats:4
  });
  await assert.rejects(
    () => reviewVehicle(pool,driver,vehicle.id,{area:"vehicle",decision:"approved"}),
    (error: unknown) => error instanceof DomainError && error.code === "AUTH_FORBIDDEN"
  );
  const reviewer = await user(["verification_admin"]);
  const reviewed = await reviewVehicle(pool,reviewer,vehicle.id,{area:"vehicle",decision:"approved"});
  assert.equal(reviewed.review_status,"approved");
});

test("private document cannot be attached to another driver's vehicle and storage key is never listed", async () => {
  const owner = await user(["driver"]);
  const other = await user(["driver"]);
  const vehicle = await createVehicle(pool,owner,{
    make:"Seat",model:"León",plate:"1234 ABC",passengerSeats:4
  });

  await assert.rejects(
    () => registerVerifiedPrivateDocument(pool,other,{
      kind:"vehicle_registration",
      vehicleId:vehicle.id,
      object:{
        storageProvider:"test-private",
        storageKey:"private/not-owned.pdf",
        contentType:"application/pdf",
        sizeBytes:100,
        sha256:"a".repeat(64)
      }
    }),
    (error: unknown) => error instanceof DomainError && error.code === "VEHICLE_NOT_OWNED"
  );

  await registerVerifiedPrivateDocument(pool,owner,{
    kind:"vehicle_registration",
    vehicleId:vehicle.id,
    object:{
      storageProvider:"test-private",
      storageKey:"private/owned.pdf",
      contentType:"application/pdf",
      sizeBytes:100,
      sha256:"b".repeat(64)
    }
  });

  const docs = await listOwnPrivateDocuments(pool,owner);
  assert.equal(docs.length,1);
  assert.equal("storage_key" in docs[0],false);
  assert.equal("storage_provider" in docs[0],false);
});

test("approved identity document verifies identity and non-admin cannot review it", async () => {
  const passenger = await user(["passenger"]);
  const reviewer = await user(["verification_admin"]);
  const document = await registerVerifiedPrivateDocument(pool,passenger,{
    kind:"identity_document",
    object:{
      storageProvider:"test-private",
      storageKey:"private/id.pdf",
      contentType:"application/pdf",
      sizeBytes:200,
      sha256:"c".repeat(64)
    }
  });

  await assert.rejects(
    () => reviewPrivateDocument(pool,passenger,document.id,{decision:"approved"}),
    (error: unknown) => error instanceof DomainError && error.code === "AUTH_FORBIDDEN"
  );

  await reviewPrivateDocument(pool,reviewer,document.id,{decision:"approved"});
  const profile = (await pool.query(`select identity_status from profiles where user_id=$1`,[passenger.userId])).rows[0];
  assert.equal(profile.identity_status,"verified");
});
