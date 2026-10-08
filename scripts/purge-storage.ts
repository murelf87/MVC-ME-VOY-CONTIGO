import { loadConfig } from "../src/config.js";
import { pool } from "../src/db/pool.js";
import { purgeQueuedStorage } from "../src/services/account-service.js";
import { buildPrivateObjectStorage } from "../src/storage/provider.js";

// Deletes from private storage the files of deleted accounts. Run on a schedule; failures stay queued.
const storage=buildPrivateObjectStorage(loadConfig());
try{
  if(storage.providerName==="disabled"){
    console.log("Private storage is not configured: nothing to purge.");
  }else{
    console.log(JSON.stringify(await purgeQueuedStorage(pool,storage)));
  }
}finally{
  await pool.end();
}
