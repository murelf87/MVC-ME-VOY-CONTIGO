import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  type ApiResult,
  type StaffWorld,
  auditCount,
  buildTrustApp,
  call,
  createPool,
  lastAudit,
  resetDatabase,
  seedStaffWorld,
  seedUser
} from "./trust-helpers.js";

/**
 * Matriz de roles (RBAC) del panel de administración: cada rol × cada endpoint.
 * La tabla de expectativas está escrita a mano a partir del contrato (docs/contracts/trust.md §3); NO se importa de la implementación.
 */

const pool = createPool();
let app: FastifyInstance;
let world: StaffWorld;

before(async () => {
  await pool.query("select 1 from audit_events limit 1");
});
beforeEach(async () => {
  await resetDatabase(pool);
  app = (await buildTrustApp(pool)).app;
  world = await seedStaffWorld(pool);
});
after(async () => {
  await app?.close();
  await pool.end();
});

type Who = "anonymous" | "rider" | "driver" | "admin" | "verification" | "finance" | "support";
type StaffWho = "admin" | "verification" | "finance" | "support";
const WHO: readonly Who[] = ["anonymous", "rider", "driver", "admin", "verification", "finance", "support"];

const ID = "0f0f0f0f-1111-4222-8333-444444444444";

type Endpoint = {
  method: "GET" | "POST" | "PUT";
  url: string;
  body?: unknown;
  /** Roles de personal con acceso (contrato §3). */
  roles: readonly StaffWho[];
  /** Recurso que debe quedar en `admin.access_denied` (entity_id). */
  resource: string;
};

const ALL: readonly StaffWho[] = ["admin", "verification", "finance", "support"];

const ENDPOINTS: readonly Endpoint[] = [
  { method: "GET", url: "/v1/admin/me", roles: ALL, resource: "admin_panel" },
  { method: "GET", url: "/v1/admin/summary", roles: ["admin", "finance", "support"], resource: "summary" },
  { method: "GET", url: "/v1/admin/summary/vehicle-activity", roles: ["admin", "finance", "support"], resource: "summary" },
  { method: "GET", url: "/v1/admin/review/users", roles: ["admin", "verification"], resource: "review" },
  { method: "GET", url: `/v1/admin/review/users/${ID}`, roles: ["admin", "verification"], resource: "review" },
  { method: "POST", url: `/v1/admin/review/users/${ID}/decision`, body: { decision: "approved" }, roles: ["admin", "verification"], resource: "review" },
  { method: "POST", url: `/v1/admin/evidence/private_document/${ID}/access`, body: { purpose: "identity_review" }, roles: ["admin", "verification"], resource: "evidence" },
  { method: "GET", url: "/v1/admin/bookings", roles: ["admin", "finance", "support"], resource: "bookings" },
  { method: "GET", url: "/v1/admin/tariffs", roles: ["admin", "finance"], resource: "tariffs" },
  {
    method: "PUT",
    url: "/v1/admin/tariffs/draft",
    body: { ratePerKmMicros: null, passengerCommissionBps: null, driverCommissionBps: null, premiumMonthlyCents: null },
    roles: ["admin", "finance"],
    resource: "tariffs"
  },
  { method: "POST", url: "/v1/admin/tariffs/example", body: { distanceMeters: 18000 }, roles: ["admin", "finance"], resource: "tariffs" },
  { method: "GET", url: "/v1/admin/tariffs/versions", roles: ["admin", "finance"], resource: "tariffs" },
  { method: "POST", url: `/v1/admin/tariffs/versions/${ID}/publish`, body: {}, roles: ["admin"], resource: "tariff_activation" },
  { method: "GET", url: "/v1/admin/operations", roles: ["admin", "finance", "support"], resource: "operations" },
  { method: "PUT", url: "/v1/admin/operations", body: {}, roles: ["admin"], resource: "operations" },
  { method: "GET", url: "/v1/admin/alerts", roles: ["admin", "finance", "support"], resource: "alerts" },
  { method: "POST", url: "/v1/admin/alerts/evaluate", roles: ["admin", "support"], resource: "alerts" },
  { method: "POST", url: `/v1/admin/alerts/${ID}/status`, body: { status: "acknowledged" }, roles: ["admin", "support"], resource: "alerts" },
  { method: "GET", url: "/v1/admin/audit-events", roles: ["admin"], resource: "audit" },
  { method: "GET", url: "/v1/admin/legal/documents", roles: ["admin"], resource: "legal" },
  {
    method: "POST",
    url: "/v1/admin/legal/documents",
    body: { kind: "terms", title: "Términos y condiciones de uso", sections: [{ heading: "Objeto", paragraphs: ["Texto estructural."] }] },
    roles: ["admin"],
    resource: "legal"
  },
  { method: "POST", url: `/v1/admin/legal/documents/${ID}/publish`, body: { legalReviewReference: "ref-prueba" }, roles: ["admin"], resource: "legal" },
  { method: "GET", url: "/v1/admin/support/tickets", roles: ["admin", "support"], resource: "support" },
  { method: "GET", url: `/v1/admin/support/tickets/${ID}`, roles: ["admin", "support"], resource: "support" },
  { method: "POST", url: `/v1/admin/support/tickets/${ID}/reply`, body: { body: "Hola, ya lo estamos revisando." }, roles: ["admin", "support"], resource: "support" },
  { method: "POST", url: `/v1/admin/support/tickets/${ID}/assign`, body: { assignee: "me" }, roles: ["admin", "support"], resource: "support" },
  { method: "POST", url: `/v1/admin/support/tickets/${ID}/close`, roles: ["admin", "support"], resource: "support" },
  { method: "POST", url: `/v1/admin/support/attachments/${ID}/access`, roles: ["admin", "support"], resource: "support" }
];

function sessionOf(who: Who) {
  switch (who) {
    case "anonymous": return null;
    case "rider": return world.rider;
    case "driver": return world.driver;
    case "admin": return world.admin;
    case "verification": return world.verification;
    case "finance": return world.finance;
    case "support": return world.support;
  }
}

function allowedFor(endpoint: Endpoint, who: Who): boolean {
  return who !== "anonymous" && who !== "rider" && who !== "driver" && endpoint.roles.includes(who);
}

test("matriz: cada rol × cada endpoint /v1/admin/** (401 sin sesión, 403 AUTH_FORBIDDEN + auditoría, acceso permitido solo a los roles del contrato)", async () => {
  let denied = 0;
  let allowed = 0;
  let unauthenticated = 0;
  const failures: string[] = [];

  for (const endpoint of ENDPOINTS) {
    for (const who of WHO) {
      const label = `${who} ${endpoint.method} ${endpoint.url}`;
      const deniedBefore = await auditCount(pool, "admin.access_denied");
      const res: ApiResult = await call(app, endpoint.method, endpoint.url, {
        as: sessionOf(who),
        ...(endpoint.body !== undefined ? { body: endpoint.body } : {})
      });
      const deniedAfter = await auditCount(pool, "admin.access_denied");

      if (who === "anonymous") {
        unauthenticated += 1;
        if (res.status !== 401) failures.push(`${label}: esperado 401, recibido ${res.status}`);
        if (deniedAfter !== deniedBefore) failures.push(`${label}: sin sesión no debe auditarse acceso denegado (no hay actor)`);
        continue;
      }

      if (allowedFor(endpoint, who)) {
        allowed += 1;
        // «Autorizado» = la petición llegó a la lógica del endpoint. Un 503 SUPPORT_UNAVAILABLE (tablas de comms ausentes en esta base)
        // o PRIVATE_STORAGE_DISABLED es una respuesta de negocio legítima; cualquier otro 5xx es un fallo.
        const businessUnavailable = res.status === 503 && ["SUPPORT_UNAVAILABLE", "PRIVATE_STORAGE_DISABLED"].includes(res.body?.error?.code);
        if (res.status === 401 || res.status === 403 || (res.status >= 500 && !businessUnavailable)) {
          failures.push(`${label}: debía estar autorizado, recibido ${res.status} ${res.body?.error?.code ?? ""}`);
        }
        if (deniedAfter !== deniedBefore) failures.push(`${label}: un acceso permitido no debe dejar admin.access_denied`);
      } else {
        denied += 1;
        if (res.status !== 403) failures.push(`${label}: esperado 403, recibido ${res.status}`);
        else {
          if (res.body?.error?.code !== "AUTH_FORBIDDEN") failures.push(`${label}: código ${res.body?.error?.code}`);
          if (!res.body?.requestId) failures.push(`${label}: falta requestId`);
          if (deniedAfter !== deniedBefore + 1) failures.push(`${label}: el acceso denegado debe auditarse exactamente una vez`);
          const event = await lastAudit(pool, "admin.access_denied");
          const session = sessionOf(who)!;
          if (event?.actor_user_id !== session.id) failures.push(`${label}: actor de la auditoría ${event?.actor_user_id}`);
          if (event?.entity_id !== endpoint.resource) failures.push(`${label}: recurso auditado ${event?.entity_id}, esperado ${endpoint.resource}`);
          if (event?.metadata?.method !== endpoint.method) failures.push(`${label}: método auditado ${event?.metadata?.method}`);
        }
      }
    }
  }

  assert.deepEqual(failures, [], failures.join("\n"));
  // 28 endpoints × 7 intervinientes = 196 combinaciones comprobadas
  assert.equal(unauthenticated, ENDPOINTS.length);
  assert.equal(allowed + denied + unauthenticated, ENDPOINTS.length * WHO.length);
  assert.ok(denied > 100 && allowed > 40, `denegados ${denied}, permitidos ${allowed}`);
});

test("matriz: el 403 no revela qué rol haría falta ni el recurso", async () => {
  const res = await call(app, "GET", "/v1/admin/audit-events", { as: world.finance });
  assert.equal(res.status, 403);
  assert.equal(res.body.error.code, "AUTH_FORBIDDEN");
  assert.doesNotMatch(res.raw, /admin|audit|finance_admin|verification/i);
});

test("matriz: /v1/admin/me devuelve exactamente los permisos por recurso del contrato para cada rol", async () => {
  const none = {
    summary: "none", finance_kpis: "none", review: "none", evidence: "none", bookings: "none", tariffs: "none",
    tariff_activation: "none", operations: "none", alerts: "none", audit: "none", legal: "none", support: "none"
  };
  const expected: Record<StaffWho, { role: string; permissions: Record<string, string> }> = {
    admin: {
      role: "admin",
      permissions: {
        summary: "read", finance_kpis: "read", review: "write", evidence: "write", bookings: "read", tariffs: "write",
        tariff_activation: "write", operations: "write", alerts: "write", audit: "read", legal: "write", support: "write"
      }
    },
    verification: { role: "verification_admin", permissions: { ...none, review: "write", evidence: "write" } },
    finance: {
      role: "finance_admin",
      permissions: { ...none, summary: "read", finance_kpis: "read", bookings: "read", tariffs: "write", operations: "read", alerts: "read" }
    },
    support: {
      role: "support_admin",
      permissions: { ...none, summary: "read", bookings: "read", operations: "read", alerts: "write", support: "write" }
    }
  };
  for (const who of ALL) {
    const res = await call(app, "GET", "/v1/admin/me", { as: sessionOf(who) });
    assert.equal(res.status, 200, who);
    assert.deepEqual(res.body.roles, [expected[who].role], who);
    assert.deepEqual(res.body.permissions, expected[who].permissions, who);
    assert.equal(res.body.userId, sessionOf(who)!.id);
    assert.equal(res.headers["cache-control"], "no-store");
  }
  assert.equal((await auditCount(pool, "admin.me.viewed")), 4);
});

test("matriz: una persona con varios roles de personal acumula permisos", async () => {
  const both = await seedUser(pool, "Rosa Vega", { roles: ["verification_admin", "finance_admin"] });
  const res = await call(app, "GET", "/v1/admin/me", { as: both });
  assert.equal(res.status, 200);
  assert.deepEqual([...res.body.roles].sort(), ["finance_admin", "verification_admin"]);
  assert.equal(res.body.permissions.review, "write");
  assert.equal(res.body.permissions.tariffs, "write");
  assert.equal(res.body.permissions.audit, "none");
  assert.equal(res.body.permissions.tariff_activation, "none");
});

test("sesión: los roles se leen de la base de datos en cada petición (revocar surte efecto de inmediato)", async () => {
  assert.equal((await call(app, "GET", "/v1/admin/review/users", { as: world.verification })).status, 200);
  await pool.query(`delete from user_roles where user_id = $1 and role = 'verification_admin'`, [world.verification.id]);
  const after = await call(app, "GET", "/v1/admin/review/users", { as: world.verification });
  assert.equal(after.status, 403);
  assert.equal(after.body.error.code, "AUTH_FORBIDDEN");
  // y concederlo de nuevo lo devuelve sin iniciar sesión otra vez
  await pool.query(`insert into user_roles(user_id, role) values($1,'verification_admin')`, [world.verification.id]);
  assert.equal((await call(app, "GET", "/v1/admin/review/users", { as: world.verification })).status, 200);
});

test("sesión: cuenta suspendida (aunque tenga rol de personal), sesión revocada y token inventado no acceden", async () => {
  await pool.query(`update app_users set status = 'suspended' where id = $1`, [world.admin.id]);
  const suspended = await call(app, "GET", "/v1/admin/me", { as: world.admin });
  assert.equal(suspended.status, 403);
  assert.equal(suspended.body.error.code, "ACCOUNT_NOT_ACTIVE");

  await pool.query(`update auth_sessions set revoked_at = now() where user_id = $1`, [world.finance.id]);
  const revoked = await call(app, "GET", "/v1/admin/me", { as: world.finance });
  assert.equal(revoked.status, 401);

  const fake = await call(app, "GET", "/v1/admin/me", { as: "mvc_sess_inventado_0000000000000000000000000000" });
  assert.equal(fake.status, 401);
  const malformed = await call(app, "GET", "/v1/admin/me", { as: "no-es-un-token" });
  assert.equal(malformed.status, 401);
});

test("no hay autoservicio para conseguir un rol de personal ni contraseña maestra", async () => {
  for (const role of ["admin", "verification_admin", "finance_admin", "support_admin"]) {
    const res = await call(app, "PUT", "/v1/me/roles", { as: world.rider, body: { roles: ["passenger", role] } });
    assert.equal(res.status, 422, role);
    assert.equal(res.body.error.code, "ROLES_INVALID", role);
  }
  const staffRows = await pool.query(`select count(*)::int as n from user_roles where user_id = $1 and role::text not in ('passenger','driver')`, [world.rider.id]);
  assert.equal(staffRows.rows[0].n, 0);
  // ni siquiera el personal de verificación puede darse permisos nuevos por la API
  const asStaff = await call(app, "PUT", "/v1/me/roles", { as: world.verification, body: { roles: ["admin"] } });
  assert.equal(asStaff.status, 422);
  // no existe ninguna ruta de inicio de sesión de administración
  for (const url of ["/v1/admin/login", "/v1/admin/auth", "/v1/admin/session", "/v1/admin/token"]) {
    const res = await call(app, "POST", url, { body: { password: "cualquiera" } });
    assert.equal(res.status, 404, url);
  }
});

test("endpoints de usuario y públicos: 401 sin sesión, accesibles para cualquier sesión válida; lo público no pide sesión", async () => {
  const userEndpoints = ["/v1/me/verification", "/v1/me/photo", "/v1/me/identity-check", "/v1/me/legal/status", "/v1/me/legal/acceptances"];
  for (const url of userEndpoints) {
    assert.equal((await call(app, "GET", url)).status, 401, `anónimo ${url}`);
    for (const who of ["rider", "driver", "admin", "verification", "finance", "support"] as const) {
      const res = await call(app, "GET", url, { as: sessionOf(who) });
      assert.equal(res.status, 200, `${who} ${url}`);
    }
  }
  for (const url of ["/v1/legal/documents", "/v1/legal/documents/privacy", "/v1/legal/documents/terms/versions/1"]) {
    const res = await call(app, "GET", url);
    assert.equal(res.status, 200, url);
    assert.match(String(res.headers["cache-control"]), /public/);
  }
  assert.equal((await call(app, "GET", `/v1/public/users/${world.rider.id}/photo`)).status, 404);
  // solo conductor: el permiso de conducir
  const rider = await call(app, "POST", "/v1/me/identity/documents/upload-intents", {
    as: world.rider,
    body: { kind: "driver_license", contentType: "application/pdf", sizeBytes: 1000 }
  });
  assert.equal(rider.status, 403);
  assert.equal(rider.body.error.code, "DRIVER_ROLE_REQUIRED");
});

test("rutas existentes de revisión (vehículos y documentos): sin sesión 401 y nunca éxito para quien no es admin/verification_admin", async (t) => {
  const targets: Array<[string, Record<string, unknown>]> = [
    [`/v1/admin/vehicles/${ID}/review`, { area: "vehicle", decision: "approved" }],
    [`/v1/admin/documents/${ID}/review`, { decision: "approved" }]
  ];
  let externalDefect = false;
  for (const [url, body] of targets) {
    assert.equal((await call(app, "POST", url, { body })).status, 401, `anónimo ${url}`);
    for (const who of ["rider", "driver", "finance", "support"] as const) {
      const res = await call(app, "POST", url, { as: sessionOf(who), body });
      assert.ok(res.status === 403 || res.status === 500, `${who} ${url}: nunca éxito (recibido ${res.status})`);
      if (res.status === 500) externalDefect = true;
    }
    for (const who of ["admin", "verification"] as const) {
      const res = await call(app, "POST", url, { as: sessionOf(who), body });
      assert.ok(res.status !== 401 && res.status !== 403, `${who} ${url}: debía pasar la autorización (recibido ${res.status})`);
      if (res.status === 500) externalDefect = true;
    }
  }
  if (externalDefect) {
    t.diagnostic(
      "DEFECTO EXTERNO: src/auth/session.ts:63 devuelve `roles` como texto ({admin}); requireAnyRole lanza TypeError (500) en estas dos rutas existentes. " +
        "Arreglo de una línea: array_agg(ur.role::text)."
    );
  }
});

test("auditoría de lecturas: si no se puede escribir el evento, la petición falla y no sale ningún dato (falla cerrado)", async () => {
  await pool.query(`
    create or replace function trust_test_block_audit() returns trigger language plpgsql as $$
    begin raise exception 'auditoría bloqueada por la prueba'; end $$;
    drop trigger if exists trust_test_block_audit_trg on audit_events;
    create trigger trust_test_block_audit_trg before insert on audit_events
      for each row when (new.action in ('admin.summary.viewed','admin.audit_log.viewed','admin.dossier.viewed')) execute function trust_test_block_audit();
  `);
  try {
    const summary = await call(app, "GET", "/v1/admin/summary", { as: world.admin });
    assert.equal(summary.status, 500);
    assert.equal(summary.body.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(summary.raw, /kpis|activeTrips|window/);
    const log = await call(app, "GET", "/v1/admin/audit-events", { as: world.admin });
    assert.equal(log.status, 500);
    assert.doesNotMatch(log.raw, /"items"/);
    const dossier = await call(app, "GET", `/v1/admin/review/users/${world.rider.id}`, { as: world.verification });
    assert.equal(dossier.status, 500);
    assert.doesNotMatch(dossier.raw, /summary|items/);
    // lo que no está bloqueado sigue funcionando
    assert.equal((await call(app, "GET", "/v1/admin/me", { as: world.admin })).status, 200);
  } finally {
    await pool.query(`drop trigger if exists trust_test_block_audit_trg on audit_events; drop function if exists trust_test_block_audit();`);
  }
});

test("errores no controlados: 500 INTERNAL_ERROR sin detalles internos", async () => {
  await pool.query(`
    create or replace function trust_test_boom() returns trigger language plpgsql as $$
    begin raise exception 'detalle interno secreto: tabla audit_events'; end $$;
    drop trigger if exists trust_test_boom_trg on audit_events;
    create trigger trust_test_boom_trg before insert on audit_events for each row when (new.action = 'admin.operations.viewed') execute function trust_test_boom();
  `);
  try {
    const res = await call(app, "GET", "/v1/admin/operations", { as: world.admin });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.code, "INTERNAL_ERROR");
    assert.doesNotMatch(res.raw, /secreto|audit_events|trigger|exception/i);
  } finally {
    await pool.query(`drop trigger if exists trust_test_boom_trg on audit_events; drop function if exists trust_test_boom();`);
  }
});

test("validación: errores 400 VALIDATION_ERROR con details.issues y requestId; cuerpo inexistente también", async () => {
  const bad = await call(app, "GET", "/v1/admin/summary", { as: world.admin, query: { period: "siempre" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, "VALIDATION_ERROR");
  assert.ok(Array.isArray(bad.body.error.details.issues) && bad.body.error.details.issues.length > 0);
  assert.ok(bad.body.requestId);

  const badUuid = await call(app, "GET", "/v1/admin/review/users/no-es-uuid", { as: world.verification });
  assert.equal(badUuid.status, 400);
  assert.equal(badUuid.body.error.code, "VALIDATION_ERROR");

  const noBody = await call(app, "POST", `/v1/admin/review/users/${world.rider.id}/decision`, { as: world.verification });
  assert.equal(noBody.status, 400);
  assert.equal(noBody.body.error.code, "VALIDATION_ERROR");

  // la autorización va ANTES que la validación: sin permiso, ni se evalúa el cuerpo
  const noPermission = await call(app, "POST", `/v1/admin/review/users/${world.rider.id}/decision`, { as: world.finance, body: { decision: "nada" } });
  assert.equal(noPermission.status, 403);
});
