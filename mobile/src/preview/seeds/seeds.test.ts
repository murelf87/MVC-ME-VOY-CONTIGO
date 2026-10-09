/**
 * Mundo sembrado: todas las combinaciones perfil × variante, determinismo, instantáneas, las cifras de las láminas y el
 * estado concreto que deja cada variante (solicitud pendiente, plaza retenida con cuenta atrás, reserva, viaje en curso,
 * viaje terminado). También el contrato con los slices (`seedSlice` después del mundo base y antes de la variante).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_PREVIEW_NOW } from "../core/clock";
import { createPreviewDb, type PreviewDb } from "../core/db";
import { createRouter } from "../core/router";
import { PREVIEW_PROFILE_IDS, PREVIEW_PROFILES, type PreviewProfileId } from "../core/types";
import { SEVILLA_PROVINCE_ID } from "../data/provinces";
import { availableSeatsForRange, occupiedOnSegment } from "../domain/seats";
import { userStats } from "../domain/users";
import { PREVIEW_SLICES, isAcceptedSeed, listSeedVariants, registerPreviewHandlers, resetWorld, seedWorld, type PreviewSlice } from "../register";
import { createPreviewRuntime } from "../runtime";
import { asArray, asRecord, createApi, num, str, testRuntime, tokenFor } from "../testing/harness";
import {
  CAST,
  HISTORY_TRIPS_FOR_MIGUEL,
  MIGUEL_MESSAGE,
  SEED_TRIP_IDS,
  SEED_USER_IDS,
  SEED_VARIANTS,
  SEED_VEHICLE_IDS,
  SeedRefError,
  TRIP_SPECS,
  baseOptionsFor,
  historyTripIds,
  isKnownSeedVariant,
  profileSessionToken,
  profileUserId,
  registerSeedRef,
  resolveAllSeedRefs,
  resolveRefsIn,
  resolveSeedRef,
  seedBase,
  seedRefNames,
  seedVariantNames,
  unregisterSeedRef,
} from "./index";

const T1 = SEED_TRIP_IDS.anaMorning;
const MIN = 60_000;
const NOW = Date.parse(DEFAULT_PREVIEW_NOW);

const VARIANTS = [
  "default",
  "driver-requests",
  "empty",
  "fresh-driver",
  "request-pending",
  "request-accepted",
  "booking-confirmed",
  "trip-live-waiting",
  "trip-live-in-car",
  "trip-finished",
] as const;

function seededDb(profile: PreviewProfileId, seed = "default", clock?: string): PreviewDb {
  const db = createPreviewDb(clock ? { now: clock } : {});
  seedWorld(db, profile, seed);
  return db;
}

/** Solo el mundo base (sin slices ni variante): las cifras exactas no dependen de lo que añadan los slices. */
function baseOnly(seed = "default", profile: PreviewProfileId = "passenger"): PreviewDb {
  const db = createPreviewDb();
  seedBase(db, profile, baseOptionsFor(seed));
  return db;
}

function fingerprint(db: PreviewDb): string {
  return JSON.stringify(db.snapshot());
}

/** Como `fingerprint`, sin las colecciones vacías (una base usada puede conservar alguna creada «al vuelo» por un slice). */
function fingerprintWithoutEmpty(db: PreviewDb): string {
  const snapshot = db.snapshot();
  const collections = Object.fromEntries(Object.entries(snapshot.collections).filter(([, data]) => data.rows.length > 0));
  return JSON.stringify({ ...snapshot, collections });
}

/** Coherencia referencial y de capacidad de todo lo sembrado. Devuelve los problemas encontrados. */
function integrityProblems(db: PreviewDb): string[] {
  const problems: string[] = [];
  const need = (ok: boolean, message: string): void => {
    if (!ok) problems.push(message);
  };
  for (const role of db.userRoles.all()) need(db.users.has(role.user_id), `rol ${role.id}: usuario inexistente`);
  for (const profile of db.profiles.all()) need(db.users.has(profile.user_id), `perfil ${profile.user_id}: usuario inexistente`);
  for (const session of db.sessions.all()) need(db.users.has(session.user_id), `sesión ${session.id}: usuario inexistente`);
  for (const vehicle of db.vehicles.all()) need(db.users.has(vehicle.driver_user_id), `vehículo ${vehicle.id}: conductor inexistente`);
  for (const doc of db.documents.all()) {
    need(db.users.has(doc.owner_user_id), `documento ${doc.id}: propietario inexistente`);
    need(doc.vehicle_id === null || db.vehicles.has(doc.vehicle_id), `documento ${doc.id}: vehículo inexistente`);
    need(db.blobs.has(doc.storage_key), `documento ${doc.id}: sin objeto en el almacén simulado`);
  }
  for (const trip of db.trips.all()) {
    need(db.users.has(trip.driver_user_id), `viaje ${trip.id}: conductor inexistente`);
    need(db.provinces.has(trip.province_id), `viaje ${trip.id}: provincia inexistente`);
    const vehicle = db.vehicles.get(trip.vehicle_id);
    need(vehicle !== undefined, `viaje ${trip.id}: vehículo inexistente`);
    need(vehicle?.driver_user_id === trip.driver_user_id, `viaje ${trip.id}: el vehículo es de otra persona`);
    const stops = db.tripStops.filter((s) => s.trip_id === trip.id);
    const segments = db.tripSegments.filter((s) => s.trip_id === trip.id);
    need(stops.length >= 2, `viaje ${trip.id}: menos de dos paradas`);
    need(segments.length === stops.length - 1, `viaje ${trip.id}: tramos (${segments.length}) ≠ paradas − 1 (${stops.length - 1})`);
    need(trip.route_geometry.length >= 2, `viaje ${trip.id}: ruta sin geometría`);
    for (const segment of segments) {
      const used = occupiedOnSegment(db, trip.id, segment.seq);
      need(used <= segment.capacity, `viaje ${trip.id} tramo ${segment.seq}: ${used} plazas ocupadas con capacidad ${segment.capacity}`);
    }
  }
  for (const request of db.rideRequests.all()) {
    const segments = db.tripSegments.filter((s) => s.trip_id === request.trip_id).length;
    need(db.trips.has(request.trip_id), `solicitud ${request.id}: viaje inexistente`);
    need(db.users.has(request.passenger_user_id), `solicitud ${request.id}: pasajero inexistente`);
    need(request.from_segment_seq < request.to_segment_seq && request.to_segment_seq <= segments, `solicitud ${request.id}: rango de tramos no válido`);
  }
  for (const hold of db.seatHolds.all()) need(db.rideRequests.has(hold.request_id), `hold ${hold.id}: solicitud inexistente`);
  for (const booking of db.bookings.all()) need(db.rideRequests.has(booking.request_id), `reserva ${booking.id}: solicitud inexistente`);
  for (const code of db.pickupCodes.all()) need(db.bookings.has(code.booking_id), `código ${code.id}: reserva inexistente`);
  for (const message of db.messages.all()) {
    need(db.trips.has(message.trip_id), `mensaje ${message.id}: viaje inexistente`);
    need(db.users.has(message.sender_user_id) && db.users.has(message.recipient_user_id), `mensaje ${message.id}: persona inexistente`);
  }
  for (const state of db.liveState.all()) need(db.trips.has(state.trip_id), `ubicación en vivo ${state.id}: viaje inexistente`);
  for (const event of db.locationEvents.all()) need(db.trips.has(event.trip_id), `evento de ubicación ${event.id}: viaje inexistente`);
  return problems;
}

describe("catálogo de variantes", () => {
  it("expone las diez variantes documentadas, en orden, cada una con su descripción", () => {
    assert.deepEqual(seedVariantNames(), [...VARIANTS]);
    for (const name of VARIANTS) {
      const variant = SEED_VARIANTS[name];
      assert.ok(variant, name);
      assert.ok(variant.description.length > 30, `${name}: descripción útil para quien escribe un escenario`);
    }
  });

  it("isKnownSeedVariant no se deja engañar por propiedades heredadas de Object", () => {
    for (const name of VARIANTS) assert.equal(isKnownSeedVariant(name), true, name);
    for (const name of ["", "nope", "toString", "constructor", "__proto__", "hasOwnProperty", "Default"]) {
      assert.equal(isKnownSeedVariant(name), false, name);
    }
  });

  it("un nombre desconocido se comporta como «default» (no rompe un escenario con una errata)", () => {
    const reference = seededDb("passenger", "default");
    const unknown = seededDb("passenger", "no-existe");
    const a = reference.snapshot();
    const b = unknown.snapshot();
    assert.equal(b.seedName, "no-existe");
    assert.deepEqual({ ...b, seedName: a.seedName }, a);
    assert.deepEqual(baseOptionsFor("no-existe"), baseOptionsFor("default"));
    assert.deepEqual(baseOptionsFor("toString"), baseOptionsFor("default"));
  });

  it("«default» y «driver-requests» son el mismo mundo (la conductora ve dos solicitudes pendientes en ambos)", () => {
    const a = seededDb("driver", "default").snapshot();
    const b = seededDb("driver", "driver-requests").snapshot();
    // el flujo del azar posterior a sembrar se bifurca por nombre de variante: solo eso difiere
    assert.deepEqual({ ...b, seedName: a.seedName, ids: a.ids }, a);
  });
});

describe("todas las combinaciones perfil × variante", () => {
  for (const profile of PREVIEW_PROFILE_IDS) {
    for (const seed of VARIANTS) {
      it(`${profile} · ${seed}: se siembra, es coherente y sobrevive a una instantánea JSON`, () => {
        const db = seededDb(profile, seed);
        assert.equal(db.profile, profile);
        assert.equal(db.seedName, seed);
        assert.deepEqual(integrityProblems(db), []);

        const json = fingerprint(db);
        const copy = createPreviewDb();
        copy.restore(JSON.parse(json) as ReturnType<PreviewDb["snapshot"]>);
        assert.equal(fingerprint(copy), json, "restaurar la instantánea reproduce exactamente la base");
        assert.deepEqual(integrityProblems(copy), []);
      });
    }
  }
});

describe("determinismo", () => {
  it("los mismos datos de entrada dan exactamente la misma base (ids, horas, códigos)", () => {
    for (const seed of VARIANTS) {
      assert.equal(fingerprint(seededDb("passenger", seed)), fingerprint(seededDb("passenger", seed)), seed);
    }
  });

  it("volver a sembrar con resetWorld sobre una base usada deja la misma base que una nueva", () => {
    const db = seededDb("driver", "booking-confirmed");
    db.rideRequests.delete(db.rideRequests.all()[0]?.id ?? "");
    db.ids.uuid();
    resetWorld(db, { profile: "passenger", seed: "request-pending", clock: null });
    assert.equal(fingerprintWithoutEmpty(db), fingerprintWithoutEmpty(seededDb("passenger", "request-pending")));
  });

  it("el perfil solo cambia la sesión: el resto del mundo es idéntico", () => {
    const worlds = PREVIEW_PROFILE_IDS.map((profile) => {
      const snap = seededDb(profile, "request-pending").snapshot();
      const { auth_sessions: sessions, ...collections } = snap.collections;
      return { profile, sessions: sessions?.rows.length ?? 0, rest: JSON.stringify({ ...snap, profile: "x", collections }) };
    });
    const [first, ...others] = worlds;
    assert.ok(first);
    for (const other of others) assert.equal(other.rest, first.rest, `${other.profile} difiere de ${first.profile}`);
    assert.deepEqual(
      worlds.map((w) => w.sessions),
      [0, 1, 1, 1]
    );
  });

  it("los ids que crea una variante no dependen del perfil ni de lo que hagan los slices al sembrar", () => {
    const requestIds = PREVIEW_PROFILE_IDS.map((profile) => {
      const db = seededDb(profile, "booking-confirmed");
      const request = db.rideRequests.find((r) => r.trip_id === T1 && r.passenger_user_id === SEED_USER_IDS.miguel);
      const booking = db.bookings.find((b) => b.request_id === request?.id);
      return `${request?.id}|${booking?.id}`;
    });
    assert.equal(new Set(requestIds).size, 1, requestIds.join(" / "));
    assert.match(requestIds[0] ?? "", /^[0-9a-f-]{36}\|[0-9a-f-]{36}$/);

    const slices = PREVIEW_SLICES as PreviewSlice[];
    slices.push({
      name: "ruido",
      module: {
        registerPreview: () => undefined,
        seedSlice(db) {
          for (let i = 0; i < 50; i += 1) db.ids.uuid(); // un slice que gasta azar al sembrar
        },
      },
    });
    try {
      const db = seededDb("passenger", "booking-confirmed");
      const request = db.rideRequests.find((r) => r.trip_id === T1 && r.passenger_user_id === SEED_USER_IDS.miguel);
      const booking = db.bookings.find((b) => b.request_id === request?.id);
      assert.equal(`${request?.id}|${booking?.id}`, requestIds[0], "los mismos ids con un slice que consume azar");
    } finally {
      slices.pop();
    }
  });

  it("la oferta se ancla al día de «ahora» y conserva las horas locales (08:05, 08:03…)", () => {
    const monday = seededDb("passenger", "default");
    assert.equal(monday.trips.get(T1)?.departure_at, Date.parse("2026-10-05T08:05:00+02:00"));

    const tuesday = seededDb("passenger", "default", "2026-10-06T07:17:00+02:00");
    assert.equal(tuesday.trips.get(T1)?.departure_at, Date.parse("2026-10-06T08:05:00+02:00"));
    assert.equal(tuesday.trips.get(SEED_TRIP_IDS.miguelAngelMorning)?.departure_at, Date.parse("2026-10-06T08:03:00+02:00"));
    assert.deepEqual(integrityProblems(tuesday), []);

    const evening = seededDb("passenger", "default", "2026-10-05T22:00:00+02:00");
    assert.equal(evening.trips.get(T1)?.departure_at, Date.parse("2026-10-06T08:05:00+02:00"), "pasadas las 21:00 locales se ofrece el día siguiente");
    assert.ok((evening.trips.get(T1)?.departure_at ?? 0) > evening.nowMs());
  });

  it("también se siembran con el reloj en verano e invierno (cambio de hora)", () => {
    for (const clock of ["2026-03-28T22:30:00+01:00", "2026-03-29T07:17:00+02:00", "2026-10-24T22:30:00+02:00", "2026-10-25T07:17:00+01:00", "2027-01-11T07:17:00+01:00"]) {
      const db = seededDb("driver", "request-pending", clock);
      assert.deepEqual(integrityProblems(db), [], clock);
      for (const trip of db.trips.filter((t) => t.status === "published")) {
        assert.ok((trip.departure_at ?? 0) > db.nowMs(), `${clock}: ${trip.id} sale en el futuro`);
      }
    }
  });
});

describe("mundo base", () => {
  it("20 personas del reparto: teléfonos de pruebas +34 611 000 xxx, únicos, y el personal con +34611000199", () => {
    const db = baseOnly();
    assert.equal(CAST.length, 20);
    assert.equal(db.users.size, 20);
    const phones = db.users.all().map((u) => u.phone_e164);
    assert.equal(new Set(phones).size, 20);
    for (const phone of phones) assert.match(phone, /^\+34611000\d{3}$/);
    const staff = db.users.get(SEED_USER_IDS.staff);
    assert.equal(staff?.phone_e164, "+34611000199");
    assert.deepEqual(
      db.userRoles.filter((r) => r.user_id === SEED_USER_IDS.staff).map((r) => r.role),
      ["admin", "verification_admin", "finance_admin", "support_admin"]
    );
  });

  it("valoraciones públicas de las láminas: Miguel 4,8 ★ (12 viajes) y Ana 4,8 ★ (32)", () => {
    const db = baseOnly();
    const stats = userStats(db);
    assert.deepEqual(stats.get(SEED_USER_IDS.miguel), { id: SEED_USER_IDS.miguel, rating_average: 4.8, rating_count: 12, trips_completed: 12 });
    assert.deepEqual(stats.get(SEED_USER_IDS.ana), { id: SEED_USER_IDS.ana, rating_average: 4.8, rating_count: 32, trips_completed: 32 });
    assert.equal(stats.get(SEED_USER_IDS.miguelAngel)?.rating_average, 4.9);
    assert.equal(stats.get(SEED_USER_IDS.miguelAngel)?.rating_count, 18);
    assert.equal(db.profiles.get(SEED_USER_IDS.miguel)?.display_name, "Miguel Torres");
    assert.equal(db.profiles.get(SEED_USER_IDS.ana)?.display_name, "Ana García López");
  });

  it("oferta: 13 viajes de la tabla (12 publicados y 1 borrador) + 12 del historial de Miguel con Ana", () => {
    const db = baseOnly();
    assert.equal(TRIP_SPECS.length, 13);
    assert.equal(HISTORY_TRIPS_FOR_MIGUEL, 12);
    assert.equal(db.trips.size, 25);
    assert.equal(db.trips.count((t) => t.status === "published"), 12);
    assert.equal(db.trips.count((t) => t.status === "draft"), 1);
    assert.equal(db.trips.count((t) => t.status === "completed"), 12);
    assert.equal(db.tripStops.size, 52);
    assert.equal(db.rideRequests.size, 24, "22 confirmadas + 2 pendientes (Hugo y Nuria) en el viaje de Ana");
    assert.equal(db.bookings.size, 22);
    assert.equal(db.rideRequests.count((r) => r.status === "pending"), 2);
    assert.deepEqual(
      historyTripIds(db).filter((id) => !db.trips.has(id)),
      []
    );
  });

  it("los viajes publicados salen en el futuro y los del historial son pasados y completados", () => {
    const db = baseOnly();
    for (const trip of db.trips.all()) {
      const departure = trip.departure_at ?? 0;
      if (trip.status === "completed") {
        assert.ok(departure < NOW, `${trip.id} es del pasado`);
        assert.ok((trip.completed_at ?? 0) > departure);
      } else {
        assert.ok(departure > NOW, `${trip.id} sale después de «ahora»`);
        assert.ok(trip.created_at < NOW, `${trip.id} se creó antes de «ahora»`);
      }
    }
  });

  it("la provincia es Sevilla y todos los viajes, vehículos y personas son de ella o ficticias", () => {
    const db = baseOnly();
    assert.equal(db.provinces.size, 1);
    assert.equal(db.provinces.get(SEVILLA_PROVINCE_ID)?.name, "Sevilla");
    assert.ok(db.trips.all().every((t) => t.province_id === SEVILLA_PROVINCE_ID));
  });

  it("los vehículos aprobados tienen foto y seguro vigentes; los otros dos alimentan las colas de revisión", () => {
    const db = baseOnly();
    const approved = db.vehicles.filter((v) => v.review_status === "approved");
    const pending = db.vehicles.filter((v) => v.review_status !== "approved");
    assert.equal(approved.length + pending.length, db.vehicles.size);
    assert.equal(pending.length, 2);
    const today = new Date(NOW).toISOString().slice(0, 10);
    for (const vehicle of approved) {
      assert.equal(vehicle.insurance_status, "approved", vehicle.plate);
      assert.equal(vehicle.vehicle_photo_status, "approved", vehicle.plate);
      assert.ok((vehicle.insurance_expires_on ?? "") > today, `${vehicle.plate}: seguro vigente`);
    }
  });

  it("las personas tienen retrato aprobado solo si el diseño las muestra con foto", () => {
    const db = baseOnly();
    for (const member of CAST) {
      const profile = db.profiles.get(SEED_USER_IDS[member.key]);
      assert.equal(profile?.public_photo_key !== null, member.photo !== null, member.displayName);
      assert.equal(profile?.public_photo_status, member.photo ? "approved" : "pending");
    }
  });
});

describe("perfiles de prueba", () => {
  it("«new» no tiene sesión ni token; los otros tres abren la sesión de su persona con un token determinista", () => {
    assert.equal(profileSessionToken("new"), null);
    assert.equal(profileUserId("new"), null);
    assert.equal(seededDb("new").sessions.size, 0);

    const expected: Array<[PreviewProfileId, string]> = [
      ["passenger", SEED_USER_IDS.miguel],
      ["driver", SEED_USER_IDS.ana],
      ["admin", SEED_USER_IDS.staff],
    ];
    for (const [profile, userId] of expected) {
      assert.equal(profileUserId(profile), userId);
      const token = profileSessionToken(profile);
      assert.match(token ?? "", /^mvc_sess_[A-Za-z0-9_-]{43}$/);
      assert.equal(token, profileSessionToken(profile), "el token no cambia entre llamadas");
      assert.equal(seededDb(profile).sessions.size, 1);
    }
    const tokens = new Set(expected.map(([profile]) => profileSessionToken(profile)));
    assert.equal(tokens.size, 3);
    assert.equal(PREVIEW_PROFILES.new.userKey, null);
  });

  it("/me devuelve a Miguel, Ana o el personal según el perfil, con sus roles", async () => {
    const expectations: Array<[PreviewProfileId, string, string[]]> = [
      ["passenger", "Miguel Torres", ["passenger"]],
      ["driver", "Ana García López", ["passenger", "driver"]],
      ["admin", "Administración MVC", ["admin", "verification_admin", "finance_admin", "support_admin"]],
    ];
    for (const [profile, name, roles] of expectations) {
      const rt = testRuntime({ profile });
      const me = await createApi(rt)("GET", "/me", { token: rt.sessionToken() });
      assert.equal(me.status, 200, profile);
      const body = asRecord(me.body);
      assert.equal(body.display_name, name);
      assert.deepEqual([...(body.roles as string[])].sort(), [...roles].sort());
      assert.equal(body.status, "active");
    }
  });

  it("el token del perfil no abre la sesión de otro y uno desconocido es 401", async () => {
    const rt = testRuntime({ profile: "passenger" });
    const api = createApi(rt);
    const ana = await api("GET", "/me", { token: tokenFor(rt, "ana") });
    assert.equal(asRecord(ana.body).display_name, "Ana García López");
    const nobody = await api("GET", "/me", { token: "mvc_sess_" + "x".repeat(43) });
    assert.equal(nobody.status, 401);
  });
});

describe("cifras de las láminas", () => {
  const search = (origin: [number, number], destination: [number, number]): string =>
    new URLSearchParams({
      provinceId: SEVILLA_PROVINCE_ID,
      originLatitude: String(origin[0]),
      originLongitude: String(origin[1]),
      destinationLatitude: String(destination[0]),
      destinationLongitude: String(destination[1]),
    }).toString();

  it("lámina 12: Montequinto 08:05 → Dos Hermanas 08:15 → Universidad 08:28 · 24 km · 23 min · 2 plazas libres", () => {
    const db = baseOnly();
    const trip = db.trips.get(T1);
    assert.ok(trip);
    assert.equal(trip.route_distance_m, 24000);
    assert.equal(trip.route_duration_s, 1380);
    assert.equal(trip.departure_at, Date.parse("2026-10-05T08:05:00+02:00"));
    const stops = db.tripStops.filter((s) => s.trip_id === T1).sort((a, b) => a.seq - b.seq);
    assert.deepEqual(
      stops.map((s) => s.label),
      ["Montequinto", "Dos Hermanas", "Sevilla – Universidad"]
    );
    const segments = db.tripSegments.filter((s) => s.trip_id === T1).sort((a, b) => a.seq - b.seq);
    assert.deepEqual(
      segments.map((s) => [s.distance_m, s.duration_s]),
      [
        [9000, 600],
        [15000, 780],
      ]
    );
    // 08:05 + 10 min = 08:15 en Dos Hermanas; + 13 min = 08:28 en la Universidad
    const stopTimesMs = [trip.departure_at ?? 0, (trip.departure_at ?? 0) + 600_000, (trip.departure_at ?? 0) + 1_380_000];
    assert.deepEqual(
      stopTimesMs.map((ms) => new Date(ms).toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid" })),
      ["08:05", "08:15", "08:28"]
    );
    assert.equal(availableSeatsForRange(db, T1, 0, 2), 2);
    assert.equal(db.vehicles.get(trip.vehicle_id)?.model, "Arona");
    assert.equal(db.vehicles.get(trip.vehicle_id)?.color, "Gris");
  });

  it("lámina 11: Miguel Ángel, Mairena del Aljarafe → Universidad, 21,5 km, 29 min, queda 1 plaza", () => {
    const db = baseOnly();
    const trip = db.trips.get(SEED_TRIP_IDS.miguelAngelMorning);
    assert.ok(trip);
    assert.equal(trip.route_distance_m, 21500);
    assert.equal(trip.route_duration_s, 1740);
    assert.equal(availableSeatsForRange(db, trip.id, 0, 1), 1);
    assert.equal(trip.departure_at, Date.parse("2026-10-05T08:03:00+02:00"));
  });

  it("lámina 09: Carlos tiene 1 plaza, Marta va completa y Ana 2", () => {
    const db = baseOnly();
    assert.equal(availableSeatsForRange(db, SEED_TRIP_IDS.carlosWork, 0, 1), 1);
    assert.equal(availableSeatsForRange(db, SEED_TRIP_IDS.martaWork, 0, 1), 0);
    assert.equal(availableSeatsForRange(db, T1, 0, 2), 2);
  });

  it("la búsqueda HTTP de la lámina devuelve a Ana primero, con sus cifras, y no ofrece el viaje completo de Marta", async () => {
    const rt = testRuntime({ profile: "passenger" });
    const res = await createApi(rt)("GET", `/v1/trips/search?${search([37.3256, -5.9396], [37.3796, -5.9919])}`);
    assert.equal(res.status, 200);
    const trips = asArray(asRecord(res.body).trips, "trips").map((t) => asRecord(t));
    const [first] = trips;
    assert.equal(first?.tripId, T1);
    assert.equal(first?.availableSeats, 2);
    assert.equal(first?.roadDistanceM, 24000);
    assert.equal(first?.estimatedDurationS, 1380);
    assert.ok(!trips.some((t) => t.tripId === SEED_TRIP_IDS.martaWork), "un viaje completo no se ofrece");
  });

  it("buscar de Mairena a la Universidad ofrece el viaje de Miguel Ángel con 1 plaza", async () => {
    const rt = testRuntime({ profile: "passenger" });
    const res = await createApi(rt)("GET", `/v1/trips/search?${search([37.3446, -6.0614], [37.3825, -5.9919])}`);
    const found = asArray(asRecord(res.body).trips, "trips")
      .map((t) => asRecord(t))
      .find((t) => t.tripId === SEED_TRIP_IDS.miguelAngelMorning);
    assert.ok(found);
    assert.equal(found.availableSeats, 1);
    assert.equal(found.driverDisplayName, "Miguel Ángel Ruiz");
    assert.equal(found.roadDistanceM, 21500);
  });
});

describe("variantes: estado que deja cada una", () => {
  function pendingOf(db: PreviewDb, userId: string) {
    return db.rideRequests.filter((r) => r.trip_id === T1 && r.passenger_user_id === userId);
  }

  it("default: Ana ve dos solicitudes pendientes (Hugo y Nuria) y Miguel ninguna abierta", () => {
    const db = seededDb("driver");
    const pending = db.rideRequests.filter((r) => r.trip_id === T1 && r.status === "pending");
    assert.deepEqual(
      pending.map((r) => r.passenger_user_id).sort(),
      [SEED_USER_IDS.hugo, SEED_USER_IDS.nuria].sort()
    );
    const hugo = pending.find((r) => r.passenger_user_id === SEED_USER_IDS.hugo);
    const nuria = pending.find((r) => r.passenger_user_id === SEED_USER_IDS.nuria);
    assert.equal(db.nowMs() - (hugo?.requested_at ?? 0), 26 * MIN);
    assert.equal(db.nowMs() - (nuria?.requested_at ?? 0), 11 * MIN);
    assert.equal(hugo?.pickup_label, "Dos Hermanas");
    assert.equal(nuria?.pickup_label, "Montequinto");
    assert.deepEqual(pendingOf(db, SEED_USER_IDS.miguel), []);
    assert.equal(availableSeatsForRange(db, T1, 0, 2), 2, "las pendientes no reservan plaza");
  });

  it("empty: sin viajes, sin solicitudes, sin historial; la conductora conserva su vehículo", async () => {
    const rt = testRuntime({ profile: "driver", seed: "empty" });
    assert.equal(rt.db.trips.size, 0);
    assert.equal(rt.db.rideRequests.size, 0);
    assert.equal(rt.db.bookings.size, 0);
    assert.ok(rt.db.vehicles.size > 0);
    const api = createApi(rt);
    const mine = await api("GET", "/v1/me/trips", { token: rt.sessionToken() });
    assert.deepEqual(asRecord(mine.body).trips, []);
    const found = await api("GET", `/v1/trips/search?${new URLSearchParams({ provinceId: SEVILLA_PROVINCE_ID, originLatitude: "37.3256", originLongitude: "-5.9396", destinationLatitude: "37.3796", destinationLongitude: "-5.9919" })}`);
    assert.deepEqual(asRecord(found.body).trips, []);
  });

  it("fresh-driver: Ana no tiene vehículo, documentos, viajes ni valoraciones (alta desde cero); los demás siguen ahí", async () => {
    const rt = testRuntime({ profile: "driver", seed: "fresh-driver" });
    const ana = SEED_USER_IDS.ana;
    assert.equal(rt.db.vehicles.count((v) => v.driver_user_id === ana), 0);
    assert.equal(rt.db.documents.count((d) => d.owner_user_id === ana), 0);
    assert.equal(rt.db.trips.count((t) => t.driver_user_id === ana), 0);
    assert.deepEqual(userStats(rt.db).get(ana), { id: ana, rating_average: null, rating_count: 0, trips_completed: 0 });
    assert.ok(rt.db.trips.count((t) => t.driver_user_id === SEED_USER_IDS.carlos) > 0);
    assert.equal(rt.db.rideRequests.count((r) => r.status === "pending"), 0, "sin viaje de Ana no hay solicitudes pendientes para ella");

    const api = createApi(rt);
    const vehicles = await api("GET", "/v1/me/vehicles", { token: rt.sessionToken() });
    assert.deepEqual(asRecord(vehicles.body).vehicles, []);
    const me = asRecord((await api("GET", "/me", { token: rt.sessionToken() })).body);
    assert.deepEqual(me.roles, ["passenger", "driver"], "sigue siendo conductora aunque aún no tenga vehículo");
  });

  it("request-pending: Miguel pidió plaza a Ana hace 3 minutos, con su mensaje, y la solicitud no reserva plaza", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "request-pending" });
    const mine = rt.db.rideRequests.filter((r) => r.trip_id === T1 && r.passenger_user_id === SEED_USER_IDS.miguel);
    assert.equal(mine.length, 1);
    const [request] = mine;
    assert.equal(request?.status, "pending");
    assert.equal(rt.db.nowMs() - (request?.requested_at ?? 0), 3 * MIN);
    assert.equal(request?.message, MIGUEL_MESSAGE);
    assert.equal(request?.pickup_label, "Montequinto");
    assert.equal(request?.pickup_source, "driver_stop");
    assert.deepEqual([request?.from_segment_seq, request?.to_segment_seq], [0, 2]);
    assert.equal(availableSeatsForRange(rt.db, T1, 0, 2), 2);
    assert.equal(rt.db.rideRequests.count((r) => r.trip_id === T1 && r.status === "pending"), 3, "Hugo, Nuria y Miguel");

    const api = createApi(rt);
    const list = asArray(asRecord((await api("GET", "/v1/me/ride-requests", { token: rt.sessionToken() })).body).requests, "requests").map((r) => asRecord(r));
    const pending = list.find((r) => r.id === request?.id);
    assert.equal(pending?.status, "pending");
    assert.equal(pending?.hold_expires_at, null);
  });

  it("request-accepted: plaza retenida, cuenta atrás 14:52 y pago pendiente", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "request-accepted" });
    const request = rt.db.rideRequests.find((r) => r.trip_id === T1 && r.passenger_user_id === SEED_USER_IDS.miguel);
    assert.ok(request);
    assert.equal(request.status, "payment_pending");
    const hold = rt.db.seatHolds.find((h) => h.request_id === request.id);
    assert.ok(hold);
    assert.equal(hold.status, "active");
    const remainingS = (hold.expires_at - rt.db.nowMs()) / 1000;
    assert.equal(remainingS, 15 * 60 - 8, "ya han pasado 8 s de los 15 min: quedan 14:52");
    assert.equal(rt.db.bookings.count((b) => b.request_id === request.id), 0);
    assert.equal(availableSeatsForRange(rt.db, T1, 0, 2), 1, "la plaza retenida ya no está libre");

    const api = createApi(rt);
    const list = asArray(asRecord((await api("GET", "/v1/me/ride-requests", { token: rt.sessionToken() })).body).requests, "requests").map((r) => asRecord(r));
    const mine = list.find((r) => r.id === request.id);
    assert.equal(mine?.status, "payment_pending");
    assert.equal(mine?.hold_expires_at, new Date(hold.expires_at).toISOString());
  });

  it("request-accepted: si nadie paga, la cuenta atrás llega a cero y la plaza vuelve a estar libre (reloj virtual)", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "request-accepted" });
    const api = createApi(rt);
    rt.db.clock.advance(14 * MIN + 51_000);
    const before = asArray(asRecord((await api("GET", "/v1/me/ride-requests", { token: rt.sessionToken() })).body).requests, "requests").map((r) => asRecord(r));
    assert.equal(before.find((r) => r.trip_id === T1)?.status, "payment_pending", "a falta de 1 s sigue vigente");
    rt.db.clock.advance(2_000);
    const after = asArray(asRecord((await api("GET", "/v1/me/ride-requests", { token: rt.sessionToken() })).body).requests, "requests").map((r) => asRecord(r));
    assert.equal(after.find((r) => r.trip_id === T1)?.status, "expired");
    assert.equal(availableSeatsForRange(rt.db, T1, 0, 2), 2);
  });

  it("booking-confirmed: reserva confirmada, hold consumido y conversación con Ana abierta", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "booking-confirmed" });
    const request = rt.db.rideRequests.find((r) => r.trip_id === T1 && r.passenger_user_id === SEED_USER_IDS.miguel);
    assert.equal(request?.status, "confirmed");
    const booking = rt.db.bookings.find((b) => b.request_id === request?.id);
    assert.equal(booking?.status, "confirmed");
    assert.equal(booking?.picked_up_at, null);
    assert.equal(rt.db.nowMs() - (booking?.created_at ?? 0), 4 * MIN);
    assert.equal(rt.db.seatHolds.find((h) => h.request_id === request?.id)?.status, "consumed");
    assert.equal(availableSeatsForRange(rt.db, T1, 0, 2), 1, "Laura + Miguel");

    const api = createApi(rt);
    const chat = await api("GET", `/v1/trips/${T1}/chat/${SEED_USER_IDS.ana}/messages`, { token: rt.sessionToken() });
    assert.equal(chat.status, 200);
    const messages = asArray(asRecord(chat.body).messages, "messages").map((m) => asRecord(m));
    assert.equal(messages.length, 2);
    assert.equal(messages[0]?.body, MIGUEL_MESSAGE);
    assert.equal(messages[0]?.senderUserId ?? messages[0]?.sender_user_id, SEED_USER_IDS.miguel);
    assert.match(str(messages[1]?.body), /^Perfecto, Miguel\./);
  });

  it("trip-live-waiting: el viaje está en curso, el coche a ~600 m de la parada y Miguel lo ve en el mapa con precisión", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "trip-live-waiting" });
    const trip = rt.db.trips.get(T1);
    assert.equal(trip?.status, "active");
    assert.equal(rt.db.nowMs() - (trip?.started_at ?? 0), 4 * MIN);
    const api = createApi(rt);

    const asMiguel = asRecord(asRecord((await api("GET", `/v1/trips/${T1}/location`, { token: rt.sessionToken() })).body).location, "location");
    assert.equal(asMiguel.precision, "precise", "Miguel tiene reserva confirmada");
    assert.equal(asMiguel.stale, false);
    assert.equal(asMiguel.ageSeconds, 8);
    const pickup = rt.db.tripStops.find((s) => s.trip_id === T1 && s.seq === 0);
    assert.ok(pickup);
    const metres = Math.hypot((num(asMiguel.latitude) - pickup.lat) * 111_320, (num(asMiguel.longitude) - pickup.lng) * 111_320 * Math.cos((pickup.lat * Math.PI) / 180));
    assert.ok(metres > 450 && metres < 750, `el coche está a ${Math.round(metres)} m de la parada`);

    const stranger = asRecord(asRecord((await api("GET", `/v1/trips/${T1}/location`, { token: tokenFor(rt, "hugo") })).body).location, "location");
    assert.equal(stranger.precision, "approximate", "quien no tiene reserva solo ve una posición aproximada");
    assert.equal(stranger.accuracyM, undefined);

    const map = asRecord((await api("GET", `/v1/live/map?provinceId=${SEVILLA_PROVINCE_ID}`)).body);
    assert.equal(asArray(map.trips, "trips").length, 1);
    assert.equal(rt.db.locationEvents.count((e) => e.trip_id === T1), 5);
  });

  it("trip-live-in-car: Laura y Miguel recogidos (código verificado), trayecto al 40 %", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "trip-live-in-car" });
    assert.equal(rt.db.trips.get(T1)?.status, "active");
    const confirmed = rt.db.bookings.filter((b) => rt.db.rideRequests.get(b.request_id)?.trip_id === T1);
    assert.equal(confirmed.length, 2);
    assert.ok(confirmed.every((b) => b.status === "confirmed" && b.picked_up_at !== null), "ambos van en el coche");
    const miguel = confirmed.find((b) => rt.db.rideRequests.get(b.request_id)?.passenger_user_id === SEED_USER_IDS.miguel);
    assert.ok(miguel);
    assert.equal(rt.db.pickupCodes.get(miguel.id)?.verified_at, miguel.picked_up_at);
    assert.equal(rt.db.nowMs() - (miguel.picked_up_at ?? 0), 11 * MIN);

    const location = asRecord(asRecord((await createApi(rt)("GET", `/v1/trips/${T1}/location`, { token: rt.sessionToken() })).body).location, "location");
    assert.equal(location.speedMps, 11.2);
    assert.equal(location.stale, false);
  });

  it("trip-finished: el viaje terminó hace 2 min, ambas reservas completadas y ya no hay ubicación en vivo", async () => {
    const rt = testRuntime({ profile: "passenger", seed: "trip-finished" });
    const trip = rt.db.trips.get(T1);
    assert.equal(trip?.status, "completed");
    assert.equal(rt.db.nowMs() - (trip?.completed_at ?? 0), 2 * MIN);
    const bookings = rt.db.bookings.filter((b) => rt.db.rideRequests.get(b.request_id)?.trip_id === T1);
    assert.deepEqual(
      bookings.map((b) => b.status),
      ["completed", "completed"]
    );
    const api = createApi(rt);
    const location = await api("GET", `/v1/trips/${T1}/location`, { token: rt.sessionToken() });
    assert.equal(asRecord(location.body).location, null);
    const map = asRecord((await api("GET", `/v1/live/map?provinceId=${SEVILLA_PROVINCE_ID}`)).body);
    assert.deepEqual(map.trips, []);
  });

  it("las variantes se pueden reproducir con el reloj movido: lo relativo a «ahora» se conserva", () => {
    for (const seed of ["request-accepted", "trip-live-waiting", "trip-finished"] as const) {
      const base = seededDb("passenger", seed);
      const moved = seededDb("passenger", seed, "2026-11-17T07:17:00+01:00");
      assert.deepEqual(integrityProblems(moved), [], seed);
      const ageOf = (db: PreviewDb): number[] =>
        db.rideRequests
          .filter((r) => r.trip_id === T1 && r.passenger_user_id === SEED_USER_IDS.miguel)
          .map((r) => db.nowMs() - r.requested_at);
      assert.deepEqual(ageOf(moved), ageOf(base), `${seed}: la edad de la solicitud no depende del día`);
    }
  });
});

describe("referencias simbólicas ($ref) a datos sembrados", () => {
  it("user.*, trip.* y vehicle.* son constantes: valen en cualquier variante, aunque el dato no exista", () => {
    const empty = seededDb("passenger", "empty");
    assert.equal(resolveSeedRef(empty, "user.ana"), SEED_USER_IDS.ana);
    assert.equal(resolveSeedRef(empty, "user.staff"), SEED_USER_IDS.staff);
    assert.equal(resolveSeedRef(empty, "trip.anaMorning"), T1, "en «empty» el viaje no existe: la pantalla mostrará su estado «no encontrado»");
    assert.equal(resolveSeedRef(empty, "vehicle.anaArona"), SEED_VEHICLE_IDS.anaArona);
    for (const key of Object.keys(SEED_TRIP_IDS)) assert.ok(seedRefNames().includes(`trip.${key}`), key);
  });

  it("request.* y booking.* salen de la base: existen solo cuando la variante las crea", () => {
    const base = seededDb("passenger", "default");
    assert.equal(resolveSeedRef(base, "request.miguel"), undefined);
    assert.equal(resolveSeedRef(base, "booking.miguel"), undefined);
    assert.ok(resolveSeedRef(base, "request.hugo"), "las pendientes de Hugo y Nuria están en el mundo base");
    assert.ok(resolveSeedRef(base, "request.nuria"));
    assert.equal(resolveSeedRef(base, "booking.hugo"), undefined, "una solicitud pendiente no tiene reserva");
    assert.ok(resolveSeedRef(base, "booking.laura"), "Laura ya tiene reserva confirmada en el viaje de Ana");

    const pending = seededDb("passenger", "request-pending");
    const request = pending.rideRequests.find((r) => r.trip_id === T1 && r.passenger_user_id === SEED_USER_IDS.miguel);
    assert.equal(resolveSeedRef(pending, "request.miguel"), request?.id);
    assert.equal(resolveSeedRef(pending, "booking.miguel"), undefined);

    const accepted = seededDb("passenger", "request-accepted");
    assert.ok(resolveSeedRef(accepted, "request.miguel"));
    assert.equal(resolveSeedRef(accepted, "booking.miguel"), undefined, "aún sin pagar");

    const booked = seededDb("passenger", "booking-confirmed");
    const booking = booked.bookings.find((b) => b.request_id === resolveSeedRef(booked, "request.miguel"));
    assert.ok(booking);
    assert.equal(resolveSeedRef(booked, "booking.miguel"), booking.id);
  });

  it("resolveAllSeedRefs lista todas con su id o null, y los nombres salen ordenados", () => {
    const db = seededDb("passenger", "request-pending");
    const all = resolveAllSeedRefs(db);
    assert.deepEqual(Object.keys(all), seedRefNames());
    assert.deepEqual([...seedRefNames()].sort(), seedRefNames());
    assert.equal(all["user.miguel"], SEED_USER_IDS.miguel);
    assert.equal(all["booking.miguel"], null);
    assert.equal(typeof all["request.miguel"], "string");
  });

  it("resolveRefsIn sustituye { $ref } a cualquier profundidad (objetos y listas) y deja el resto intacto", () => {
    const db = seededDb("passenger", "request-pending");
    const params = {
      requestId: { $ref: "request.miguel" },
      nested: { list: [{ $ref: "trip.anaMorning" }, "texto", 7, null, { otro: true }], flag: false },
      notARef: { $ref: "request.miguel", extra: 1 },
    };
    const resolved = resolveRefsIn(db, params);
    assert.equal(resolved.requestId, resolveSeedRef(db, "request.miguel"));
    assert.deepEqual(resolved.nested, { list: [T1, "texto", 7, null, { otro: true }], flag: false });
    assert.deepEqual(resolved.notARef, { $ref: "request.miguel", extra: 1 }, "con más claves no es una referencia");
    assert.deepEqual(params.requestId, { $ref: "request.miguel" }, "no muta la entrada");
    assert.equal(resolveRefsIn(db, undefined), undefined);
    assert.equal(resolveRefsIn(db, "x"), "x");
  });

  it("los errores dicen qué falta: nombre desconocido, referencia que no existe en esta variante, $ref que no es texto", () => {
    const db = seededDb("passenger", "default");
    assert.throws(() => resolveRefsIn(db, { id: { $ref: "request.nadie" } }), (error: unknown) => {
      assert.ok(error instanceof SeedRefError);
      assert.match(error.message, /Referencia desconocida «request\.nadie»/);
      assert.match(error.message, /request\.miguel/, "propone los nombres que sí existen");
      return true;
    });
    assert.throws(() => resolveRefsIn(db, { requestId: { $ref: "request.miguel" } }), (error: unknown) => {
      assert.ok(error instanceof SeedRefError);
      assert.match(error.message, /«request\.miguel» no existe en este mundo \(perfil «passenger», variante «default»\)/);
      assert.match(error.message, /seeds\(\)/);
      return true;
    });
    assert.throws(() => resolveRefsIn(db, { a: [{ $ref: 5 }] }), /a\[0\]\.\$ref debe ser un texto/);
  });

  it("los slices registran las suyas con registerSeedRef (nombre «grupo.clave») y pueden retirarlas", () => {
    assert.throws(() => registerSeedRef("sinpunto", () => "x"), /Nombre de referencia no válido/);
    assert.throws(() => registerSeedRef("Mayus.cula", () => "x"), /Nombre de referencia no válido/);
    registerSeedRef("pruebas.cosa", (db) => db.users.all()[0]?.id);
    try {
      const db = seededDb("passenger", "default");
      assert.equal(resolveSeedRef(db, "pruebas.cosa"), db.users.all()[0]?.id);
      assert.ok(seedRefNames().includes("pruebas.cosa"));
    } finally {
      assert.equal(unregisterSeedRef("pruebas.cosa"), true);
    }
    assert.equal(unregisterSeedRef("pruebas.cosa"), false);
    assert.throws(() => resolveSeedRef(seededDb("new"), "pruebas.cosa"), SeedRefError);
  });
});

describe("instantáneas y runtime", () => {
  it("una instantánea JSON restaurada en otro runtime sirve el mismo API", async () => {
    const source = testRuntime({ profile: "passenger", seed: "booking-confirmed" });
    const json = JSON.stringify(source.db.snapshot());
    const target = createPreviewRuntime({ latency: 0, skipSeed: true });
    target.db.restore(JSON.parse(json) as ReturnType<PreviewDb["snapshot"]>);
    assert.equal(target.db.profile, "passenger");
    assert.equal(target.db.seedName, "booking-confirmed");
    const token = target.sessionToken();
    assert.equal(token, source.sessionToken());
    const read = async (rt: typeof source) => (await createApi(rt)("GET", "/v1/me/ride-requests", { token })).text;
    assert.equal(await read(target), await read(source));
  });

  it("reset del runtime: cambia de perfil, de variante y de reloj, y el reloj indicado manda", () => {
    const rt = testRuntime({ profile: "new" });
    rt.reset({ profile: "driver", seed: "request-pending", clock: "2026-10-06T07:17:00+02:00" });
    assert.equal(rt.db.profile, "driver");
    assert.equal(rt.db.nowMs(), Date.parse("2026-10-06T07:17:00+02:00"));
    assert.equal(rt.db.trips.get(T1)?.departure_at, Date.parse("2026-10-06T08:05:00+02:00"));
    rt.reset({ profile: "driver", seed: "default" });
    assert.equal(rt.db.nowMs(), Date.parse("2026-10-06T07:17:00+02:00"), "sin «clock» se conserva el reloj");
    rt.reset({ profile: "driver", seed: "default", clock: null });
    assert.equal(rt.db.nowMs(), NOW, "null vuelve al instante de las láminas");
  });
});

describe("contrato con los slices", () => {
  it("hay exactamente los ocho slices acordados y el registro del núcleo + slices no repite rutas", () => {
    assert.deepEqual(
      PREVIEW_SLICES.map((s) => s.name),
      ["auth", "search", "driver", "live", "messages", "profile", "account", "admin"]
    );
    const router = createRouter();
    const db = createPreviewDb();
    registerPreviewHandlers(router, db);
    assert.ok(router.size() >= 40, `hay al menos las 40 rutas del núcleo (hay ${router.size()})`);
    const keys = router.routes().map((r) => `${r.method} ${r.pattern}`);
    assert.equal(new Set(keys).size, keys.length, "ninguna ruta duplicada");
  });

  it("seedSlice se llama tras el mundo base y antes de la variante, con (db, perfil, seed)", () => {
    const calls: Array<{ profile: PreviewProfileId; seed: string; users: number; pendingByMiguel: number }> = [];
    const registered: string[] = [];
    const slice: PreviewSlice = {
      name: "pruebas",
      module: {
        registerPreview(r, db) {
          registered.push("registerPreview");
          r.get("/v1/pruebas/contador", { summary: "Prueba de slice" }, () => ({ total: db.collection<{ id: string }>("pruebas_cosas").size }));
        },
        seedSlice(db, profile, seed) {
          calls.push({
            profile,
            seed,
            users: db.users.size,
            pendingByMiguel: db.rideRequests.count((r) => r.passenger_user_id === SEED_USER_IDS.miguel && r.status === "pending"),
          });
          db.collection<{ id: string }>("pruebas_cosas").insert({ id: "uno" });
        },
      },
    };
    const slices = PREVIEW_SLICES as PreviewSlice[];
    slices.push(slice);
    try {
      const db = createPreviewDb();
      seedWorld(db, "passenger", "request-pending");
      assert.deepEqual(calls, [{ profile: "passenger", seed: "request-pending", users: 20, pendingByMiguel: 0 }], "la variante aún no se había aplicado");
      assert.equal(db.rideRequests.count((r) => r.passenger_user_id === SEED_USER_IDS.miguel && r.status === "pending"), 1, "y se aplica después");
      assert.ok(db.collectionNames().includes("pruebas_cosas"));

      const copy = createPreviewDb();
      copy.restore(JSON.parse(JSON.stringify(db.snapshot())) as ReturnType<PreviewDb["snapshot"]>);
      assert.equal(copy.collection<{ id: string }>("pruebas_cosas").size, 1, "las colecciones de los slices viajan en la instantánea");

      const router = createRouter();
      registerPreviewHandlers(router, db);
      assert.deepEqual(registered, ["registerPreview"]);
      assert.ok(router.has("GET", "/v1/pruebas/contador"));
    } finally {
      slices.pop();
    }
    assert.equal(PREVIEW_SLICES.length, 8, "la prueba deja los slices como estaban");
  });

  it("un slice declara sus variantes de datos con seedVariants: se aceptan, se listan con su dueño y se construyen en seedSlice", () => {
    assert.deepEqual(
      listSeedVariants().map((v) => v.name),
      [...VARIANTS],
      "sin slices que declaren nada, solo las del núcleo"
    );
    assert.ok(listSeedVariants().every((v) => v.owner === "core"));
    assert.equal(isAcceptedSeed("bandeja-con-no-leidos"), false);

    const slices = PREVIEW_SLICES as PreviewSlice[];
    slices.push({
      name: "mensajes-pruebas",
      module: {
        registerPreview() {},
        seedVariants: { "bandeja-con-no-leidos": "La bandeja de Miguel con tres conversaciones sin leer." },
        seedSlice(db, _profile, seed) {
          if (seed === "bandeja-con-no-leidos") db.collection<{ id: string }>("pruebas_no_leidos").insert({ id: "tres" });
        },
      },
    });
    try {
      assert.equal(isAcceptedSeed("bandeja-con-no-leidos"), true);
      assert.equal(isAcceptedSeed("default"), true);
      assert.equal(isAcceptedSeed("toString"), false);
      const declared = listSeedVariants().find((v) => v.name === "bandeja-con-no-leidos");
      assert.deepEqual(declared, { name: "bandeja-con-no-leidos", description: "La bandeja de Miguel con tres conversaciones sin leer.", owner: "mensajes-pruebas" });

      const db = createPreviewDb();
      seedWorld(db, "passenger", "bandeja-con-no-leidos");
      assert.equal(db.collection<{ id: string }>("pruebas_no_leidos").size, 1, "el slice construyó su variante");
      const base = createPreviewDb();
      seedWorld(base, "passenger", "default");
      assert.equal(base.collection<{ id: string }>("pruebas_no_leidos").size, 0, "y solo con ese nombre");
      assert.equal(db.trips.size, base.trips.size, "sobre el mundo base de «default»");
    } finally {
      slices.pop();
    }
    assert.equal(isAcceptedSeed("bandeja-con-no-leidos"), false);
  });

  it("dos declaraciones de la misma variante (con el núcleo o entre slices) fallan al arrancar, nombrando a las dos partes", () => {
    const slices = PREVIEW_SLICES as PreviewSlice[];
    slices.push({ name: "uno", module: { registerPreview() {}, seedVariants: { default: "pisa al núcleo" } } });
    try {
      assert.throws(() => listSeedVariants(), /«default» la declaran «core» y «uno»/);
      assert.throws(() => registerPreviewHandlers(createRouter(), createPreviewDb()), /«default» la declaran «core» y «uno»/);
    } finally {
      slices.pop();
    }
    slices.push({ name: "uno", module: { registerPreview() {}, seedVariants: { rara: "a" } } });
    slices.push({ name: "dos", module: { registerPreview() {}, seedVariants: { rara: "b" } } });
    try {
      assert.throws(() => listSeedVariants(), /«rara» la declaran «uno» y «dos»/);
    } finally {
      slices.pop();
      slices.pop();
    }
    assert.equal(PREVIEW_SLICES.length, 8);
  });

  it("un slice que repite una ruta del núcleo falla al arrancar (para sustituirla debe usar r.override)", () => {
    const slices = PREVIEW_SLICES as PreviewSlice[];
    slices.push({
      name: "duplicado",
      module: {
        registerPreview(r) {
          r.get("/me", {}, () => ({ ok: true }));
        },
      },
    });
    try {
      assert.throws(() => registerPreviewHandlers(createRouter(), createPreviewDb()), /\/me/);
    } finally {
      slices.pop();
    }
  });
});
