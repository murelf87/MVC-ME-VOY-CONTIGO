import { pool } from "../src/db/pool.js";
import { deliverPendingPushes,disabledPushProvider } from "../src/services/push-service.js";

// Delivers queued push notices. With no provider chosen yet it only expires old ones (BLOCKERS 6).
try{
  console.log(JSON.stringify(await deliverPendingPushes(pool,disabledPushProvider)));
}finally{
  await pool.end();
}
