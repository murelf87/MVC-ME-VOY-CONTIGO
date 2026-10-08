/**
 * DEVELOPMENT ONLY. Stands in for the administrative review that a real reviewer
 * performs in the admin panel (pending): approves the public photo, identity and
 * every vehicle of the driver with the given phone, with a one-year insurance expiry.
 * Refuses to run unless NODE_ENV=development.
 */
import { pool } from "../src/db/pool.js";

if (process.env.NODE_ENV !== "development") {
  throw new Error("dev-approve-driver only runs with NODE_ENV=development");
}

const phone = process.argv[2];
if (!phone) throw new Error("Usage: npm run dev:approve-driver -- +34600000000");

try {
  const user = await pool.query(`select id from app_users where phone_e164=$1`, [phone]);
  const userId = user.rows[0]?.id as string | undefined;
  if (!userId) throw new Error(`No user with phone ${phone}`);
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
