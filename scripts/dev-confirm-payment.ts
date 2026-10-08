/**
 * DEVELOPMENT ONLY. Payments have no provider yet (see docs/BLOCKERS.md). This
 * script calls the same domain function a signed provider webhook will call,
 * so the confirmed-booking flows (chat, pickup code, completion) can be exercised
 * locally. It records a 0-cent "dev_manual_*" payment because no tariff is approved.
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
  const result = await confirmProviderPayment(pool, {
    requestId,
    providerPaymentId: `dev_manual_${crypto.randomUUID()}`,
    amountCents: 0
  });
  console.log(JSON.stringify(result));
} finally {
  await pool.end();
}
