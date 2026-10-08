/**
 * DEVELOPMENT ONLY. Stands in for the administrative review that a real reviewer
 * performs in the admin panel (pending): approves the public photo, identity and
 * every vehicle of the driver with the given email, with a one-year insurance expiry.
 * Refuses to run unless NODE_ENV=development.
 */
import { pool } from "../src/db/pool.js";

if (process.env.NODE_ENV !== "development") {
  throw new Error("dev-approve-driver only runs with NODE_ENV=development");
}

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) throw new Error("Usage: npm run dev:approve-driver -- persona@ejemplo.es");

try {
  const user = await pool.query(`select id from app_users where lower(email)=$1`, [email]);
  const userId = user.rows[0]?.id as string | undefined;
  if (!userId) throw new Error(`No user with email ${email}`);
  await pool.query(
    `update profiles set public_photo_status='approved', identity_status='verified' where user_id=$1`,
    [userId]
  );
  const vehicles = await pool.query(
    `update vehicles
        set review_status='approved', documentation_status='approved',
            vehicle_photo_status='approved', insurance_status='approved',
            insurance_expires_on=(current_date + interval '1 year')::date,
            insurance_reviewed_at=now(), reviewed_at=now()
      where driver_user_id=$1
      returning id`,
    [userId]
  );
  await pool.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
     values(null,'dev.driver_approved','user',$1,'{"environment":"development"}'::jsonb)`,
    [userId]
  );
  console.log(JSON.stringify({ userId, approvedVehicles: vehicles.rowCount }));
} finally {
  await pool.end();
}
