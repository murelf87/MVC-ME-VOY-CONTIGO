/**
 * Evalúa las reglas de alertas de operación una vez (para cron/systemd/línea de comandos).
 *   DATABASE_URL=postgres://… npx tsx src/modules/trust/operations/run-evaluator.ts
 * Salida: un objeto JSON con lo evaluado. No usa credenciales especiales: solo acceso a la base de datos.
 */
import { pathToFileURL } from "node:url";
import { loadTrustConfig } from "../config.js";
import { evaluateAlerts } from "./evaluator.js";

async function main(): Promise<void> {
  const { pool } = await import("../../../db/pool.js");
  try {
    const result = await evaluateAlerts(
      { pool, storage: null, config: loadTrustConfig(), uploadTtlSeconds: 600, now: () => new Date() },
      { actorUserId: null, via: "cli" }
    );
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
