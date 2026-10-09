/**
 * «Mis viajes» (GET /v1/me/trips/overview) en el servidor simulado. `node --import tsx --test "src/features/profile/preview/trips.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asArray, asRecord, createApi, str, testRuntime } from "@/preview/testing/harness";

function world(profile: "passenger" | "driver" = "passenger", seed = "messages-cancel") {
  const rt = testRuntime({ profile, seed, clock: "2026-10-05T07:17:00+02:00" });
  const token = rt.sessionToken();
  const raw = createApi(rt);
  return { rt, api: <T = unknown>(method: string, path: string) => raw<T>(method, path, { token }) };
}
const codeOf = (body: unknown): string => str(asRecord(asRecord(body).error).code, "error.code");

describe("mis viajes", () => {
  it("el pasajero recibe el contrato completo: contadores, próximos, en curso e historial paginado", async () => {
    const { api } = world();
    const res = await api("GET", "/v1/me/trips/overview?role=passenger");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.equal(body.role, "passenger");
    const counts = asRecord(body.counts);
    const upcoming = asArray(body.upcoming).map(asRecord);
    assert.equal(counts.upcoming, upcoming.length);
    assert.equal(counts.inProgress, asArray(body.inProgress).length);
    assert.ok("items" in asRecord(body.history) && "nextCursor" in asRecord(body.history));
  });

  it("cada tarjeta lleva el estado real de la solicitud y nunca una ETA inventada", async () => {
    const { api } = world();
    const body = asRecord((await api("GET", "/v1/me/trips/overview?role=passenger")).body);
    const cards = [...asArray(body.upcoming), ...asArray(body.inProgress), ...asArray(asRecord(body.history).items)].map(asRecord);
    assert.ok(cards.length > 0, "hay al menos una tarjeta con este escenario");
    for (const card of cards) {
      assert.ok(typeof asRecord(card.status).code === "string" && typeof asRecord(card.status).label === "string");
      if (card.kind === "trip") assert.equal(card.liveEta, null);
    }
  });

  it("rol no concedido → 403; rol o sección inválidos → 400; cursor roto → 400", async () => {
    const passenger = world("passenger");
    assert.equal((await passenger.api("GET", "/v1/me/trips/overview?role=driver")).status, 403);
    assert.equal((await passenger.api("GET", "/v1/me/trips/overview")).status, 400);
    assert.equal((await passenger.api("GET", "/v1/me/trips/overview?role=passenger&section=nada")).status, 400);
    const bad = await passenger.api("GET", "/v1/me/trips/overview?role=passenger&cursor=%25%25");
    assert.equal(bad.status, 400);
    assert.equal(codeOf(bad.body), "VALIDATION_ERROR");
  });

  it("sin sesión → 401", async () => {
    const { rt } = world();
    const anonymous = createApi(rt);
    assert.equal((await anonymous("GET", "/v1/me/trips/overview?role=passenger")).status, 401);
  });

  it("el conductor ve sus viajes y el historial se pagina con cursor", async () => {
    const { api } = world("driver", "default");
    const first = asRecord((await api("GET", "/v1/me/trips/overview?role=driver&section=history&limit=1")).body);
    const page = asRecord(first.history);
    assert.ok(asArray(page.items).length <= 1);
    if (page.nextCursor !== null) {
      const second = asRecord((await api("GET", `/v1/me/trips/overview?role=driver&section=history&limit=1&cursor=${encodeURIComponent(str(page.nextCursor, "cursor"))}`)).body);
      assert.notDeepEqual(asRecord(asArray(asRecord(second.history).items)[0]).id, asRecord(asArray(page.items)[0]).id);
    }
  });
});
