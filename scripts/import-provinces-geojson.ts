import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { pool } from "../src/db/pool.js";
import { importProvinceFeatureCollection } from "../src/geo/province-import.js";

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function main(): Promise<void> {
  const filename = process.argv[2];
  if (!filename) {
    throw new Error("Usage: npm run provinces:import -- /absolute/path/provinces.geojson");
  }

  const bytes = await fs.readFile(filename);
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const data = JSON.parse(bytes.toString("utf8")) as unknown;
  const sourceVersion = process.env.PROVINCE_SOURCE_VERSION?.trim();

  const result = await importProvinceFeatureCollection(pool, data, {
    sourceName: env("PROVINCE_SOURCE_NAME"),
    sourceUrl: env("PROVINCE_SOURCE_URL"),
    sourceDate: env("PROVINCE_SOURCE_DATE"),
    sourceLicense: env("PROVINCE_SOURCE_LICENSE"),
    ...(sourceVersion ? { sourceVersion } : {}),
    fileSha256,
    codeField: env("PROVINCE_CODE_FIELD"),
    nameField: env("PROVINCE_NAME_FIELD"),
    codeMode: env("PROVINCE_CODE_MODE") as "two-digit" | "natcode"
  });

  console.log(JSON.stringify({
    imported: true,
    importId: result.importId,
    featureCount: result.featureCount,
    fileSha256,
    provinceCodes: result.provinceCodes
  }, null, 2));
}

try {
  await main();
} finally {
  await pool.end();
}
