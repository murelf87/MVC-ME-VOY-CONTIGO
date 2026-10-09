import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import type { GeocodingProvider } from "../src/maps/types.js";
import { registerGeocodingRoutes } from "../src/routes/geocoding-routes.js";
import { createSession } from "../src/auth/session.js";
import { pool } from "../src/db/pool.js";
import { DomainError } from "../src/errors.js";

const provider: GeocodingProvider = {
  name: "stub",
  async geocodeAddress(address) {
    return [{
      provider: "stub",
      placeId: "place-1",
      formattedAddress: address,
      location: { latitude: 37.3, longitude: -6.0 },
      types: ["locality"]
    }];
  },
  async reverseGeocode(location) {
    return [{
      provider: "stub",
      placeId: "place-2",
      formattedAddress: "Reverse result",
      location,
      types: ["street_address"]
    }];
  }
};

let app = Fastify();

async function createPassengerSession(): Promise<string> {
  const user = (await pool.query(
    `insert into app_users default values returning id`
  )).rows[0];
  await pool.query(
    `insert into user_roles(user_id,role) values($1,'passenger')`,
    [user.id]
  );
  await pool.query(
    `insert into profiles(user_id) values($1)`,
    [user.id]
  );

  const client = await pool.connect();
  try {
    const session = await createSession(client, user.id, 3600);
    return session.token;
  } finally {
    client.release();
  }
}

before(async () => {
  app = Fastify();
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
        requestId: request.id
      });
    }
    throw error;
  });
  await registerGeocodingRoutes(app, pool, provider);
  await app.ready();
});

beforeEach(async () => {
  await pool.query(
    `truncate table
      auth_sessions,auth_challenges,profiles,user_roles,app_users
     restart identity cascade`
  );
});

after(async () => {
  await app.close();
  await pool.end();
});

test("a guest can geocode, but an invalid or malformed token is rejected", async () => {
  const guest = await app.inject({ method: "GET", url: "/v1/maps/geocode?query=Sevilla" });
  assert.equal(guest.statusCode, 200);

  const guestReverse = await app.inject({ method: "GET", url: "/v1/maps/reverse?latitude=37.3&longitude=-6" });
  assert.equal(guestReverse.statusCode, 200);

  const unknown = await app.inject({
    method: "GET",
    url: "/v1/maps/geocode?query=Sevilla",
    headers: { authorization: "Bearer mvc_sess_no-existe" }
  });
  assert.equal(unknown.statusCode, 401);

  const malformed = await app.inject({
    method: "GET",
    url: "/v1/maps/geocode?query=Sevilla",
    headers: { authorization: "Token abc" }
  });
  assert.equal(malformed.statusCode, 401);
  const body = malformed.json() as { error: { code: string } };
  assert.equal(body.error.code, "AUTH_INVALID");
});

test("authenticated geocoding delegates to the configured provider", async () => {
  const token = await createPassengerSession();
  const response = await app.inject({
    method: "GET",
    url: "/v1/maps/geocode?query=Palomares%20del%20Rio",
    headers: { authorization: `Bearer ${token}` }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    results: Array<{ provider: string; formattedAddress: string }>;
  };
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0]?.provider, "stub");
  assert.equal(body.results[0]?.formattedAddress, "Palomares del Rio");
});

test("authenticated reverse geocoding delegates coordinates", async () => {
  const token = await createPassengerSession();
  const response = await app.inject({
    method: "GET",
    url: "/v1/maps/reverse?latitude=37.3&longitude=-6",
    headers: { authorization: `Bearer ${token}` }
  });

  assert.equal(response.statusCode, 200);
  const body = response.json() as {
    results: Array<{ location: { latitude: number; longitude: number } }>;
  };
  assert.equal(body.results[0]?.location.latitude, 37.3);
  assert.equal(body.results[0]?.location.longitude, -6);
});
