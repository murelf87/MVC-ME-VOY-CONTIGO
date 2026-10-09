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
  keyFromUploadUrl,
  resetDatabase,
  sampleBytes,
  seedProvince,
  seedStaffWorld,
  seedTrip,
  seedUser,
  seedVehicle,
  uploadFlow
} from "./trust-helpers.js";

const pool = createPool();
let app: FastifyInstance;
let storage: FakeStorage;
let world: StaffWorld;
let ana: SeededUser; // persona usuaria que se verifica

before(async () => {
  await pool.query("select 1 from trust_identity_checks limit 1");
});
beforeEach(async () => {
  await resetDatabase(pool);
  const built = await buildTrustApp(pool);
  app = built.app;
  storage = built.storage as FakeStorage;
  world = await seedStaffWorld(pool);
  ana = await seedUser(pool, "Ana López", { roles: ["driver", "passenger"] });
});
after(async () => {
  await app?.close();
  await pool.end();
});

const decide = (userId: string, body: Record<string, unknown>) =>
  call(app, "POST", `/v1/admin/review/users/${userId}/decision`, { as: world.verification, body });

/* ───────────────────────────── Foto de perfil (pantalla 05) ───────────────────────────── */

test("foto: sin sesión 401 y estado inicial «none»", async () => {
  assert.equal((await call(app, "GET", "/v1/me/photo")).status, 401);
  const res = await call(app, "GET", "/v1/me/photo", { as: ana });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { state: "none", required: true, publicPhotoUrl: null, latest: null, uploadAvailable: true });
  assert.equal(res.headers["cache-control"], "no-store");
});

test("foto: intención → subida → confirmación deja la entrega en revisión humana", async () => {
  const { intent, complete, key, bytes } = await uploadFlow(app, storage, ana, "photo", { salt: 1 });
  assert.equal(intent.status, 201);
  assert.equal(intent.body.method, "PUT");
  assert.equal(intent.body.headers["content-type"], "image/jpeg");
  assert.equal(intent.body.maxSizeBytes, 10 * 1024 * 1024);
  assert.deepEqual(intent.body.allowedContentTypes, ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);
  assert.match(key, new RegExp(`^users/${ana.id}/trust/profile_photo/[0-9a-f-]{36}\\.jpg$`));

  assert.equal(complete.status, 200);
  assert.equal(complete.body.state, "in_review");
  assert.equal(complete.body.latest.status, "in_review");
  assert.equal(complete.body.latest.reason, null);
  assert.match(complete.body.latest.previewUrl, /^https:\/\/download\.invalid\/.+ttl=300/);
  assert.equal(complete.body.publicPhotoUrl, null, "una foto en revisión nunca es pública");
  const row = (await pool.query(`select status, sha256, size_bytes, content_type from trust_profile_photos where user_id=$1`, [ana.id])).rows[0];
  assert.equal(row.status, "in_review");
  assert.equal(row.sha256, crypto.createHash("sha256").update(bytes).digest("hex"));
  assert.equal(Number(row.size_bytes), bytes.byteLength);
  const profile = (await pool.query(`select public_photo_key, public_photo_status from profiles where user_id=$1`, [ana.id])).rows[0];
  assert.equal(profile.public_photo_key, null);
  assert.equal(profile.public_photo_status, "pending");
});

test("foto: validaciones de la intención (tipo, tamaño, cuerpo) con códigos estables", async () => {
  const pdf = await call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType: "application/pdf", sizeBytes: 1000 } });
  assert.equal(pdf.status, 422);
  assert.equal(pdf.body.error.code, "UPLOAD_TYPE_NOT_ALLOWED");
  assert.deepEqual(pdf.body.error.details.allowedContentTypes.slice(0, 2), ["image/jpeg", "image/png"]);
  for (const sizeBytes of [0, 10 * 1024 * 1024 + 1]) {
    const res = await call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes } });
    assert.equal(res.status, 422, `sizeBytes ${sizeBytes}`);
    assert.equal(res.body.error.code, "UPLOAD_SIZE_INVALID");
  }
  const bad = await call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType: "image/jpeg" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(bad.body.error.details.issues));
  assert.equal((await call(app, "POST", "/v1/me/photo/upload-intents", { body: { contentType: "image/jpeg", sizeBytes: 5 } })).status, 401);
});

test("foto: la confirmación verifica lo realmente subido (falta, tamaño, firma, caducidad, propietario, proveedor)", async () => {
  const mk = async (contentType = "image/jpeg", size = 64) =>
    call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType, sizeBytes: size } });

  // 1. no se ha subido nada
  const a = await mk();
  const missing = await call(app, "POST", `/v1/me/photo/upload-intents/${a.body.intentId}/complete`, { as: ana });
  assert.equal(missing.status, 409);
  assert.equal(missing.body.error.code, "UPLOAD_OBJECT_MISSING");

  // 2. tamaño distinto del declarado
  storage.put(keyFromUploadUrl(a.body.uploadUrl), sampleBytes("image/jpeg", 1, 80), "image/jpeg");
  const size = await call(app, "POST", `/v1/me/photo/upload-intents/${a.body.intentId}/complete`, { as: ana });
  assert.equal(size.status, 422);
  assert.equal(size.body.error.code, "UPLOAD_SIZE_MISMATCH");

  // 3. firma binaria que no corresponde al tipo (un PDF declarado como JPEG)
  const b = await mk();
  storage.put(keyFromUploadUrl(b.body.uploadUrl), sampleBytes("application/pdf", 2, 64), "image/jpeg");
  const content = await call(app, "POST", `/v1/me/photo/upload-intents/${b.body.intentId}/complete`, { as: ana });
  assert.equal(content.status, 422);
  assert.equal(content.body.error.code, "UPLOAD_CONTENT_INVALID");

  // 4. tipo del objeto distinto del declarado
  const c = await mk();
  storage.put(keyFromUploadUrl(c.body.uploadUrl), sampleBytes("image/jpeg", 3, 64), "image/png");
  const type = await call(app, "POST", `/v1/me/photo/upload-intents/${c.body.intentId}/complete`, { as: ana });
  assert.equal(type.status, 422);
  assert.equal(type.body.error.code, "UPLOAD_TYPE_MISMATCH");

  // 5. otra persona no puede confirmar una intención ajena (404, sin revelar que existe)
  const d = await mk();
  storage.put(keyFromUploadUrl(d.body.uploadUrl), sampleBytes("image/jpeg", 4, 64), "image/jpeg");
  const foreign = await call(app, "POST", `/v1/me/photo/upload-intents/${d.body.intentId}/complete`, { as: world.rider });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error.code, "UPLOAD_INTENT_NOT_FOUND");

  // 6. intención caducada
  await pool.query(`update trust_upload_intents set expires_at = now() - interval '1 minute' where id = $1`, [d.body.intentId]);
  const expired = await call(app, "POST", `/v1/me/photo/upload-intents/${d.body.intentId}/complete`, { as: ana });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error.code, "UPLOAD_INTENT_EXPIRED");

  // 7. proveedor de almacenamiento cambiado desde la petición
  const e = await mk();
  storage.put(keyFromUploadUrl(e.body.uploadUrl), sampleBytes("image/jpeg", 5, 64), "image/jpeg");
  await pool.query(`update trust_upload_intents set storage_provider = 'otro' where id = $1`, [e.body.intentId]);
  const provider = await call(app, "POST", `/v1/me/photo/upload-intents/${e.body.intentId}/complete`, { as: ana });
  assert.equal(provider.status, 409);
  assert.equal(provider.body.error.code, "UPLOAD_STORAGE_MISMATCH");

  assert.equal((await pool.query(`select count(*)::int as n from trust_profile_photos`)).rows[0].n, 0, "ninguna entrega registrada");
  assert.equal((await call(app, "POST", `/v1/me/photo/upload-intents/not-a-uuid/complete`, { as: ana })).status, 400);
});

test("foto: confirmar dos veces es idempotente y una nueva entrega sustituye a la pendiente", async () => {
  const first = await uploadFlow(app, storage, ana, "photo", { salt: 11 });
  const again = await call(app, "POST", `/v1/me/photo/upload-intents/${first.intent.body.intentId}/complete`, { as: ana });
  assert.equal(again.status, 200);
  assert.equal(again.body.latest.id, first.complete.body.latest.id);
  assert.equal((await pool.query(`select count(*)::int as n from trust_profile_photos`)).rows[0].n, 1);

  const second = await uploadFlow(app, storage, ana, "photo", { salt: 12, contentType: "image/png" });
  assert.equal(second.complete.status, 200);
  const rows = (await pool.query(`select status from trust_profile_photos order by submitted_at`)).rows.map(r => r.status);
  assert.deepEqual(rows, ["superseded", "in_review"]);
  assert.notEqual(second.complete.body.latest.id, first.complete.body.latest.id);
});

test("foto: tope diario de 20 intenciones (todas las finalidades) → 429 UPLOAD_RATE_LIMITED", async () => {
  // 19 intenciones ya registradas en las últimas 24 h (de distinta finalidad) y una más por la API: la 20.ª se acepta, la 21.ª no.
  const purposes = ["profile_photo", "identity_selfie", "identity_document", "driver_license"];
  for (let i = 0; i < 19; i += 1) {
    await pool.query(
      `insert into trust_upload_intents(owner_user_id, purpose, storage_provider, storage_key, content_type, expected_size_bytes, expires_at)
       values($1,$2,'fake',$3,'image/jpeg',100, now() + interval '10 minutes')`,
      [ana.id, purposes[i % purposes.length], `users/${ana.id}/trust/seed/${i}.jpg`]
    );
  }
  const last = await call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 100 } });
  assert.equal(last.status, 201, "la intención número 20 todavía se acepta");
  const blocked = await call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 99 } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, "UPLOAD_RATE_LIMITED");
  // otra persona no se ve afectada
  assert.equal((await call(app, "POST", "/v1/me/photo/upload-intents", { as: world.rider, body: { contentType: "image/jpeg", sizeBytes: 99 } })).status, 201);
  // las intenciones de hace más de 24 h no cuentan
  await pool.query(`update trust_upload_intents set created_at = now() - interval '25 hours' where owner_user_id = $1`, [ana.id]);
  assert.equal((await call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 99 } })).status, 201);
});

test("subidas: el límite por minuto de la ruta responde 429 RATE_LIMITED con el sobre de error del módulo", async () => {
  let blocked: ApiResult | undefined;
  for (let i = 0; i < 25 && !blocked; i += 1) {
    const res = await call(app, "POST", "/v1/me/photo/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 10 } });
    if (res.status === 429) blocked = res;
  }
  assert.ok(blocked, "alguna de las 25 peticiones seguidas debe recibir 429");
  assert.equal(blocked.body.error.code, "RATE_LIMITED");
  assert.ok(blocked.body.requestId);
});

test("almacenamiento desactivado: los estados responden con uploadAvailable:false y subir da 503 PRIVATE_STORAGE_DISABLED", async () => {
  for (const disabled of [new DisabledStorage(), null]) {
    const local = await buildTrustApp(pool, { storage: disabled });
    try {
      const photo = await call(local.app, "GET", "/v1/me/photo", { as: ana });
      assert.equal(photo.status, 200);
      assert.equal(photo.body.uploadAvailable, false);
      const check = await call(local.app, "GET", "/v1/me/identity-check", { as: ana });
      assert.equal(check.status, 200);
      assert.equal(check.body.uploadAvailable, false);
      const overview = await call(local.app, "GET", "/v1/me/verification", { as: ana });
      assert.equal(overview.status, 200);
      assert.equal(overview.body.identity.uploadAvailable, false);

      await acceptPrivateCheckNotice(local.app, ana);
      const bodies: Array<[string, Record<string, unknown>]> = [
        ["/v1/me/photo/upload-intents", { contentType: "image/jpeg", sizeBytes: 100 }],
        ["/v1/me/identity-check/upload-intents", { contentType: "image/jpeg", sizeBytes: 100 }],
        ["/v1/me/identity/documents/upload-intents", { kind: "identity_document", contentType: "application/pdf", sizeBytes: 100 }]
      ];
      for (const [url, body] of bodies) {
        const res = await call(local.app, "POST", url, { as: ana, body });
        assert.equal(res.status, 503, url);
        assert.equal(res.body.error.code, "PRIVATE_STORAGE_DISABLED", url);
      }
      const complete = await call(local.app, "POST", `/v1/me/photo/upload-intents/${crypto.randomUUID()}/complete`, { as: ana });
      assert.ok([404, 503].includes(complete.status));
    } finally {
      await local.app.close();
    }
  }
});

/* ───────────────────────────── Comprobación privada (pantallas 06–08) ───────────────────────────── */

test("comprobación: estado inicial = pantalla 06 (aviso sin aceptar, 0 de 3, sin biometría, la selfie no verifica)", async () => {
  const res = await call(app, "GET", "/v1/me/identity-check", { as: ana });
  assert.equal(res.status, 200);
  const b = res.body;
  assert.equal(b.state, "not_started");
  assert.equal(b.method, null);
  assert.deepEqual(b.attempts, { used: 0, max: 3, remaining: 3 });
  assert.equal(b.reason, null);
  assert.equal(b.nextAction, "accept_notice");
  assert.equal(b.canUseAlternative, true);
  assert.deepEqual(b.consent, { noticeKind: "private_check_notice", noticeVersion: 1, accepted: false, acceptedAt: null, noticeLegallyReviewed: false });
  assert.equal(b.lastAttempt, null);
  assert.equal(b.review, "human");
  assert.equal(b.biometricMatching, "not_activated");
  assert.equal(b.selfieAloneVerifiesIdentity, false);
  assert.equal(b.uploadAvailable, true);
  assert.equal(b.updatedAt, null);
});

test("comprobación: sin aceptar el aviso no se puede subir; la aceptación queda registrada con su versión y estado legal", async () => {
  const blocked = await call(app, "POST", "/v1/me/identity-check/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 100 } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "PRIVATE_CHECK_CONSENT_REQUIRED");

  const accepted = await acceptPrivateCheckNotice(app, ana);
  assert.equal(accepted.status, 201);
  assert.equal(accepted.body.kind, "private_check_notice");
  assert.equal(accepted.body.context, "private_check");
  assert.equal(accepted.body.legallyEffective, false, "el aviso sembrado está pendiente de revisión legal");

  const row = (await pool.query(`select user_id, version, document_status, ip_hash, context from trust_legal_acceptances`)).rows[0];
  assert.equal(row.user_id, ana.id);
  assert.equal(row.version, 1);
  assert.equal(row.document_status, "draft_pending_legal_review");
  assert.equal(row.ip_hash, null, "sin pepper no se guarda ningún hash de IP");

  const state = await call(app, "GET", "/v1/me/identity-check", { as: ana });
  assert.equal(state.body.nextAction, "capture");
  assert.equal(state.body.consent.accepted, true);
  assert.ok(state.body.consent.acceptedAt);
});

test("comprobación: máquina de estados completa con 3 intentos (needs_retry → in_review → … → rejected por intentos agotados)", async () => {
  await acceptPrivateCheckNotice(app, ana);

  // Intento 1 → in_review
  const one = await uploadFlow(app, storage, ana, "selfie", { salt: 21 });
  assert.equal(one.complete.status, 200);
  assert.equal(one.complete.body.state, "in_review");
  assert.equal(one.complete.body.method, "selfie");
  assert.deepEqual(one.complete.body.attempts, { used: 1, max: 3, remaining: 2 });
  assert.equal(one.complete.body.nextAction, "wait_review");
  assert.equal(one.complete.body.lastAttempt.attemptNo, 1);
  assert.equal(one.complete.body.lastAttempt.status, "in_review");
  const noticeId = (await pool.query(`select id from trust_legal_documents where kind='private_check_notice' and version=1`)).rows[0].id;
  assert.equal((await pool.query(`select notice_document_id from trust_identity_check_attempts where attempt_no=1`)).rows[0].notice_document_id, noticeId);

  // mientras está en revisión no se aceptan más capturas
  const during = await call(app, "POST", "/v1/me/identity-check/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 100 } });
  assert.equal(during.status, 409);
  assert.equal(during.body.error.code, "PRIVATE_CHECK_IN_REVIEW");

  // Personal pide otra captura (lámina 08)
  const retry1 = await decide(ana.id, { decision: "needs_retry", reasonCode: "FACE_OUT_OF_FRAME", reason: "Rostro fuera de plano" });
  assert.equal(retry1.status, 200);
  assert.equal(retry1.body.results[0].item, "private_check");
  assert.equal(retry1.body.results[0].outcome, "needs_retry");
  let state = (await call(app, "GET", "/v1/me/identity-check", { as: ana })).body;
  assert.equal(state.state, "needs_retry");
  assert.equal(state.nextAction, "retry_capture");
  assert.deepEqual(state.reason, {
    code: "FACE_OUT_OF_FRAME",
    title: "Necesitamos otra captura",
    message: "El rostro está fuera del marco o no se ve con claridad."
  });
  assert.equal(state.lastAttempt.status, "needs_retry");
  assert.deepEqual(state.attempts, { used: 1, max: 3, remaining: 2 });

  // Intento 2 → in_review → otra vez needs_retry («Intentos: 2 de 3», lámina 08)
  const two = await uploadFlow(app, storage, ana, "selfie", { salt: 22 });
  assert.equal(two.complete.body.state, "in_review");
  assert.deepEqual(two.complete.body.attempts, { used: 2, max: 3, remaining: 1 });
  assert.equal((await decide(ana.id, { decision: "needs_retry", reasonCode: "LOW_LIGHT" })).status, 200);
  state = (await call(app, "GET", "/v1/me/identity-check", { as: ana })).body;
  assert.equal(state.state, "needs_retry");
  assert.equal(state.reason.code, "LOW_LIGHT");
  assert.deepEqual(state.attempts, { used: 2, max: 3, remaining: 1 });

  // Intento 3 → el personal vuelve a pedir otra captura, pero ya no quedan intentos → rejected (MAX_ATTEMPTS_REACHED)
  const three = await uploadFlow(app, storage, ana, "selfie", { salt: 23 });
  assert.deepEqual(three.complete.body.attempts, { used: 3, max: 3, remaining: 0 });
  assert.equal((await decide(ana.id, { decision: "needs_retry", reasonCode: "IMAGE_BLURRY" })).status, 200);
  state = (await call(app, "GET", "/v1/me/identity-check", { as: ana })).body;
  assert.equal(state.state, "rejected");
  assert.equal(state.reason.code, "MAX_ATTEMPTS_REACHED");
  assert.equal(state.nextAction, "use_alternative");
  assert.equal(state.canUseAlternative, true);
  assert.equal(state.selfieAloneVerifiesIdentity, false);

  // No hay cuarto intento
  const fourth = await call(app, "POST", "/v1/me/identity-check/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 100 } });
  assert.equal(fourth.status, 409);
  assert.ok(["PRIVATE_CHECK_REJECTED", "PRIVATE_CHECK_MAX_ATTEMPTS_REACHED"].includes(fourth.body.error.code));
  assert.equal((await pool.query(`select attempts_used from trust_identity_checks where user_id=$1`, [ana.id])).rows[0].attempts_used, 3);
  assert.equal((await pool.query(`select count(*)::int as n from trust_identity_check_attempts where user_id=$1`, [ana.id])).rows[0].n, 3);
});

test("comprobación: el límite de 3 intentos resiste peticiones simultáneas (bloqueo de base de datos)", async () => {
  await acceptPrivateCheckNotice(app, ana);
  // Estado: 2 intentos usados y pendiente de otra captura.
  await pool.query(`insert into trust_identity_checks(user_id, state, attempts_used, reason_code, decided_at) values($1,'needs_retry',2,'LOW_LIGHT', now())`, [ana.id]);
  const intents: Array<{ intentId: string }> = [];
  for (let i = 0; i < 4; i += 1) {
    const res = await call(app, "POST", "/v1/me/identity-check/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 80 } });
    assert.equal(res.status, 201);
    storage.put(keyFromUploadUrl(res.body.uploadUrl), sampleBytes("image/jpeg", 40 + i, 80), "image/jpeg");
    intents.push(res.body);
  }
  const results = await Promise.all(
    intents.map(i => call(app, "POST", `/v1/me/identity-check/upload-intents/${i.intentId}/complete`, { as: ana }))
  );
  const ok = results.filter(r => r.status === 200);
  const conflicts = results.filter(r => r.status === 409);
  assert.equal(ok.length, 1, JSON.stringify(results.map(r => r.status)));
  assert.equal(conflicts.length, 3);
  for (const c of conflicts) assert.ok(["PRIVATE_CHECK_IN_REVIEW", "PRIVATE_CHECK_MAX_ATTEMPTS_REACHED"].includes(c.body.error.code));
  const row = (await pool.query(`select attempts_used, state from trust_identity_checks where user_id=$1`, [ana.id])).rows[0];
  assert.equal(row.attempts_used, 3);
  assert.equal(row.state, "in_review");
});

test("comprobación: aprobar la selfie la completa pero NO verifica la identidad", async () => {
  await acceptPrivateCheckNotice(app, ana);
  await uploadFlow(app, storage, ana, "selfie", { salt: 31 });
  const approved = await decide(ana.id, { decision: "approved" });
  assert.equal(approved.status, 200);
  assert.deepEqual(approved.body.results.map((r: any) => [r.item, r.outcome]), [["private_check", "approved"]]);

  const overview = (await call(app, "GET", "/v1/me/verification", { as: ana })).body;
  assert.equal(overview.privateCheck.state, "completed");
  assert.equal(overview.privateCheck.nextAction, "none");
  assert.equal(overview.privateCheck.method, "selfie");
  assert.equal(overview.privateCheck.selfieAloneVerifiesIdentity, false);
  assert.equal(overview.identity.status, "unverified", "la selfie por sí sola no acredita identidad");
  assert.equal(overview.identity.verifiedBy, null);
  assert.equal((await pool.query(`select identity_status from profiles where user_id=$1`, [ana.id])).rows[0].identity_status, "unverified");

  const again = await call(app, "POST", "/v1/me/identity-check/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 100 } });
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, "PRIVATE_CHECK_ALREADY_COMPLETED");
  // la persona recibe un aviso dentro de la app
  const notices = await pool.query(`select title from notifications where user_id=$1`, [ana.id]);
  assert.ok(notices.rows.length >= 1);
});

test("comprobación: rechazo de la selfie → rejected con texto neutro; queda la alternativa del documento", async () => {
  await acceptPrivateCheckNotice(app, ana);
  await uploadFlow(app, storage, ana, "selfie", { salt: 32 });
  const rejected = await decide(ana.id, { decision: "rejected", reason: "No coincide con la foto del perfil", reasonCode: "NOT_MATCHING_PROFILE_PHOTO" });
  assert.equal(rejected.status, 200);
  const state = (await call(app, "GET", "/v1/me/identity-check", { as: ana })).body;
  assert.equal(state.state, "rejected");
  assert.equal(state.nextAction, "use_alternative");
  assert.equal(state.reason.code, "NOT_MATCHING_PROFILE_PHOTO");
  assert.doesNotMatch(JSON.stringify(state), /No coincide con la foto del perfil/, "la sospecha interna no se muestra a la persona usuaria");
  assert.match(state.reason.message, /No hemos podido completar la comprobación/);
  const blocked = await call(app, "POST", "/v1/me/identity-check/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 100 } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "PRIVATE_CHECK_REJECTED");
});

/* ───────────────────────────── Alternativa: documento de identidad ───────────────────────────── */

test("documento de identidad: subida → en revisión (identidad pending) → aprobado = ÚNICO camino a identity_status verified", async () => {
  const flow = await uploadFlow(app, storage, ana, "identity_document", { salt: 51 });
  assert.equal(flow.intent.status, 201);
  assert.deepEqual(flow.intent.body.allowedContentTypes, ["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  assert.equal(flow.intent.body.maxSizeBytes, 20 * 1024 * 1024);
  assert.equal(flow.complete.status, 200);
  assert.equal(flow.complete.body.document.kind, "identity_document");
  assert.equal(flow.complete.body.document.status, "in_review");
  assert.equal(flow.complete.body.privateCheck.state, "in_review");
  assert.equal(flow.complete.body.privateCheck.method, "identity_document");
  assert.equal(flow.complete.body.identity.status, "pending");

  // un segundo documento mientras el primero está en revisión
  const dup = await call(app, "POST", "/v1/me/identity/documents/upload-intents", {
    as: ana,
    body: { kind: "identity_document", contentType: "application/pdf", sizeBytes: 100 }
  });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "DOCUMENT_IN_REVIEW");

  // repetir la confirmación es idempotente
  const again = await call(app, "POST", `/v1/me/identity/documents/upload-intents/${flow.intent.body.intentId}/complete`, { as: ana });
  assert.equal(again.status, 200);
  assert.equal(again.body.document.id, flow.complete.body.document.id);
  assert.equal((await pool.query(`select count(*)::int as n from private_documents where owner_user_id=$1`, [ana.id])).rows[0].n, 1);

  const approved = await decide(ana.id, { decision: "approved" });
  assert.equal(approved.status, 200);
  assert.ok(approved.body.results.some((r: any) => r.item === "identity" && r.outcome === "approved"));
  const overview = (await call(app, "GET", "/v1/me/verification", { as: ana })).body;
  assert.equal(overview.identity.status, "verified");
  assert.equal(overview.identity.verifiedBy, "identity_document");
  assert.equal(overview.privateCheck.state, "completed");
  assert.equal(overview.privateCheck.method, "identity_document");
  assert.equal(overview.privateCheck.canUseAlternative, false);

  const reupload = await call(app, "POST", "/v1/me/identity/documents/upload-intents", {
    as: ana,
    body: { kind: "identity_document", contentType: "application/pdf", sizeBytes: 100 }
  });
  assert.equal(reupload.status, 409);
  assert.equal(reupload.body.error.code, "IDENTITY_ALREADY_VERIFIED");
});

test("documento de identidad: rechazado → identidad rejected, la comprobación pide otra vía y se puede volver a subir", async () => {
  await uploadFlow(app, storage, ana, "identity_document", { salt: 52 });
  const rejected = await decide(ana.id, { decision: "rejected", reason: "Documento ilegible", reasonCode: "DOCUMENT_REVIEW_REJECTED" });
  assert.equal(rejected.status, 200);
  const overview = (await call(app, "GET", "/v1/me/verification", { as: ana })).body;
  assert.equal(overview.identity.status, "rejected");
  assert.equal(overview.identity.documents[0].status, "rejected");
  assert.equal(overview.privateCheck.state, "needs_retry");
  assert.equal(overview.privateCheck.method, "identity_document");
  assert.equal(overview.privateCheck.nextAction, "use_alternative");
  const again = await uploadFlow(app, storage, ana, "identity_document", { salt: 53 });
  assert.equal(again.complete.status, 200);
  assert.equal(again.complete.body.identity.status, "pending");
});

test("permiso de conducir: solo con rol conductor", async () => {
  const body = { kind: "driver_license", contentType: "image/jpeg", sizeBytes: 100 };
  const denied = await call(app, "POST", "/v1/me/identity/documents/upload-intents", { as: world.rider, body });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.error.code, "DRIVER_ROLE_REQUIRED");
  const flow = await uploadFlow(app, storage, ana, "driver_license", { salt: 54, contentType: "image/jpeg" });
  assert.equal(flow.complete.status, 200);
  assert.equal(flow.complete.body.document.kind, "driver_license");
  assert.equal(flow.complete.body.identity.driverLicense.status, "in_review");
  assert.equal(flow.complete.body.identity.status, "unverified", "el permiso no verifica la identidad");
});

/* ───────────────────────────── Roles (chips de la pantalla 05) ───────────────────────────── */

test("roles: elegir conductor/pasajero, nunca roles de personal; no se deja un rol en uso", async () => {
  const rider = world.rider;
  const both = await call(app, "PUT", "/v1/me/roles", { as: rider, body: { roles: ["driver", "passenger"] } });
  assert.equal(both.status, 200);
  assert.deepEqual(both.body.roles, ["passenger", "driver"]);
  assert.equal((await call(app, "GET", "/v1/me/verification", { as: rider })).body.roles.length, 2);
  assert.equal(await auditCount(pool, "user.roles.updated"), 1);

  for (const roles of [["admin"], ["passenger", "finance_admin"], [], ["superuser"]]) {
    const res = await call(app, "PUT", "/v1/me/roles", { as: rider, body: { roles } });
    assert.equal(res.status, 422, JSON.stringify(roles));
    assert.equal(res.body.error.code, "ROLES_INVALID");
  }
  assert.equal((await pool.query(`select count(*)::int as n from user_roles where user_id=$1 and role::text not in ('passenger','driver')`, [rider.id])).rows[0].n, 0);

  // un conductor con un viaje publicado no puede dejar de serlo
  const province = await seedProvince(pool);
  const vehicle = await seedVehicle(pool, ana.id);
  await seedTrip(pool, ana.id, vehicle, province, { status: "published" });
  const stuck = await call(app, "PUT", "/v1/me/roles", { as: ana, body: { roles: ["passenger"] } });
  assert.equal(stuck.status, 409);
  assert.equal(stuck.body.error.code, "ROLE_IN_USE");
  assert.equal((await call(app, "PUT", "/v1/me/roles", { body: { roles: ["driver"] } })).status, 401);
});

test("visión general: agrega roles, foto, comprobación e identidad", async () => {
  const res = await call(app, "GET", "/v1/me/verification", { as: ana });
  assert.equal(res.status, 200);
  assert.deepEqual(Object.keys(res.body).sort(), ["identity", "photo", "privateCheck", "roles"]);
  assert.deepEqual(res.body.roles, ["passenger", "driver"]);
  assert.equal(res.body.photo.state, "none");
  assert.equal(res.body.privateCheck.state, "not_started");
  assert.deepEqual(res.body.identity, { status: "unverified", verifiedBy: null, documents: [], driverLicense: null, uploadAvailable: true });
});
