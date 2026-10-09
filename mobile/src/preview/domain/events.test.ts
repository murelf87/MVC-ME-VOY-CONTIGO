/**
 * Eventos de dominio y tareas de fondo: la API de `PreviewEvents` / `PreviewJobs` y, sobre todo, que el núcleo emite cada
 * evento documentado con el payload que prometen los comentarios de `core/events.ts` (los slices de mensajes y notificaciones
 * se suscriben a ellos: si cambia un payload, se enteran aquí y no en pantalla).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPreviewDb } from "../core/db";
import { PreviewEvents, PreviewJobs, type CoreEventName } from "../core/events";
import { SEED_TRIP_IDS, SEED_USER_IDS } from "../seeds";
import { asRecord, createApi, str, testRuntime, tokenFor } from "../testing/harness";
import { confirmProviderPayment } from "./requests";
import { publishTrip } from "./trips";

const T1 = SEED_TRIP_IDS.anaMorning;
const CORE_EVENTS: readonly CoreEventName[] = [
  "ride_request.created",
  "ride_request.decided",
  "ride_request.expired",
  "booking.confirmed",
  "trip.published",
  "trip.started",
  "trip.completed",
  "pickup.verified",
  "message.sent",
  "location.recorded",
];

describe("PreviewEvents", () => {
  it("on/emit llaman a los manejadores en orden de suscripción; la función devuelta da de baja", () => {
    const events = new PreviewEvents();
    const seen: string[] = [];
    const offA = events.on("x.hecho", (p) => seen.push(`a:${String(p)}`));
    events.on("x.hecho", (p) => seen.push(`b:${String(p)}`));
    assert.equal(events.count("x.hecho"), 2);
    events.emit("x.hecho", 1);
    offA();
    events.emit("x.hecho", 2);
    assert.deepEqual(seen, ["a:1", "b:1", "b:2"]);
    assert.equal(events.count("x.hecho"), 1);
    events.emit("sin.manejadores", null);
    events.clear();
    assert.equal(events.count("x.hecho"), 0);
  });

  it("un manejador puede darse de baja a sí mismo mientras se emite (se itera una copia)", () => {
    const events = new PreviewEvents();
    const seen: number[] = [];
    const off = events.on("x", () => {
      seen.push(1);
      off();
    });
    events.on("x", () => seen.push(2));
    events.emit("x", null);
    events.emit("x", null);
    assert.deepEqual(seen, [1, 2, 2]);
  });

  it("si un manejador lanza dentro de una transacción, se deshace TODO lo escrito (como un notify() fallido)", () => {
    const db = createPreviewDb();
    const notes = db.collection<{ id: string }>("notas");
    db.events.on("ride_request.created", () => {
      throw new Error("el aviso falló");
    });
    assert.throws(
      () =>
        db.tx(() => {
          notes.insert({ id: "uno" });
          db.events.emit("ride_request.created", {});
        }),
      /el aviso falló/
    );
    assert.equal(notes.size, 0, "la escritura previa se revirtió");
  });
});

describe("PreviewJobs", () => {
  it("register sustituye por nombre, unregister quita y run las ejecuta todas una vez", () => {
    const db = createPreviewDb();
    const jobs = new PreviewJobs();
    const calls: string[] = [];
    jobs.register("caducar", () => calls.push("v1"));
    jobs.register("caducar", () => calls.push("v2"));
    jobs.register("arrancar", () => calls.push("arrancar"));
    assert.deepEqual(jobs.names(), ["caducar", "arrancar"]);
    jobs.run(db);
    assert.deepEqual(calls, ["v2", "arrancar"]);
    jobs.unregister("caducar");
    jobs.run(db);
    assert.deepEqual(calls, ["v2", "arrancar", "arrancar"]);
  });

  it("run no es reentrante (una tarea que dispara una petición no lanza otra pasada) y se libera aunque una tarea falle", () => {
    const db = createPreviewDb();
    const jobs = new PreviewJobs();
    let passes = 0;
    jobs.register("reentrante", (d) => {
      passes += 1;
      jobs.run(d);
    });
    jobs.run(db);
    assert.equal(passes, 1);
    jobs.unregister("reentrante");
    jobs.register("falla", () => {
      throw new Error("boom");
    });
    assert.throws(() => jobs.run(db), /boom/);
    jobs.unregister("falla");
    let ran = false;
    jobs.register("ok", () => {
      ran = true;
    });
    jobs.run(db);
    assert.equal(ran, true, "tras el fallo, la siguiente pasada funciona");
  });
});

describe("eventos que emite el núcleo", () => {
  it("el ciclo completo (solicitar → aceptar → pagar → chatear → iniciar → ubicar → recoger → terminar) emite cada evento con su payload", async () => {
    const rt = testRuntime({ profile: "passenger", slices: false });
    const api = createApi(rt);
    const miguel = rt.sessionToken() ?? "";
    const ana = tokenFor(rt, "ana");
    const log: Array<{ name: string; payload: Record<string, unknown> }> = [];
    for (const name of CORE_EVENTS) rt.db.events.on(name, (payload) => log.push({ name, payload: asRecord(payload, name) }));
    const names = (): string[] => log.map((entry) => entry.name);
    const last = (name: string): Record<string, unknown> => {
      const found = [...log].reverse().find((entry) => entry.name === name);
      assert.ok(found, `no se emitió ${name}`);
      return found.payload;
    };

    // 1. Miguel pide plaza
    const created = await api("POST", `/v1/trips/${T1}/requests`, { token: miguel, body: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
    assert.equal(created.status, 201);
    const requestId = str(asRecord(created.body).id);
    assert.deepEqual(names(), ["ride_request.created"]);
    assert.equal(asRecord(last("ride_request.created").request).id, requestId);
    assert.equal(asRecord(last("ride_request.created").request).status, "pending");
    assert.equal(asRecord(last("ride_request.created").trip).id, T1);

    // 2. Ana acepta
    await api("POST", `/v1/ride-requests/${requestId}/decision`, { token: ana, body: { decision: "accept" } });
    assert.deepEqual(names(), ["ride_request.created", "ride_request.decided"]);
    const decided = last("ride_request.decided");
    assert.equal(decided.decision, "accept");
    assert.equal(asRecord(decided.request).status, "payment_pending");
    assert.equal(asRecord(decided.request).id, requestId);
    assert.match(str(asRecord(decided.hold).id), /^[0-9a-f-]{36}$/, "hold = { id, expiresAt } (el mismo DTO que devuelve el endpoint)");
    assert.equal(asRecord(decided.hold).expiresAt, "2026-10-05T05:27:00.000Z");
    assert.equal(asRecord(decided.trip).id, T1);

    // 3. el cobro se confirma (módulo de pagos; no hay ruta HTTP)
    const paid = confirmProviderPayment(rt.db, { requestId, providerPaymentId: "pay_events", amountCents: 290 });
    assert.equal(paid.status, "confirmed");
    const bookingId = paid.status === "confirmed" ? paid.bookingId : "";
    assert.equal(names().at(-1), "booking.confirmed");
    assert.equal(asRecord(last("booking.confirmed").booking).id, bookingId);
    assert.equal(asRecord(last("booking.confirmed").request).status, "confirmed");

    // 4. mensaje directo
    const sent = await api("POST", `/v1/trips/${T1}/chat/${SEED_USER_IDS.ana}/messages`, {
      token: miguel,
      body: { clientMessageId: "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10bb01", body: "Estaré en la parada." },
    });
    assert.equal(sent.status, 201);
    assert.equal(names().at(-1), "message.sent");
    assert.equal(asRecord(last("message.sent").message).body, "Estaré en la parada.");

    // 5. Ana inicia el viaje y publica su posición
    await api("POST", `/v1/me/trips/${T1}/start`, { token: ana });
    assert.equal(names().at(-1), "trip.started");
    assert.equal(asRecord(last("trip.started").trip).status, "active");

    const located = await api("POST", `/v1/trips/${T1}/location`, {
      token: ana,
      body: { eventId: "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10bb02", recordedAt: "2026-10-05T05:17:00.000Z", latitude: 37.3317, longitude: -5.9365 },
    });
    assert.equal(located.status, 200);
    assert.equal(names().at(-1), "location.recorded");
    assert.equal(asRecord(last("location.recorded").trip).id, T1);
    assert.equal(asRecord(last("location.recorded").event).trip_id, T1);

    // 6. recogida con código
    const code = await api("POST", `/v1/bookings/${bookingId}/pickup-code`, { token: miguel });
    assert.equal(code.status, 200);
    const verified = await api("POST", `/v1/bookings/${bookingId}/pickup-verify`, { token: ana, body: { code: str(asRecord(code.body).code) } });
    assert.equal(verified.status, 200);
    assert.equal(names().at(-1), "pickup.verified");
    assert.equal(asRecord(last("pickup.verified").booking).id, bookingId);
    assert.equal(asRecord(last("pickup.verified").trip).id, T1);

    // 7. fin del viaje
    await api("POST", `/v1/me/trips/${T1}/complete`, { token: ana });
    assert.equal(names().at(-1), "trip.completed");
    assert.equal(asRecord(last("trip.completed").trip).status, "completed");
  });

  it("un hold que caduca emite ride_request.expired una sola vez, con la solicitud ya en «expired»", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "request-accepted", slices: false });
    const api = createApi(rt);
    const expired: Array<Record<string, unknown>> = [];
    rt.db.events.on("ride_request.expired", (payload) => expired.push(asRecord(payload)));
    rt.db.clock.advance(16 * 60_000); // la variante retiene 15 min y ya han pasado 8 s
    await api("GET", "/health/live");
    await api("GET", "/health/live");
    assert.equal(expired.length, 1);
    assert.equal(asRecord(expired[0]?.request).status, "expired");
  });

  it("publicar un borrador emite trip.published con el viaje ya publicado", () => {
    const rt = testRuntime({ profile: "driver", slices: false });
    const draft = rt.db.trips.find((trip) => trip.status === "draft");
    assert.ok(draft, "el mundo base siembra un borrador");
    const seen: Array<Record<string, unknown>> = [];
    rt.db.events.on("trip.published", (payload) => seen.push(asRecord(payload)));
    publishTrip(rt.db, draft.id);
    assert.equal(seen.length, 1);
    assert.equal(asRecord(seen[0]?.trip).id, draft.id);
    assert.equal(asRecord(seen[0]?.trip).status, "published");
  });
});
