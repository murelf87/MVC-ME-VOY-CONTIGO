import test from "node:test";
import assert from "node:assert/strict";
import { GoogleMapsProvider } from "../src/maps/google-maps-provider.js";

test("Google Routes requests high-quality GeoJSON and alternatives without intermediates", async () => {
  let capturedUrl = "";
  let capturedInit: RequestInit | undefined;

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedInit = init;
    return new Response(JSON.stringify({
      routes: [{
        distanceMeters: 12345,
        duration: "901.2s",
        routeLabels: ["DEFAULT_ROUTE"],
        polyline: {
          geoJsonLinestring: {
            type: "LineString",
            coordinates: [[-5.99,37.38],[-5.95,37.40]]
          }
        }
      }]
    }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  const provider = new GoogleMapsProvider("test-key", fakeFetch);
  const routes = await provider.computeRoutes({
    origin: { latitude: 37.38, longitude: -5.99 },
    destination: { latitude: 37.40, longitude: -5.95 },
    alternatives: true
  });

  assert.equal(capturedUrl, "https://routes.googleapis.com/directions/v2:computeRoutes");
  const body = JSON.parse(String(capturedInit?.body));
  assert.equal(body.computeAlternativeRoutes, true);
  assert.equal(body.polylineEncoding, "GEO_JSON_LINESTRING");
  assert.equal(body.polylineQuality, "HIGH_QUALITY");
  assert.equal(routes[0]?.distanceMeters, 12345);
  assert.equal(routes[0]?.durationSeconds, 902);
  assert.match(routes[0]?.providerRef ?? "", /^google-routes-sha256:[0-9a-f]{64}$/);
});

test("Google Routes disables alternatives when intermediate waypoints exist", async () => {
  let body: Record<string, unknown> = {};
  const fakeFetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({
      routes: [{
        distanceMeters: 1000,
        duration: "60s",
        polyline: { geoJsonLinestring: { type: "LineString", coordinates: [[0,0],[1,1]] } }
      }]
    }), { status: 200 });
  }) as typeof fetch;

  const provider = new GoogleMapsProvider("test-key", fakeFetch);
  await provider.computeRoutes({
    origin: { latitude: 0, longitude: 0 },
    destination: { latitude: 1, longitude: 1 },
    intermediates: [{ latitude: 0.5, longitude: 0.5 }],
    alternatives: true
  });

  assert.equal(body.computeAlternativeRoutes, false);
  assert.equal(Array.isArray(body.intermediates), true);
});

test("Google Geocoding v4 parses address results without exposing API key in URL", async () => {
  let capturedUrl = "";
  let capturedHeaders: HeadersInit | undefined;

  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = String(input);
    capturedHeaders = init?.headers;
    return new Response(JSON.stringify({
      results: [{
        placeId: "place-1",
        formattedAddress: "Sevilla, España",
        location: { latitude: 37.3891, longitude: -5.9845 },
        types: ["locality"]
      }]
    }), { status: 200 });
  }) as typeof fetch;

  const provider = new GoogleMapsProvider("secret-test-key", fakeFetch);
  const results = await provider.geocodeAddress("Sevilla");

  assert.equal(capturedUrl.includes("secret-test-key"), false);
  assert.match(capturedUrl, /geocode\.googleapis\.com\/v4\/geocode\/address\/Sevilla/);
  assert.equal(results[0]?.placeId, "place-1");
  assert.deepEqual(results[0]?.location, { latitude: 37.3891, longitude: -5.9845 });
  assert.ok(capturedHeaders);
});
