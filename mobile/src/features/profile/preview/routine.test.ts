/**
 * Servidor simulado de favoritos, rutina y planes. `node --import tsx --test "src/features/profile/preview/*.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asArray, asRecord, createApi, str, testRuntime } from "@/preview/testing/harness";

type Profile = "new" | "passenger" | "driver";

function world(options: { profile?: Profile; seed?: string; clock?: string } = {}) {
  const rt = testRuntime({ profile: options.profile ?? "driver", seed: options.seed ?? "profile-routine", ...(options.clock ? { clock: options.clock } : {}) });
  const token = rt.sessionToken();
  const raw = createApi(rt);
  const api = <T = unknown>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => raw<T>(method, path, { token, ...init });
  return { rt, api, anonymous: raw };
}
const codeOf = (body: unknown): string => str(asRecord(asRecord(body).error).code, "error.code");
const SEVILLA = { lat: 37.39, lng: -5.99 };

describe("favoritos", () => {
  it("lista los tres destinos de la lámina 31 en orden de creación", async () => {
    const { api } = world();
    const body = asRecord((await api("GET", "/v1/me/favorites")).body);
    const items = asArray(body.items).map(asRecord);
    assert.deepEqual(items.map((i) => i.name), ["Trabajo", "Campus", "Casa"]);
    assert.equal(items[0]?.address, "Torre Sevilla, Sevilla");
  });

  it("crea un destino (201), normaliza espacios y exige estar dentro de una provincia", async () => {
    const { api } = world({ seed: "profile-routine-empty" });
    const ok = await api("POST", "/v1/me/favorites", { body: { kind: "other", name: "  Gimnasio   Centro ", address: "Calle Sierpes 1", ...SEVILLA }, headers: { "Idempotency-Key": "9b2f6c1e-3a5d-4e7f-8a0b-1c2d3e4f5a6b" } });
    assert.equal(ok.status, 201);
    assert.equal(asRecord(ok.body).name, "Gimnasio Centro");
    const outside = await api("POST", "/v1/me/favorites", { body: { kind: "other", name: "Madrid", address: "Gran Vía", lat: 40.42, lng: -3.7 } });
    assert.equal(outside.status, 422);
    assert.equal(codeOf(outside.body), "FAVORITE_OUTSIDE_PROVINCES");
  });

  it("20 destinos es el máximo: el 21 responde 409", async () => {
    const { api } = world({ seed: "profile-favorites-full" });
    const res = await api("POST", "/v1/me/favorites", { body: { kind: "other", name: "Uno más", address: "Calle 1", ...SEVILLA } });
    assert.equal(res.status, 409);
    assert.equal(codeOf(res.body), "FAVORITES_LIMIT_REACHED");
  });

  it("no se borra un destino que usa la rutina (409 FAVORITE_IN_USE) y sí uno libre", async () => {
    const { api } = world();
    const places = asArray(asRecord((await api("GET", "/v1/me/favorites")).body).items).map(asRecord);
    const casa = places.find((p) => p.name === "Casa");
    const trabajo = places.find((p) => p.name === "Trabajo");
    const blocked = await api("DELETE", `/v1/me/favorites/${str(casa?.id, "id")}`);
    assert.equal(blocked.status, 409);
    assert.equal(codeOf(blocked.body), "FAVORITE_IN_USE");
    const free = await api("DELETE", `/v1/me/favorites/${str(trabajo?.id, "id")}`);
    assert.equal(free.status, 204);
  });

  it("mover un destino exige lat y lng juntas", async () => {
    const { api } = world();
    const id = str(asRecord(asArray(asRecord((await api("GET", "/v1/me/favorites")).body).items)[0]).id, "id");
    const res = await api("PATCH", `/v1/me/favorites/${id}`, { body: { lat: 37.4 } });
    assert.equal(res.status, 422);
  });
});

describe("rutina", () => {
  it("devuelve la rutina Casa → Campus de lunes a viernes 07:30 y la plaza semanal", async () => {
    const { api } = world();
    const body = asRecord((await api("GET", "/v1/me/routine")).body);
    const entries = asArray(body.entries).map(asRecord);
    assert.deepEqual(entries.map((e) => e.weekday), ["mon", "tue", "wed", "thu", "fri"]);
    assert.equal(entries[0]?.time, "07:30");
    assert.equal(asRecord(entries[0]?.fromPlace).name, "Casa");
    assert.equal(asRecord(entries[0]?.toPlace).name, "Campus");
    const offer = asRecord(body.weeklyOffer);
    assert.equal(offer.enabled, true);
    assert.equal(offer.seats, 1);
    assert.equal(asRecord(asRecord(offer.conditions).price).status, "pending_definition");
    assert.equal(asRecord(body.nextWeek).weekStart, "2026-10-12");
    assert.equal(asRecord(body.nextWeek).suspended, false);
  });

  it("no crea filas repetidas (409 con los días) ni con el mismo origen y destino (422)", async () => {
    const { api } = world();
    const routine = asRecord((await api("GET", "/v1/me/routine")).body);
    const first = asRecord(asArray(routine.entries)[0]);
    const from = str(asRecord(first.fromPlace).id, "from");
    const to = str(asRecord(first.toPlace).id, "to");
    const dup = await api("POST", "/v1/me/routine/entries", { body: { weekdays: ["mon", "sat"], time: "07:30", fromPlaceId: from, toPlaceId: to } });
    assert.equal(dup.status, 409);
    assert.equal(codeOf(dup.body), "ROUTINE_ENTRY_EXISTS");
    assert.equal((await asRecord((await api("GET", "/v1/me/routine")).body).entries as unknown[]).length, 5, "no se creó ninguna");
    const same = await api("POST", "/v1/me/routine/entries", { body: { weekdays: ["sat"], time: "09:00", fromPlaceId: from, toPlaceId: from } });
    assert.equal(same.status, 422);
    assert.equal(codeOf(same.body), "ROUTINE_SAME_PLACE");
    const bad = await api("POST", "/v1/me/routine/entries", { body: { weekdays: ["sat"], time: "9:00", fromPlaceId: from, toPlaceId: to } });
    assert.equal(bad.status, 400);
  });

  it("crea, edita (activar/desactivar) y elimina una fila", async () => {
    const { api } = world();
    const routine = asRecord((await api("GET", "/v1/me/routine")).body);
    const first = asRecord(asArray(routine.entries)[0]);
    const from = str(asRecord(first.fromPlace).id, "from");
    const to = str(asRecord(first.toPlace).id, "to");
    const created = await api("POST", "/v1/me/routine/entries", { body: { weekdays: ["sat"], time: "10:00", fromPlaceId: from, toPlaceId: to } });
    assert.equal(created.status, 201);
    const id = str(asRecord(asArray(asRecord(created.body).items)[0]).id, "id");
    const patched = await api("PATCH", `/v1/me/routine/entries/${id}`, { body: { enabled: false } });
    assert.equal(asRecord(patched.body).enabled, false);
    assert.equal((await api("PATCH", `/v1/me/routine/entries/${id}`, { body: {} })).status, 400);
    assert.equal((await api("DELETE", `/v1/me/routine/entries/${id}`)).status, 204);
    assert.equal((await api("DELETE", `/v1/me/routine/entries/${id}`)).status, 404);
  });

  it("suspender la próxima semana: 201 y luego 200 (idempotente); reanudar es 204", async () => {
    const { api } = world();
    const first = await api("POST", "/v1/me/routine/suspensions", { body: {} });
    assert.equal(first.status, 201);
    assert.equal(asRecord(first.body).weekStart, "2026-10-12");
    assert.equal(asRecord(first.body).withdrawnRequests, 0);
    const again = await api("POST", "/v1/me/routine/suspensions", { body: {} });
    assert.equal(again.status, 200);
    assert.equal(asRecord(asRecord((await api("GET", "/v1/me/routine")).body).nextWeek).suspended, true);
    assert.equal((await api("DELETE", "/v1/me/routine/suspensions/2026-10-12")).status, 204);
    assert.equal(asRecord(asRecord((await api("GET", "/v1/me/routine")).body).nextWeek).suspended, false);
    assert.equal(codeOf((await api("POST", "/v1/me/routine/suspensions", { body: { weekStart: "2026-10-13" } })).body), "INVALID_WEEK_START");
    assert.equal(codeOf((await api("POST", "/v1/me/routine/suspensions", { body: { weekStart: "2026-09-28" } })).body), "INVALID_WEEK_START");
  });

  it("la plaza semanal es una preferencia solo del conductor (1–8 plazas)", async () => {
    const { api } = world();
    const ok = await api("PUT", "/v1/me/routine/weekly-offer", { body: { enabled: true, seats: 3 } });
    assert.equal(ok.status, 200);
    assert.equal(asRecord(ok.body).seats, 3);
    assert.equal((await api("PUT", "/v1/me/routine/weekly-offer", { body: { enabled: true, seats: 9 } })).status, 422);
    const pax = world({ profile: "passenger", seed: "profile-routine" });
    assert.equal((await pax.api("PUT", "/v1/me/routine/weekly-offer", { body: { enabled: true, seats: 1 } })).status, 403);
  });

  it("sin sesión responde 401", async () => {
    const { anonymous } = world();
    assert.equal((await anonymous("GET", "/v1/me/routine")).status, 401);
  });
});

describe("planes", () => {
  it("el catálogo no ofrece compra: gratis activo, Premium Conductor en propuesta y Membresía no disponible", async () => {
    const { api } = world();
    const items = asArray(asRecord((await api("GET", "/v1/plans")).body).items).map(asRecord);
    assert.deepEqual(items.map((i) => [i.code, i.status]), [["free", "active"], ["premium_driver", "proposal"], ["membership", "unavailable"]]);
    assert.equal(asRecord(items[1]?.price).status, "pending_definition");
    const mine = asRecord((await api("GET", "/v1/me/plan")).body);
    assert.equal(mine.planCode, "free");
    assert.equal(mine.purchasable, false);
  });
});
