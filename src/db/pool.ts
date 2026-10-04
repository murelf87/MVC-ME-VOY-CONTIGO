import pg from "pg";
import { loadConfig } from "../config.js";

const { Pool } = pg;
const config = loadConfig();

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000
});

export async function checkDatabaseReadiness(): Promise<{ ok: boolean; postgis?: string; error?: string }> {
  try {
    const result = await pool.query<{ postgis: string }>(
      "select postgis_full_version() as postgis"
    );
    return { ok: true, postgis: result.rows[0]?.postgis ?? "unknown" };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "database_error" };
  }
}
