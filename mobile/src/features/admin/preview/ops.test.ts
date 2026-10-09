/**
 * Servidor simulado de «admin-ops»: tarifas, operación, alertas y auditoría con su RBAC. Se ejecuta con:
 * `node --import tsx --test "src/features/admin/**\/*.test.ts"` (desde `mobile/`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { asArray, asRecord, createApi, num, str, testRuntime, tokenFor } from "@/preview/testing/harness";

function world(options: { seed?: string; as?: "ana" | "miguel" } = {}) {
  const rt = testRuntime({ profile: "admin", seed: options.seed ?? "default" });
  const token = options.as !== undefined ? tokenFor(rt, options.as) : rt.sessionToken();
  const raw = createApi(rt);
  const api = <T = unknown>(method: string, path: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
    raw<T>(method, path, { token, ...init });
  return { rt, api, anonymous: raw };
}

function codeOf(body: unknown): string {
  return str(asRecord(asRecord(body).error).code, "error.code");
}

const RANDOM_UUID = "7b0f3c1e-5d2a-4f6b-9a1c-0d3e5f7a9b1c";

async function auditActions(api: ReturnType<typeof world>["api"], query = ""): Promise<string[]> {
  const res = await api("GET", `/v1/admin/audit-events?limit=50${query}`);
  assert.equal(res.status, 200);
  return asArray(asRecord(res.body).items).map((item) => str(asRecord(item).action));
}

describe("tarifas · GET /v1/admin/tariffs", () => {
  it("estado real: sin tarifa en vigor, borrador con 0,30 €/km, comisiones por definir y activación bloqueada", async () => {
    const { api } = world();
    const res = await api("GET", "/v1/admin/tariffs");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.equal(body.active, null);
    const draft = asRecord(body.draft);
    assert.equal(draft.ratePerKmMicros, 300000);
    assert.equal(draft.passengerCommissionBps, null);
    assert.equal(draft.driverCommissionBps, null);
    assert.equal(draft.premiumMonthlyCents, null);
    assert.equal(draft.notes, "Propuesta pendiente de decisión");
    const activation = asRecord(body.activation);
    assert.equal(activation.mode, "disabled");
    assert.equal(activation.canPublish, false);
    assert.equal(body.applyNote, "Los cambios de tarifas afectan solo a futuras reservas. No se modifican reservas confirmadas.");
    assert.equal(body.auditNote, "Registro en auditoría privada de MVC");
  });

  it("lámina 40b: borrador con 0,18 €/km y comisiones del 10 %", async () => {
    const { api } = world({ seed: "admin-ops-tariff-b" });
    const draft = asRecord(asRecord((await api("GET", "/v1/admin/tariffs")).body).draft);
    assert.equal(draft.ratePerKmMicros, 180000);
    assert.equal(draft.passengerCommissionBps, 1000);
    assert.equal(draft.driverCommissionBps, 1000);
  });

  it("sin sesión: 401; sin token válido, no se filtra nada", async () => {
    const { anonymous } = world();
    const res = await anonymous("GET", "/v1/admin/tariffs");
    assert.equal(res.status, 401);
  });
});

describe("tarifas · borrador y ejemplo", () => {
  it("PUT draft actualiza el único borrador y queda auditado; no activa nada", async () => {
    const { api } = world();
    const res = await api("PUT", "/v1/admin/tariffs/draft", {
      body: { ratePerKmMicros: 180000, passengerCommissionBps: 1000, driverCommissionBps: 1000, premiumMonthlyCents: null, notes: "  Revisar en enero " },
    });
    assert.equal(res.status, 200);
    const saved = asRecord(res.body);
    assert.equal(saved.status, "draft");
    assert.equal(saved.version, 1);
    assert.equal(saved.ratePerKmMicros, 180000);
    assert.equal(saved.notes, "Revisar en enero");
    const overview = asRecord((await api("GET", "/v1/admin/tariffs")).body);
    assert.equal(overview.active, null);
    assert.equal(asRecord(overview.draft).id, saved.id);
    assert.ok((await auditActions(api)).includes("admin.tariff_draft.saved"));
  });

  it("valores fuera de rango: 422 TARIFF_INVALID con los campos", async () => {
    const { api } = world();
    const res = await api("PUT", "/v1/admin/tariffs/draft", {
      body: { ratePerKmMicros: 9_000_000, passengerCommissionBps: 20000, driverCommissionBps: null, premiumMonthlyCents: null },
    });
    assert.equal(res.status, 422);
    assert.equal(codeOf(res.body), "TARIFF_INVALID");
    const fields = asArray(asRecord(asRecord(asRecord(res.body).error).details).fields).map((f) => str(asRecord(f).field));
    assert.deepEqual(fields, ["ratePerKmMicros", "passengerCommissionBps"]);
  });

  it("un cuerpo sin los cuatro campos obligatorios: 400 VALIDATION_ERROR", async () => {
    const { api } = world();
    const res = await api("PUT", "/v1/admin/tariffs/draft", { body: { ratePerKmMicros: 1 } });
    assert.equal(res.status, 400);
    assert.equal(codeOf(res.body), "VALIDATION_ERROR");
  });

  it("sin borrador, el primer guardado crea la versión 1", async () => {
    const { api } = world({ seed: "admin-ops-no-draft" });
    const before = asRecord((await api("GET", "/v1/admin/tariffs")).body);
    assert.equal(before.draft, null);
    const res = await api("PUT", "/v1/admin/tariffs/draft", {
      body: { ratePerKmMicros: 150000, passengerCommissionBps: null, driverCommissionBps: null, premiumMonthlyCents: null },
    });
    assert.equal(res.status, 200);
    assert.equal(asRecord(res.body).version, 1);
  });

  it("ejemplo: 18 km × 0,18 €/km y 10 %/10 % → aportación 324, comisión 32, total 356, neto 292 (ilustrativos)", async () => {
    const { api } = world();
    const res = await api("POST", "/v1/admin/tariffs/example", {
      body: { distanceMeters: 18000, ratePerKmMicros: 180000, passengerCommissionBps: 1000, driverCommissionBps: 1000 },
    });
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.equal(asRecord(body.contribution).cents, 324);
    assert.equal(asRecord(body.contribution).status, "illustrative");
    assert.equal(asRecord(body.passengerCommission).cents, 32);
    assert.equal(asRecord(body.passengerTotal).cents, 356);
    assert.equal(asRecord(body.driverCommission).cents, 32);
    assert.equal(asRecord(body.driverNet).cents, 292);
    assert.equal(body.roundingRule, "half_up_cents");
  });

  it("ejemplo con 0,30 €/km y sin comisiones: 540 y el resto «Por definir»", async () => {
    const { api } = world();
    const body = asRecord((await api("POST", "/v1/admin/tariffs/example", { body: { distanceMeters: 18000, ratePerKmMicros: 300000 } })).body);
    assert.equal(asRecord(body.contribution).cents, 540);
    for (const key of ["passengerCommission", "driverCommission", "passengerTotal", "driverNet"]) {
      assert.equal(asRecord(body[key]).status, "pending_definition");
      assert.equal(asRecord(body[key]).cents, null);
    }
  });

  it("el ejemplo no guarda nada y valida la distancia (422)", async () => {
    const { api } = world();
    const bad = await api("POST", "/v1/admin/tariffs/example", { body: { distanceMeters: 0 } });
    assert.equal(bad.status, 422);
    assert.equal(codeOf(bad.body), "TARIFF_INVALID");
    const before = asRecord(asRecord((await api("GET", "/v1/admin/tariffs")).body).draft);
    await api("POST", "/v1/admin/tariffs/example", { body: { distanceMeters: 1000, ratePerKmMicros: 1 } });
    const after = asRecord(asRecord((await api("GET", "/v1/admin/tariffs")).body).draft);
    assert.equal(after.updatedAt, before.updatedAt);
  });

  it("historial: más recientes primero con cursor opaco", async () => {
    const { api } = world({ seed: "admin-ops-tariff-history" });
    const res = await api("GET", "/v1/admin/tariffs/versions?limit=2");
    assert.equal(res.status, 200);
    const page = asRecord(res.body);
    const items = asArray(page.items).map((item) => asRecord(item));
    assert.deepEqual(items.map((item) => item.version), [3, 2]);
    assert.deepEqual(items.map((item) => item.status), ["draft", "approved"]);
    assert.equal(typeof page.nextCursor, "string");
    const next = asRecord((await api("GET", `/v1/admin/tariffs/versions?limit=2&cursor=${encodeURIComponent(str(page.nextCursor))}`)).body);
    assert.deepEqual(asArray(next.items).map((item) => asRecord(item).version), [1]);
    assert.equal(next.nextCursor, null);
    assert.equal(asRecord((await api("GET", "/v1/admin/tariffs")).body).active !== null, true);
  });
});

describe("tarifas · activación (puerta dura)", () => {
  it("con ECONOMICS_ACTIVATION=disabled responde 409 ANTES de validar el cuerpo y audita el intento", async () => {
    const { api } = world();
    const draftId = str(asRecord(asRecord((await api("GET", "/v1/admin/tariffs")).body).draft).id);
    for (const body of [undefined, {}, { approvalReference: "x" }, { approvalReference: "Acta 1", effectiveFrom: "2030-01-01T00:00:00Z" }]) {
      const res = await api("POST", `/v1/admin/tariffs/versions/${draftId}/publish`, body === undefined ? {} : { body });
      assert.equal(res.status, 409);
      assert.equal(codeOf(res.body), "ECONOMICS_ACTIVATION_DISABLED");
    }
    const notFound = await api("POST", "/v1/admin/tariffs/versions/no-es-un-uuid/publish", {});
    assert.equal(notFound.status, 409);
    const tariffs = asRecord((await api("GET", "/v1/admin/tariffs")).body);
    assert.equal(asRecord(tariffs.draft).status, "draft");
    assert.equal(tariffs.active, null);
    assert.ok((await auditActions(api, "&action=admin.tariff.publish_attempted")).length >= 5);
  });

  it("habilitada: exige referencia, fecha futura y borrador completo; después queda aprobada", async () => {
    const { api } = world({ seed: "admin-ops-activation-enabled" });
    const overview = asRecord((await api("GET", "/v1/admin/tariffs")).body);
    assert.equal(asRecord(overview.activation).canPublish, true);
    const draftId = str(asRecord(overview.draft).id);
    const publish = (body: unknown) => api("POST", `/v1/admin/tariffs/versions/${draftId}/publish`, { body });

    const noRef = await publish({ approvalReference: "  ", effectiveFrom: "2031-01-01T00:00:00.000Z" });
    assert.equal(noRef.status, 422);
    assert.equal(codeOf(noRef.body), "APPROVAL_REFERENCE_REQUIRED");
    const past = await publish({ approvalReference: "Acta 2026-10", effectiveFrom: "2020-01-01T00:00:00.000Z" });
    assert.equal(codeOf(past.body), "TARIFF_EFFECTIVE_FROM_INVALID");
    const unknown = await api("POST", `/v1/admin/tariffs/versions/${RANDOM_UUID}/publish`, {
      body: { approvalReference: "Acta 2026-10", effectiveFrom: "2031-01-01T00:00:00.000Z" },
    });
    assert.equal(unknown.status, 404);
    assert.equal(codeOf(unknown.body), "TARIFF_NOT_FOUND");

    const ok = await publish({ approvalReference: "Acta 2026-10", effectiveFrom: "2031-01-01T00:00:00.000Z" });
    assert.equal(ok.status, 200);
    assert.equal(asRecord(ok.body).status, "approved");
    assert.equal(asRecord(ok.body).approvalReference, "Acta 2026-10");
    const again = await publish({ approvalReference: "Acta 2026-10", effectiveFrom: "2031-01-01T00:00:00.000Z" });
    assert.equal(codeOf(again.body), "TARIFF_NOT_DRAFT");
    assert.ok((await auditActions(api)).includes("admin.tariff.published"));
  });

  it("un borrador incompleto no se puede publicar (422 TARIFF_DRAFT_INCOMPLETE)", async () => {
    const { api } = world({ seed: "admin-ops-activation-enabled" });
    const saved = asRecord(
      (await api("PUT", "/v1/admin/tariffs/draft", { body: { ratePerKmMicros: 180000, passengerCommissionBps: null, driverCommissionBps: 1000, premiumMonthlyCents: null } })).body,
    );
    const res = await api("POST", `/v1/admin/tariffs/versions/${str(saved.id)}/publish`, {
      body: { approvalReference: "Acta 2026-10", effectiveFrom: "2031-01-01T00:00:00.000Z" },
    });
    assert.equal(res.status, 422);
    assert.equal(codeOf(res.body), "TARIFF_DRAFT_INCOMPLETE");
    assert.deepEqual(asRecord(asRecord(asRecord(res.body).error).details).missing, ["passengerCommissionBps"]);
  });
});

describe("operación", () => {
  it("lectura: provincia bloqueada y tres reglas con sus parámetros", async () => {
    const { api } = world();
    const res = await api("GET", "/v1/admin/operations");
    assert.equal(res.status, 200);
    const body = asRecord(res.body);
    assert.deepEqual(body.provinceOnly, { enabled: true, locked: true, label: "Solo trayectos dentro de la provincia" });
    const alerts = asRecord(body.realtimeAlerts);
    assert.equal(alerts.enabled, true);
    const rules = asArray(alerts.rules).map((rule) => asRecord(rule));
    assert.deepEqual(rules.map((rule) => rule.kind), ["unusual_cancellations", "schedule_price_changes", "route_incidents"]);
    assert.deepEqual(rules[0]?.params, { thresholdCount: 5, windowMinutes: 60 });
    assert.equal(rules[2]?.source, "available");
  });

  it("PUT: cambia una regla y los parámetros, y audita el antes y el después", async () => {
    const { api } = world();
    const res = await api("PUT", "/v1/admin/operations", {
      body: { rules: [{ kind: "unusual_cancellations", enabled: false, params: { thresholdCount: 8 } }] },
    });
    assert.equal(res.status, 200);
    const rule = asRecord(asArray(asRecord(asRecord(res.body).realtimeAlerts).rules)[0]);
    assert.equal(rule.enabled, false);
    assert.deepEqual(rule.params, { thresholdCount: 8, windowMinutes: 60 });
    assert.notEqual(asRecord(res.body).updatedAt, null);
    const events = asArray(asRecord((await api("GET", "/v1/admin/audit-events?action=admin.operations.updated")).body).items).map((e) => asRecord(e));
    assert.ok(events.length >= 1);
    const changes = asRecord(asRecord(events[0]?.metadata).changes);
    assert.deepEqual(asRecord(asRecord(changes.unusual_cancellations).before).params, { thresholdCount: 5, windowMinutes: 60 });
  });

  it("«solo provincia» no se puede desactivar (422) y los parámetros fuera de rango se rechazan (400)", async () => {
    const { api } = world();
    const locked = await api("PUT", "/v1/admin/operations", { body: { provinceOnly: false } });
    assert.equal(locked.status, 422);
    assert.equal(codeOf(locked.body), "PROVINCE_ONLY_LOCKED");
    const range = await api("PUT", "/v1/admin/operations", { body: { rules: [{ kind: "unusual_cancellations", params: { windowMinutes: 2 } }] } });
    assert.equal(range.status, 400);
    assert.equal(codeOf(range.body), "VALIDATION_ERROR");
    const unknown = await api("PUT", "/v1/admin/operations", { body: { rules: [{ kind: "schedule_price_changes", params: { thresholdCount: 2 } }] } });
    assert.equal(unknown.status, 400);
    const after = asRecord((await api("GET", "/v1/admin/operations")).body);
    assert.deepEqual(asRecord(asArray(asRecord(after.realtimeAlerts).rules)[0]).params, { thresholdCount: 5, windowMinutes: 60 });
  });

  it("sin la fuente de incidencias, la regla lo dice y no se evalúa", async () => {
    const { api } = world({ seed: "admin-ops-no-incident-source" });
    const rules = asArray(asRecord(asRecord((await api("GET", "/v1/admin/operations")).body).realtimeAlerts).rules).map((rule) => asRecord(rule));
    assert.equal(rules[2]?.source, "unavailable");
    assert.equal(rules[2]?.sourceNote, "La fuente de incidencias (módulo live) aún no está disponible.");
    const evaluation = asRecord((await api("POST", "/v1/admin/alerts/evaluate")).body);
    const incidents = asArray(evaluation.rules).map((rule) => asRecord(rule)).find((rule) => rule.kind === "route_incidents");
    assert.equal(incidents?.skippedReason, "source_unavailable");
  });
});

describe("alertas", () => {
  it("por defecto hay dos abiertas, una reconocida y las resueltas; el filtro y el cursor funcionan", async () => {
    const { api } = world();
    const open = asRecord((await api("GET", "/v1/admin/alerts?status=open")).body);
    const items = asArray(open.items).map((item) => asRecord(item));
    assert.equal(items.length, 2);
    assert.deepEqual(items.map((item) => item.kind), ["route_incidents", "unusual_cancellations"]);
    assert.equal(asRecord(items[0]?.province).name, "Sevilla");
    const all = asRecord((await api("GET", "/v1/admin/alerts?status=all&limit=2")).body);
    assert.equal(asArray(all.items).length, 2);
    assert.equal(typeof all.nextCursor, "string");
    const onlyKind = asRecord((await api("GET", "/v1/admin/alerts?status=all&kind=schedule_price_changes")).body);
    assert.equal(asArray(onlyKind.items).length, 1);
    assert.equal((await api("GET", "/v1/admin/alerts?status=desconocido")).status, 400);
  });

  it("reconocer → resolver; resolver no vuelve atrás (409) y una alerta que no existe es 404", async () => {
    const { api } = world();
    const items = asArray(asRecord((await api("GET", "/v1/admin/alerts?status=open")).body).items).map((item) => asRecord(item));
    const id = str(items[0]?.id);
    const ack = await api("POST", `/v1/admin/alerts/${id}/status`, { body: { status: "acknowledged" } });
    assert.equal(ack.status, 200);
    assert.equal(asRecord(ack.body).status, "acknowledged");
    assert.notEqual(asRecord(ack.body).acknowledgedAt, null);
    const again = await api("POST", `/v1/admin/alerts/${id}/status`, { body: { status: "acknowledged" } });
    assert.equal(again.status, 409);
    assert.equal(codeOf(again.body), "ALERT_INVALID_TRANSITION");
    const resolved = await api("POST", `/v1/admin/alerts/${id}/status`, { body: { status: "resolved" } });
    assert.equal(asRecord(resolved.body).status, "resolved");
    const back = await api("POST", `/v1/admin/alerts/${id}/status`, { body: { status: "acknowledged" } });
    assert.equal(back.status, 409);
    const missing = await api("POST", `/v1/admin/alerts/${RANDOM_UUID}/status`, { body: { status: "resolved" } });
    assert.equal(missing.status, 404);
    assert.equal(codeOf(missing.body), "ALERT_NOT_FOUND");
    assert.ok((await auditActions(api, "&action=admin.alert.status_changed")).length >= 2);
  });

  it("evaluar con eventos reales: con cancelaciones recientes nace una alerta; sin ellas no se inventa nada", async () => {
    const quiet = world({ seed: "admin-ops-alerts-empty" });
    const none = asRecord((await quiet.api("POST", "/v1/admin/alerts/evaluate")).body);
    assert.equal(none.created, 0);
    assert.equal(asRecord((await quiet.api("GET", "/v1/admin/alerts?status=all")).body).items instanceof Array, true);
    assert.equal(asArray(asRecord((await quiet.api("GET", "/v1/admin/alerts?status=all")).body).items).length, 0);

    const busy = world({ seed: "admin-ops-alerts-evaluable" });
    const first = asRecord((await busy.api("POST", "/v1/admin/alerts/evaluate")).body);
    assert.equal(first.created, 1);
    const open = asArray(asRecord((await busy.api("GET", "/v1/admin/alerts?status=open")).body).items).map((item) => asRecord(item));
    assert.equal(open.length, 1);
    assert.equal(open[0]?.kind, "unusual_cancellations");
    assert.match(str(open[0]?.body), /reservas canceladas en los últimos 60 minutos \(umbral: 5\)/);
    const second = asRecord((await busy.api("POST", "/v1/admin/alerts/evaluate")).body);
    assert.equal(second.created, 0);
  });

  it("con las alertas en tiempo real apagadas no se evalúa ninguna regla", async () => {
    const { api } = world({ seed: "admin-ops-alerts-off" });
    const evaluation = asRecord((await api("POST", "/v1/admin/alerts/evaluate")).body);
    assert.equal(evaluation.created, 0);
    for (const rule of asArray(evaluation.rules).map((r) => asRecord(r))) {
      assert.equal(rule.evaluated, false);
      assert.equal(rule.skippedReason, "realtime_alerts_off");
    }
  });
});

describe("auditoría", () => {
  it("más recientes primero, con filtros por acción exacta y por prefijo", async () => {
    const { api } = world();
    const all = asRecord((await api("GET", "/v1/admin/audit-events?limit=5")).body);
    const items = asArray(all.items).map((item) => asRecord(item));
    assert.equal(items.length, 5);
    assert.equal(typeof all.nextCursor, "string");
    const times = items.map((item) => Date.parse(str(item.createdAt)));
    assert.deepEqual([...times].sort((a, b) => b - a), times);
    const exact = await auditActions(api, "&action=admin.tariff_draft.saved");
    assert.ok(exact.length >= 1 && exact.every((action) => action === "admin.tariff_draft.saved"));
    const prefix = await auditActions(api, `&action=${encodeURIComponent("admin.alert*")}`);
    assert.ok(prefix.length >= 2 && prefix.every((action) => action.startsWith("admin.alert")));
  });

  it("oculta los datos personales de los metadatos", async () => {
    const { api } = world();
    const events = asArray(asRecord((await api("GET", "/v1/admin/audit-events?limit=50")).body).items).map((item) => asRecord(item));
    const photo = events.find((event) => event.action === "profile.photo.submitted");
    assert.ok(photo !== undefined);
    const metadata = asRecord(photo.metadata);
    assert.equal(metadata.phone, "[oculto]");
    assert.equal(metadata.storageKey, "[oculto]");
    assert.equal(metadata.contentType, "image/jpeg");
    assert.equal(num(photo.redactions), 2);
    const request = events.find((event) => event.action === "trips.request.created");
    assert.ok(request !== undefined);
    assert.equal(str(asRecord(request.metadata).message), "Hola, te escribo desde el [oculto] o [oculto]");
    assert.equal(num(request.redactions), 2);
  });

  it("filtros inválidos: 422 AUDIT_FILTER_INVALID; un rango invertido también", async () => {
    const { api } = world();
    const badAction = await api("GET", `/v1/admin/audit-events?action=${encodeURIComponent("con espacios")}`);
    assert.equal(badAction.status, 422);
    assert.equal(codeOf(badAction.body), "AUDIT_FILTER_INVALID");
    const inverted = await api("GET", "/v1/admin/audit-events?from=2026-10-05T00:00:00Z&to=2026-10-01T00:00:00Z");
    assert.equal(inverted.status, 422);
    assert.equal((await api("GET", "/v1/admin/audit-events?actorUserId=no-uuid")).status, 400);
    assert.equal((await api("GET", "/v1/admin/audit-events?cursor=%%%")).status, 400);
  });

  it("consultar el registro queda registrado (pero no aparece en su propia página)", async () => {
    const { api } = world();
    const first = await auditActions(api);
    assert.ok(!first.includes("admin.audit_log.viewed") || first.indexOf("admin.audit_log.viewed") > 0);
    const second = await auditActions(api);
    assert.equal(second[0], "admin.audit_log.viewed");
  });
});

describe("RBAC (matriz de docs/contracts/trust.md §3)", () => {
  it("una persona sin rol de personal recibe 403 AUTH_FORBIDDEN en todo el panel", async () => {
    const { api } = world({ as: "ana" });
    for (const [method, path] of [
      ["GET", "/v1/admin/tariffs"],
      ["GET", "/v1/admin/operations"],
      ["GET", "/v1/admin/alerts"],
      ["GET", "/v1/admin/audit-events"],
    ] as const) {
      const res = await api(method, path);
      assert.equal(res.status, 403, `${method} ${path}`);
      assert.equal(codeOf(res.body), "AUTH_FORBIDDEN");
    }
  });

  it("solo atención: ve operación y alertas (y las gestiona), pero no tarifas ni auditoría", async () => {
    const { api } = world({ seed: "admin-ops-support-only" });
    assert.equal((await api("GET", "/v1/admin/tariffs")).status, 403);
    assert.equal((await api("PUT", "/v1/admin/tariffs/draft", { body: { ratePerKmMicros: null, passengerCommissionBps: null, driverCommissionBps: null, premiumMonthlyCents: null } })).status, 403);
    assert.equal((await api("GET", "/v1/admin/audit-events")).status, 403);
    assert.equal((await api("GET", "/v1/admin/operations")).status, 200);
    assert.equal((await api("PUT", "/v1/admin/operations", { body: { realtimeAlertsEnabled: false } })).status, 403);
    assert.equal((await api("GET", "/v1/admin/alerts")).status, 200);
    assert.equal((await api("POST", "/v1/admin/alerts/evaluate")).status, 200);
  });

  it("solo finanzas: edita tarifas pero no las activa; ve alertas pero no las gestiona; no ve la auditoría", async () => {
    const { api } = world({ seed: "admin-ops-finance-only" });
    assert.equal((await api("GET", "/v1/admin/tariffs")).status, 200);
    assert.equal((await api("PUT", "/v1/admin/tariffs/draft", { body: { ratePerKmMicros: 200000, passengerCommissionBps: null, driverCommissionBps: null, premiumMonthlyCents: null } })).status, 200);
    const draftId = str(asRecord(asRecord((await api("GET", "/v1/admin/tariffs")).body).draft).id);
    assert.equal((await api("POST", `/v1/admin/tariffs/versions/${draftId}/publish`, {})).status, 403);
    assert.equal((await api("GET", "/v1/admin/alerts")).status, 200);
    assert.equal((await api("POST", "/v1/admin/alerts/evaluate")).status, 403);
    assert.equal((await api("GET", "/v1/admin/audit-events")).status, 403);
  });

  it("cada denegación queda auditada como admin.access_denied", async () => {
    const { rt, api } = world({ seed: "admin-ops-support-only" });
    await api("GET", "/v1/admin/tariffs");
    const denied = rt.db.audit.filter((row) => row.action === "admin.access_denied" && row.entity_id === "tariffs");
    assert.equal(denied.length, 1);
    assert.deepEqual(denied[0]?.metadata.roles, ["support_admin"]);
  });
});
