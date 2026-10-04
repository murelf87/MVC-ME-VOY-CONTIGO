import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { pool } from "./db/pool.js";

const config = loadConfig();
const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutdown requested");
  await app.close();
  await pool.end();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ host: config.host, port: config.port });
