import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  buildUserDataExport, executeDueAccountDeletions, getDeletionBlockerProviders, getErasureSteps, getExportContributors, loadCommsConfig,
  registerErasureStep, resetCommsRegistries
} from "../src/modules/comms/public.js";
import { eraseUserLiveData, exportUserLiveData, LIVE_MODULE_NAME, registerLiveDataRights } from "../src/modules/live/data-rights.js";
import {
  completeIncidentAttachment, createIncident, createIncidentAttachmentIntent, createRating
} from "../src/modules/live/feedback-service.js";
import { setLivePrivacy } from "../src/modules/live/privacy-service.js";
import { createRouteChange, respondRouteChange } from "../src/modules/live/route-change-service.js";
import { createShare } from "../src/modules/live/share-service.js";
import {
  buildLiveApp, createPool, FakeRouteProvider, FakeStorage, minutesAfter, principalOf, seedBooking, seedTrip, seedUser, seedWorld,
  truncateAll, type SeededTrip, type World
} from "./live-support.js";

const pool = createPool();
const storage = new FakeStorage();

/** Salida 05:25 UTC; «ahora» 05:17 (viaje aún publicado) y 06:30 (viaje terminado). */
const DEPARTURE = new Date("2026-10-05T05:25:00.000Z");
const BEFORE_TRIP = new Date("2026-10-05T05:17:00.000Z");
const AFTER_TRIP = new Date("2026-10-05T06:30:00.000Z");
const FAR_STOP = { lat: 37.3935, lng: -5.9919, label: "Plaza de la Encarnación" };

before(async () => { await pool.query("select 1 from user_settings limit 1"); });
beforeEach(async () => {
  await truncateAll(pool);
  storage.objects.clear();
  resetCommsRegistries();
});
after(async () => { resetCommsRegistries(); await pool.end(); });

type Rich = {
  world: World;
  trip: SeededTrip;
  miguelBooking: string;
  lauraBooking: string;
  proposalId: string;
  incidentId: string;
  attachmentKey: string;
};

const asAna = (r: { world: World }) => principalOf(r.world.ana, ["driver", "passenger"]);
const asMiguel = (r: { world: World }) => principalOf(r.world.miguel);
const asLaura = (r: { world: World }) => principalOf(r.world.laura);

/**
 * Ana conduce Santa Justa → Universidad con Miguel y Laura. Ana propone una parada nueva y Miguel la rechaza; Miguel crea dos
 * enlaces de viaje compartido (el primero queda revocado) y comparte su perfil con copasajeros. El viaje termina y los tres se
 * valoran; Miguel abre una incidencia con una foto.
 */
async function richScene(): Promise<Rich> {
  const world = await seedWorld(pool);
  const trip = await seedTrip(pool, world.ana, world.vehicleId, world.provinceId, { status: "published", departureAt: DEPARTURE });
  const miguel = await seedBooking(pool, trip.tripId, world.miguel, 1, 3);
  const laura = await seedBooking(pool, trip.tripId, world.laura, 2, 3);
  const s = { world };

  const proposal = await createRouteChange(pool, asAna(s), new FakeRouteProvider(), { tripId: trip.tripId, stop: FAR_STOP }, BEFORE_TRIP);
  const rejected = await respondRouteChange(pool, asMiguel(s), proposal.view.id, "reject", BEFORE_TRIP);
  assert.equal(rejected.status, "rejected");

  await createShare(pool, asMiguel(s), miguel.bookingId!, { includePlate: true }, BEFORE_TRIP);
  await createShare(pool, asMiguel(s), miguel.bookingId!, { expiresInMinutes: 60 }, BEFORE_TRIP);
  await setLivePrivacy(pool, world.miguel, true, BEFORE_TRIP);

  await pool.query(`update trips set status='active', started_at=$2 where id=$1`, [trip.tripId, DEPARTURE]);
  await pool.query(`update trips set status='completed', completed_at=$2 where id=$1`, [trip.tripId, minutesAfter(DEPARTURE, 55)]);
  await pool.query(`update bookings set status='completed', picked_up_at=$2 where id=$1`, [miguel.bookingId, minutesAfter(DEPARTURE, 2)]);
  await pool.query(`update bookings set status='completed', picked_up_at=$2 where id=$1`, [laura.bookingId, minutesAfter(DEPARTURE, 20)]);

  await createRating(pool, asMiguel(s), trip.tripId, { rateeUserId: world.ana, stars: 5, comment: "Muy puntual y amable" }, AFTER_TRIP);
  await createRating(pool, asLaura(s), trip.tripId, { rateeUserId: world.ana, stars: 3, comment: "Fue bien, algo de prisa" }, AFTER_TRIP);
  await createRating(pool, asAna(s), trip.tripId, { rateeUserId: world.miguel, stars: 4, comment: "Pasajero correcto" }, AFTER_TRIP);

  const { view } = await createIncident(
    pool, asMiguel(s),
    { tripId: trip.tripId, bookingId: miguel.bookingId!, category: "vehicle", description: "El aire acondicionado no funcionaba en todo el trayecto." },
    undefined, AFTER_TRIP
  );
  const intent = await createIncidentAttachmentIntent(pool, asMiguel(s), storage, 600, view.id, { contentType: "image/jpeg", sizeBytes: 2048 });
  const attachmentKey = `users/${world.miguel}/incidents/${view.id}/${intent.attachmentId}.jpg`;
  storage.objects.set(attachmentKey, { bytes: new Uint8Array(2048).fill(9), contentType: "image/jpeg" });
  await completeIncidentAttachment(pool, asMiguel(s), storage, view.id, intent.attachmentId);

  return {
    world, trip, miguelBooking: miguel.bookingId!, lauraBooking: laura.bookingId!, proposalId: proposal.view.id,
    incidentId: view.id, attachmentKey
  };
}

const count = async (sql: string, params: unknown[] = []): Promise<number> =>
  Number((await pool.query<{ n: string }>(`select count(*)::text as n from (${sql}) q`, params)).rows[0]!.n);

/* ───────────────────────────── Exportación (derecho de acceso) ───────────────────────────── */

test("exportación: Miguel recibe SUS valoraciones, incidencia, enlaces, decisión de cambio de ruta y preferencia", async () => {
  const r = await richScene();
  const data = await exportUserLiveData(pool, r.world.miguel);

  // Media = (58 + 4) / (12 + 1): la valoración que Ana le dio ya cuenta en su agregado.
  assert.deepEqual(data.ratingSummary, { average: Math.round((62 * 10) / 13) / 10, count: 13 });
  assert.deepEqual(data.ratingsGiven.map(({ createdAt: _c, ...rest }) => rest), [
    { tripId: r.trip.tripId, asRole: "passenger", stars: 5, comment: "Muy puntual y amable" }
  ]);
  assert.deepEqual(data.ratingsReceived.map(({ createdAt: _c, ...rest }) => rest), [
    { tripId: r.trip.tripId, stars: 4, comment: "Pasajero correcto" }
  ]);
  assert.deepEqual(Object.keys(data.ratingsReceived[0]!).sort(), ["comment", "createdAt", "stars", "tripId"], "no identifica a quien valoró");

  assert.equal(data.incidentReports.length, 1);
  const incident = data.incidentReports[0]!;
  assert.equal(incident.id, r.incidentId);
  assert.equal(incident.bookingId, r.miguelBooking);
  assert.equal(incident.asRole, "passenger");
  assert.equal(incident.category, "vehicle");
  assert.equal(incident.status, "open");
  assert.equal(incident.resolvedAt, null);
  assert.equal(incident.description, "El aire acondicionado no funcionaba en todo el trayecto.");
  assert.deepEqual(incident.attachments.map(({ id: _i, createdAt: _c, ...rest }) => rest), [
    { contentType: "image/jpeg", sizeBytes: 2048, status: "uploaded" }
  ]);

  assert.equal(data.sharedTripLinks.length, 2);
  assert.deepEqual(data.sharedTripLinks.map(link => [link.includePlate, link.revokedAt !== null]).sort(), [[false, false], [true, true]]);
  assert.ok(data.sharedTripLinks.every(link => link.bookingId === r.miguelBooking && link.viewCount === 0));

  assert.deepEqual(data.routeChanges.proposedByYou, []);
  assert.equal(data.routeChanges.decisionsByYou.length, 1);
  assert.equal(data.routeChanges.decisionsByYou[0]!.proposalId, r.proposalId);
  assert.equal(data.routeChanges.decisionsByYou[0]!.tripId, r.trip.tripId);
  assert.equal(data.routeChanges.decisionsByYou[0]!.decision, "rejected");

  assert.equal(data.privacy.showProfileToCoPassengers, true);
  assert.match(data.privacy.updatedAt!, /^2026-10-05T05:17:00\.000Z$/);
  assert.equal(data.truncated, false);

  // Nunca: terceras personas, claves de almacenamiento, hash o token de los enlaces, notas internas.
  const text = JSON.stringify(data);
  for (const other of [r.world.ana, r.world.laura]) assert.equal(text.includes(other), false, "no aparecen ids de otras personas");
  assert.equal(text.includes("users/"), false, "ni claves de almacenamiento");
  assert.equal(text.includes("storage"), false);
  assert.equal(text.includes("resolution_note"), false);
  for (const row of (await pool.query<{ token_hash: string }>(`select token_hash from trip_shares`)).rows) {
    assert.equal(text.includes(row.token_hash), false, "ni el hash del token");
  }
  assert.equal(text.includes("mvc_share_"), false, "ni el token");
});

test("exportación: la conductora ve lo recibido (sin quién valoró), lo dado y su propuesta de cambio de ruta", async () => {
  const r = await richScene();
  const data = await exportUserLiveData(pool, r.world.ana);

  assert.deepEqual(data.ratingSummary, { average: Math.round((162 * 10) / 34) / 10, count: 34 });
  assert.deepEqual(data.ratingsReceived.map(({ createdAt: _c, ...rest }) => rest).sort((a, b) => a.stars - b.stars), [
    { tripId: r.trip.tripId, stars: 3, comment: "Fue bien, algo de prisa" },
    { tripId: r.trip.tripId, stars: 5, comment: "Muy puntual y amable" }
  ]);
  assert.deepEqual(data.ratingsGiven.map(({ createdAt: _c, ...rest }) => rest), [
    { tripId: r.trip.tripId, asRole: "driver", stars: 4, comment: "Pasajero correcto" }
  ]);
  assert.equal(data.routeChanges.proposedByYou.length, 1);
  const proposed = data.routeChanges.proposedByYou[0]!;
  assert.equal(proposed.id, r.proposalId);
  assert.equal(proposed.status, "rejected");
  assert.equal(proposed.resolution, "rejected_by_passenger");
  assert.equal(proposed.newStopLabel, "Plaza de la Encarnación");
  assert.notEqual(proposed.resolvedAt, null);
  assert.deepEqual(data.routeChanges.decisionsByYou, []);
  assert.deepEqual(data.incidentReports, []);
  assert.deepEqual(data.sharedTripLinks, []);
  assert.deepEqual(data.privacy, { showProfileToCoPassengers: false, updatedAt: null });
});

test("exportación: quien no tiene nada en live recibe listas vacías y la preferencia por defecto, sin inventar una media", async () => {
  await richScene();
  const stranger = await seedUser(pool, "Curioso");
  const data = await exportUserLiveData(pool, stranger);
  assert.deepEqual(data, {
    ratingSummary: { average: null, count: 0 },
    ratingsGiven: [],
    ratingsReceived: [],
    incidentReports: [],
    sharedTripLinks: [],
    routeChanges: { proposedByYou: [], decisionsByYou: [] },
    privacy: { showProfileToCoPassengers: false, updatedAt: null },
    truncated: false
  });
});

/* ───────────────────────────── Conexión con comms ───────────────────────────── */

test("al arrancar el módulo, live se registra en comms (exportación y eliminación de cuenta), sin duplicarse", async () => {
  assert.deepEqual(getExportContributors(), []);
  assert.deepEqual(getErasureSteps(), []);

  const app = await buildLiveApp(pool, { routeProvider: new FakeRouteProvider(), privateStorage: storage });
  try {
    assert.deepEqual(getExportContributors().map(c => c.name), [LIVE_MODULE_NAME]);
    assert.deepEqual(getErasureSteps().map(step => step.name), [LIVE_MODULE_NAME]);
    assert.deepEqual(getDeletionBlockerProviders(), [], "live no bloquea la eliminación: comms ya comprueba reservas y viajes activos");
    assert.equal(await registerLiveDataRights(), true);
    assert.equal(getExportContributors().length, 1, "registrar de nuevo sustituye, no duplica");
    assert.equal(getErasureSteps().length, 1);
  } finally {
    await app.close();
  }
});

/** Forma del archivo de exportación de comms que interesa aquí (`UserDataExport` es un `Record<string, unknown>`). */
type ExportFile = { modules: Record<string, unknown>; notIncluded: Array<{ section: string; reason: string }> };

test("el archivo de exportación real de comms incluye modules.live y deja de listar a live como «no incluido»", async () => {
  const r = await richScene();
  const config = loadCommsConfig({});
  const before = (await buildUserDataExport(pool, r.world.miguel, config, AFTER_TRIP)) as unknown as ExportFile;
  assert.equal("live" in before.modules, false);
  assert.ok(before.notIncluded.some(item => item.section.startsWith("Valoraciones, incidencias")));

  assert.equal(await registerLiveDataRights(), true);
  const after = (await buildUserDataExport(pool, r.world.miguel, config, AFTER_TRIP)) as unknown as ExportFile;
  assert.deepEqual(JSON.parse(JSON.stringify(after.modules.live)), JSON.parse(JSON.stringify(await exportUserLiveData(pool, r.world.miguel))));
  assert.equal(after.notIncluded.some(item => item.section.startsWith("Valoraciones, incidencias")), false);
  // Las demás secciones externas siguen sin integrar: live no las toca.
  assert.ok(after.notIncluded.length >= 1);
});

/* ───────────────────────────── Eliminación de cuenta (derecho de supresión) ───────────────────────────── */

test("borrado: elimina enlaces, preferencia y valoraciones recibidas; vacía el texto de las dadas; conserva incidencias y lo ajeno", async () => {
  const r = await richScene();
  const client = await pool.connect();
  let counts: Record<string, number>;
  try {
    await client.query("begin");
    counts = await eraseUserLiveData(client, r.world.miguel);
    await client.query("commit");
  } finally {
    client.release();
  }
  assert.deepEqual(counts, {
    tripSharesDeleted: 2, privacyPreferencesDeleted: 1, ratingsReceivedDeleted: 1, ratingCommentsErased: 1, ratingAggregatesReset: 1
  });

  assert.equal(await count(`select 1 from trip_shares where created_by_user_id=$1`, [r.world.miguel]), 0);
  assert.equal(await count(`select 1 from live_privacy_preferences where user_id=$1`, [r.world.miguel]), 0);
  // Lo que Ana dijo de Miguel desaparece; lo que Miguel dijo de Ana se queda SIN texto y sus estrellas siguen en la media de Ana.
  assert.equal(await count(`select 1 from trip_ratings where ratee_user_id=$1`, [r.world.miguel]), 0);
  const given = (await pool.query(`select stars, comment from trip_ratings where rater_user_id=$1`, [r.world.miguel])).rows;
  assert.deepEqual(given, [{ stars: 5, comment: null }]);
  const aggregates = (await pool.query(`select rating_sum, rating_count from profiles where user_id=$1`, [r.world.miguel])).rows[0];
  assert.deepEqual({ sum: Number(aggregates.rating_sum), count: Number(aggregates.rating_count) }, { sum: 0, count: 0 });
  const ana = (await pool.query(`select rating_sum, rating_count from profiles where user_id=$1`, [r.world.ana])).rows[0];
  assert.deepEqual({ sum: Number(ana.rating_sum), count: Number(ana.rating_count) }, { sum: 162, count: 34 });

  // Se conservan: la incidencia con su foto (seguridad y defensa de reclamaciones), la decisión de cambio de ruta y todo lo de otros.
  assert.equal(await count(`select 1 from incident_reports where id=$1 and reporter_user_id=$2`, [r.incidentId, r.world.miguel]), 1);
  assert.equal(await count(`select 1 from incident_attachments where report_id=$1`, [r.incidentId]), 1);
  assert.equal(await count(`select 1 from route_change_acceptances where passenger_user_id=$1`, [r.world.miguel]), 1);
  assert.equal(await count(`select 1 from route_change_proposals where id=$1`, [r.proposalId]), 1);
  assert.equal(
    (await pool.query(`select comment from trip_ratings where rater_user_id=$1`, [r.world.laura])).rows[0].comment,
    "Fue bien, algo de prisa"
  );

  // Idempotente: una segunda ejecución no encuentra nada que borrar.
  const again = await eraseUserLiveData(pool, r.world.miguel);
  assert.deepEqual(again, {
    tripSharesDeleted: 0, privacyPreferencesDeleted: 0, ratingsReceivedDeleted: 0, ratingCommentsErased: 0, ratingAggregatesReset: 0
  });
});

test("eliminación de cuenta de punta a punta con comms: ejecuta el paso de live dentro de su transacción y deja el resumen", async () => {
  const r = await richScene();
  assert.equal(await registerLiveDataRights(), true);
  const erased: string[] = [];
  const deps = {
    pool, config: loadCommsConfig({}), storage: null,
    eraser: { deleteObjects: async (keys: string[]) => { erased.push(...keys); } }
  };
  await pool.query(
    `insert into account_deletion_requests(user_id, status, scheduled_for, requested_at)
     values($1,'scheduled', now() - interval '1 minute', now() - interval '15 days')`,
    [r.world.miguel]
  );

  const outcome = await executeDueAccountDeletions(deps, new Date());
  assert.deepEqual(outcome, { processed: 1, completed: 1, blocked: 0, failed: 0 });

  assert.equal((await pool.query(`select status::text as status from app_users where id=$1`, [r.world.miguel])).rows[0].status, "deleted");
  const summary = (await pool.query(`select erasure_summary from account_deletion_requests where user_id=$1`, [r.world.miguel])).rows[0].erasure_summary;
  assert.equal(summary["live.tripSharesDeleted"], 2);
  assert.equal(summary["live.privacyPreferencesDeleted"], 1);
  assert.equal(summary["live.ratingsReceivedDeleted"], 1);
  assert.equal(summary["live.ratingCommentsErased"], 1);
  assert.equal(summary["live.ratingAggregatesReset"], 1);

  assert.equal(await count(`select 1 from trip_shares where created_by_user_id=$1`, [r.world.miguel]), 0);
  assert.deepEqual((await pool.query(`select stars, comment from trip_ratings where rater_user_id=$1`, [r.world.miguel])).rows, [{ stars: 5, comment: null }]);
  // La foto de la incidencia es prueba conservada: comms no la borra del almacenamiento privado.
  assert.equal(erased.some(key => key.includes("/incidents/")), false);
  assert.equal(storage.objects.has(r.attachmentKey), true);
  assert.equal(await count(`select 1 from incident_reports where id=$1`, [r.incidentId]), 1);
  // Los datos de otras personas siguen intactos.
  assert.equal(await count(`select 1 from trip_ratings where ratee_user_id=$1`, [r.world.ana]), 2);
});

test("si un paso posterior de otro módulo falla, comms deshace TODA la eliminación, también lo borrado por live", async () => {
  const r = await richScene();
  assert.equal(await registerLiveDataRights(), true);
  registerErasureStep({
    name: "zz-otro-modulo",
    run: async () => { throw new Error("OTRO_MODULO_FALLA"); }
  });
  await pool.query(
    `insert into account_deletion_requests(user_id, status, scheduled_for, requested_at)
     values($1,'scheduled', now() - interval '1 minute', now() - interval '15 days')`,
    [r.world.miguel]
  );
  const deps = { pool, config: loadCommsConfig({}), storage: null, eraser: { deleteObjects: async () => {} } };

  const outcome = await executeDueAccountDeletions(deps, new Date());
  assert.deepEqual(outcome, { processed: 1, completed: 0, blocked: 0, failed: 1 });
  assert.equal((await pool.query(`select status::text as status from app_users where id=$1`, [r.world.miguel])).rows[0].status, "active");
  // El paso de live se ejecutó dentro de la transacción y se deshizo con ella.
  assert.equal(await count(`select 1 from trip_shares where created_by_user_id=$1`, [r.world.miguel]), 2);
  assert.equal(await count(`select 1 from live_privacy_preferences where user_id=$1`, [r.world.miguel]), 1);
  assert.equal(await count(`select 1 from trip_ratings where ratee_user_id=$1`, [r.world.miguel]), 1);
  assert.deepEqual(
    (await pool.query(`select comment from trip_ratings where rater_user_id=$1`, [r.world.miguel])).rows,
    [{ comment: "Muy puntual y amable" }]
  );
  const request = (await pool.query(`select status, last_error from account_deletion_requests where user_id=$1`, [r.world.miguel])).rows[0];
  assert.deepEqual(request, { status: "processing", last_error: "OTRO_MODULO_FALLA" });
});
