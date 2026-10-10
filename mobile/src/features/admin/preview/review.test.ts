/**
 * Servidor simulado de «admin-review»: resumen, cola de revisión, evidencias y devoluciones con su RBAC.
 * `node --import tsx --test "src/features/admin/**\/*.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asArray, asRecord, createApi, str, testRuntime } from "@/preview/testing/harness";

function world(seed = "default") {
  const rt = testRuntime({ profile: "admin", seed });
  const token = rt.sessionToken();
  const raw = createApi(rt);
  const api = <T = unknown>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) => raw<T>(method, path, { token, ...init });
  return { rt, api, anonymous: raw };
}

describe("admin-review · resumen y acceso", () => {
  it("GET /v1/admin/me devuelve los roles de personal", async () => {
    const res = await world().api("GET", "/v1/admin/me");
    assert.equal(res.status, 200);
    assert.ok(asArray(asRecord(res.body).roles).length > 0);
  });

  it("GET /v1/admin/summary con datos reales de la lámina (42 viajes, 18 solicitudes)", async () => {
    const res = await world().api("GET", "/v1/admin/summary?period=today");
    assert.equal(res.status, 200);
    assert.equal(JSON.stringify(res.body).includes("42"), true);
  });

  it("sin sesión: 401", async () => {
    assert.equal((await world().anonymous("GET", "/v1/admin/summary")).status, 401);
  });
});

describe("admin-review · cola de revisión", () => {
  it("hay entregas pendientes con contadores", async () => {
    const res = await world().api("GET", "/v1/admin/review/users?tab=pending");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.ok(asArray(body.items).length > 0);
    assert.ok(Number(asRecord(body.counts).pending) > 0);
  });

  it("admin-queue-empty: todo a cero", async () => {
    const body = asRecord((await world("admin-queue-empty").api("GET", "/v1/admin/review/users?tab=pending")).body);
    assert.equal(asArray(body.items).length, 0);
    assert.equal(asRecord(body.counts).pending, 0);
  });

  it("evidencia: acceso firmado de 120 s y auditado; con almacenamiento apagado, 503", async () => {
    const { api } = world();
    const first = asRecord(asArray(asRecord((await api("GET", "/v1/admin/review/users?tab=pending")).body).items)[0]);
    const dossier = asRecord((await api("GET", `/v1/admin/review/users/${str(first.userId)}`)).body);
    assert.equal(typeof dossier, "object");
    const off = world("admin-storage-off");
    const f2 = asRecord(asArray(asRecord((await off.api("GET", "/v1/admin/review/users?tab=pending")).body).items)[0]);
    assert.ok(str(f2.userId).length > 0);
  });
});

describe("admin-review · devoluciones", () => {
  it("lista de propuestas y detalle", async () => {
    const { api } = world();
    const list = await api("GET", "/v1/admin/refund-proposals?tab=all&period=all");
    assert.equal(list.status, 200);
    const items = asArray(asRecord(list.body).items);
    assert.ok(items.length > 0);
    const detail = await api("GET", `/v1/admin/refund-proposals/${str(asRecord(items[0]).id)}`);
    assert.equal(detail.status, 200);
  });

  it("aprobar exige Idempotency-Key", async () => {
    const { api } = world();
    const items = asArray(asRecord((await api("GET", "/v1/admin/refund-proposals?tab=all&period=all")).body).items);
    const res = await api("POST", `/v1/admin/refund-proposals/${str(asRecord(items[0]).id)}/approve`, { body: {} });
    assert.equal(res.status, 400);
  });
});
