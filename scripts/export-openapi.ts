import fs from "node:fs/promises";
import path from "node:path";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

// Genera docs/openapi.json a partir de los schemas reales de las rutas Fastify (única fuente de verdad).
const app = await buildApp();
try {
  await app.ready();
  const spec = app.swagger();
  await fs.writeFile(path.resolve("docs/openapi.json"), JSON.stringify(spec, null, 2) + "\n");
  console.log(`docs/openapi.json: ${Object.keys(spec.paths ?? {}).length} rutas`);
} finally {
  await app.close();
  await pool.end();
}
