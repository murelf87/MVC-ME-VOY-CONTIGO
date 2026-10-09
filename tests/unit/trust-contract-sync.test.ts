import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../../src/config.js";
import { registerTrustModule } from "../../src/modules/trust/index.js";
import { loadTrustConfig } from "../../src/modules/trust/config.js";
import { LEGAL_CONTEXTS, LEGAL_KINDS } from "../../src/modules/trust/legal.js";
import { ALERT_KINDS } from "../../src/modules/trust/operations.js";
import { PERIODS } from "../../src/modules/trust/period.js";
import { ADMIN_RESOURCES, STAFF_ROLES, permissionFor, permits, type AdminResource } from "../../src/modules/trust/rbac.js";
import { CHECK_REJECT_REASON_CODES, CHECK_RETRY_REASON_CODES, DOCUMENT_REASON_CODE, PHOTO_REASON_CODES } from "../../src/modules/trust/reasons.js";
import { ITEM_KEYS } from "../../src/modules/trust/review-queue.js";
import type { ModuleDeps } from "../../src/modules/register.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");
const doc = read("docs/contracts/trust.md");
const mobile = read("mobile/src/api/types/trust.ts");

type OpenApiParameter = { name: string; in: string; schema?: { enum?: unknown[] } };
type OpenApiOperation = {
  summary?: string;
  parameters?: OpenApiParameter[];
  requestBody?: { content?: Record<string, { schema?: { properties?: Record<string, { enum?: unknown[] }> } }> };
};
type OpenApiSpec = { paths: Record<string, Record<string, OpenApiOperation>> };

let specPromise: Promise<OpenApiSpec> | undefined;
/** Registra el módulo con una base de datos inexistente: solo se necesita el árbol de rutas, no se ejecuta ningún manejador. */
function loadSpec(): Promise<OpenApiSpec> {
  specPromise ??= (async () => {
    const app = Fastify({ logger: false });
    await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
    await app.register(swagger, {
      openapi: {
        info: { title: "trust", version: "0" },
        components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } }
      }
    });
    const deps: ModuleDeps = {
      pool: {} as Pool,
      config: { privateUploadTtlSeconds: 600 } as AppConfig,
      privateStorage: null,
      routeProvider: null,
      geocodingProvider: null
    };
    await registerTrustModule(app, deps, { trustConfig: loadTrustConfig({}) });
    await app.ready();
    const spec = app.swagger() as unknown as OpenApiSpec;
    await app.close();
    return spec;
  })();
  return specPromise;
}

function registeredEndpoints(spec: OpenApiSpec): string[] {
  return Object.entries(spec.paths)
    .flatMap(([route, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${route}`))
    .sort();
}

/* ─────────────────────────── Índice de endpoints ─────────────────────────── */

const indexSection = doc.slice(doc.indexOf("## 4. Endpoints"), doc.indexOf("### 4.1 "));
const documentedRows = [...indexSection.matchAll(/^\|\s*(GET|POST|PUT|DELETE)\s*\|\s*`([^`]+)`\s*\|\s*([^|]+?)\s*\|/gm)].map(match => ({
  endpoint: `${match[1]} ${match[2]}`,
  access: match[3]!
}));

test("trust: los endpoints registrados coinciden exactamente con el índice de docs/contracts/trust.md (§4)", async () => {
  assert.ok(documentedRows.length >= 40, "no se leyó el índice de endpoints");
  const documented = documentedRows.map(row => row.endpoint).sort();
  assert.equal(new Set(documented).size, documented.length, "endpoints repetidos en el índice");
  assert.deepEqual(registeredEndpoints(await loadSpec()), documented);
});

test("trust: cada ruta registrada se describe en el detalle del contrato (después del índice)", async () => {
  const detail = doc.slice(doc.indexOf("### 4.1 "));
  const missing = Object.keys((await loadSpec()).paths).filter(route => !detail.includes(route));
  assert.deepEqual(missing, [], "rutas sin sección en el contrato");
});

test("trust: todos los endpoints tienen resumen en español y requieren sesión salvo los públicos", async () => {
  const spec = await loadSpec();
  const publicRoutes = new Set(["GET /v1/legal/documents", "GET /v1/legal/documents/{kind}", "GET /v1/legal/documents/{kind}/versions/{version}", "GET /v1/public/users/{userId}/photo"]);
  for (const [route, methods] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      assert.ok((operation.summary ?? "").length > 10, `${method} ${route} sin resumen`);
      const security = (operation as { security?: unknown[] }).security;
      const isPublic = publicRoutes.has(`${method.toUpperCase()} ${route}`);
      assert.equal(Array.isArray(security) && security.length > 0, !isPublic, `${method} ${route}: seguridad`);
    }
  }
});

/**
 * La columna «Acceso» del índice se deriva del CÓDIGO: el recurso/permiso con el que cada ruta llama a `authorizeAdmin`
 * y la matriz ADMIN_MATRIX. Si alguien cambia un permiso sin actualizar el contrato (o al revés), este test falla.
 */
function routeAccessFromSource(): Map<string, string> {
  const dir = path.join(root, "src/modules/trust/routes");
  const letter: Record<string, string> = { admin: "A", verification_admin: "V", finance_admin: "F", support_admin: "S" };
  const result = new Map<string, string>();
  for (const file of readdirSync(dir).filter(name => name.endsWith("-routes.ts"))) {
    const text = readFileSync(path.join(dir, file), "utf8");
    const starts = [...text.matchAll(/scope\.(get|post|put|delete)\(\s*"(\/v1\/[^"]+)"/g)];
    starts.forEach((start, index) => {
      const chunk = text.slice(start.index, index + 1 < starts.length ? starts[index + 1]!.index : text.length);
      const endpoint = `${start[1]!.toUpperCase()} ${start[2]!.replace(/:([A-Za-z0-9_]+)/g, "{$1}")}`;
      const admin = /authorizeAdmin\(ctx, request, "(\w+)", "(read|write)"\)/.exec(chunk);
      const guard = /adminGuard\(ctx, "(\w+)", "(read|write)"\)/.exec(chunk);
      let access: string;
      if (admin) {
        const resource = admin[1] as AdminResource;
        assert.ok((ADMIN_RESOURCES as readonly string[]).includes(resource), `${endpoint}: recurso desconocido ${resource}`);
        // La sesión y el permiso se comprueban antes de validar (preValidation) con el MISMO recurso y permiso que el manejador.
        assert.ok(guard, `${endpoint}: falta preValidation: adminGuard(...)`);
        assert.deepEqual([guard[1], guard[2]], [admin[1], admin[2]], `${endpoint}: el guard y el manejador autorizan cosas distintas`);
        access = STAFF_ROLES.filter(role => permits(permissionFor([role], resource), admin[2] as "read" | "write"))
          .map(role => letter[role])
          .join(" ");
      } else if (chunk.includes("authorizeStaff(")) {
        assert.ok(chunk.includes("staffGuard(ctx)"), `${endpoint}: falta preValidation: staffGuard(ctx)`);
        access = STAFF_ROLES.map(role => letter[role]).join(" ");
      } else if (chunk.includes("authenticate(")) {
        access = "usuario";
      } else {
        access = "público";
      }
      assert.equal(result.has(endpoint), false, `${endpoint} registrado dos veces`);
      result.set(endpoint, access);
    });
  }
  return result;
}

test("trust: la columna «Acceso» del contrato coincide con los permisos que aplica el código", async () => {
  const fromSource = routeAccessFromSource();
  assert.deepEqual([...fromSource.keys()].sort(), registeredEndpoints(await loadSpec()), "el análisis del código no ve las mismas rutas");
  for (const row of documentedRows) {
    assert.equal(row.access, fromSource.get(row.endpoint), `${row.endpoint}: acceso documentado «${row.access}»`);
  }
});

/* ───────────────────────────── Códigos de error ───────────────────────────── */

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}

/** Códigos del núcleo (src/auth, manejador global) que este módulo reutiliza o que llegan antes de entrar en él. */
const CORE_CODES = new Set(["AUTH_REQUIRED", "AUTH_INVALID", "AUTH_INVALID_OR_EXPIRED", "ACCOUNT_NOT_ACTIVE", "AUTH_FORBIDDEN"]);

function mobileList(name: string): string[] {
  const match = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const`).exec(mobile);
  assert.ok(match, `${name} no encontrado en mobile/src/api/types/trust.ts`);
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map(m => m[1]!);
}

function mobileUnion(name: string): string[] {
  const match = new RegExp(`export type ${name} =([^;]+);`).exec(mobile);
  assert.ok(match, `${name} no encontrado en mobile/src/api/types/trust.ts`);
  return [...match[1]!.matchAll(/"([^"]+)"/g)].map(m => m[1]!);
}

const sorted = (values: readonly string[]) => [...values].sort();

test("trust: TRUST_ERROR_CODES de la app == códigos que emite src/modules/trust (menos los del núcleo)", () => {
  const emitted = new Set<string>();
  for (const file of sourceFiles(path.join(root, "src/modules/trust"))) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/(?:trustError|DomainError)\(\s*"([A-Z][A-Z0-9_]+)"/g)) emitted.add(match[1]!);
    for (const match of text.matchAll(/\bcode:\s*"([A-Z][A-Z0-9_]+)"/g)) emitted.add(match[1]!);
  }
  assert.ok(emitted.size >= 40, "no se leyeron los códigos emitidos");
  const codes = mobileList("TRUST_ERROR_CODES");
  assert.equal(new Set(codes).size, codes.length, "códigos repetidos en TRUST_ERROR_CODES");
  const emittedOwn = [...emitted].filter(code => !CORE_CODES.has(code));
  assert.deepEqual(
    emittedOwn.filter(code => !codes.includes(code)),
    [],
    "códigos que emite el módulo y no están en TRUST_ERROR_CODES (mobile/src/api/types/trust.ts)"
  );
  assert.deepEqual(
    codes.filter(code => !emitted.has(code)),
    [],
    "códigos de TRUST_ERROR_CODES que ningún fichero del módulo emite"
  );
});

test("trust: cada código de error está documentado y la documentación no cita códigos que no existen", () => {
  const codes = mobileList("TRUST_ERROR_CODES");
  assert.deepEqual(codes.filter(code => !doc.includes(code)), [], "códigos sin documentar en docs/contracts/trust.md");

  // «409 CODE», «422 CODE_A|CODE_B» → todos los citados con estado HTTP deben existir.
  const cited = new Set<string>();
  const token = "(?:[A-Z][A-Z0-9]*_)+[A-Z0-9]+";
  for (const match of doc.matchAll(new RegExp(`\\b[1-5]\\d{2} (${token}(?:\\|${token})*)`, "g"))) {
    for (const code of match[1]!.split("|")) cited.add(code);
  }
  assert.ok(cited.size >= 40, "no se leyeron los códigos citados");
  const known = new Set([...codes, ...CORE_CODES]);
  assert.deepEqual([...cited].filter(code => !known.has(code)).sort(), [], "códigos citados en el contrato que no existen");
});

/* ───────────────────── Enumeraciones compartidas con la app ───────────────────── */

test("trust: las enumeraciones de la app coinciden con las del backend", () => {
  assert.deepEqual(sorted(mobileUnion("AdminResource")), sorted(ADMIN_RESOURCES));
  assert.deepEqual(sorted(mobileUnion("TrustStaffRole")), sorted(STAFF_ROLES));
  assert.deepEqual(sorted(mobileUnion("LegalDocumentKind")), sorted(LEGAL_KINDS));
  assert.deepEqual(sorted(mobileUnion("LegalAcceptanceContext")), sorted(LEGAL_CONTEXTS));
  assert.deepEqual(sorted(mobileUnion("AdminPeriod")), sorted(PERIODS));
  assert.deepEqual(sorted(mobileUnion("AdminAlertKind")), sorted(ALERT_KINDS));
  assert.deepEqual(sorted(mobileUnion("AdminReviewItemKey")), sorted(ITEM_KEYS));
  assert.deepEqual(mobileList("TRUST_PHOTO_REASON_CODES"), [...PHOTO_REASON_CODES]);
  assert.deepEqual(mobileList("TRUST_CHECK_RETRY_REASON_CODES"), [...CHECK_RETRY_REASON_CODES]);
  assert.deepEqual(mobileList("TRUST_CHECK_REJECT_REASON_CODES"), [...CHECK_REJECT_REASON_CODES]);
  assert.deepEqual(mobileUnion("TrustDocumentReasonCode"), [DOCUMENT_REASON_CODE]);
});

function queryEnum(spec: OpenApiSpec, route: string, method: string, name: string): string[] {
  const parameter = spec.paths[route]?.[method]?.parameters?.find(p => p.name === name);
  assert.ok(parameter?.schema?.enum, `${method} ${route}: parámetro ${name} sin enum`);
  return parameter.schema.enum.map(String);
}

function bodyEnum(spec: OpenApiSpec, route: string, method: string, field: string): string[] {
  const properties = spec.paths[route]?.[method]?.requestBody?.content?.["application/json"]?.schema?.properties;
  const values = properties?.[field]?.enum;
  assert.ok(values, `${method} ${route}: campo ${field} sin enum`);
  return values.map(String);
}

test("trust: los enum de los schemas de las rutas coinciden con los tipos de la app", async () => {
  const spec = await loadSpec();
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/summary", "get", "period")), sorted(mobileUnion("AdminPeriod")));
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/bookings", "get", "period")), sorted(mobileUnion("AdminPeriod")));
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/bookings", "get", "status")), sorted(mobileUnion("AdminBookingStatusFilter")));
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/review/users", "get", "tab")), sorted(mobileUnion("AdminReviewTab")));
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/review/users", "get", "item")), sorted(mobileUnion("AdminReviewItemKey")));
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/review/users", "get", "role")), ["driver", "passenger"]);
  assert.deepEqual(sorted(bodyEnum(spec, "/v1/admin/review/users/{userId}/decision", "post", "decision")), sorted(mobileUnion("AdminReviewDecision")));
  assert.deepEqual(sorted(bodyEnum(spec, "/v1/admin/evidence/{kind}/{evidenceId}/access", "post", "purpose")), sorted(mobileUnion("AdminEvidencePurpose")));
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/evidence/{kind}/{evidenceId}/access", "post", "kind")), sorted(mobileUnion("AdminEvidenceKind")));
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/alerts", "get", "status")), [...mobileUnion("AdminAlertStatus"), "all"].sort());
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/alerts", "get", "kind")), sorted(mobileUnion("AdminAlertKind")));
  assert.deepEqual(sorted(bodyEnum(spec, "/v1/admin/alerts/{alertId}/status", "post", "status")), ["acknowledged", "resolved"]);
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/support/tickets", "get", "status")), [...mobileUnion("AdminSupportTicketStatus"), "all"].sort());
  assert.deepEqual(sorted(queryEnum(spec, "/v1/admin/support/tickets", "get", "category")), sorted(mobileUnion("AdminSupportTicketCategory")));
  assert.deepEqual(sorted(bodyEnum(spec, "/v1/admin/legal/documents", "post", "kind")), sorted(mobileUnion("LegalDocumentKind")));
  assert.deepEqual(sorted(bodyEnum(spec, "/v1/me/legal/acceptances", "post", "kind")), sorted(mobileUnion("LegalDocumentKind")));
  assert.deepEqual(sorted(bodyEnum(spec, "/v1/me/legal/acceptances", "post", "context")), sorted(mobileUnion("LegalAcceptanceContext")));
  assert.deepEqual(sorted(bodyEnum(spec, "/v1/me/identity/documents/upload-intents", "post", "kind")), sorted(mobileUnion("TrustDocumentKind")));
});

test("trust: el contrato fija las garantías de producto que el código implementa", () => {
  // Las frases clave del contrato no pueden desaparecer sin que alguien lo note.
  for (const phrase of [
    "La selfie NO acredita identidad",
    "ECONOMICS_ACTIVATION_DISABLED",
    "draft_pending_legal_review",
    "scripts/grant-role.ts",
    "pending_definition",
    "mvc_trust_full"
  ]) {
    assert.ok(doc.includes(phrase), `falta «${phrase}» en docs/contracts/trust.md`);
  }
  assert.doesNotMatch(doc, /alerts\/run-evaluator/, "la ruta del evaluador es src/modules/trust/operations/run-evaluator.ts");
  assert.ok(doc.includes("src/modules/trust/operations/run-evaluator.ts"));
});
