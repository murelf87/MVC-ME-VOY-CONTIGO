/** Scheduler job: keep every active weekly series published up to the horizon. Safe to run repeatedly. */
import pg from "pg";
import { materializeAllSeries } from "../src/services/recurring-service.js";

const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL is required");
const pool=new pg.Pool({connectionString:databaseUrl});
try{
  const out=await materializeAllSeries(pool,Number(process.env.SERIES_HORIZON_WEEKS??4));
  for(const s of out){
    console.log(`${s.seriesId}: +${s.created.length} creados, ${s.published.length} publicados, ${s.failed.length} con error`);
    for(const f of s.failed) console.log(`  ${f.tripId}: ${f.code}`);
  }
}finally{
  await pool.end();
}
