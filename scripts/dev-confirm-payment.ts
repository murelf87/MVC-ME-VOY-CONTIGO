/**
 * DEVELOPMENT ONLY. Payments have no provider yet (see docs/BLOCKERS.md). This
 * script calls the same domain function a signed provider webhook will call,
 * so the confirmed-booking flows (chat, pickup code, completion) can be exercised
 * locally. It records a "dev_manual_*" payment for the frozen quote amount, or
 * 0 cents when no tariff was approved at acceptance time.
 * Refuses to run unless NODE_ENV=development.
 */
import crypto from "node:crypto";
import { pool } from "../src/db/pool.js";
import { confirmProviderPayment } from "../src/services/reservation-service.js";

if (process.env.NODE_ENV !== "development") {
  throw new Error("dev-confirm-payment only runs with NODE_ENV=development");
}

const requestId = process.argv[2];
if (!requestId) throw new Error("Usage: npm run dev:confirm-payment -- <rideRequestId>");

try {
  const quote = await pool.query(`select passenger_total_cents from quote_snapshots where request_id=$1`, [requestId]);
  const result = await confirmProviderPayment(pool, {
    requestId,
    providerPaymentId: `dev_manual_${crypto.randomUUID()}`,
    amountCents: quote.rows[0]?.passenger_total_cents ?? 0
  });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
