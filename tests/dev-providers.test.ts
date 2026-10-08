import test from "node:test";
import assert from "node:assert/strict";
import type { AppConfig } from "../src/config.js";
import { buildSmsVerificationProvider } from "../src/auth/provider.js";
import { DevConsoleSmsProvider } from "../src/dev/dev-sms-provider.js";
import { DevLocalMapsProvider } from "../src/dev/dev-maps-provider.js";

test("dev_console SMS provider is refused outside development", () => {
  for (const nodeEnv of ["production", "test", "staging"]) {
    assert.throws(
      () => buildSmsVerificationProvider({ smsProvider: "dev_console", nodeEnv } as AppConfig),
      /only allowed with NODE_ENV=development/
    );
  }
  assert.equal(buildSmsVerificationProvider({ smsProvider: "dev_console", nodeEnv: "development" } as AppConfig).name, "dev_console");
});

test("dev_console SMS codes are random per challenge and single use", async () => {
  const provider = new DevConsoleSmsProvider();
  const log = console.log;
  const codes: string[] = [];
  console.log = (line: string) => { codes.push(/code=(\d{6})/.exec(line)?.[1] ?? ""); };
  try {
    const a = await provider.start("+34600000001");
    const b = await provider.start("+34600000002");
    assert.equal((await provider.check(a.providerChallengeId, codes[1]!)).approved, codes[0] === codes[1]);
    assert.equal((await provider.check(b.providerChallengeId, codes[1]!)).approved, true);
    assert.equal((await provider.check(b.providerChallengeId, codes[1]!)).approved, false);
  } finally {
    console.log = log;
  }
});

test("dev_local maps labels its routes as estimates and follows every requested point", async () => {
  const maps = new DevLocalMapsProvider();
  const [origin] = await maps.geocodeAddress("dos hermanas");
  const [destination] = await maps.geocodeAddress("ecija");
  assert.ok(origin && destination);
  const [route] = await maps.computeRoutes({ origin: origin.location, destination: destination.location, alternatives: false });
  assert.ok(route);
  assert.deepEqual(route.labels, ["dev_local_estimate"]);
  assert.equal(route.provider, "dev_local");
  assert.deepEqual(route.geometry.coordinates[0], [origin.location.longitude, origin.location.latitude]);
  assert.deepEqual(route.geometry.coordinates.at(-1), [destination.location.longitude, destination.location.latitude]);
  assert.ok(route.distanceMeters > 0 && Number.isInteger(route.distanceMeters));
});
