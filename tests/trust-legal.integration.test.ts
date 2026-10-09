import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { ApiResult } from "./trust-helpers.js";
import {
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
  uploadFlow
} from "./trust-helpers.js";

/** Documentos legales versionados, registros de aceptación (usuario, versión, instante, hash de IP) y administración de versiones. */

const pool = createPool();
let app: FastifyInstance;
let storage: FakeStorage;
let world: StaffWorld;
let ana: SeededUser;

before(async () => {
  await pool.query("select 1 from trust_legal_documents limit 1");
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

const KINDS = ["terms", "privacy", "cancellation", "private_check_notice"] as const;
const accept = (kind: string, version: number, as: SeededUser | null = ana, context?: string, target: FastifyInstance = app) =>
  call(target, "POST", "/v1/me/legal/acceptances", { as, body: { kind, version, ...(context ? { context } : {}) } });
const section = (heading: string, text: string) => ({ heading, paragraphs: [text] });
const create = (kind: string, title = "Documento de prueba", sections: unknown = [section("Objeto", "Texto estructural de prueba.")], as: SeededUser = world.admin) =>
  call(app, "POST", "/v1/admin/legal/documents", { as, body: { kind, title, sections } });
const publish = (id: string, reference = "Acta de revisión legal 2026-11-02", extra: Record<string, unknown> = {}, as: SeededUser = world.admin) =>
  call(app, "POST", `/v1/admin/legal/documents/${id}/publish`, { as, body: { legalReviewReference: reference, ...extra } });

/* ───────────────────────────── Lectura pública ───────────────────────────── */

test("público: las cuatro últimas versiones, sin sesión, marcadas como borrador pendiente de revisión legal", async () => {
  const res = await call(app, "GET", "/v1/legal/documents");
  assert.equal(res.status, 200);
  assert.equal(res.headers["cache-control"], "public, max-age=60");
  assert.deepEqual(res.body.items.map((i: any) => i.kind), [...KINDS]);
  for (const item of res.body.items) {
    assert.equal(item.version, 1);
    assert.equal(item.status, "draft_pending_legal_review");
    assert.equal(item.legallyEffective, false);
    assert.equal(item.pendingLegalReview, true);
    assert.equal(item.locale, "es-ES");
    assert.equal(item.effectiveFrom, null);
    assert.equal(item.publishedAt, null);
    assert.match(item.contentSha256, /^[0-9a-f]{64}$/);
    assert.match(item.id, /^[0-9a-f-]{36}$/);
    assert.equal("sections" in item, false, "el resumen no lleva el texto");
  }
  const titles = Object.fromEntries(res.body.items.map((i: any) => [i.kind, i.title]));
  assert.equal(titles.terms, "Términos y condiciones de uso");
  assert.equal(titles.private_check_notice, "Privacidad de la comprobación");
});

test("público: el texto sembrado es estructural y neutro (sin texto legal inventado); el aviso de la pantalla 07 va por secciones", async () => {
  for (const kind of ["terms", "privacy", "cancellation"] as const) {
    const res = await call(app, "GET", `/v1/legal/documents/${kind}`);
    assert.equal(res.status, 200, kind);
    const text = JSON.stringify(res.body.sections);
    assert.match(text, /Contenido pendiente de revisión legal/);
    assert.match(res.body.sections[0].heading, /Estado de este documento/);
    assert.match(res.body.sections[0].paragraphs[0], /no tiene validez legal/);
    assert.doesNotMatch(text, /art[íi]culo|Ley Org|RGPD|LOPDGDD|\d+\s?€|euros|\d+ (d[íi]as|meses|a[ñn]os)/i, `${kind}: nada de cifras ni citas legales inventadas`);
    for (const s of res.body.sections) {
      assert.equal(typeof s.heading, "string");
      assert.ok(Array.isArray(s.paragraphs) && Array.isArray(s.bullets));
    }
  }
  const notice = (await call(app, "GET", "/v1/legal/documents/private_check_notice")).body;
  assert.deepEqual(
    notice.sections.map((s: any) => s.heading),
    ["Tus fotos, usos y privacidad", "Qué se usa y para qué", "Conservación y proveedor: por definir", "Otra forma de verificar"]
  );
  assert.deepEqual(notice.sections[0].bullets, [
    "Foto visible en tu perfil: la ven otros usuarios para generar confianza en los trayectos.",
    "Comprobación privada: solo la ve el equipo de MVC para revisar tu cuenta."
  ]);
  assert.equal(notice.sections[2].paragraphs[0], "El tiempo de conservación y el proveedor del servicio se definirán en próximas fases.");
});

test("público: huella del contenido (SHA-256) calculada por la base de datos y coherente con el texto", async () => {
  for (const kind of KINDS) {
    const body = (await call(app, "GET", `/v1/legal/documents/${kind}`)).body;
    const expected = (
      await pool.query(`select trust_legal_content_hash(title, sections)::text as h from trust_legal_documents where id = $1`, [body.id])
    ).rows[0].h;
    assert.equal(body.contentSha256, expected, kind);
  }
});

test("público: versión concreta, kind desconocido y versión inexistente", async () => {
  const v1 = await call(app, "GET", "/v1/legal/documents/privacy/versions/1");
  assert.equal(v1.status, 200);
  assert.equal(v1.body.version, 1);
  const missingVersion = await call(app, "GET", "/v1/legal/documents/privacy/versions/9");
  assert.equal(missingVersion.status, 404);
  assert.equal(missingVersion.body.error.code, "LEGAL_DOCUMENT_NOT_FOUND");
  for (const url of ["/v1/legal/documents/cookies", "/v1/legal/documents/cookies/versions/1"]) {
    const res = await call(app, "GET", url);
    assert.equal(res.status, 404, url);
    assert.equal(res.body.error.code, "LEGAL_DOCUMENT_NOT_FOUND", url);
  }
  for (const version of ["0", "uno", "-1", "1.5"]) {
    assert.equal((await call(app, "GET", `/v1/legal/documents/privacy/versions/${version}`)).status, 400, version);
  }
});

/* ───────────────────────────── Aceptaciones ───────────────────────────── */

test("aceptación: se registra usuario, versión, instante, contexto y estado legal; repetirla es idempotente (200)", async () => {
  assert.equal((await accept("privacy", 1, null)).status, 401);

  const first = await accept("privacy", 1, ana, "registration");
  assert.equal(first.status, 201);
  assert.deepEqual(Object.keys(first.body).sort(), ["acceptedAt", "context", "documentId", "id", "kind", "legallyEffective", "version"]);
  assert.equal(first.body.kind, "privacy");
  assert.equal(first.body.version, 1);
  assert.equal(first.body.context, "registration");
  assert.equal(first.body.legallyEffective, false, "aceptar un borrador no es aceptar un texto con validez legal");

  const again = await accept("privacy", 1, ana, "account");
  assert.equal(again.status, 200);
  assert.equal(again.body.id, first.body.id);
  assert.equal(again.body.context, "registration", "la aceptación original no se reescribe");

  const rows = (await pool.query(`select user_id, version, kind, context, document_status, ip_hash from trust_legal_acceptances`)).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].user_id, ana.id);
  assert.equal(rows[0].document_status, "draft_pending_legal_review");
  assert.equal(rows[0].ip_hash, null, "sin TRUST_IP_HASH_PEPPER no se guarda ningún hash de IP");
  assert.equal(await auditCount(pool, "legal.accepted"), 1, "solo la primera aceptación deja evento");
  assert.equal(JSON.stringify(rows), JSON.stringify(rows).replace(/127\.0\.0\.1/g, ""), "la IP nunca se guarda");

  // contexto por defecto según el tipo de documento
  const defaults = [["terms", "account"], ["cancellation", "booking"], ["private_check_notice", "private_check"]] as const;
  for (const [kind, context] of defaults) {
    const res = await accept(kind, 1);
    assert.equal(res.status, 201, kind);
    assert.equal(res.body.context, context, kind);
  }
  const history = await call(app, "GET", "/v1/me/legal/acceptances", { as: ana });
  assert.equal(history.status, 200);
  assert.deepEqual(history.body.items.map((i: any) => i.kind), ["private_check_notice", "cancellation", "terms", "privacy"], "más recientes primero");
  const other = await call(app, "GET", "/v1/me/legal/acceptances", { as: world.rider });
  assert.deepEqual(other.body.items, [], "cada persona ve solo lo suyo");
});

test("aceptación: con TRUST_IP_HASH_PEPPER se guarda solo un HMAC-SHA256 de la IP (nunca la IP)", async () => {
  const pepper = "pepper-de-prueba-0123456789";
  const local = await buildTrustApp(pool, { trustConfig: { ipHashPepper: pepper } });
  try {
    const res = await accept("terms", 1, ana, "registration", local.app);
    assert.equal(res.status, 201);
    const row = (await pool.query(`select ip_hash from trust_legal_acceptances where user_id = $1`, [ana.id])).rows[0];
    const expected = crypto.createHmac("sha256", pepper).update("127.0.0.1", "utf8").digest("hex");
    assert.equal(row.ip_hash, expected);
    assert.doesNotMatch(row.ip_hash, /127/);
    const audit = await lastAudit(pool, "legal.accepted");
    assert.equal(audit?.metadata.proofHashed, true);
    assert.doesNotMatch(JSON.stringify(audit?.metadata), new RegExp(`127\\.0\\.0\\.1|${expected}`), "ni la IP ni su hash van a la auditoría");
    // otra IP → otro hash
    const second = await local.app.inject({
      method: "POST",
      url: "/v1/me/legal/acceptances",
      headers: { authorization: `Bearer ${ana.token}` },
      payload: { kind: "privacy", version: 1 },
      remoteAddress: "10.20.30.40"
    });
    assert.equal(second.statusCode, 201);
    const hashes = (await pool.query(`select ip_hash from trust_legal_acceptances where user_id = $1 order by accepted_at`, [ana.id])).rows.map(r => r.ip_hash);
    assert.equal(hashes[1], crypto.createHmac("sha256", pepper).update("10.20.30.40", "utf8").digest("hex"));
    assert.notEqual(hashes[0], hashes[1]);
  } finally {
    await local.app.close();
  }
});

test("aceptación: errores (documento o versión inexistente, versión desfasada, retirada, entrada inválida)", async () => {
  const unknownVersion = await accept("terms", 7);
  assert.equal(unknownVersion.status, 404);
  assert.equal(unknownVersion.body.error.code, "LEGAL_DOCUMENT_NOT_FOUND");
  for (const body of [{ kind: "cookies", version: 1 }, { kind: "terms", version: 0 }, { kind: "terms" }, { version: 1 }, { kind: "terms", version: 1, context: "otro-sitio" }]) {
    const res = await call(app, "POST", "/v1/me/legal/acceptances", { as: ana, body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.equal(res.body.error.code, "VALIDATION_ERROR");
  }

  // nueva versión borrador (v2) → la v1 queda desfasada
  const v2 = await create("terms", "Términos y condiciones de uso", [section("Objeto", "Segunda versión estructural.")]);
  assert.equal(v2.status, 201);
  const outdated = await accept("terms", 1);
  assert.equal(outdated.status, 409);
  assert.equal(outdated.body.error.code, "LEGAL_VERSION_OUTDATED");
  assert.equal(outdated.body.error.details.latestVersion, 2);
  assert.equal((await accept("terms", 2)).status, 201);

  // publicada y luego sustituida → retirada
  assert.equal((await publish(v2.body.id)).status, 200);
  const v3 = await create("terms", "Términos y condiciones de uso", [section("Objeto", "Tercera versión estructural.")]);
  assert.equal((await publish(v3.body.id, "Acta de revisión legal 2026-12-01")).status, 200);
  const retired = await accept("terms", 2, world.rider);
  assert.equal(retired.status, 409);
  assert.equal(retired.body.error.code, "LEGAL_DOCUMENT_RETIRED");
});

test("aceptación: estado «qué falta por aceptar» y versión nueva que exige volver a aceptar", async () => {
  const initial = (await call(app, "GET", "/v1/me/legal/status", { as: ana })).body;
  assert.equal(initial.accountDocumentsAccepted, false);
  assert.deepEqual(initial.items.map((i: any) => [i.kind, i.scope, i.accepted, i.acceptedVersion, i.acceptedAt]), [
    ["terms", "account", false, null, null],
    ["privacy", "account", false, null, null],
    ["cancellation", "booking", false, null, null],
    ["private_check_notice", "private_check", false, null, null]
  ]);
  for (const item of initial.items) {
    assert.equal(item.latestVersion, 1);
    assert.equal(item.status, "draft_pending_legal_review");
    assert.equal(item.pendingLegalReview, true);
  }

  await accept("terms", 1);
  assert.equal((await call(app, "GET", "/v1/me/legal/status", { as: ana })).body.accountDocumentsAccepted, false, "faltan los dos para las cuentas");
  await accept("privacy", 1);
  const accepted = (await call(app, "GET", "/v1/me/legal/status", { as: ana })).body;
  assert.equal(accepted.accountDocumentsAccepted, true);
  assert.deepEqual(accepted.items.filter((i: any) => i.accepted).map((i: any) => i.kind), ["terms", "privacy"]);

  // se publica una versión nueva de privacidad: hay que aceptarla otra vez; se conserva lo aceptado antes
  const v2 = await create("privacy", "Política de privacidad", [section("Responsable", "Texto estructural v2.")]);
  const published = await publish(v2.body.id);
  assert.equal(published.status, 200);
  const after = (await call(app, "GET", "/v1/me/legal/status", { as: ana })).body;
  const privacy = after.items.find((i: any) => i.kind === "privacy");
  assert.deepEqual(
    { latestVersion: privacy.latestVersion, status: privacy.status, accepted: privacy.accepted, acceptedVersion: privacy.acceptedVersion },
    { latestVersion: 2, status: "published", accepted: false, acceptedVersion: 1 }
  );
  assert.equal(after.accountDocumentsAccepted, false);
  const second = await accept("privacy", 2);
  assert.equal(second.status, 201);
  assert.equal(second.body.legallyEffective, true, "esta sí es una versión publicada con revisión legal");
  assert.equal((await pool.query(`select document_status from trust_legal_acceptances where user_id = $1 and version = 2 and kind = 'privacy'`, [ana.id])).rows[0].document_status, "published");
  assert.equal((await call(app, "GET", "/v1/me/legal/status", { as: ana })).body.accountDocumentsAccepted, true);
  assert.equal((await pool.query(`select count(*)::int as n from trust_legal_acceptances where user_id = $1 and kind = 'privacy'`, [ana.id])).rows[0].n, 2, "se conserva la prueba de la aceptación anterior");
});

test("aceptación: limitada en frecuencia (30 por minuto) con el sobre de error del módulo", async () => {
  let blocked: ApiResult | undefined;
  for (let i = 0; i < 40 && !blocked; i += 1) {
    const res = await accept("privacy", 1);
    if (res.status === 429) blocked = res;
  }
  assert.ok(blocked);
  assert.equal(blocked.body.error.code, "RATE_LIMITED");
});

/* ───────────────────────────── Aviso de la comprobación privada ───────────────────────────── */

test("consentimiento de la comprobación: una versión nueva del aviso exige aceptarla de nuevo y cada intento recuerda qué se aceptó", async () => {
  await acceptPrivateCheckNotice(app, ana);
  const first = await uploadFlow(app, storage, ana, "selfie", { salt: 301 });
  assert.equal(first.complete.status, 200);
  const v1 = (await pool.query(`select id from trust_legal_documents where kind = 'private_check_notice' and version = 1`)).rows[0].id;
  assert.equal((await pool.query(`select notice_document_id from trust_identity_check_attempts where attempt_no = 1`)).rows[0].notice_document_id, v1);

  // el equipo de revisión pide otra captura y, entretanto, se publica una versión nueva del aviso
  assert.equal(
    (await call(app, "POST", `/v1/admin/review/users/${ana.id}/decision`, { as: world.verification, body: { decision: "needs_retry", reasonCode: "LOW_LIGHT" } })).status,
    200
  );
  const v2 = await create("private_check_notice", "Privacidad de la comprobación", [
    { heading: "Tus fotos, usos y privacidad", bullets: ["Versión nueva del aviso (estructura de prueba)."] }
  ]);
  assert.equal((await publish(v2.body.id)).status, 200);

  const state = (await call(app, "GET", "/v1/me/identity-check", { as: ana })).body;
  assert.equal(state.consent.noticeVersion, 2);
  assert.equal(state.consent.accepted, false);
  assert.equal(state.consent.noticeLegallyReviewed, true);
  assert.equal(state.nextAction, "accept_notice");
  const blocked = await call(app, "POST", "/v1/me/identity-check/upload-intents", { as: ana, body: { contentType: "image/jpeg", sizeBytes: 100 } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error.code, "PRIVATE_CHECK_CONSENT_REQUIRED");

  assert.equal((await accept("private_check_notice", 2, ana, "private_check")).status, 201);
  const second = await uploadFlow(app, storage, ana, "selfie", { salt: 302 });
  assert.equal(second.complete.status, 200);
  const v2Id = v2.body.id;
  const attempts = (await pool.query(`select attempt_no, notice_document_id from trust_identity_check_attempts order by attempt_no`)).rows;
  assert.deepEqual(attempts.map(a => [a.attempt_no, a.notice_document_id]), [[1, v1], [2, v2Id]]);
});

/* ───────────────────────────── Administración de versiones ───────────────────────────── */

test("admin: alta de versión (borrador pendiente de revisión legal), validaciones y auditoría", async () => {
  const created = await create("cancellation", "Política de cancelación", [
    { heading: "Cancelación por la persona pasajera", paragraphs: ["Texto estructural de prueba."], bullets: ["Una viñeta"] }
  ]);
  assert.equal(created.status, 201);
  assert.equal(created.body.kind, "cancellation");
  assert.equal(created.body.version, 2, "versión = máximo + 1");
  assert.equal(created.body.status, "draft_pending_legal_review");
  assert.equal(created.body.legallyEffective, false);
  assert.equal(created.body.publishedAt, null);
  assert.deepEqual(created.body.sections, [{ heading: "Cancelación por la persona pasajera", paragraphs: ["Texto estructural de prueba."], bullets: ["Una viñeta"] }]);
  assert.equal(
    created.body.contentSha256,
    (await pool.query(`select trust_legal_content_hash(title, sections)::text as h from trust_legal_documents where id = $1`, [created.body.id])).rows[0].h
  );
  const audit = await lastAudit(pool, "admin.legal.created");
  assert.equal(audit?.actor_user_id, world.admin.id);
  assert.equal(audit?.entity_id, created.body.id);
  assert.deepEqual({ kind: audit?.metadata.kind, version: audit?.metadata.version, sections: audit?.metadata.sections }, { kind: "cancellation", version: 2, sections: 1 });

  const invalid: Array<[string, unknown, unknown]> = [
    ["título corto", "ab", [section("Objeto", "Texto")]],
    ["sin secciones", "Documento de prueba", []],
    ["sección vacía", "Documento de prueba", [{ heading: "Objeto" }]],
    ["encabezado vacío", "Documento de prueba", [{ heading: "  ", paragraphs: ["Texto"] }]],
    ["párrafo vacío", "Documento de prueba", [{ heading: "Objeto", paragraphs: [" "] }]],
    ["demasiadas secciones", "Documento de prueba", Array.from({ length: 61 }, (_, i) => section(`Sección ${i + 1}`, "Texto"))]
  ];
  for (const [label, title, sections] of invalid) {
    const res = await create("terms", title as string, sections);
    assert.equal(res.status, 422, label);
    assert.equal(res.body.error.code, "LEGAL_CONTENT_INVALID", label);
  }
  assert.equal((await create("cookies")).status, 400);
  assert.equal((await pool.query(`select count(*)::int as n from trust_legal_documents where kind = 'terms'`)).rows[0].n, 1, "las altas inválidas no dejan filas");

  // las versiones se numeran por tipo
  const second = await create("cancellation", "Política de cancelación", [section("Devoluciones", "Otra versión")]);
  assert.equal(second.body.version, 3);
  const list = await call(app, "GET", "/v1/admin/legal/documents", { as: world.admin });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 6, "todas las versiones, no solo las vigentes");
  assert.deepEqual(
    list.body.items.filter((i: any) => i.kind === "cancellation").map((i: any) => i.version),
    [3, 2, 1]
  );
  assert.equal(await auditCount(pool, "admin.legal.listed"), 1);
});

test("admin: publicar exige la referencia de revisión legal; la publicada anterior pasa a retirada; la vigente cambia", async () => {
  const draft = await create("terms", "Términos y condiciones de uso", [section("Objeto", "Segunda versión estructural.")]);
  const v2 = draft.body.id;

  const missing = await call(app, "POST", `/v1/admin/legal/documents/${v2}/publish`, { as: world.admin, body: {} });
  assert.equal(missing.status, 400);
  const blank = await call(app, "POST", `/v1/admin/legal/documents/${v2}/publish`, { as: world.admin, body: { legalReviewReference: "" } });
  assert.equal(blank.status, 400);
  const short = await publish(v2, "ok");
  assert.equal(short.status, 422);
  assert.equal(short.body.error.code, "LEGAL_REVIEW_REFERENCE_REQUIRED");
  const badDate = await publish(v2, "Acta 2026-11-02", { effectiveFrom: "mañana" });
  assert.equal(badDate.status, 422);
  assert.equal(badDate.body.error.code, "LEGAL_CONTENT_INVALID");
  assert.equal((await pool.query(`select status from trust_legal_documents where id = $1`, [v2])).rows[0].status, "draft_pending_legal_review", "nada se publicó");

  const unknown = await publish(crypto.randomUUID());
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, "LEGAL_DOCUMENT_NOT_FOUND");

  const fixed = await buildTrustApp(pool, { now: () => new Date("2026-11-03T09:00:00.000Z") });
  try {
    const published = await call(fixed.app, "POST", `/v1/admin/legal/documents/${v2}/publish`, {
      as: world.admin,
      body: { legalReviewReference: "Acta de revisión legal 2026-11-02" }
    });
    assert.equal(published.status, 200);
    assert.equal(published.body.status, "published");
    assert.equal(published.body.legallyEffective, true);
    assert.equal(published.body.pendingLegalReview, false);
    assert.equal(published.body.effectiveFrom, "2026-11-03T09:00:00.000Z");
    assert.ok(published.body.publishedAt);
  } finally {
    await fixed.app.close();
  }
  const row = (await pool.query(`select legal_review_reference, published_by_user_id from trust_legal_documents where id = $1`, [v2])).rows[0];
  assert.equal(row.legal_review_reference, "Acta de revisión legal 2026-11-02");
  assert.equal(row.published_by_user_id, world.admin.id);
  const audit = await lastAudit(pool, "admin.legal.published");
  assert.equal(audit?.metadata.legalReviewReference, "Acta de revisión legal 2026-11-02");
  assert.equal(audit?.metadata.retiredVersion, null);

  // La vigente pública ahora es la v2; la v1 (borrador) ya no es la vigente
  const latest = (await call(app, "GET", "/v1/legal/documents/terms")).body;
  assert.equal(latest.version, 2);
  assert.equal(latest.legallyEffective, true);
  // y la v1 sigue consultable por versión
  assert.equal((await call(app, "GET", "/v1/legal/documents/terms/versions/1")).body.status, "draft_pending_legal_review");

  assert.equal((await publish(v2)).body.error.code, "LEGAL_ALREADY_PUBLISHED");

  // v3 con fecha futura: retira la v2
  const v3 = await create("terms", "Términos y condiciones de uso", [section("Objeto", "Tercera versión estructural.")]);
  const published3 = await publish(v3.body.id, "Informe del despacho 2026-12-15", { effectiveFrom: "2027-01-01T00:00:00.000Z" });
  assert.equal(published3.status, 200);
  assert.equal(published3.body.effectiveFrom, "2027-01-01T00:00:00.000Z");
  assert.deepEqual(
    (await pool.query(`select version, status from trust_legal_documents where kind = 'terms' order by version`)).rows,
    [{ version: 1, status: "draft_pending_legal_review" }, { version: 2, status: "retired" }, { version: 3, status: "published" }]
  );
  assert.equal((await lastAudit(pool, "admin.legal.published"))?.metadata.retiredVersion, 2);

  // una retirada o una anterior a la publicada no vuelven
  const retired = await publish(v2);
  assert.equal(retired.status, 409);
  assert.equal(retired.body.error.code, "LEGAL_DOCUMENT_RETIRED");
  const v1Id = (await pool.query(`select id from trust_legal_documents where kind = 'terms' and version = 1`)).rows[0].id;
  const older = await publish(v1Id);
  assert.equal(older.status, 409);
  assert.equal(older.body.error.code, "LEGAL_VERSION_OUTDATED");
  assert.equal(older.body.error.details.latestVersion, 3);
});

test("admin: dos publicaciones simultáneas del mismo tipo dejan exactamente una versión publicada", async () => {
  const a = await create("privacy", "Política de privacidad", [section("Responsable", "Versión 2.")]);
  const b = await create("privacy", "Política de privacidad", [section("Responsable", "Versión 3.")]);
  const [ra, rb] = await Promise.all([publish(a.body.id, "Acta A 2026-11-01"), publish(b.body.id, "Acta B 2026-11-01", {}, world.admin)]);
  const statuses = [ra.status, rb.status].sort();
  assert.ok(statuses.join() === "200,200" || statuses.join() === "200,409", statuses.join());
  const published = (await pool.query(`select version from trust_legal_documents where kind = 'privacy' and status = 'published'`)).rows;
  assert.deepEqual(published, [{ version: 3 }]);
});

test("base de datos: el contenido de una versión es inmutable y una publicada no vuelve a borrador", async () => {
  const id = (await pool.query(`select id from trust_legal_documents where kind = 'terms' and version = 1`)).rows[0].id;
  await assert.rejects(() => pool.query(`update trust_legal_documents set title = 'Otro título' where id = $1`, [id]), /inmutable/);
  await assert.rejects(() => pool.query(`update trust_legal_documents set sections = '[{"heading":"x","paragraphs":["y"],"bullets":[]}]'::jsonb where id = $1`, [id]), /inmutable/);
  await assert.rejects(() => pool.query(`update trust_legal_documents set version = 9 where id = $1`, [id]), /inmutable/);
  const created = await create("terms", "Términos y condiciones de uso", [section("Objeto", "v2")]);
  await publish(created.body.id);
  await assert.rejects(
    () => pool.query(`update trust_legal_documents set status = 'draft_pending_legal_review' where id = $1`, [created.body.id]),
    /no vuelve a borrador/
  );
  // no se puede publicar sin referencia de revisión ni dejar dos publicadas del mismo tipo
  await assert.rejects(() =>
    pool.query(`update trust_legal_documents set status = 'published', published_at = now(), effective_from = now() where id = $1`, [id])
  );
});

test("admin: solo el rol admin (ver trust-rbac); finanzas y verificación reciben 403", async () => {
  for (const who of [world.finance, world.verification, world.support, world.rider]) {
    assert.equal((await call(app, "GET", "/v1/admin/legal/documents", { as: who })).status, 403);
    assert.equal((await create("terms", "Documento de prueba", undefined, who)).status, 403);
  }
  assert.equal((await pool.query(`select count(*)::int as n from trust_legal_documents`)).rows[0].n, 4, "ningún alta de quien no es admin");
});
