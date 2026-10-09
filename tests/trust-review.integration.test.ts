import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ApiResult } from "./trust-helpers.js";
import {
  DisabledStorage,
  FakeStorage,
  type SeededUser,
  type StaffWorld,
  acceptPrivateCheckNotice,
  auditCount,
  buildTrustApp,
  call,
  createPool,
  lastAudit,
  resetDatabase,
  seedStaffWorld,
  seedUser,
  seedVehicle,
  seedProvince,
  uploadFlow
} from "./trust-helpers.js";

/**
 * Pantalla 38 (Usuarios y revisión): cola, expediente, decisiones y acceso a documentación privada.
 * Cubre los efectos de aprobar/rechazar y la regla «URL firmada de vida corta + auditoría previa».
 */

const pool = createPool();
let app: FastifyInstance;
let storage: FakeStorage;
let world: StaffWorld;

before(async () => {
  await pool.query("select 1 from trust_profile_photos limit 1");
});
beforeEach(async () => {
  await resetDatabase(pool);
  const built = await buildTrustApp(pool);
  app = built.app;
  storage = built.storage as FakeStorage;
  world = await seedStaffWorld(pool);
});
after(async () => {
  await app?.close();
  await pool.end();
});

const decide = (userId: string, body: Record<string, unknown>, as: SeededUser = world.verification) =>
  call(app, "POST", `/v1/admin/review/users/${userId}/decision`, { as, body });
const queue = (query: Record<string, string | number> = {}, as: SeededUser = world.verification) =>
  call(app, "GET", "/v1/admin/review/users", { as, query });
const ids = (res: { body: any }) => res.body.items.map((i: any) => i.userId);

/** Ana entrega todo: foto, comprobación privada (selfie), documento de identidad y permiso de conducir. */
async function submitEverything(user: SeededUser) {
  const photo = await uploadFlow(app, storage, user, "photo", { salt: 101 });
  await acceptPrivateCheckNotice(app, user);
  const selfie = await uploadFlow(app, storage, user, "selfie", { salt: 102 });
  const idDoc = await uploadFlow(app, storage, user, "identity_document", { salt: 103 });
  const license = await uploadFlow(app, storage, user, "driver_license", { salt: 104, contentType: "image/png" });
  for (const step of [photo, selfie, idDoc, license]) assert.equal(step.complete.status, 200, JSON.stringify(step.complete.body));
  return { photo, selfie, idDoc, license };
}

/* ───────────────────────────── Cola ───────────────────────────── */

test("cola: pestañas, recuentos, filtros por rol y elemento, orden y etiquetas", async () => {
  const ana = await seedUser(pool, "Ana López", { roles: ["driver", "passenger"] });
  const miguel = world.rider; // «Miguel Torres», pasajero
  const rosa = await seedUser(pool, "Rosa Vega", { roles: ["passenger"] });
  const pedro = await seedUser(pool, "Pedro Ruiz", { roles: ["passenger"] });
  const lola = await seedUser(pool, "Lola Marín", { roles: ["passenger"] });

  await submitEverything(ana);
  await uploadFlow(app, storage, miguel, "identity_document", { salt: 111 });
  await uploadFlow(app, storage, rosa, "identity_document", { salt: 112 });
  assert.equal((await decide(rosa.id, { decision: "approved" })).status, 200);
  await uploadFlow(app, storage, pedro, "photo", { salt: 113 });
  assert.equal((await decide(pedro.id, { decision: "rejected", reason: "Rostro tapado por una gorra", reasonCode: "FACE_NOT_VISIBLE" })).status, 200);
  await acceptPrivateCheckNotice(app, lola);
  await uploadFlow(app, storage, lola, "selfie", { salt: 114 });
  assert.equal((await decide(lola.id, { decision: "needs_retry", reasonCode: "LOW_LIGHT", reason: "Muy oscura" })).status, 200);

  // Pendientes (por defecto, más recientes primero): Miguel entregó después que Ana.
  const pending = await queue();
  assert.equal(pending.status, 200);
  assert.deepEqual(ids(pending), [miguel.id, ana.id]);
  assert.deepEqual(pending.body.counts, { pending: 2, approved: 1, rejected: 1 });
  assert.equal(pending.body.nextCursor, null);

  const anaItem = pending.body.items[1];
  assert.equal(anaItem.displayName, "Ana López");
  assert.equal(anaItem.firstName, "Ana");
  assert.equal(anaItem.photoUrl, null, "una foto en revisión no es pública");
  assert.deepEqual([...anaItem.roles].sort(), ["driver", "passenger"]);
  assert.equal(anaItem.tab, "pending");
  assert.equal(anaItem.statusLabel, "Pendiente");
  assert.equal(anaItem.pendingCount, 4);
  assert.equal(anaItem.canDecide, true);
  assert.match(anaItem.submittedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.deepEqual(
    anaItem.rows.map((r: any) => [r.key, r.state, r.label, r.badge]),
    [
      ["identity", "in_review", "Identidad · En revisión", null],
      ["driver_license", "in_review", "Permiso de conducir", "Requiere revisión"],
      ["profile_photo", "in_review", "Foto de perfil", "Requiere revisión"],
      ["private_check", "in_review", "Comprobación privada · En revisión", "Requiere revisión"]
    ]
  );
  const miguelItem = pending.body.items[0];
  assert.equal(miguelItem.pendingCount, 1);
  assert.deepEqual(miguelItem.rows.map((r: any) => [r.key, r.state]), [["identity", "in_review"], ["profile_photo", "none"]]);

  // Aprobados: «DNI verificado»
  const approved = await queue({ tab: "approved" });
  assert.deepEqual(ids(approved), [rosa.id]);
  assert.equal(approved.body.items[0].statusLabel, "Aprobado");
  assert.deepEqual(approved.body.items[0].rows.find((r: any) => r.key === "identity"), { key: "identity", label: "DNI verificado", state: "approved", badge: null });
  assert.equal(approved.body.items[0].canDecide, false);

  // Rechazados
  const rejected = await queue({ tab: "rejected" });
  assert.deepEqual(ids(rejected), [pedro.id]);
  assert.equal(rejected.body.items[0].statusLabel, "Rechazado");
  assert.equal(rejected.body.items[0].rows.find((r: any) => r.key === "profile_photo").state, "rejected");
  assert.equal(rejected.body.items[0].rows.find((r: any) => r.key === "identity").label, "Identidad · Sin enviar");

  // «Pedir otra captura» por sí solo no mete a nadie en la cola: espera a la persona usuaria.
  for (const tab of ["pending", "approved", "rejected"]) assert.ok(!ids(await queue({ tab })).includes(lola.id), `Lola no aparece en ${tab}`);

  // Orden
  assert.deepEqual(ids(await queue({ sort: "oldest" })), [ana.id, miguel.id]);
  assert.deepEqual(ids(await queue({ sort: "recent" })), [miguel.id, ana.id]);

  // Filtro por rol: los recuentos respetan el filtro
  const drivers = await queue({ role: "driver" });
  assert.deepEqual(ids(drivers), [ana.id]);
  assert.deepEqual(drivers.body.counts, { pending: 1, approved: 0, rejected: 0 });
  const passengers = await queue({ role: "passenger" });
  assert.deepEqual(ids(passengers), [miguel.id, ana.id]);

  // Filtro por elemento
  const photos = await queue({ item: "profile_photo" });
  assert.deepEqual(ids(photos), [ana.id]);
  assert.deepEqual(photos.body.counts, { pending: 1, approved: 0, rejected: 1 });
  const identity = await queue({ item: "identity" });
  assert.deepEqual(ids(identity), [miguel.id, ana.id]);
  assert.deepEqual(identity.body.counts, { pending: 2, approved: 1, rejected: 0 });
  assert.deepEqual(ids(await queue({ item: "private_check" })), [ana.id]);
  assert.deepEqual(ids(await queue({ item: "driver_license" })), [ana.id]);
  assert.deepEqual(ids(await queue({ item: "driver_license", role: "passenger", tab: "approved" })), []);

  // Entradas inválidas
  for (const bad of [{ tab: "todas" }, { role: "admin" }, { item: "vehicle" }, { sort: "random" }]) {
    const res = await queue(bad);
    assert.equal(res.status, 400, JSON.stringify(bad));
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
  }
  assert.ok((await auditCount(pool, "admin.review_queue.viewed")) >= 10);
  const audit = await lastAudit(pool, "admin.review_queue.viewed");
  assert.equal(audit?.actor_user_id, world.verification.id);
});

test("cola: el personal no puede decidir sobre su propio expediente (canDecide:false) y los usuarios eliminados no aparecen", async () => {
  await uploadFlow(app, storage, world.verification, "photo", { salt: 121 });
  const gone = await seedUser(pool, "Eva Soto", { roles: ["passenger"] });
  await uploadFlow(app, storage, gone, "photo", { salt: 122 });
  await pool.query(`update app_users set status = 'deleted' where id = $1`, [gone.id]);

  const asVerification = await queue();
  assert.deepEqual(ids(asVerification), [world.verification.id]);
  assert.equal(asVerification.body.items[0].canDecide, false);
  const asAdmin = await queue({}, world.admin);
  assert.equal(asAdmin.body.items[0].canDecide, true);
});

test("cola: paginación por cursor sin repetir ni saltar a nadie; cursor y límite inválidos", async () => {
  const people: SeededUser[] = [];
  for (const name of ["Alba Ríos", "Bruno Gil", "Carla Nieto", "Diego Mora", "Elena Paz"]) {
    const person = await seedUser(pool, name, { roles: ["passenger"] });
    await uploadFlow(app, storage, person, "photo", { salt: 130 + people.length });
    people.push(person);
  }
  const expected = [...people].reverse().map(p => p.id); // más recientes primero

  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res: any = await queue({ limit: 2, ...(cursor ? { cursor } : {}) });
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length <= 2);
    seen.push(...ids(res));
    cursor = res.body.nextCursor;
    pages += 1;
    assert.ok(pages <= 5, "no debe haber más páginas de las necesarias");
  } while (cursor);
  assert.deepEqual(seen, expected);
  assert.equal(pages, 3);

  // ascendente
  const asc: string[] = [];
  let next: string | null = null;
  do {
    const res: any = await queue({ limit: 2, sort: "oldest", ...(next ? { cursor: next } : {}) });
    asc.push(...ids(res));
    next = res.body.nextCursor;
  } while (next);
  assert.deepEqual(asc, people.map(p => p.id));

  const garbage = await queue({ cursor: "esto-no-es-un-cursor" });
  assert.equal(garbage.status, 400);
  assert.equal(garbage.body.error.code, "CURSOR_INVALID");
  const forged = await queue({ cursor: Buffer.from(JSON.stringify({ t: "no-es-fecha", id: "tampoco" })).toString("base64url") });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error.code, "CURSOR_INVALID");
  for (const limit of [0, 51, -3]) assert.equal((await queue({ limit })).status, 400, `limit=${limit}`);
});

/* ───────────────────────────── Expediente ───────────────────────────── */

test("expediente: tarjeta, elementos con evidencias SIN url, teléfono enmascarado, historial y auditoría", async () => {
  const ana = await seedUser(pool, "Ana López", { roles: ["driver", "passenger"] });
  const province = await seedProvince(pool);
  void province;
  const vehicleId = await seedVehicle(pool, ana.id, "4321 LBC");
  await submitEverything(ana);

  const res = await call(app, "GET", `/v1/admin/review/users/${ana.id}`, { as: world.verification });
  assert.equal(res.status, 200);
  const d = res.body;
  assert.equal(d.accessNote, "Acceso a documentación privada solo para personal autorizado de MVC.");
  assert.equal(d.user.id, ana.id);
  assert.equal(d.user.displayName, "Ana López");
  assert.equal(d.user.status, "active");
  assert.match(d.user.phoneMasked, /•••/);
  assert.ok(d.user.phoneMasked.endsWith(ana.phone.slice(-3)));
  assert.ok(!res.raw.includes(ana.phone), "el teléfono completo nunca viaja");
  assert.equal(d.summary.userId, ana.id);
  assert.equal(d.summary.pendingCount, 4);

  assert.deepEqual(d.items.map((i: any) => i.key), ["identity", "driver_license", "profile_photo", "private_check"]);
  for (const item of d.items) {
    assert.equal(item.state, "in_review", item.key);
    assert.deepEqual(item.allowedDecisions, item.key === "private_check" ? ["approved", "needs_retry", "rejected"] : ["approved", "rejected"], item.key);
    assert.ok(Array.isArray(item.reasonOptions) && item.reasonOptions.length > 0, item.key);
    assert.ok(item.evidence.length >= 1, item.key);
    for (const ev of item.evidence) {
      assert.ok(["profile_photo", "identity_selfie", "private_document"].includes(ev.kind));
      assert.match(ev.id, /^[0-9a-f-]{36}$/);
      assert.equal(Object.keys(ev).some(k => /url|key|path/i.test(k)), false, "las evidencias no llevan URL ni clave de almacenamiento");
    }
  }
  assert.doesNotMatch(res.raw, /download\.invalid|upload\.invalid|users\/[0-9a-f-]{36}\/trust|storage_key|sha256/i);
  assert.deepEqual(d.items.find((i: any) => i.key === "private_check").reasonOptions.map((o: any) => o.code).sort(), [
    "FACE_COVERED", "FACE_OUT_OF_FRAME", "IMAGE_BLURRY", "LOW_LIGHT", "MULTIPLE_PEOPLE", "NOT_A_LIVE_PERSON", "NOT_MATCHING_PROFILE_PHOTO", "OTHER"
  ]);
  assert.equal(d.vehicles.length, 1);
  assert.equal(d.vehicles[0].id, vehicleId);
  assert.equal(d.vehicles[0].reviewEndpoint, `/v1/admin/vehicles/${vehicleId}/review`);
  const actions = d.history.map((h: any) => h.action);
  for (const action of ["identity_document.submitted", "driver_license.submitted", "profile_photo.submitted", "identity_check.attempt_submitted"]) {
    assert.ok(actions.includes(action), action);
  }
  assert.deepEqual([...d.history.map((h: any) => h.at)].sort().reverse(), d.history.map((h: any) => h.at), "historial más reciente primero");

  const audit = await lastAudit(pool, "admin.dossier.viewed");
  assert.equal(audit?.actor_user_id, world.verification.id);
  assert.equal(audit?.entity_id, ana.id);

  assert.equal((await call(app, "GET", `/v1/admin/review/users/${crypto.randomUUID()}`, { as: world.verification })).body.error.code, "USER_NOT_FOUND");
  assert.equal((await call(app, "GET", `/v1/admin/review/users/${crypto.randomUUID()}`, { as: world.verification })).status, 404);
});

/* ───────────────────────────── Decisiones ───────────────────────────── */

test("decisión: aprobar todo lo pendiente — efecto por elemento, avisos a la persona y auditoría", async () => {
  const ana = await seedUser(pool, "Ana López", { roles: ["driver", "passenger"] });
  const sent = await submitEverything(ana);

  const res = await decide(ana.id, { decision: "approved" });
  assert.equal(res.status, 200);
  assert.deepEqual(
    res.body.results.map((r: any) => [r.item, r.outcome, r.errorCode]),
    [["identity", "approved", null], ["driver_license", "approved", null], ["profile_photo", "approved", null], ["private_check", "approved", null]]
  );
  assert.equal(res.body.userId, ana.id);
  assert.equal(res.body.summary.pendingCount, 0);
  assert.equal(res.body.summary.tab, "approved");
  assert.equal(res.body.summary.canDecide, false);

  // Efectos en las tablas
  const profile = (await pool.query(`select identity_status, public_photo_status, public_photo_key from profiles where user_id = $1`, [ana.id])).rows[0];
  assert.equal(profile.identity_status, "verified", "el documento de identidad aprobado es lo que verifica");
  assert.equal(profile.public_photo_status, "approved");
  assert.equal(profile.public_photo_key, sent.photo.key);
  assert.deepEqual(
    (await pool.query(`select kind::text, review_status::text as s from private_documents where owner_user_id = $1 order by kind::text`, [ana.id])).rows,
    [{ kind: "driver_license", s: "approved" }, { kind: "identity_document", s: "approved" }]
  );
  assert.equal((await pool.query(`select state from trust_identity_checks where user_id = $1`, [ana.id])).rows[0].state, "completed");

  // La persona ve el resultado
  const overview = (await call(app, "GET", "/v1/me/verification", { as: ana })).body;
  assert.equal(overview.photo.state, "approved");
  assert.match(overview.photo.publicPhotoUrl, new RegExp(`^/v1/public/users/${ana.id}/photo\\?v=[0-9a-f]{8}$`));
  assert.equal(overview.privateCheck.state, "completed");
  assert.equal(overview.identity.status, "verified");
  assert.equal(overview.identity.driverLicense.status, "approved");

  // Avisos dentro de la app (sin datos sensibles)
  const notices = (await pool.query(`select kind, title, body, data from notifications where user_id = $1 order by kind`, [ana.id])).rows;
  assert.deepEqual(notices.map(n => n.kind), ["driver_license_approved", "identity_check_completed", "identity_document_approved", "profile_photo_approved"]);
  for (const n of notices) assert.doesNotMatch(JSON.stringify(n), /download|storage|users\/|sha256|\+34/i);

  // Auditoría: una entrada por elemento, con quién decidió
  const audits = (await pool.query(`select actor_user_id, entity_id, request_id, metadata from audit_events where action = 'admin.review.decision' order by id`)).rows;
  assert.equal(audits.length, 4);
  assert.deepEqual(audits.map(a => a.metadata.item).sort(), ["driver_license", "identity", "private_check", "profile_photo"]);
  for (const a of audits) {
    assert.equal(a.actor_user_id, world.verification.id);
    assert.equal(a.entity_id, ana.id);
    assert.ok(a.request_id);
    assert.equal(a.metadata.decision, "approved");
  }

  // Foto pública: 302 a una URL firmada de 15 minutos, sin sesión
  const publicPhoto = await call(app, "GET", `/v1/public/users/${ana.id}/photo`);
  assert.equal(publicPhoto.status, 302);
  assert.equal(publicPhoto.headers.location, `https://download.invalid/${sent.photo.key}?ttl=900&sig=test`);
  assert.equal(publicPhoto.headers["cache-control"], "public, max-age=300");
  assert.deepEqual(storage.downloadCalls.at(-1), { key: sent.photo.key, expiresInSeconds: 900 });
  const withVersion = await call(app, "GET", `/v1/public/users/${ana.id}/photo?v=${overview.photo.publicPhotoUrl.split("v=")[1]}`);
  assert.equal(withVersion.status, 302);
});

test("decisión: validaciones de motivo, códigos y elementos; NOTHING_TO_REVIEW; resultados parciales", async () => {
  const ana = await seedUser(pool, "Ana López", { roles: ["driver", "passenger"] });
  await uploadFlow(app, storage, ana, "identity_document", { salt: 141 });

  const expectError = async (body: Record<string, unknown>, status: number, code: string, label: string) => {
    const res = await decide(ana.id, body);
    assert.equal(res.status, status, `${label}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.error.code, code, label);
    return res;
  };
  await expectError({ decision: "rejected" }, 422, "REVIEW_REASON_REQUIRED", "rechazo sin motivo");
  await expectError({ decision: "rejected", reason: "no" }, 422, "REVIEW_REASON_REQUIRED", "motivo demasiado corto");
  await expectError({ decision: "rejected", reason: "x".repeat(1001) }, 400, "VALIDATION_ERROR", "motivo demasiado largo (esquema)");
  await expectError({ decision: "rejected", reason: "Documento ilegible", reasonCode: "NO_EXISTE" }, 422, "REVIEW_REASON_CODE_INVALID", "código desconocido");
  await expectError({ decision: "rejected", reason: "Documento ilegible", reasonCode: "LOW_LIGHT" }, 422, "REVIEW_REASON_CODE_INVALID", "código de reintento en un rechazo");
  await expectError({ decision: "approved", reasonCode: "OTHER" }, 422, "REVIEW_REASON_CODE_INVALID", "una aprobación no lleva motivo");
  await expectError({ decision: "needs_retry" }, 422, "REVIEW_REASON_REQUIRED", "otra captura exige el motivo");
  await expectError({ decision: "needs_retry", reasonCode: "OTHER" }, 422, "REVIEW_REASON_CODE_INVALID", "OTHER no es motivo de reintento");
  await expectError({ decision: "maybe" }, 400, "VALIDATION_ERROR", "decisión desconocida");
  await expectError({ decision: "approved", items: ["vehicle"] }, 400, "VALIDATION_ERROR", "elemento desconocido");

  // «Otra captura» solo existe para la comprobación privada
  const retryOnDocument = await expectError({ decision: "needs_retry", reasonCode: "LOW_LIGHT", items: ["identity"] }, 409, "NOTHING_TO_REVIEW", "otra captura sobre un documento");
  assert.equal(retryOnDocument.body.error.details.results[0].errorCode, "REVIEW_ITEM_INVALID");

  // Un elemento sin entrega no se puede decidir
  const none = await expectError({ decision: "approved", items: ["profile_photo"] }, 409, "NOTHING_TO_REVIEW", "foto sin entregar");
  assert.equal(none.body.error.details.results[0].errorCode, "NOTHING_TO_REVIEW");

  // Parcial: la identidad se aprueba y el elemento sin entrega se informa como omitido (la petición no falla)
  // (las propiedades desconocidas se descartan: no cambian el comportamiento)
  const partial = await decide(ana.id, { decision: "approved", items: ["identity", "profile_photo"], extra: true });
  assert.equal(partial.status, 200);
  assert.deepEqual(partial.body.results, [
    { item: "identity", outcome: "approved", errorCode: null, message: null },
    { item: "profile_photo", outcome: "skipped", errorCode: "NOTHING_TO_REVIEW", message: "No hay entregas pendientes de este elemento." }
  ]);
  // Nada que revisar → 409; usuario inexistente → 404; id inválido → 400
  await expectError({ decision: "approved" }, 409, "NOTHING_TO_REVIEW", "ya no queda nada pendiente");
  const missing = await decide(crypto.randomUUID(), { decision: "approved" });
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, "USER_NOT_FOUND");
  assert.equal((await decide("no-es-uuid", { decision: "approved" })).status, 400);
  // las decisiones fallidas no dejan rastro de decisión
  assert.equal(await auditCount(pool, "admin.review.decision"), 1);
});

test("decisión: rechazar la foto — motivo visible y neutro; la foto aprobada anterior sigue siendo la pública hasta que se apruebe la nueva", async () => {
  const user = await seedUser(pool, "Pedro Ruiz", { roles: ["passenger"] });
  const first = await uploadFlow(app, storage, user, "photo", { salt: 151 });
  assert.equal((await decide(user.id, { decision: "approved" })).status, 200);
  const urlBefore = (await call(app, "GET", "/v1/me/photo", { as: user })).body.publicPhotoUrl;
  assert.ok(urlBefore);

  // nueva foto: la anterior sigue visible mientras se revisa
  const second = await uploadFlow(app, storage, user, "photo", { salt: 152, contentType: "image/png" });
  const inReview = (await call(app, "GET", "/v1/me/photo", { as: user })).body;
  assert.equal(inReview.state, "approved");
  assert.equal(inReview.latest.status, "in_review");
  assert.equal(inReview.publicPhotoUrl, urlBefore);

  // rechazo con nota interna que NO debe llegar a la persona
  const rejected = await decide(user.id, { decision: "rejected", reason: "Parece una foto de internet", reasonCode: "NOT_A_PERSON" });
  assert.equal(rejected.status, 200);
  const after = (await call(app, "GET", "/v1/me/photo", { as: user })).body;
  assert.equal(after.state, "approved", "la anterior sigue siendo la pública");
  assert.equal(after.publicPhotoUrl, urlBefore);
  assert.equal(after.latest.status, "rejected");
  assert.deepEqual(after.latest.reason, { code: "NOT_A_PERSON", title: "Necesitamos otra foto", message: "La foto de perfil debe ser una foto tuya." });
  assert.doesNotMatch(JSON.stringify(after), /internet/, "la nota interna no se muestra");
  assert.equal((await pool.query(`select public_photo_key from profiles where user_id = $1`, [user.id])).rows[0].public_photo_key, first.key);
  const notice = (await pool.query(`select kind, body from notifications where user_id = $1 and kind = 'profile_photo_rejected'`, [user.id])).rows[0];
  assert.ok(notice);
  assert.doesNotMatch(notice.body, /internet/);

  // se vuelve a subir y esta vez se aprueba: sustituye a la anterior
  const third = await uploadFlow(app, storage, user, "photo", { salt: 153 });
  assert.equal((await decide(user.id, { decision: "approved" })).status, 200);
  const profile = (await pool.query(`select public_photo_key from profiles where user_id = $1`, [user.id])).rows[0];
  assert.equal(profile.public_photo_key, third.key);
  assert.notEqual(profile.public_photo_key, second.key);
  const statuses = (await pool.query(`select status from trust_profile_photos where user_id = $1 order by submitted_at`, [user.id])).rows.map(r => r.status);
  assert.deepEqual(statuses, ["superseded", "rejected", "approved"]);
  const urlAfter = (await call(app, "GET", "/v1/me/photo", { as: user })).body.publicPhotoUrl;
  assert.notEqual(urlAfter, urlBefore, "el parámetro v cambia al cambiar la foto (invalida cachés)");
});

test("decisión: rechazar la primera foto deja el perfil «rechazado»; sin foto aprobada la ruta pública da 404", async () => {
  const user = await seedUser(pool, "Lola Marín", { roles: ["passenger"] });
  await uploadFlow(app, storage, user, "photo", { salt: 161 });
  assert.equal((await decide(user.id, { decision: "rejected", reason: "Rostro tapado", reasonCode: "FACE_NOT_VISIBLE" })).status, 200);
  const state = (await call(app, "GET", "/v1/me/photo", { as: user })).body;
  assert.equal(state.state, "rejected");
  assert.equal(state.publicPhotoUrl, null);
  assert.equal((await pool.query(`select public_photo_status from profiles where user_id = $1`, [user.id])).rows[0].public_photo_status, "rejected");
  const publicPhoto = await call(app, "GET", `/v1/public/users/${user.id}/photo`);
  assert.equal(publicPhoto.status, 404);
  assert.equal(publicPhoto.body.error.code, "PHOTO_NOT_FOUND");
  // una cuenta no activa tampoco la expone
  await uploadFlow(app, storage, user, "photo", { salt: 162 });
  assert.equal((await pool.query(`select public_photo_status from profiles where user_id = $1`, [user.id])).rows[0].public_photo_status, "pending");
  await decide(user.id, { decision: "approved" });
  assert.equal((await call(app, "GET", `/v1/public/users/${user.id}/photo`)).status, 302);
  await pool.query(`update app_users set status = 'suspended' where id = $1`, [user.id]);
  assert.equal((await call(app, "GET", `/v1/public/users/${user.id}/photo`)).status, 404);
});

test("decisión: nadie decide ni accede a la documentación de su propio expediente (SELF_REVIEW_FORBIDDEN)", async () => {
  const own = await uploadFlow(app, storage, world.verification, "photo", { salt: 171 });
  const self = await decide(world.verification.id, { decision: "approved" });
  assert.equal(self.status, 403);
  assert.equal(self.body.error.code, "SELF_REVIEW_FORBIDDEN");
  assert.equal((await pool.query(`select status from trust_profile_photos where user_id = $1`, [world.verification.id])).rows[0].status, "in_review");
  assert.equal(await auditCount(pool, "admin.review.decision"), 0);

  const photoId = (await pool.query(`select id from trust_profile_photos where user_id = $1`, [world.verification.id])).rows[0].id;
  const signedBefore = storage.downloadCalls.length; // las vistas previas propias (300 s) ya firmaron alguna
  const access = await call(app, "POST", `/v1/admin/evidence/profile_photo/${photoId}/access`, { as: world.verification, body: { purpose: "photo_moderation" } });
  assert.equal(access.status, 403);
  assert.equal(access.body.error.code, "SELF_REVIEW_FORBIDDEN");
  assert.equal(await auditCount(pool, "admin.evidence.access_url_issued"), 0);
  assert.equal(storage.downloadCalls.length, signedBefore, "ni siquiera se firmó una URL");

  // otra persona del equipo sí puede revisarlo
  const other = await decide(world.verification.id, { decision: "approved" }, world.admin);
  assert.equal(other.status, 200);
  assert.equal((await pool.query(`select public_photo_key from profiles where user_id = $1`, [world.verification.id])).rows[0].public_photo_key, own.key);
});

test("decisión: dos revisores a la vez sobre la misma entrega → se aplica exactamente una decisión", async () => {
  const user = await seedUser(pool, "Ana López", { roles: ["passenger"] });
  await uploadFlow(app, storage, user, "photo", { salt: 181 });
  const [a, b] = await Promise.all([
    decide(user.id, { decision: "approved" }, world.admin),
    decide(user.id, { decision: "rejected", reason: "Foto demasiado oscura", reasonCode: "LOW_QUALITY" }, world.verification)
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.body.error.code, "NOTHING_TO_REVIEW");
  assert.equal(await auditCount(pool, "admin.review.decision"), 1);
  const rows = (await pool.query(`select status from trust_profile_photos where user_id = $1`, [user.id])).rows;
  assert.equal(rows.length, 1);
  assert.ok(["approved", "rejected"].includes(rows[0].status));
});

/* ───────────────────────────── Acceso a documentación privada ───────────────────────────── */

async function evidenceIds(userId: string) {
  const photo = (await pool.query(`select id from trust_profile_photos where user_id = $1`, [userId])).rows[0].id as string;
  const selfie = (await pool.query(`select id from trust_identity_check_attempts where user_id = $1`, [userId])).rows[0].id as string;
  const document = (await pool.query(`select id from private_documents where owner_user_id = $1 and kind = 'identity_document'`, [userId])).rows[0].id as string;
  return { photo, selfie, document };
}

test("evidencias: URL firmada de 120 s con auditoría previa para foto, selfie y documento", async () => {
  const fixed = new Date("2026-10-09T12:00:00.000Z");
  const local = await buildTrustApp(pool, { now: () => fixed });
  try {
    const ana = await seedUser(pool, "Ana López", { roles: ["passenger"] });
    const sent = await submitEverythingOn(local.app, local.storage as FakeStorage, ana);
    const evidence = await evidenceIds(ana.id);
    const expectedKeys = { profile_photo: sent.photoKey, identity_selfie: sent.selfieKey, private_document: sent.documentKey };
    const ids = { profile_photo: evidence.photo, identity_selfie: evidence.selfie, private_document: evidence.document };
    const entityTypes = { profile_photo: "profile_photo", identity_selfie: "identity_check_attempt", private_document: "private_document" } as const;

    let n = 0;
    for (const kind of ["profile_photo", "identity_selfie", "private_document"] as const) {
      n += 1;
      const res = await call(local.app, "POST", `/v1/admin/evidence/${kind}/${ids[kind]}/access`, {
        as: world.verification,
        body: { purpose: kind === "private_document" ? "identity_review" : "photo_moderation", note: "Comprobación rutinaria" }
      });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      assert.equal(res.body.url, `https://download.invalid/${expectedKeys[kind]}?ttl=120&sig=test`);
      assert.equal(res.body.ttlSeconds, 120);
      assert.equal(res.body.expiresAt, "2026-10-09T12:02:00.000Z");
      assert.deepEqual(res.body.evidence, { kind, id: ids[kind] });
      assert.ok(res.body.contentType);
      assert.equal(res.headers["cache-control"], "no-store");
      assert.deepEqual((local.storage as FakeStorage).downloadCalls.at(-1), { key: expectedKeys[kind], expiresInSeconds: 120 });

      const audit = await lastAudit(pool, "admin.evidence.access_url_issued");
      assert.equal(audit?.actor_user_id, world.verification.id);
      assert.equal(audit?.entity_type, entityTypes[kind]);
      assert.equal(audit?.entity_id, ids[kind]);
      assert.ok(audit?.request_id);
      assert.equal(audit?.metadata.evidenceKind, kind);
      assert.equal(audit?.metadata.ttlSeconds, 120);
      assert.equal(audit?.metadata.ownerUserId, ana.id);
      assert.equal(audit?.metadata.note, "Comprobación rutinaria");
      assert.doesNotMatch(JSON.stringify(audit?.metadata), /download|users\//, "la auditoría no guarda la URL ni la clave de almacenamiento");
      assert.equal(await auditCount(pool, "admin.evidence.access_url_issued"), n);
    }
    // el administrador también puede; otros roles no (ver trust-rbac)
    const asAdmin = await call(local.app, "POST", `/v1/admin/evidence/profile_photo/${ids.profile_photo}/access`, { as: world.admin, body: { purpose: "support_case" } });
    assert.equal(asAdmin.status, 200);
    const asFinance = await call(local.app, "POST", `/v1/admin/evidence/profile_photo/${ids.profile_photo}/access`, { as: world.finance, body: { purpose: "support_case" } });
    assert.equal(asFinance.status, 403);
    assert.equal(await auditCount(pool, "admin.evidence.access_url_issued"), 4, "un acceso denegado no emite URL ni evento de acceso");
    // propósitos válidos únicamente
    const badPurpose = await call(local.app, "POST", `/v1/admin/evidence/profile_photo/${ids.profile_photo}/access`, { as: world.admin, body: { purpose: "curiosidad" } });
    assert.equal(badPurpose.status, 400);
    assert.equal((await call(local.app, "POST", `/v1/admin/evidence/video/${ids.profile_photo}/access`, { as: world.admin, body: { purpose: "support_case" } })).status, 400);
    assert.equal((await call(local.app, "POST", `/v1/admin/evidence/profile_photo/${ids.profile_photo}/access`, { as: world.admin })).status, 400);
  } finally {
    await local.app.close();
  }
});

/** Variante de `submitEverything` contra otra instancia de la aplicación; devuelve las claves de almacenamiento. */
async function submitEverythingOn(target: FastifyInstance, fake: FakeStorage, user: SeededUser) {
  const photo = await uploadFlow(target, fake, user, "photo", { salt: 201 });
  await acceptPrivateCheckNotice(target, user);
  const selfie = await uploadFlow(target, fake, user, "selfie", { salt: 202 });
  const document = await uploadFlow(target, fake, user, "identity_document", { salt: 203 });
  for (const step of [photo, selfie, document]) assert.equal(step.complete.status, 200, JSON.stringify(step.complete.body));
  return { photoKey: photo.key, selfieKey: selfie.key, documentKey: document.key };
}

test("evidencias: errores sin URL ni auditoría de acceso (no existe, identificador ajeno, proveedor distinto, almacenamiento desactivado)", async () => {
  const ana = await seedUser(pool, "Ana López", { roles: ["passenger"] });
  await submitEverythingOn(app, storage, ana);
  const evidence = await evidenceIds(ana.id);
  const access = (kind: string, id: string, as: SeededUser = world.verification) =>
    call(app, "POST", `/v1/admin/evidence/${kind}/${id}/access`, { as, body: { purpose: "identity_review" } });

  const unknown = await access("profile_photo", crypto.randomUUID());
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "EVIDENCE_NOT_FOUND");
  // un identificador válido pero de otro tipo de evidencia tampoco existe
  const wrongKind = await access("identity_selfie", evidence.photo);
  assert.equal(wrongKind.status, 404);
  assert.equal(wrongKind.body.error.code, "EVIDENCE_NOT_FOUND");
  assert.equal((await access("private_document", "no-es-uuid")).status, 400);

  // el archivo está en otro proveedor que el configurado
  await pool.query(`update trust_profile_photos set storage_provider = 'otro-proveedor' where id = $1`, [evidence.photo]);
  const mismatch = await access("profile_photo", evidence.photo);
  assert.equal(mismatch.status, 409);
  assert.equal(mismatch.body.error.code, "EVIDENCE_STORAGE_MISMATCH");

  // un fallo al firmar no deja constancia de un acceso que no ocurrió
  const signedBefore = storage.downloadCalls.length;
  storage.failDownload = new Error("el proveedor no responde");
  const failing = await access("private_document", evidence.document);
  assert.equal(failing.status, 500);
  assert.doesNotMatch(failing.raw, /proveedor|download/i);
  storage.failDownload = null;

  assert.equal(await auditCount(pool, "admin.evidence.access_url_issued"), 0);
  assert.equal(storage.downloadCalls.length, signedBefore, "ningún intento fallido llegó a firmar una URL de personal");

  for (const disabled of [new DisabledStorage(), null]) {
    const local = await buildTrustApp(pool, { storage: disabled });
    try {
      const res = await call(local.app, "POST", `/v1/admin/evidence/private_document/${evidence.document}/access`, {
        as: world.verification,
        body: { purpose: "identity_review" }
      });
      assert.equal(res.status, 503);
      assert.equal(res.body.error.code, "PRIVATE_STORAGE_DISABLED");
    } finally {
      await local.app.close();
    }
  }
  assert.equal(await auditCount(pool, "admin.evidence.access_url_issued"), 0);
});

test("evidencias: si la auditoría falla no sale ninguna URL (falla cerrado)", async () => {
  const ana = await seedUser(pool, "Ana López", { roles: ["passenger"] });
  await submitEverythingOn(app, storage, ana);
  const evidence = await evidenceIds(ana.id);
  await pool.query(`
    create or replace function trust_review_test_block() returns trigger language plpgsql as $$
    begin raise exception 'auditoría no disponible'; end $$;
    drop trigger if exists trust_review_test_block_trg on audit_events;
    create trigger trust_review_test_block_trg before insert on audit_events
      for each row when (new.action = 'admin.evidence.access_url_issued') execute function trust_review_test_block();
  `);
  try {
    const res = await call(app, "POST", `/v1/admin/evidence/private_document/${evidence.document}/access`, {
      as: world.verification,
      body: { purpose: "identity_review" }
    });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(res.raw, /download\.invalid|https?:\/\//, "la respuesta no contiene ninguna URL");
    assert.equal(await auditCount(pool, "admin.evidence.access_url_issued"), 0);
  } finally {
    await pool.query(`drop trigger if exists trust_review_test_block_trg on audit_events; drop function if exists trust_review_test_block();`);
  }
});

test("evidencias: la vida de la URL es configurable y el acceso está limitado en frecuencia (429)", async () => {
  const local = await buildTrustApp(pool, { trustConfig: { signedUrlTtlSeconds: 45 } });
  try {
    const ana = await seedUser(pool, "Ana López", { roles: ["passenger"] });
    const sent = await submitEverythingOn(local.app, local.storage as FakeStorage, ana);
    const evidence = await evidenceIds(ana.id);
    const res = await call(local.app, "POST", `/v1/admin/evidence/profile_photo/${evidence.photo}/access`, { as: world.admin, body: { purpose: "photo_moderation" } });
    assert.equal(res.status, 200);
    assert.equal(res.body.ttlSeconds, 45);
    assert.equal(res.body.url, `https://download.invalid/${sent.photoKey}?ttl=45&sig=test`);

    // 60 peticiones por minuto en las rutas de escritura/acceso del panel; la 61.ª recibe 429
    let blocked: ApiResult | undefined;
    for (let i = 0; i < 70 && !blocked; i += 1) {
      const r = await call(local.app, "POST", `/v1/admin/evidence/profile_photo/${crypto.randomUUID()}/access`, { as: world.admin, body: { purpose: "photo_moderation" } });
      if (r.status === 429) blocked = r;
    }
    assert.ok(blocked, "debe aparecer un 429 antes de 70 peticiones");
    assert.equal(blocked.body.error.code, "RATE_LIMITED");
  } finally {
    await local.app.close();
  }
});
