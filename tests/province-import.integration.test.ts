import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DomainError } from "../src/errors.js";
import { importProvinceFeatureCollection } from "../src/geo/province-import.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

const metadata = {
  sourceName: "Synthetic integration fixture",
  sourceUrl: "https://example.invalid/provinces.geojson",
  sourceDate: "2026-10-04",
  sourceLicense: "TEST-ONLY",
  sourceVersion: "fixture-1",
  fileSha256: "a".repeat(64),
  codeField: "CODE",
  nameField: "NAME"
};

function collection(features: Array<{ code: string; name: string; coordinates: unknown }>) {
  return {
    type: "FeatureCollection",
    features: features.map(feature => ({
      type: "Feature",
      properties: { CODE: feature.code, NAME: feature.name },
      geometry: { type: "Polygon", coordinates: feature.coordinates }
    }))
  };
}

const squareA = [[[0,0],[2,0],[2,2],[0,2],[0,0]]];
const squareB = [[[3,0],[5,0],[5,2],[3,2],[3,0]]];

before(async () => {
  await pool.query("select postgis_full_version()");
  await pool.query("select 1 from province_dataset_imports limit 1");
});

beforeEach(async () => {
  await pool.query(`
    truncate table audit_events, province_dataset_imports, provinces
    restart identity cascade`);
});

after(async () => {
  await pool.end();
});

test("imports validated province polygons and activates provenance metadata", async () => {
  const result = await importProvinceFeatureCollection(pool, collection([
    { code: "01", name: "Fixture One", coordinates: squareA },
    { code: "02", name: "Fixture Two", coordinates: squareB }
  ]), metadata);

  assert.equal(result.featureCount, 2);
  assert.deepEqual(result.provinceCodes, ["01","02"]);

  const rows = await pool.query(`
    select p.code,p.name,d.status,d.file_sha256,
           ST_IsValid(p.geom) as valid,ST_SRID(p.geom) as srid
      from provinces p join province_dataset_imports d on d.id=p.dataset_import_id
     order by p.code`);
  assert.equal(rows.rowCount, 2);
  assert.equal(rows.rows[0].status, "active");
  assert.equal(rows.rows[0].file_sha256, "a".repeat(64));
  assert.equal(rows.rows[0].valid, true);
  assert.equal(rows.rows[0].srid, 4326);
});

test("duplicate province code rejects the whole import atomically", async () => {
  await assert.rejects(
    () => importProvinceFeatureCollection(pool, collection([
      { code: "01", name: "Fixture One", coordinates: squareA },
      { code: "01", name: "Duplicate", coordinates: squareB }
    ]), metadata),
    (error: unknown) => error instanceof DomainError && error.code === "PROVINCE_DATA_DUPLICATE_CODE"
  );

  const imports = await pool.query("select count(*)::int as n from province_dataset_imports");
  const provinces = await pool.query("select count(*)::int as n from provinces");
  assert.equal(imports.rows[0].n, 0);
  assert.equal(provinces.rows[0].n, 0);
});

test("invalid geometry type is rejected before database mutation", async () => {
  const invalid = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { CODE: "01", NAME: "Bad" },
      geometry: { type: "Point", coordinates: [0,0] }
    }]
  };

  await assert.rejects(
    () => importProvinceFeatureCollection(pool, invalid, metadata),
    (error: unknown) => error instanceof DomainError && error.code === "PROVINCE_DATA_INVALID_GEOMETRY"
  );
  const imports = await pool.query("select count(*)::int as n from province_dataset_imports");
  assert.equal(imports.rows[0].n, 0);
});

test("same file hash cannot be activated twice", async () => {
  const data = collection([{ code: "01", name: "Fixture One", coordinates: squareA }]);
  await importProvinceFeatureCollection(pool, data, metadata);
  await assert.rejects(
    () => importProvinceFeatureCollection(pool, data, metadata),
    (error: unknown) => error instanceof DomainError && error.code === "PROVINCE_DATA_ALREADY_IMPORTED"
  );
});
