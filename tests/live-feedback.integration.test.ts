import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../src/errors.js";
import {
  completeIncidentAttachment, createIncident, createIncidentAttachmentIntent, createRating, getMyIncident, listMyIncidents
} from "../src/modules/live/feedback-service.js";
import { getBookingSummary } from "../src/modules/live/passenger-service.js";
import {
  createPool, FakeStorage, minutesAfter, principalOf, seedBooking, seedTrip, seedUser, seedWorld, truncateAll,
  type SeededTrip, type World
} from "./live-support.js";

const pool = createPool();
const DEPARTURE = new Date("2026-10-05T05:10:00.000Z");
/** El viaje de las pruebas termina 55 min después de la salida (06:05 UTC). */
const COMPLETED_AT = minutesAfter(DEPARTURE, 55);
const AFTER_TRIP = new Date("2026-10-05T06:30:00.000Z");

before(async () => { await pool.query("select 1 from incident_attachments limit 1"); });
beforeEach(async () => {
  await truncateAll(pool);
  delete process.env.LIVE_RATING_WINDOW_DAYS;
});
after(async () => { await pool.end(); });

type Scene = { world: World; trip: SeededTrip; miguelBooking: string; lauraBooking: string };

/** Viaje de Ana terminado: Miguel (S1→S3) y Laura (S2→S3) lo completaron. */
async function completedScene(): Promise<Scene> {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status: "completed", departureAt: DEPARTURE });
  const miguel = await seedBooking(pool, trip.tripId, world.miguel, 1, 3, { status: "completed", pickedUpAt: minutesAfter(DEPARTURE, 2) });
  const laura = await seedBooking(pool, trip.tripId, world.laura, 2, 3, { status: "completed", pickedUpAt: minutesAfter(DEPARTURE, 20) });
  return { world, trip, miguelBooking: miguel.bookingId!, lauraBooking: laura.bookingId! };
}

async function activeScene(): Promise<Scene> {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status: "active", departureAt: DEPARTURE });
  const miguel = await seedBooking(pool, trip.tripId, world.miguel, 1, 3);
  const laura = await seedBooking(pool, trip.tripId, world.laura, 2, 3);
  return { world, trip, miguelBooking: miguel.bookingId!, lauraBooking: laura.bookingId! };
}

const asAna = (s: Scene) => principalOf(s.world.ana, ["driver", "passenger"]);
const asMiguel = (s: Scene) => principalOf(s.world.miguel);
const asLaura = (s: Scene) => principalOf(s.world.laura);

async function failsWith(promise: Promise<unknown>, code: string, status: number): Promise<DomainError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof DomainError, `esperaba DomainError ${code}, llegó ${String(error)}`);
    assert.equal(error.code, code);
    assert.equal(error.statusCode, status);
    return error;
  }
  assert.fail(`esperaba el error ${code}`);
}

async function aggregate(userId: string): Promise<{ sum: number; count: number }> {
  const row = (await pool.query<{ rating_sum: number; rating_count: number }>(
    `select rating_sum, rating_count from profiles where user_id=$1`, [userId]
  )).rows[0]!;
  return { sum: Number(row.rating_sum), count: Number(row.rating_count) };
}

/* ───────────────────────────── Valoraciones ───────────────────────────── */

test("el pasajero valora al conductor: se guarda recortada, actualiza el agregado y el resumen lo refleja", async () => {
  const s = await completedScene();
  assert.deepEqual(await aggregate(s.world.ana), { sum: 154, count: 32 });

  const rating = await createRating(
    pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5, comment: "  Muy puntual y amable  " }, AFTER_TRIP
  );
  assert.deepEqual(
    { ...rating, id: "x" },
    {
      id: "x", tripId: s.trip.tripId, raterUserId: s.world.miguel, rateeUserId: s.world.ana, stars: 5,
      comment: "Muy puntual y amable", createdAt: AFTER_TRIP.toISOString()
    }
  );
  assert.deepEqual(await aggregate(s.world.ana), { sum: 159, count: 33 });

  const summary = await getBookingSummary(pool, asMiguel(s), s.miguelBooking, AFTER_TRIP);
  assert.deepEqual(summary.rating.mine, rating);
  assert.equal(summary.rating.canRate, false);
  assert.equal(summary.rating.reason, "already_rated");

  // Una sola valoración por persona y viaje: el segundo intento no toca el agregado.
  await failsWith(
    createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 1 }, AFTER_TRIP),
    "RATING_ALREADY_SUBMITTED", 409
  );
  assert.deepEqual(await aggregate(s.world.ana), { sum: 159, count: 33 });
  // Laura sí puede valorar a Ana en el mismo viaje.
  await createRating(pool, asLaura(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 4 }, AFTER_TRIP);
  assert.deepEqual(await aggregate(s.world.ana), { sum: 163, count: 34 });
});

test("el conductor valora a cada pasajero que completó el viaje (y solo a ellos)", async () => {
  const s = await completedScene();
  const first = await createRating(pool, asAna(s), s.trip.tripId, { rateeUserId: s.world.miguel, stars: 4, comment: "Puntual" }, AFTER_TRIP);
  assert.equal(first.raterUserId, s.world.ana);
  assert.equal(first.rateeUserId, s.world.miguel);
  assert.deepEqual(await aggregate(s.world.miguel), { sum: 62, count: 13 });
  await createRating(pool, asAna(s), s.trip.tripId, { rateeUserId: s.world.laura, stars: 5 }, new Date(AFTER_TRIP.getTime() + 1000));
  assert.deepEqual(await aggregate(s.world.laura), { sum: 25, count: 5 });
  const rows = (await pool.query(`select rater_role, booking_id from trip_ratings order by created_at, id`)).rows;
  assert.deepEqual(rows.map(r => r.rater_role), ["driver", "driver"]);
  assert.equal(rows[0].booking_id, s.miguelBooking);
  assert.equal(rows[1].booking_id, s.lauraBooking);

  await failsWith(createRating(pool, asAna(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, AFTER_TRIP), "RATING_INVALID_RATEE", 422);
  const stranger = await seedUser(pool, "Curioso");
  await failsWith(createRating(pool, asAna(s), s.trip.tripId, { rateeUserId: stranger, stars: 5 }, AFTER_TRIP), "RATING_INVALID_RATEE", 422);
  await failsWith(createRating(pool, asAna(s), s.trip.tripId, { rateeUserId: s.world.miguel, stars: 2 }, AFTER_TRIP), "RATING_ALREADY_SUBMITTED", 409);
});

test("reglas de valoración: participante, valorado, viaje terminado, reserva completada y estrellas", async () => {
  const s = await completedScene();
  const stranger = await seedUser(pool, "Curioso");
  await failsWith(createRating(pool, principalOf(stranger), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, AFTER_TRIP), "RATING_NOT_PARTICIPANT", 403);
  // Un pasajero solo valora al conductor (no a otro pasajero).
  await failsWith(createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.laura, stars: 5 }, AFTER_TRIP), "RATING_INVALID_RATEE", 422);
  await failsWith(createRating(pool, asMiguel(s), "00000000-0000-4000-8000-000000000000", { rateeUserId: s.world.ana, stars: 5 }, AFTER_TRIP), "TRIP_NOT_FOUND", 404);

  for (const stars of [0, 6, 3.5, Number.NaN]) {
    await failsWith(createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars }, AFTER_TRIP), "RATING_INVALID_STARS", 400);
  }
  await failsWith(
    createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5, comment: "x".repeat(501) }, AFTER_TRIP),
    "RATING_COMMENT_TOO_LONG", 400
  );
  // Un comentario en blanco se guarda como «sin comentario».
  const blank = await createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 3, comment: "   " }, AFTER_TRIP);
  assert.equal(blank.comment, null);
  assert.equal((await pool.query(`select 1 from trip_ratings`)).rowCount, 1);
});

test("no se valora un viaje sin terminar ni quien no llegó a completarlo", async () => {
  const active = await activeScene();
  await failsWith(createRating(pool, asMiguel(active), active.trip.tripId, { rateeUserId: active.world.ana, stars: 5 }, AFTER_TRIP), "RATING_TRIP_NOT_COMPLETED", 409);
  await failsWith(createRating(pool, asAna(active), active.trip.tripId, { rateeUserId: active.world.miguel, stars: 5 }, AFTER_TRIP), "RATING_TRIP_NOT_COMPLETED", 409);

  await truncateAll(pool);
  const done = await completedScene();
  await pool.query(`update bookings set status='no_show' where id=$1`, [done.miguelBooking]);
  await failsWith(createRating(pool, asMiguel(done), done.trip.tripId, { rateeUserId: done.world.ana, stars: 5 }, AFTER_TRIP), "RATING_BOOKING_NOT_COMPLETED", 409);
  // El conductor tampoco valora a quien no completó el viaje.
  await failsWith(createRating(pool, asAna(done), done.trip.tripId, { rateeUserId: done.world.miguel, stars: 5 }, AFTER_TRIP), "RATING_INVALID_RATEE", 422);
  assert.equal((await pool.query(`select 1 from trip_ratings`)).rowCount, 0);
  assert.deepEqual(await aggregate(done.world.ana), { sum: 154, count: 32 });
});

test("la ventana de valoración es de 14 días tras el fin del viaje y es configurable", async () => {
  const s = await completedScene();
  const lastInstant = new Date(COMPLETED_AT.getTime() + 14 * 86_400_000);
  const closed = new Date(lastInstant.getTime() + 1);
  const error = await failsWith(
    createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, closed), "RATING_WINDOW_CLOSED", 409
  );
  assert.deepEqual(error.details, { windowEndsAt: lastInstant.toISOString() });
  assert.equal((await aggregate(s.world.ana)).count, 32);
  // En el último instante todavía vale.
  await createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, lastInstant);

  process.env.LIVE_RATING_WINDOW_DAYS = "1";
  const tooLate = new Date(COMPLETED_AT.getTime() + 86_400_000 + 1);
  await failsWith(createRating(pool, asLaura(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, tooLate), "RATING_WINDOW_CLOSED", 409);
});

test("las valoraciones concurrentes de la misma pareja solo cuentan una vez", async () => {
  const s = await completedScene();
  const results = await Promise.allSettled([
    createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, AFTER_TRIP),
    createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, AFTER_TRIP),
    createRating(pool, asMiguel(s), s.trip.tripId, { rateeUserId: s.world.ana, stars: 5 }, AFTER_TRIP)
  ]);
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  for (const result of results) {
    if (result.status === "rejected") assert.equal((result.reason as DomainError).code, "RATING_ALREADY_SUBMITTED");
  }
  assert.deepEqual(await aggregate(s.world.ana), { sum: 159, count: 33 });
});

/* ───────────────────────────── Incidencias ───────────────────────────── */

const DESCRIPTION = "El conductor paró a recoger a otra persona fuera de la ruta acordada.";

test("el pasajero crea una incidencia: abierta, ligada a su reserva y auditada", async () => {
  const s = await activeScene();
  const { view, created } = await createIncident(
    pool, asMiguel(s), { tripId: s.trip.tripId, category: "route_or_schedule", description: `  ${DESCRIPTION}  ` }, undefined, AFTER_TRIP
  );
  assert.equal(created, true);
  assert.deepEqual(
    { ...view, id: "x" },
    {
      id: "x", tripId: s.trip.tripId, bookingId: s.miguelBooking, category: "route_or_schedule", description: DESCRIPTION,
      status: "open", reporterRole: "passenger", createdAt: AFTER_TRIP.toISOString(), updatedAt: AFTER_TRIP.toISOString(), attachments: []
    }
  );
  const context = (await pool.query(`select context from incident_reports where id=$1`, [view.id])).rows[0].context;
  assert.deepEqual(context, { tripStatus: "active", bookingStatus: "confirmed", routeVersion: 1 });
  assert.equal((await pool.query(`select 1 from audit_events where action='incident.created' and entity_id=$1`, [view.id])).rowCount, 1);
  // La incidencia cuenta en el resumen de Miguel y en nada más.
  assert.equal((await getBookingSummary(pool, asMiguel(s), s.miguelBooking, AFTER_TRIP)).incidents.mineCount, 1);
  assert.equal((await getBookingSummary(pool, asLaura(s), s.lauraBooking, AFTER_TRIP)).incidents.mineCount, 0);
});

test("el conductor también denuncia, opcionalmente sobre una reserva de su viaje", async () => {
  const s = await activeScene();
  const general = await createIncident(pool, asAna(s), { tripId: s.trip.tripId, category: "vehicle", description: "El coche tiene un testigo de aceite encendido." }, undefined, AFTER_TRIP);
  assert.equal(general.view.reporterRole, "driver");
  assert.equal(general.view.bookingId, null);
  const withBooking = await createIncident(
    pool, asAna(s), { tripId: s.trip.tripId, bookingId: s.lauraBooking, category: "passenger_behavior", description: "Laura no estaba en el punto acordado." }, undefined, AFTER_TRIP
  );
  assert.equal(withBooking.view.bookingId, s.lauraBooking);

  const other = await seedTrip(pool, s.world.ana, s.world.vehicleId, s.world.provinceId, { departureAt: DEPARTURE });
  const foreign = await seedBooking(pool, other.tripId, s.world.miguel, 1, 3);
  await failsWith(
    createIncident(pool, asAna(s), { tripId: s.trip.tripId, bookingId: foreign.bookingId!, category: "other", description: DESCRIPTION }, undefined, AFTER_TRIP),
    "INCIDENT_BOOKING_MISMATCH", 422
  );
});

test("solo los participantes del viaje denuncian y la descripción tiene límites", async () => {
  const s = await activeScene();
  const stranger = await seedUser(pool, "Curioso");
  await failsWith(
    createIncident(pool, principalOf(stranger), { tripId: s.trip.tripId, category: "safety", description: DESCRIPTION }, undefined, AFTER_TRIP),
    "INCIDENT_NOT_PARTICIPANT", 403
  );
  await failsWith(
    createIncident(pool, asMiguel(s), { tripId: "00000000-0000-4000-8000-000000000000", category: "safety", description: DESCRIPTION }, undefined, AFTER_TRIP),
    "TRIP_NOT_FOUND", 404
  );
  // Un pasajero no puede apuntar a la reserva de otro.
  await failsWith(
    createIncident(pool, asMiguel(s), { tripId: s.trip.tripId, bookingId: s.lauraBooking, category: "safety", description: DESCRIPTION }, undefined, AFTER_TRIP),
    "INCIDENT_BOOKING_MISMATCH", 422
  );
  for (const description of ["demasiado", " ".repeat(30), "x".repeat(2001)]) {
    await failsWith(
      createIncident(pool, asMiguel(s), { tripId: s.trip.tripId, category: "safety", description }, undefined, AFTER_TRIP),
      "INCIDENT_DESCRIPTION_INVALID", 400
    );
  }
  assert.equal((await pool.query(`select 1 from incident_reports`)).rowCount, 0);
});

test("Idempotency-Key: el reintento devuelve la misma incidencia sin duplicarla", async () => {
  const s = await activeScene();
  const body = { tripId: s.trip.tripId, category: "safety" as const, description: DESCRIPTION };
  const first = await createIncident(pool, asMiguel(s), body, "incidencia-0001", AFTER_TRIP);
  const again = await createIncident(pool, asMiguel(s), body, "incidencia-0001", AFTER_TRIP);
  assert.equal(first.created, true);
  assert.equal(again.created, false);
  assert.equal(again.view.id, first.view.id);
  assert.equal((await pool.query(`select 1 from incident_reports`)).rowCount, 1);
  // La misma clave de otra persona es independiente.
  const laura = await createIncident(pool, asLaura(s), body, "incidencia-0001", AFTER_TRIP);
  assert.equal(laura.created, true);
  assert.notEqual(laura.view.id, first.view.id);
  // La misma clave para otro viaje es un error de cliente.
  const other = await seedTrip(pool, s.world.ana, s.world.vehicleId, s.world.provinceId, { departureAt: DEPARTURE });
  await seedBooking(pool, other.tripId, s.world.miguel, 1, 3);
  await failsWith(
    createIncident(pool, asMiguel(s), { ...body, tripId: other.tripId }, "incidencia-0001", AFTER_TRIP),
    "IDEMPOTENCY_KEY_REUSED", 409
  );
});

test("reintentos simultáneos con la misma Idempotency-Key crean una única incidencia", async () => {
  const s = await activeScene();
  const body = { tripId: s.trip.tripId, category: "safety" as const, description: DESCRIPTION };
  const results = await Promise.all([1, 2, 3, 4].map(() => createIncident(pool, asMiguel(s), body, "carrera-0001", AFTER_TRIP)));
  assert.equal(results.filter(r => r.created).length, 1);
  assert.equal(new Set(results.map(r => r.view.id)).size, 1);
  assert.equal((await pool.query(`select 1 from incident_reports`)).rowCount, 1);
});

test("mis incidencias: las más recientes primero, con cursor estable (también con la misma marca de tiempo)", async () => {
  const s = await activeScene();
  const ids: string[] = [];
  const stamps = [0, 1, 2, 3, 3, 4, 5]; // dos con la misma marca de tiempo
  for (const [index, offset] of stamps.entries()) {
    const { view } = await createIncident(
      pool, asMiguel(s), { tripId: s.trip.tripId, category: "other", description: `${DESCRIPTION} #${index}` }, undefined,
      new Date(AFTER_TRIP.getTime() + offset * 1000)
    );
    ids.push(view.id);
  }
  await createIncident(pool, asLaura(s), { tripId: s.trip.tripId, category: "other", description: DESCRIPTION }, undefined, AFTER_TRIP);

  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const page = await listMyIncidents(pool, s.world.miguel, { ...(cursor ? { cursor } : {}), limit: 3 }, AFTER_TRIP);
    pages += 1;
    assert.ok(page.items.length <= 3);
    seen.push(...page.items.map(i => i.id));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 7, "sin repeticiones ni huecos");
  assert.deepEqual([...seen].sort(), [...ids].sort());
  const all = await listMyIncidents(pool, s.world.miguel, {}, AFTER_TRIP);
  const times = all.items.map(i => Date.parse(i.createdAt));
  assert.deepEqual(times, [...times].sort((a, b) => b - a), "orden descendente por fecha");
  assert.equal(all.nextCursor, null);
  // Las de Laura son suyas.
  assert.equal((await listMyIncidents(pool, s.world.laura, {}, AFTER_TRIP)).items.length, 1);
  assert.equal((await listMyIncidents(pool, s.world.ana, {}, AFTER_TRIP)).items.length, 0);
  // Límite acotado y cursor inválido.
  assert.equal((await listMyIncidents(pool, s.world.miguel, { limit: 1 }, AFTER_TRIP)).items.length, 1);
  await failsWith(listMyIncidents(pool, s.world.miguel, { cursor: "no-es-un-cursor" }, AFTER_TRIP), "INVALID_CURSOR", 400);
  const forged = Buffer.from(JSON.stringify({ t: "2026-10-05", id: "x" }), "utf8").toString("base64url");
  await failsWith(listMyIncidents(pool, s.world.miguel, { cursor: forged }, AFTER_TRIP), "INVALID_CURSOR", 400);
});

test("una incidencia solo la ve quien la creó", async () => {
  const s = await activeScene();
  const { view } = await createIncident(pool, asMiguel(s), { tripId: s.trip.tripId, category: "safety", description: DESCRIPTION }, undefined, AFTER_TRIP);
  assert.equal((await getMyIncident(pool, s.world.miguel, view.id, AFTER_TRIP)).id, view.id);
  for (const who of [s.world.laura, s.world.ana]) {
    await failsWith(getMyIncident(pool, who, view.id, AFTER_TRIP), "INCIDENT_NOT_FOUND", 404);
  }
  await failsWith(getMyIncident(pool, s.world.miguel, "00000000-0000-4000-8000-000000000000", AFTER_TRIP), "INCIDENT_NOT_FOUND", 404);
});

/* ───────────────────────────── Adjuntos privados ───────────────────────────── */

async function incidentFor(s: Scene): Promise<string> {
  const { view } = await createIncident(pool, asMiguel(s), { tripId: s.trip.tripId, category: "vehicle", description: DESCRIPTION }, undefined);
  return view.id;
}

function keyOf(userId: string, reportId: string, attachmentId: string, extension = "jpg"): string {
  return `users/${userId}/incidents/${reportId}/${attachmentId}.${extension}`;
}

test("adjunto: URL firmada → subida → confirmación; privado y verificado por tamaño y tipo", async () => {
  const s = await activeScene();
  const reportId = await incidentFor(s);
  const storage = new FakeStorage();
  const intent = await createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, reportId, { contentType: "image/jpeg", sizeBytes: 2048 });
  assert.match(intent.uploadUrl, /^https:\/\/upload\.invalid\/users\//);
  assert.deepEqual(intent.headers, { "content-type": "image/jpeg" });
  const key = keyOf(s.world.miguel, reportId, intent.attachmentId);
  assert.ok(intent.uploadUrl.endsWith(key), "la clave del objeto cuelga de la incidencia del propio usuario");

  // Antes de subir el archivo no se puede confirmar.
  await failsWith(completeIncidentAttachment(pool, asMiguel(s), storage, reportId, intent.attachmentId), "INCIDENT_ATTACHMENT_MISMATCH", 422);
  let view = await getMyIncident(pool, s.world.miguel, reportId);
  assert.deepEqual(view.attachments.map(a => [a.status, a.sizeBytes]), [["pending", 2048]]);

  storage.objects.set(key, { bytes: new Uint8Array(2048).fill(7), contentType: "image/jpeg" });
  const done = await completeIncidentAttachment(pool, asMiguel(s), storage, reportId, intent.attachmentId);
  assert.deepEqual({ ...done, createdAt: "x" }, { id: intent.attachmentId, contentType: "image/jpeg", sizeBytes: 2048, status: "uploaded", createdAt: "x" });
  const row = (await pool.query(`select status, size_bytes, sha256 from incident_attachments where id=$1`, [intent.attachmentId])).rows[0];
  assert.equal(row.status, "uploaded");
  assert.equal(Number(row.size_bytes), 2048);
  assert.match(row.sha256, /^[0-9a-f]{64}$/);
  // Confirmar otra vez es idempotente.
  assert.equal((await completeIncidentAttachment(pool, asMiguel(s), storage, reportId, intent.attachmentId)).status, "uploaded");
  view = await getMyIncident(pool, s.world.miguel, reportId);
  assert.deepEqual(view.attachments.map(a => a.status), ["uploaded"]);
  // El adjunto no expone claves de almacenamiento ni URLs.
  assert.equal(JSON.stringify(view).includes("users/"), false);
  assert.equal(JSON.stringify(view).includes("invalid"), false);
});

test("adjunto: el tamaño o el tipo subidos deben coincidir con lo declarado", async () => {
  const s = await activeScene();
  const reportId = await incidentFor(s);
  const storage = new FakeStorage();
  const sizeIntent = await createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, reportId, { contentType: "image/png", sizeBytes: 1000 });
  storage.objects.set(keyOf(s.world.miguel, reportId, sizeIntent.attachmentId, "png"), { bytes: new Uint8Array(999), contentType: "image/png" });
  const mismatch = await failsWith(completeIncidentAttachment(pool, asMiguel(s), storage, reportId, sizeIntent.attachmentId), "INCIDENT_ATTACHMENT_MISMATCH", 422);
  assert.deepEqual(mismatch.details, { expected: 1000, actual: 999 });

  const typeIntent = await createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, reportId, { contentType: "image/webp", sizeBytes: 10 });
  storage.objects.set(keyOf(s.world.miguel, reportId, typeIntent.attachmentId, "webp"), { bytes: new Uint8Array(10), contentType: "text/html" });
  await failsWith(completeIncidentAttachment(pool, asMiguel(s), storage, reportId, typeIntent.attachmentId), "INCIDENT_ATTACHMENT_MISMATCH", 422);
  const states = (await pool.query(`select status from incident_attachments`)).rows.map(r => r.status);
  assert.deepEqual(states, ["pending", "pending"]);
});

test("adjunto: validación de tipo y peso, límite de 5 y almacenamiento no configurado", async () => {
  const s = await activeScene();
  const reportId = await incidentFor(s);
  const storage = new FakeStorage();
  const ask = (contentType: string, sizeBytes: number) =>
    createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, reportId, { contentType, sizeBytes } as never);

  await failsWith(ask("application/pdf", 100), "INCIDENT_ATTACHMENT_TYPE", 422);
  await failsWith(ask("image/svg+xml", 100), "INCIDENT_ATTACHMENT_TYPE", 422);
  for (const size of [0, -1, 10 * 1024 * 1024 + 1, 1.5]) await failsWith(ask("image/jpeg", size), "INCIDENT_ATTACHMENT_SIZE", 422);
  await ask("image/heic", 10 * 1024 * 1024); // exactamente 10 MiB sí cabe

  for (let i = 0; i < 4; i += 1) await ask("image/jpeg", 100 + i);
  await failsWith(ask("image/jpeg", 100), "INCIDENT_ATTACHMENT_LIMIT", 409);
  // Los cupos de subidas caducadas sin completar se liberan.
  const later = new Date(Date.now() + 3 * 3_600_000);
  const fresh = await createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, reportId, { contentType: "image/jpeg", sizeBytes: 5 }, later);
  assert.ok(fresh.attachmentId);
  await failsWith(
    createIncidentAttachmentIntent(pool, asMiguel(s), null, 600, reportId, { contentType: "image/jpeg", sizeBytes: 5 }),
    "PRIVATE_STORAGE_NOT_CONFIGURED", 503
  );
  await failsWith(completeIncidentAttachment(pool, asMiguel(s), null, reportId, fresh.attachmentId), "PRIVATE_STORAGE_NOT_CONFIGURED", 503);
});

test("adjunto: la URL caduca, solo el autor accede y una incidencia cerrada no admite archivos", async () => {
  const s = await activeScene();
  const reportId = await incidentFor(s);
  const storage = new FakeStorage();
  const intent = await createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, reportId, { contentType: "image/jpeg", sizeBytes: 64 });
  storage.objects.set(keyOf(s.world.miguel, reportId, intent.attachmentId), { bytes: new Uint8Array(64), contentType: "image/jpeg" });

  // Otras personas reciben 404 como si la incidencia no existiera.
  for (const who of [asLaura(s), asAna(s)]) {
    await failsWith(createIncidentAttachmentIntent(pool, who, storage, 600, reportId, { contentType: "image/jpeg", sizeBytes: 5 }), "INCIDENT_NOT_FOUND", 404);
    await failsWith(completeIncidentAttachment(pool, who, storage, reportId, intent.attachmentId), "INCIDENT_NOT_FOUND", 404);
  }
  // Un adjunto de otra incidencia no se puede confirmar desde esta.
  const secondReport = await incidentFor(s);
  await failsWith(completeIncidentAttachment(pool, asMiguel(s), storage, secondReport, intent.attachmentId), "INCIDENT_ATTACHMENT_NOT_FOUND", 404);

  const expired = new Date(Date.now() + 3 * 3_600_000);
  await failsWith(completeIncidentAttachment(pool, asMiguel(s), storage, reportId, intent.attachmentId, expired), "INCIDENT_ATTACHMENT_EXPIRED", 410);
  // La subida caducada ya no se lista como pendiente.
  assert.deepEqual((await getMyIncident(pool, s.world.miguel, reportId, expired)).attachments, []);

  for (const status of ["resolved", "dismissed"]) {
    await pool.query(`update incident_reports set status=$2 where id=$1`, [reportId, status]);
    await failsWith(
      createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, reportId, { contentType: "image/jpeg", sizeBytes: 5 }),
      "INCIDENT_CLOSED", 409
    );
  }
});
