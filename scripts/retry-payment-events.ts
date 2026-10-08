// Retries provider webhooks that arrived before what they depend on (run from a scheduler, e.g. every 5 minutes).
import { pool } from "../src/db/pool.js";
import { retryDeferredEvents } from "../src/services/payments-service.js";

try {
  const results = await retryDeferredEvents(pool);
  console.log(JSON.stringify({ retried: results.length, processed: results.filter(r => r.status === "processed").length }));
} finally {
  await pool.end();
}
