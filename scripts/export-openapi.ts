import fs from "node:fs/promises";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

// Writes the contract the running server actually serves, so docs/openapi.json never drifts from the routes.
const app = await buildApp();
try {
  await app.ready();
  const spec = app.swagger();
  await fs.writeFile("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
  console.log(`docs/openapi.json: ${Object.keys(spec.paths ?? {}).length} paths`);
} finally {
  await app.close();
  await pool.end();
}
