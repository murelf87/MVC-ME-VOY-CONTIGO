import fs from "node:fs/promises";
import path from "node:path";
import { pool } from "../src/db/pool.js";

async function main(): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations(
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const dir = path.resolve("migrations");
  // MIGRATIONS_EXCLUDE="040-099,120" omite migraciones por prefijo numérico (desarrollo en paralelo por módulo).
  const excluded = (process.env.MIGRATIONS_EXCLUDE ?? "")
    .split(",").map(s => s.trim()).filter(Boolean)
    .map(r => { const [a, b] = r.split("-").map(Number); return [a ?? 0, b ?? a ?? 0] as const; });
  const isExcluded = (filename: string) => {
    const n = Number(/^(\d+)_/.exec(filename)?.[1] ?? NaN);
    return excluded.some(([a, b]) => n >= a && n <= b);
  };
  const files = (await fs.readdir(dir)).filter(f => f.endsWith(".sql") && !isExcluded(f)).sort();

  for (const filename of files) {
    const exists = await pool.query("select 1 from schema_migrations where filename=$1", [filename]);
    if (exists.rowCount) continue;

    const sql = await fs.readFile(path.join(dir, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations(filename) values($1)", [filename]);
      await client.query("commit");
      console.log(`applied ${filename}`);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }
}

try {
  await main();
} finally {
  await pool.end();
}
