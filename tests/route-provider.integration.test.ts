import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { DomainError } from "../src/errors.js";
import { computeProvinceCompliantRoute } from "../src/maps/province-route-service.js";
import type {
  RouteCandidate,
  RouteComputationRequest,
  RouteProvider
} from "../src/maps/types.js";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
const pool = new Pool({ connectionString: databaseUrl });

class QueueRouteProvider implements RouteProvider {
  readonly name = "test-routing";
  readonly calls: RouteComputationRequest[] = [];

  constructor(private readonly replies: RouteCandidate[][]) {}

  async computeRoutes(request: RouteComputationRequest): Promise<RouteCandidate[]> {
    this.calls.push(request);
    const reply = this.replies.shift();
    if (!reply) throw new Error("No queued route reply");
    return reply;
  }
}

function route(
  ref: string,
  coordinates: [number, number][],
  distanceMeters = 1000,
  durationSeconds = 60
): RouteCandidate {
  return {
    provider: "test-routing",
    providerRef: ref,
    distanceMeters,
    durationSeconds,
    geometry: { type: "LineString", coordinates },
    labels: []
  };
}

async function seedProvince(): Promise<string> {
  return (await pool.query(`
    insert into provinces(code,name,source_name,source_url,source_date,source_license,geom)
    values(
      '99','Synthetic Routing Province','integration-test','https://example.invalid/test',
      '2026-10-04','TEST-ONLY',
      ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326))
    )
    returning id
  `)).rows[0].id as string;
}

before(async () => {
  await pool.query("select postgis_full_version()");
});

beforeEach(async () => {
  await pool.query(`
    truncate table audit_events, trip_segments, trip_stops, trips, vehicles,
      province_dataset_imports, provinces
    restart identity cascade
  `);
});

after(async () => {
  await pool.end();
});

test("selects a provider alternative whose full geometry stays inside province", async () => {
  const provinceId = await seedProvince();
  const provider = new QueueRouteProvider([[
    route("outside", [[1,1],[11,5],[9,9]], 900, 50),
    route("inside", [[1,1],[5,5],[9,9]], 1100, 70)
  ]]);

  const result = await computeProvinceCompliantRoute(pool, provider, {
    provinceId,
    origin: { latitude: 1, longitude: 1 },
    destination: { latitude: 9, longitude: 9 }
  });

  assert.equal(result.providerRef, "inside");
  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0]?.alternatives, true);
});

test("rejects an outside point before calling the route provider", async () => {
  const provinceId = await seedProvince();
  const provider = new QueueRouteProvider([]);

  await assert.rejects(
    () => computeProvinceCompliantRoute(pool, provider, {
      provinceId,
      origin: { latitude: 1, longitude: 11 },
      destination: { latitude: 9, longitude: 9 }
    }),
    (error: unknown) => error instanceof DomainError && error.code === "ROUTE_POINT_OUTSIDE_PROVINCE"
  );

  assert.equal(provider.calls.length, 0);
});

test("with intermediate stops, falls back to compliant alternatives per segment", async () => {
  const provinceId = await seedProvince();
  const provider = new QueueRouteProvider([
    [route("whole-outside", [[1,1],[11,5],[9,9]], 1000, 60)],
    [
      route("leg1-outside", [[1,1],[11,3],[5,5]], 500, 30),
      route("leg1-inside", [[1,1],[3,3],[5,5]], 600, 40)
    ],
    [
      route("leg2-inside", [[5,5],[7,7],[9,9]], 700, 50)
    ]
  ]);

  const result = await computeProvinceCompliantRoute(pool, provider, {
    provinceId,
    origin: { latitude: 1, longitude: 1 },
    destination: { latitude: 9, longitude: 9 },
    intermediates: [{ latitude: 5, longitude: 5 }]
  });

  assert.equal(provider.calls.length, 3);
  assert.equal(provider.calls[0]?.alternatives, false);
  assert.equal(provider.calls[1]?.alternatives, true);
  assert.equal(provider.calls[2]?.alternatives, true);
  assert.equal(result.distanceMeters, 1300);
  assert.equal(result.durationSeconds, 90);
  assert.deepEqual(result.labels, ["PROVINCE_SEGMENTED_FALLBACK"]);
  assert.match(result.providerRef, /^test-routing-segments-sha256:[0-9a-f]{64}$/);
});

test("blocks the trip when no route candidate remains inside the province", async () => {
  const provinceId = await seedProvince();
  const provider = new QueueRouteProvider([[
    route("outside-a", [[1,1],[11,5],[9,9]]),
    route("outside-b", [[1,1],[-1,5],[9,9]])
  ]]);

  await assert.rejects(
    () => computeProvinceCompliantRoute(pool, provider, {
      provinceId,
      origin: { latitude: 1, longitude: 1 },
      destination: { latitude: 9, longitude: 9 }
    }),
    (error: unknown) => error instanceof DomainError && error.code === "NO_ROUTE_WITHIN_PROVINCE"
  );
});
