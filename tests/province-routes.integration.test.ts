import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.js";
import { pool } from "../src/db/pool.js";

let app: Awaited<ReturnType<typeof buildApp>>;

before(async () => {
  app = await buildApp();
  await app.ready();
  await pool.query("select postgis_full_version()");
});

beforeEach(async () => {
  await pool.query(
    `truncate table
      province_dataset_imports, provinces
     restart identity cascade`
  );

  await pool.query(
    `insert into provinces(
      code,name,source_name,source_url,source_license,geom
    ) values
    (
      'TEST-A','Provincia A','integration-test','https://example.invalid/a','test',
      ST_Multi(ST_GeomFromText('POLYGON((-6 36,-4 36,-4 38,-6 38,-6 36))',4326))
    ),
    (
      'TEST-B','Provincia B','integration-test','https://example.invalid/b','test',
      ST_Multi(ST_GeomFromText('POLYGON((-4 36,-2 36,-2 38,-4 38,-4 36))',4326))
    )`
  );
});

after(async () => {
  await app.close();
  await pool.end();
});

test("lists provinces without exposing full geometry", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/provinces"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    provinces: Array<Record<string, unknown>>;
  };

  assert.equal(body.provinces.length, 2);
  assert.equal(body.provinces[0]?.name, "Provincia A");
  assert.equal("geom" in body.provinces[0]!, false);
});

test("resolves a coordinate to its containing province", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/provinces/resolve?latitude=37&longitude=-5"
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    province: { code: string; name: string };
  };
  assert.equal(body.province.code, "TEST-A");
  assert.equal(body.province.name, "Provincia A");
});

test("returns a stable domain error when no province contains the point", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/v1/provinces/resolve?latitude=40&longitude=-5"
  });

  assert.equal(response.statusCode, 404);
  const body = response.json() as {
    error: { code: string };
  };
  assert.equal(body.error.code, "PROVINCE_NOT_FOUND");
});
