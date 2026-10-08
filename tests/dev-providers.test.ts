import test from "node:test";
import assert from "node:assert/strict";
import { buildEmailProvider } from "../src/email/provider.js";
import { DevLocalMapsProvider } from "../src/dev/dev-maps-provider.js";

test("dev_console email provider is refused outside development and only logs", async () => {
  for (const nodeEnv of ["production", "test", "staging"]) {
    assert.throws(() => buildEmailProvider({ emailProvider: "dev_console", nodeEnv }), /only allowed with NODE_ENV=development/);
  }
  const provider = buildEmailProvider({ emailProvider: "dev_console", nodeEnv: "development" });
  assert.equal(provider.name, "dev_console");
  const log = console.log;
  const lines: string[] = [];
  console.log = (line: string) => { lines.push(line); };
  try { await provider.send({ to: "a@b.es", subject: "S", text: "T" }); } finally { console.log = log; }
  assert.match(lines[0] ?? "", /\[DEV EMAIL\] to=a@b\.es/);
  await assert.rejects(() => buildEmailProvider({ emailProvider: "disabled", nodeEnv: "production" }).send({ to: "a@b.es", subject: "S", text: "T" }),
    /not configured/);
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
