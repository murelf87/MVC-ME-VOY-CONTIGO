/**
 * Módulo money · contrato HTTP: inventario de rutas frente a docs/contracts/money.md, tipos de la app frente a los
 * schemas del servidor, códigos de error y avisos documentados, matriz de autenticación, Idempotency-Key obligatoria,
 * generación de OpenAPI y fidelidad de las respuestas (lo que devuelve el servicio == lo que sale por HTTP: ningún
 * campo se pierde en silencio por un schema de respuesta cerrado).
 *
 * Importes: fixtures de prueba (no son tarifas).
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import swagger from "@fastify/swagger";
import Fastify, { type FastifyInstance } from "fastify";
import ts from "typescript";
import { resolveSession } from "../src/auth/session.js";
import { getCancellationPreview } from "../src/modules/money/cancellations/cancel-service.js";
import { normalizeRoles } from "../src/modules/money/lib/http.js";
import { listPaymentMethods } from "../src/modules/money/payments/methods-service.js";
import { getPaymentForUser, getRequestPaymentContext } from "../src/modules/money/payments/payment-service.js";
import { getMyPayout, listAdminPayoutRuns, listMyPayouts } from "../src/modules/money/payouts/payout-service.js";
import { getMyPlan, listPlans } from "../src/modules/money/plans/plans-service.js";
import { DisabledPaymentProvider } from "../src/modules/money/provider/disabled.js";
import type { PaymentProvider } from "../src/modules/money/provider/types.js";
import { getAdminRefund, listAdminRefunds, listMyRefunds } from "../src/modules/money/refunds/refund-service.js";
import { getDriverEarning, listDriverEarnings } from "../src/modules/money/reports/earnings-service.js";
import { getReceipt, listReceipts } from "../src/modules/money/reports/receipt-service.js";
import { getDriverSummary, getPassengerSummary, listPassengerPayments } from "../src/modules/money/reports/summary-service.js";
import { registerMoneyRoutes } from "../src/modules/money/routes/register.js";
import {
  apiCall,
  buildTestApp,
  completeTrip,
  createActor,
  createIntent,
  createTestPool,
  ensureTariff,
  insertApprovedPolicy,
  newKey,
  paidBooking,
  payoutEvent,
  postWebhook,
  providerPayoutRef,
  providerRefundRef,
  refundEvent,
  resetMoneyData,
  scalar,
  seedPayableRequest,
  seedTrip,
  seedWorld,
  StubPaymentProvider,
  type Actor,
  type World
} from "./money-support.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOC_PATH = join(ROOT, "docs/contracts/money.md");
const MOBILE_TYPES_PATH = join(ROOT, "mobile/src/api/types/money.ts");
const DOC = readFileSync(DOC_PATH, "utf8");
const MOBILE_TYPES = readFileSync(MOBILE_TYPES_PATH, "utf8");

const pool = createTestPool();
let world: World;
let stub: StubPaymentProvider;
let app: FastifyInstance;

before(async () => {
  await pool.query("select 1 from payments limit 1");
});
after(async () => {
  await pool.end();
});
beforeEach(async () => {
  await resetMoneyData(pool);
  world = await seedWorld(pool);
  stub = new StubPaymentProvider();
  app = await buildTestApp(pool, stub);
});
afterEach(async () => {
  await app.close();
});

/* ───────────────────────── Utilidades ───────────────────────── */

type RouteInfo = { method: string; url: string; schema: Record<string, any> };
const routeKey = (r: { method: string; url: string }) => `${r.method} ${r.url}`;

async function inspectedApp(provider: PaymentProvider, withSwagger = false): Promise<{ app: FastifyInstance; routes: RouteInfo[] }> {
  const routes: RouteInfo[] = [];
  const instance = Fastify({ logger: false });
  instance.addHook("onRoute", route => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === "HEAD" || method === "OPTIONS") continue;
      routes.push({ method, url: route.url, schema: (route.schema ?? {}) as Record<string, any> });
    }
  });
  if (withSwagger) {
    await instance.register(swagger, {
      openapi: {
        info: { title: "prueba", version: "0.0.0" },
        components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "MVC opaque session token" } } }
      }
    });
  }
  await instance.register(async scope => {
    await registerMoneyRoutes(scope, { pool }, { provider });
  });
  await instance.ready();
  return { app: instance, routes };
}

type DocRow = { n: number; method: string; path: string; auth: string };
function docEndpointRows(): DocRow[] {
  // La columna «Auth» puede contener `\|` (barra escapada de Markdown: «`finance_admin`\|`admin`»).
  const rows = [...DOC.matchAll(/^\|\s*(\d+)\s*\|\s*`(GET|POST|DELETE|PUT|PATCH) ([^`]+)`\s*\|\s*((?:\\\||[^|])*)\|/gm)];
  return rows.map(m => ({ n: Number(m[1]), method: m[2]!, path: m[3]!.replace(/\{(\w+)\}/g, ":$1"), auth: m[4]! }));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(entry => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith(".ts") ? [full] : [];
  });
}
const MONEY_SOURCE = sourceFiles(join(ROOT, "src/modules/money")).map(file => readFileSync(file, "utf8")).join("\n");

const PUBLIC_ROUTES = new Set(["GET /v1/plans", "POST /v1/webhooks/payments"]);
const SAMPLE_UUID = "00000000-0000-4000-8000-000000000001";
const SAMPLE_BODY: Record<string, Record<string, unknown> | undefined> = {
  "POST /v1/ride-requests/:requestId/payment-intents": { method: { kind: "card" } },
  "POST /v1/me/payment-methods": { purpose: "charge", providerToken: "tok_card_visa_4242" },
  "POST /v1/bookings/:bookingId/cancel": { reason: "other" },
  "POST /v1/bookings/:bookingId/driver-cancel": { reason: "other" },
  "POST /v1/admin/refund-proposals/:refundId/approve": {},
  "POST /v1/admin/refund-proposals/:refundId/reject": { note: "x" },
  "POST /v1/admin/refund-proposals/:refundId/execute": undefined,
  "POST /v1/admin/payout-runs": { period: "2026-07" },
  "POST /v1/admin/payout-runs/:payoutId/execute": undefined
};
const urlFor = (route: { url: string }) => route.url.replace(/:\w+/g, SAMPLE_UUID);

/* ═════════════════════════ Inventario de rutas ═════════════════════════ */

describe("Contrato: inventario de rutas frente a docs/contracts/money.md", () => {
  it("las 31 rutas del documento existen, y no hay rutas sin documentar", async () => {
    const { app: inspected, routes } = await inspectedApp(new DisabledPaymentProvider());
    try {
      const docRows = docEndpointRows();
      assert.equal(docRows.length, 31, "la tabla de §3 debe tener 31 filas numeradas");
      assert.deepEqual(docRows.map(r => r.n), Array.from({ length: 31 }, (_, i) => i + 1));
      const documented = new Set(docRows.map(routeKey2));
      const implemented = new Set(routes.map(routeKey));
      assert.deepEqual([...documented].filter(k => !implemented.has(k)), [], "documentadas pero no implementadas");
      assert.deepEqual([...implemented].filter(k => !documented.has(k)), [], "implementadas pero no documentadas");
      assert.equal(routes.length, 31);
      assert.equal(implemented.size, 31, "sin rutas duplicadas");
    } finally {
      await inspected.close();
    }
  });

  it("cada ruta lleva resumen y descripción en español, etiqueta y seguridad Bearer (salvo catálogo de planes y webhook)", async () => {
    const { app: inspected, routes } = await inspectedApp(new DisabledPaymentProvider());
    try {
      // El idioma de la documentación es el español: se rechazan las palabras gramaticales inglesas (no hay lista de palabras
      // españolas posible sin falsos negativos con nombres propios y términos técnicos).
      const english = /\b(the|and|of|for|with|your|their|this|that|from|into|are|is|to|get|list|create|returns?)\b/i;
      const prose = (text: string) => text.replace(/`[^`]*`/g, "");
      for (const route of routes) {
        const key = routeKey(route);
        assert.ok(typeof route.schema.summary === "string" && route.schema.summary.length >= 8, `${key}: resumen`);
        assert.ok(route.schema.summary.trim().split(/\s+/).length >= 2, `${key}: el resumen tiene al menos dos palabras`);
        assert.doesNotMatch(prose(route.schema.summary), english, `${key}: el resumen debe estar en español («${route.schema.summary}»)`);
        assert.ok(typeof route.schema.description === "string" && route.schema.description.length >= 40, `${key}: descripción`);
        assert.doesNotMatch(prose(route.schema.description), english, `${key}: la descripción debe estar en español`);
        assert.ok(Array.isArray(route.schema.tags) && route.schema.tags.length >= 1, `${key}: etiquetas`);
        if (PUBLIC_ROUTES.has(key)) {
          assert.equal(route.schema.security, undefined, `${key}: ruta pública`);
        } else {
          assert.deepEqual(route.schema.security, [{ bearerAuth: [] }], `${key}: seguridad Bearer`);
          assert.ok(route.schema.response?.[401], `${key}: documenta el 401`);
        }
        const success = Object.keys(route.schema.response ?? {}).filter(code => code.startsWith("2"));
        assert.equal(success.length, 1, `${key}: una respuesta de éxito`);
        for (const code of Object.keys(route.schema.response ?? {}).filter(c => !c.startsWith("2"))) {
          assert.ok(route.schema.response[code].properties?.error, `${key}: la respuesta ${code} usa el sobre de error`);
        }
      }
    } finally {
      await inspected.close();
    }
  });

  it("la cabecera Idempotency-Key se declara exactamente en las rutas que el documento marca con ella", async () => {
    const { app: inspected, routes } = await inspectedApp(new DisabledPaymentProvider());
    try {
      const fromDoc = new Set(docEndpointRows().filter(r => /Idempotency-Key/.test(r.auth)).map(routeKey2));
      const fromCode = new Set(routes.filter(r => r.schema.headers?.properties?.["idempotency-key"]).map(routeKey));
      assert.equal(fromDoc.size, 9);
      assert.deepEqual([...fromCode].sort(), [...fromDoc].sort());
    } finally {
      await inspected.close();
    }
  });

  it("los tipos de la app citan todas las rutas (con los mismos nombres de parámetro)", async () => {
    const { app: inspected, routes } = await inspectedApp(new DisabledPaymentProvider());
    try {
      const missing = routes.map(r => `${r.method} ${r.url.replace(/:(\w+)/g, "{$1}")}`).filter(k => !MOBILE_TYPES.includes(k));
      assert.deepEqual(missing, []);
    } finally {
      await inspected.close();
    }
  });

  it("se genera un OpenAPI válido con las 31 operaciones, sus resúmenes y la seguridad declarada", async () => {
    const { app: inspected } = await inspectedApp(new DisabledPaymentProvider(), true);
    try {
      const spec = (inspected as unknown as { swagger(): any }).swagger();
      const operations: string[] = [];
      for (const [path, item] of Object.entries<any>(spec.paths)) {
        for (const [method, operation] of Object.entries<any>(item)) {
          operations.push(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`);
          assert.ok(operation.summary, `${method} ${path}: resumen`);
          assert.ok(operation.responses && Object.keys(operation.responses).length >= 1, `${method} ${path}: respuestas`);
          const isPublic = PUBLIC_ROUTES.has(`${method.toUpperCase()} ${path.replace(/\{(\w+)\}/g, ":$1")}`);
          assert.equal(Boolean(operation.security?.some((s: any) => "bearerAuth" in s)), !isPublic, `${method} ${path}: seguridad`);
        }
      }
      assert.deepEqual(operations.sort(), docEndpointRows().map(routeKey2).sort());
    } finally {
      await inspected.close();
    }
  });
});

function routeKey2(row: { method: string; path: string }): string {
  return `${row.method} ${row.path}`;
}

/* ═════════════════════════ Tipos de la app frente a los schemas ═════════════════════════ */

type Shape =
  | { t: "any" }
  | { t: "scalar"; values: string[] | null }
  | { t: "map" }
  | { t: "array"; item: Shape }
  | { t: "object"; props: Map<string, { optional: boolean; shape: Shape }> };

function mergeShapes(a: Shape, b: Shape): Shape {
  if (a.t === "any") return b;
  if (b.t === "any") return a;
  if (a.t === "object" && b.t === "object") {
    const props = new Map<string, { optional: boolean; shape: Shape }>();
    for (const key of new Set([...a.props.keys(), ...b.props.keys()])) {
      const x = a.props.get(key);
      const y = b.props.get(key);
      props.set(key, {
        optional: !x || !y || x.optional || y.optional,
        shape: x && y ? mergeShapes(x.shape, y.shape) : (x ?? y)!.shape
      });
    }
    return { t: "object", props };
  }
  if (a.t === "array" && b.t === "array") return { t: "array", item: mergeShapes(a.item, b.item) };
  if (a.t === "scalar" && b.t === "scalar") {
    return { t: "scalar", values: a.values && b.values ? [...new Set([...a.values, ...b.values])].sort() : null };
  }
  if (a.t === "map" && b.t === "map") return a;
  return { t: "any" };
}

function shapeOfType(checker: ts.TypeChecker, type: ts.Type, node: ts.Node, depth = 0): Shape {
  if (depth > 14) return { t: "any" };
  if (type.flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return { t: "any" };
  if (type.isUnion()) {
    const members = type.types.filter(m => !(m.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)));
    if (members.length === 0) return { t: "scalar", values: null };
    if (members.every(m => m.flags & ts.TypeFlags.BooleanLiteral)) return { t: "scalar", values: null };
    if (members.every(m => m.isStringLiteral())) {
      return { t: "scalar", values: members.map(m => (m as ts.StringLiteralType).value).sort() };
    }
    return members.map(m => shapeOfType(checker, m, node, depth + 1)).reduce(mergeShapes);
  }
  if (type.isStringLiteral()) return { t: "scalar", values: [type.value] };
  if (type.flags & (ts.TypeFlags.StringLike | ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike)) {
    return { t: "scalar", values: null };
  }
  if (checker.isArrayType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference);
    return { t: "array", item: item ? shapeOfType(checker, item, node, depth + 1) : { t: "any" } };
  }
  if (type.flags & ts.TypeFlags.Object || type.isIntersection()) {
    const props = checker.getPropertiesOfType(type);
    if (props.length === 0) return { t: "map" };
    const out = new Map<string, { optional: boolean; shape: Shape }>();
    for (const prop of props) {
      out.set(prop.name, {
        optional: (prop.flags & ts.SymbolFlags.Optional) !== 0,
        shape: shapeOfType(checker, checker.getTypeOfSymbolAtLocation(prop, node), node, depth + 1)
      });
    }
    return { t: "object", props: out };
  }
  return { t: "any" };
}

function shapeOfSchema(schema: any): Shape {
  if (!schema || typeof schema !== "object" || Object.keys(schema).length === 0) return { t: "any" };
  if (Array.isArray(schema.anyOf)) {
    const nonNull = schema.anyOf.filter((s: any) => s.type !== "null");
    return nonNull.length === 0 ? { t: "scalar", values: null } : nonNull.map(shapeOfSchema).reduce(mergeShapes);
  }
  const types: string[] = Array.isArray(schema.type) ? schema.type.filter((t: string) => t !== "null") : schema.type ? [schema.type] : [];
  if (types[0] === "object" || schema.properties) {
    if (!schema.properties) return { t: "map" };
    const required = new Set<string>(schema.required ?? []);
    const props = new Map<string, { optional: boolean; shape: Shape }>();
    for (const [key, value] of Object.entries<any>(schema.properties)) {
      props.set(key, { optional: !required.has(key), shape: shapeOfSchema(value) });
    }
    return { t: "object", props };
  }
  if (types[0] === "array") return { t: "array", item: shapeOfSchema(schema.items) };
  const values = Array.isArray(schema.enum) ? schema.enum.filter((v: unknown) => typeof v === "string").sort() : [];
  return { t: "scalar", values: values.length > 0 ? values : null };
}

function diffShapes(path: string, app_: Shape, server: Shape, out: string[]): void {
  if (app_.t === "any" || server.t === "any") return;
  if (app_.t !== server.t) {
    out.push(`${path}: la app declara «${app_.t}» y el servidor «${server.t}»`);
    return;
  }
  if (app_.t === "object" && server.t === "object") {
    for (const key of new Set([...app_.props.keys(), ...server.props.keys()])) {
      const a = app_.props.get(key);
      const s = server.props.get(key);
      if (!a) out.push(`${path}.${key}: el servidor lo envía y el tipo de la app NO lo declara`);
      else if (!s) out.push(`${path}.${key}: el tipo de la app lo declara y el servidor NO lo envía`);
      else {
        if (a.optional !== s.optional) out.push(`${path}.${key}: opcional en ${a.optional ? "la app" : "el servidor"} pero no en ${a.optional ? "el servidor" : "la app"}`);
        diffShapes(`${path}.${key}`, a.shape, s.shape, out);
      }
    }
  } else if (app_.t === "array" && server.t === "array") {
    diffShapes(`${path}[]`, app_.item, server.item, out);
  } else if (app_.t === "scalar" && server.t === "scalar" && app_.values && server.values) {
    if (JSON.stringify(app_.values) !== JSON.stringify(server.values)) {
      out.push(`${path}: valores distintos: app=${JSON.stringify(app_.values)} servidor=${JSON.stringify(server.values)}`);
    }
  }
}

const RESPONSE_TYPES: Record<string, string | null> = {
  "GET /v1/ride-requests/:requestId/payment": "RequestPaymentContext",
  "POST /v1/ride-requests/:requestId/payment-intents": "CreatePaymentIntentResponse",
  "GET /v1/payments/:paymentId": "PaymentView",
  "GET /v1/me/payments": "PassengerPaymentsPage",
  "GET /v1/me/payments/passenger-summary": "PassengerPaymentsSummary",
  "GET /v1/me/payments/driver-summary": "DriverPaymentsSummary",
  "GET /v1/me/earnings": "DriverEarningsPage",
  "GET /v1/me/earnings/:bookingId": "DriverEarningDetail",
  "GET /v1/me/payment-methods": "PaymentMethodsResponse",
  "POST /v1/me/payment-methods": "PaymentMethod",
  "DELETE /v1/me/payment-methods/:methodId": "RemovePaymentMethodResponse",
  "GET /v1/me/receipts": "ReceiptsPage",
  "GET /v1/me/receipts/:receiptId": "Receipt",
  "GET /v1/me/receipts/:receiptId/printable": null,
  "GET /v1/me/payouts": "MyPayoutsResponse",
  "GET /v1/me/payouts/:payoutId": "PayoutDetail",
  "GET /v1/bookings/:bookingId/cancellation-preview": "CancellationPreview",
  "POST /v1/bookings/:bookingId/cancel": "CancelBookingResponse",
  "POST /v1/bookings/:bookingId/driver-cancel": "CancelBookingResponse",
  "GET /v1/me/refunds": "MyRefundsPage",
  "GET /v1/plans": "PlansResponse",
  "GET /v1/me/plan": "MyPlanResponse",
  "POST /v1/webhooks/payments": "PaymentWebhookResponse",
  "GET /v1/admin/refund-proposals": "AdminRefundList",
  "GET /v1/admin/refund-proposals/:refundId": "AdminRefundDetail",
  "POST /v1/admin/refund-proposals/:refundId/approve": "AdminRefundItem",
  "POST /v1/admin/refund-proposals/:refundId/reject": "AdminRefundItem",
  "POST /v1/admin/refund-proposals/:refundId/execute": "ExecuteRefundResponse",
  "GET /v1/admin/payout-runs": "AdminPayoutRunList",
  "POST /v1/admin/payout-runs": "GeneratePayoutRunsResponse",
  "POST /v1/admin/payout-runs/:payoutId/execute": "ExecutePayoutRunResponse"
};
const REQUEST_TYPES: Record<string, string> = {
  "POST /v1/ride-requests/:requestId/payment-intents": "CreatePaymentIntentRequest",
  "POST /v1/me/payment-methods": "AddPaymentMethodRequest",
  "POST /v1/bookings/:bookingId/cancel": "CancelBookingRequest",
  "POST /v1/bookings/:bookingId/driver-cancel": "DriverCancelBookingRequest",
  "POST /v1/admin/refund-proposals/:refundId/approve": "ApproveRefundRequest",
  "POST /v1/admin/refund-proposals/:refundId/reject": "RejectRefundRequest",
  "POST /v1/admin/payout-runs": "GeneratePayoutRunsRequest"
};

function loadMobileProgram() {
  const program = ts.createProgram([MOBILE_TYPES_PATH], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    types: [],
    lib: ["lib.es2022.d.ts"]
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(MOBILE_TYPES_PATH)!;
  const exports = checker.getExportsOfModule(checker.getSymbolAtLocation(source)!);
  const typeNamed = (name: string): ts.Type => {
    const symbol = exports.find(e => e.name === name);
    assert.ok(symbol, `la app no exporta el tipo ${name}`);
    return checker.getDeclaredTypeOfSymbol(symbol);
  };
  return { program, checker, source, typeNamed };
}

describe("Contrato: los tipos de la app (mobile/src/api/types/money.ts) coinciden con los schemas del servidor", () => {
  it("el fichero de tipos compila sin errores", () => {
    const { program, source } = loadMobileProgram();
    const diagnostics = ts.getPreEmitDiagnostics(program, source).map(d => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
    assert.deepEqual(diagnostics, []);
  });

  it("cada respuesta y cada cuerpo de petición tiene exactamente las mismas claves, opcionalidad y valores enumerados en la app y en el servidor", async () => {
    const { app: inspected, routes } = await inspectedApp(new DisabledPaymentProvider());
    try {
      const { checker, source, typeNamed } = loadMobileProgram();
      const diffs: string[] = [];
      const covered = new Set<string>();
      for (const route of routes) {
        const key = routeKey(route);
        assert.ok(key in RESPONSE_TYPES, `${key}: falta en la tabla de correspondencias de esta prueba`);
        const typeName = RESPONSE_TYPES[key];
        if (typeName) {
          covered.add(key);
          const successCode = Object.keys(route.schema.response).find(code => code.startsWith("2"))!;
          diffShapes(
            `${key} → ${typeName}`,
            shapeOfType(checker, typeNamed(typeName), source),
            shapeOfSchema(route.schema.response[successCode]),
            diffs
          );
        }
        const requestType = REQUEST_TYPES[key];
        if (requestType) {
          diffShapes(`${key} (cuerpo) → ${requestType}`, shapeOfType(checker, typeNamed(requestType), source), shapeOfSchema(route.schema.body), diffs);
        }
      }
      assert.equal(covered.size, 30, "30 rutas con respuesta JSON (la versión imprimible es HTML)");
      assert.deepEqual(diffs, []);
    } finally {
      await inspected.close();
    }
  });
});

/* ═════════════════════════ Códigos de error y avisos ═════════════════════════ */

describe("Contrato: códigos de error y avisos documentados", () => {
  const BASE_AUTH_CODES = ["AUTH_REQUIRED", "AUTH_INVALID", "AUTH_INVALID_OR_EXPIRED", "ACCOUNT_NOT_ACTIVE", "AUTH_FORBIDDEN"];
  const unionMembers = (name: string): string[] => {
    const block = new RegExp(`export type ${name} =([\\s\\S]*?);`).exec(MOBILE_TYPES);
    assert.ok(block, `no se encuentra ${name}`);
    return [...block[1]!.matchAll(/"([A-Z0-9_]+)"/g)].map(m => m[1]!);
  };
  const mobileCodes = (): string[] => unionMembers("MoneyErrorCode");
  /** Motivos de bloqueo de la vista previa de cancelación: viajan dentro de un 200 (`blocked.code`), no como error HTTP. */
  const blockCodes = (): string[] => unionMembers("CancellationBlockCode");
  const sourceCodes = (): Set<string> =>
    new Set([...MONEY_SOURCE.matchAll(/["']([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)["']/g)].map(m => m[1]!));

  it("todo código de error que emite el módulo está en el documento y en MoneyErrorCode de la app", () => {
    const known = new Set([...mobileCodes(), ...blockCodes()]);
    const missingInDoc = [...sourceCodes()].filter(code => !DOC.includes(code));
    const missingInApp = [...sourceCodes()].filter(code => !known.has(code));
    assert.deepEqual(missingInDoc, [], "códigos sin documentar");
    assert.deepEqual(missingInApp, [], "códigos que la app no conoce");
  });

  it("el catálogo de errores del documento (§1.1) lista exactamente los códigos de MoneyErrorCode, cada uno con su estado HTTP", () => {
    const section = /### 1\.1[\s\S]*?(?=\n## 2\.)/.exec(DOC);
    assert.ok(section, "no se encuentra el catálogo de errores (§1.1) del documento");
    const rows = [...section[0].matchAll(/^\|\s*`([A-Z][A-Z0-9_]+)`\s*\|\s*([0-9, ]+?)\s*\|/gm)].map(m => ({ code: m[1]!, statuses: m[2]! }));
    assert.deepEqual(rows.map(r => r.code).sort(), [...mobileCodes()].sort(), "el catálogo y MoneyErrorCode deben coincidir");
    for (const row of rows) assert.match(row.statuses, /^([1-5][0-9]{2})(, [1-5][0-9]{2})*$/, `${row.code}: estados HTTP`);

    // Cada `new DomainError("CÓDIGO", "mensaje", estado)` literal del código fuente usa un estado que el catálogo recoge.
    const byCode = new Map(rows.map(r => [r.code, r.statuses.split(", ")]));
    const thrown = [...MONEY_SOURCE.matchAll(/new DomainError\(\s*"([A-Z][A-Z0-9_]+)"\s*,\s*("(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)\s*(?:,\s*(\d{3}))?/g)];
    assert.ok(thrown.length >= 40, "el análisis del código fuente encuentra los errores lanzados");
    for (const match of thrown) {
      const status = match[3] ?? "400";
      assert.ok(byCode.get(match[1]!)?.includes(status), `${match[1]} se lanza con ${status} y el catálogo dice ${byCode.get(match[1]!)?.join("/")}`);
    }
  });

  it("los códigos del núcleo de autenticación que puede devolver cualquier ruta están en el documento y en la app", () => {
    const union = new Set(mobileCodes());
    for (const code of BASE_AUTH_CODES) {
      assert.ok(union.has(code), `la app no conoce ${code}`);
      assert.ok(DOC.includes(code), `el documento no menciona ${code}`);
    }
  });

  it("MoneyErrorCode no contiene códigos muertos (que nada emita)", () => {
    const emitted = sourceCodes();
    const dead = mobileCodes().filter(code => !emitted.has(code) && !BASE_AUTH_CODES.includes(code));
    assert.deepEqual(dead, []);
  });

  it("los avisos in-app que emite el módulo son exactamente los de la tabla §13 del documento", () => {
    const emitted = new Set<string>();
    for (const call of MONEY_SOURCE.matchAll(/notify\(/g)) {
      const window = MONEY_SOURCE.slice(call.index, call.index + 700);
      const kindLine = /kind:\s*([^\n]+)/.exec(window);
      if (!kindLine) continue;
      for (const literal of kindLine[1]!.matchAll(/"([a-z][a-z_]+)"/g)) emitted.add(literal[1]!);
    }
    const section = /## 13\.[\s\S]*?(?=\n## 14\.)/.exec(DOC);
    assert.ok(section, "no se encuentra la sección 13 del documento");
    const documented = new Set<string>();
    for (const line of section[0].split("\n").filter(l => l.startsWith("|") && !l.startsWith("|---") && !l.includes("Destinatario"))) {
      const tokens = [...line.matchAll(/`([a-z][a-z_]+)`/g)].map(m => m[1]!);
      for (const kind of tokens.slice(1)) documented.add(kind);
    }
    assert.deepEqual([...emitted].sort(), [...documented].sort());
    assert.ok(emitted.size >= 10);
  });
});

/* ═════════════════════════ Autenticación e Idempotency-Key en todas las rutas ═════════════════════════ */

describe("Contrato: autenticación, Idempotency-Key y sobre de error en todas las rutas", () => {
  async function protectedRoutes(): Promise<RouteInfo[]> {
    const { app: inspected, routes } = await inspectedApp(new DisabledPaymentProvider());
    await inspected.close();
    return routes.filter(route => !PUBLIC_ROUTES.has(routeKey(route)));
  }

  const send = (route: RouteInfo, headers: Record<string, string>, target: FastifyInstance = app) => {
    const body = SAMPLE_BODY[routeKey(route)];
    return target.inject({
      method: route.method as "GET" | "POST" | "DELETE",
      url: urlFor(route),
      headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers },
      ...(body ? { payload: JSON.stringify(body) } : {})
    });
  };

  function assertEnvelope(label: string, response: { statusCode: number; headers: Record<string, unknown>; body: string }, code: string, status: number) {
    assert.equal(response.statusCode, status, `${label}: ${response.body}`);
    const json = JSON.parse(response.body);
    assert.equal(json.error.code, code, label);
    assert.ok(typeof json.error.message === "string" && json.error.message.length > 0, `${label}: mensaje`);
    assert.ok(typeof json.requestId === "string" && json.requestId.length > 0, `${label}: requestId`);
    assert.equal(response.headers["cache-control"], "no-store", `${label}: cache-control`);
  }

  it("sin sesión, con esquema inválido, con token desconocido, caducado, revocado o de cuenta suspendida: ninguna ruta protegida responde datos", async () => {
    const expired = await createActor(pool, "Sesión caducada", ["passenger"]);
    await pool.query(
      `update auth_sessions set created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where user_id=$1`,
      [expired.id]
    );
    const revoked = await createActor(pool, "Sesión revocada", ["passenger"]);
    await pool.query(`update auth_sessions set revoked_at = now() where user_id=$1`, [revoked.id]);
    const suspended = await createActor(pool, "Cuenta suspendida", ["passenger", "finance_admin"]);
    await pool.query(`update app_users set status='suspended' where id=$1`, [suspended.id]);

    const routes = await protectedRoutes();
    assert.equal(routes.length, 29);
    for (const route of routes) {
      const label = routeKey(route);
      assertEnvelope(`${label} sin sesión`, await send(route, {}), "AUTH_REQUIRED", 401);
      assertEnvelope(`${label} esquema Basic`, await send(route, { authorization: "Basic dXNlcjpwYXNz" }), "AUTH_INVALID", 401);
      assertEnvelope(`${label} token sin prefijo`, await send(route, { authorization: "Bearer abc" }), "AUTH_INVALID", 401);
      assertEnvelope(`${label} token desconocido`, await send(route, { authorization: "Bearer mvc_sess_desconocido" }), "AUTH_INVALID_OR_EXPIRED", 401);
      assertEnvelope(`${label} caducada`, await send(route, { authorization: `Bearer ${expired.token}` }), "AUTH_INVALID_OR_EXPIRED", 401);
      assertEnvelope(`${label} revocada`, await send(route, { authorization: `Bearer ${revoked.token}` }), "AUTH_INVALID_OR_EXPIRED", 401);
      assertEnvelope(`${label} suspendida`, await send(route, { authorization: `Bearer ${suspended.token}` }), "ACCOUNT_NOT_ACTIVE", 403);
    }
  });

  it("las operaciones con efectos exigen Idempotency-Key (ausente o mal formada → 400) antes de tocar nada", async () => {
    const routes = (await protectedRoutes()).filter(route => route.schema.headers?.properties?.["idempotency-key"]);
    assert.equal(routes.length, 9);
    const bad = ["", "corta", "con espacios y ¡símbolos!", "x".repeat(129)];
    const rowsBefore = await scalar<string>(pool, `select (select count(*) from idempotency_keys) + (select count(*) from audit_events where action not like 'admin.%')`);
    for (const route of routes) {
      const actor = route.url.startsWith("/v1/admin") ? world.finance : world.miguel;
      const label = routeKey(route);
      assertEnvelope(`${label} sin clave`, await send(route, { authorization: `Bearer ${actor.token}` }), "IDEMPOTENCY_KEY_REQUIRED", 400);
      for (const key of bad.filter(Boolean)) {
        assertEnvelope(`${label} clave «${key.slice(0, 12)}»`, await send(route, { authorization: `Bearer ${actor.token}`, "idempotency-key": key }), "IDEMPOTENCY_KEY_REQUIRED", 400);
      }
    }
    const rowsAfter = await scalar<string>(pool, `select (select count(*) from idempotency_keys) + (select count(*) from audit_events where action not like 'admin.%')`);
    assert.equal(rowsAfter, rowsBefore, "no se guardó nada");
  });

  it("JSON mal formado y tipo de contenido no admitido → 4xx con el sobre de error, nunca 500", async () => {
    const headers = { authorization: `Bearer ${world.miguel.token}`, "idempotency-key": newKey() };
    const malformed = await app.inject({
      method: "POST",
      url: "/v1/me/payment-methods",
      headers: { ...headers, "content-type": "application/json" },
      payload: '{"purpose":'
    });
    assertEnvelope("JSON mal formado", malformed, "VALIDATION_ERROR", 400);
    // text/plain lo admite Fastify por defecto (cuerpo = cadena): el schema del cuerpo lo rechaza como 400.
    const plain = await app.inject({
      method: "POST",
      url: "/v1/me/payment-methods",
      headers: { ...headers, "content-type": "text/plain" },
      payload: "hola"
    });
    assertEnvelope("text/plain", plain, "VALIDATION_ERROR", 400);
    // Un tipo sin analizador (XML) es 415 con el mismo sobre estable.
    const wrongType = await app.inject({
      method: "POST",
      url: "/v1/me/payment-methods",
      headers: { ...headers, "content-type": "application/xml" },
      payload: "<a/>"
    });
    assertEnvelope("application/xml", wrongType, "VALIDATION_ERROR", 415);
  });

  it("los errores de validación detallan la ruta del campo y las respuestas de datos nunca se cachean", async () => {
    const response = await apiCall(app, world.miguel, "POST", "/v1/me/payment-methods", { purpose: "charge" });
    assert.equal(response.response.statusCode, 400);
    assert.equal(response.json.error.code, "VALIDATION_ERROR");
    assert.ok(Array.isArray(response.json.error.details) && response.json.error.details.length >= 1);
    for (const url of ["/v1/plans", "/v1/me/plan", "/v1/me/payments/passenger-summary", "/v1/me/receipts"]) {
      const ok = await apiCall(app, world.miguel, "GET", url);
      assert.equal(ok.response.statusCode, 200, url);
      assert.equal(ok.response.headers["cache-control"], "no-store", url);
    }
  });

  it("los roles de la sesión llegan como texto de Postgres y se normalizan; los valores desconocidos nunca conceden permisos", () => {
    assert.deepEqual(normalizeRoles("{driver,passenger}").sort(), ["driver", "passenger"]);
    assert.deepEqual(normalizeRoles(["admin", "finance_admin"]), ["admin", "finance_admin"]);
    assert.deepEqual(normalizeRoles("{}"), []);
    assert.deepEqual(normalizeRoles("{superadmin,root,admin}"), ["admin"]);
    assert.deepEqual(normalizeRoles(null), []);
    assert.deepEqual(normalizeRoles(undefined), []);
    assert.deepEqual(normalizeRoles(42), []);
    assert.deepEqual(normalizeRoles(['"admin"; drop table x']), []);
  });
});

/* ═════════════════════════ Fidelidad de las respuestas ═════════════════════════ */

describe("Contrato: lo que devuelve el servicio es EXACTAMENTE lo que sale por HTTP (ningún campo se pierde)", () => {
  const principalOf = async (actor: Actor) => {
    const principal = await resolveSession(pool, actor.token);
    return { ...principal, roles: normalizeRoles(principal.roles) };
  };
  const bodies: string[] = [];

  async function same(
    name: string,
    http: ReturnType<typeof apiCall>,
    service: () => Promise<unknown>,
    normalize: (value: any) => any = value => value
  ) {
    const h = await http;
    assert.equal(h.response.statusCode, 200, `${name}: ${h.response.body}`);
    bodies.push(h.response.body);
    const expected = JSON.parse(JSON.stringify(await service()));
    assert.deepEqual(normalize(h.json), normalize(expected), name);
  }
  const withoutCountdown = (value: any) => {
    const copy = JSON.parse(JSON.stringify(value));
    if (copy.hold) copy.hold.secondsRemaining = 0;
    return copy;
  };

  it("escenario completo: pagos, recibos, cobros, liquidaciones, cancelaciones, devoluciones y planes", async () => {
    bodies.length = 0;
    const tariff = await ensureTariff(pool);
    await insertApprovedPolicy(pool, world.admin);

    // métodos de pago
    const card = await apiCall(app, world.miguel, "POST", "/v1/me/payment-methods", { purpose: "charge", providerToken: "tok_card_visa_4242" });
    assert.equal(card.response.statusCode, 201);
    assert.equal((await apiCall(app, world.ana, "POST", "/v1/me/payment-methods", { purpose: "payout", providerToken: "tok_iban_4589" })).response.statusCode, 201);

    // A: pagada, completada en julio y ya abonada (recibo de liquidación)
    const a = await paidBooking(pool, app, world, { passenger: world.miguel });
    await completeTrip(pool, a.tripId, "2026-07-15T10:00:00Z");
    const generated = await apiCall(app, world.finance, "POST", "/v1/admin/payout-runs", { period: "2026-07" });
    assert.equal(generated.response.statusCode, 201, generated.response.body);
    const run = generated.json.created[0];
    assert.equal((await apiCall(app, world.finance, "POST", `/v1/admin/payout-runs/${run.id}/execute`)).response.statusCode, 200);
    assert.equal((await postWebhook(app, [payoutEvent("paid", await providerPayoutRef(pool, run.id), 950)])).statusCode, 200);

    // B: pagada con política aprobada, cancelada con antelación, devolución aprobada por la política y confirmada (recibo de devolución)
    const b = await paidBooking(pool, app, world, { passenger: world.miguel, departureInterval: "10 days" });
    const cancelled = await apiCall(app, world.miguel, "POST", `/v1/bookings/${b.bookingId}/cancel`, { reason: "schedule_change" });
    assert.equal(cancelled.response.statusCode, 200, cancelled.response.body);
    const refundId = cancelled.json.refund.id as string;
    const approved = await apiCall(app, world.finance, "POST", `/v1/admin/refund-proposals/${refundId}/approve`, {});
    assert.equal(approved.response.statusCode, 200, approved.response.body);
    const approvedCents = approved.json.approvedRefund.cents as number;
    assert.ok(approvedCents > 0);
    assert.equal(
      (await postWebhook(app, [refundEvent("succeeded", await providerRefundRef(pool, refundId), b.providerRef, approvedCents)])).statusCode,
      200
    );

    // C: pagada y confirmada (previsualización con política aprobada); D: pago abierto; E: solicitud pagable sin intento
    const c = await paidBooking(pool, app, world, { passenger: world.miguel });
    const dTrip = await seedTrip(pool, world);
    const d = await seedPayableRequest(pool, dTrip, world.miguel, { tariffId: tariff });
    const dIntent = await createIntent(app, world.miguel, d.requestId);
    assert.equal(dIntent.response.statusCode, 201, dIntent.response.body);
    const eTrip = await seedTrip(pool, world);
    const e = await seedPayableRequest(pool, eTrip, world.lucia, { tariffId: tariff });

    // C2: pagada y cancelada por la conductora (reserva con consecuencia sin definir)
    const c2 = await paidBooking(pool, app, world, { passenger: world.lucia });
    assert.equal((await apiCall(app, world.ana, "POST", `/v1/bookings/${c2.bookingId}/driver-cancel`, { reason: "vehicle_issue" })).response.statusCode, 200);

    const miguel = await principalOf(world.miguel);
    const lucia = await principalOf(world.lucia);
    const ana = await principalOf(world.ana);
    const month = await scalar<string>(pool, `select to_char(departure_at at time zone 'Europe/Madrid','YYYY-MM') from trips where id=$1`, [c.tripId]);

    // ── pasajero ──
    await same("passenger-summary", apiCall(app, world.miguel, "GET", `/v1/me/payments/passenger-summary?month=${month}`), () => getPassengerSummary(pool, stub, miguel, month));
    await same("me/payments", apiCall(app, world.miguel, "GET", "/v1/me/payments?limit=50"), () => listPassengerPayments(pool, miguel, { limit: 50 }));
    await same("payment context (pago abierto)", apiCall(app, world.miguel, "GET", `/v1/ride-requests/${d.requestId}/payment`), () => getRequestPaymentContext(pool, stub, miguel, d.requestId), withoutCountdown);
    await same("payment context (pagable)", apiCall(app, world.lucia, "GET", `/v1/ride-requests/${e.requestId}/payment`), () => getRequestPaymentContext(pool, stub, lucia, e.requestId), withoutCountdown);
    await same("payment context (confirmada)", apiCall(app, world.miguel, "GET", `/v1/ride-requests/${c.requestId}/payment`), () => getRequestPaymentContext(pool, stub, miguel, c.requestId), withoutCountdown);
    for (const paymentId of [a.paymentId, b.paymentId, c.paymentId, dIntent.json.payment.id as string]) {
      await same(`payments/${paymentId}`, apiCall(app, world.miguel, "GET", `/v1/payments/${paymentId}`), () => getPaymentForUser(pool, miguel, paymentId));
    }
    await same("payment-methods", apiCall(app, world.miguel, "GET", "/v1/me/payment-methods"), () => listPaymentMethods(pool, stub, miguel, "charge"));
    await same("cancellation-preview (con política)", apiCall(app, world.miguel, "GET", `/v1/bookings/${c.bookingId}/cancellation-preview`), () => getCancellationPreview(pool, miguel, c.bookingId));
    await same("cancellation-preview (ya cancelada)", apiCall(app, world.miguel, "GET", `/v1/bookings/${b.bookingId}/cancellation-preview`), () => getCancellationPreview(pool, miguel, b.bookingId));
    await same("me/refunds", apiCall(app, world.miguel, "GET", "/v1/me/refunds"), () => listMyRefunds(pool, miguel, {}));
    await same("me/refunds (cancelada por la conductora)", apiCall(app, world.lucia, "GET", "/v1/me/refunds"), () => listMyRefunds(pool, lucia, {}));
    const luciaRefunds = await apiCall(app, world.lucia, "GET", "/v1/me/refunds");
    assert.deepEqual(
      (luciaRefunds.json.items as Array<{ bookingId: string; origin: string }>).map(item => [item.bookingId, item.origin]),
      [[c2.bookingId, "driver_cancellation"]]
    );

    // ── recibos ──
    const receipts = await apiCall(app, world.miguel, "GET", "/v1/me/receipts");
    await same("receipts", apiCall(app, world.miguel, "GET", "/v1/me/receipts"), () => listReceipts(pool, miguel, {}));
    assert.equal(receipts.json.items.length, 4, "3 pagos confirmados de Miguel (A, B y C) + 1 recibo de la devolución de B");
    for (const item of receipts.json.items as any[]) {
      await same(`receipt ${item.number}`, apiCall(app, world.miguel, "GET", `/v1/me/receipts/${item.id}`), () => getReceipt(pool, miguel, item.id));
    }
    const statement = await apiCall(app, world.ana, "GET", "/v1/me/receipts?kind=earning_statement");
    assert.equal(statement.json.items.length, 1);
    await same("receipt (liquidación)", apiCall(app, world.ana, "GET", `/v1/me/receipts/${statement.json.items[0].id}`), () => getReceipt(pool, ana, statement.json.items[0].id));

    // ── conductora ──
    await same("driver-summary (julio)", apiCall(app, world.ana, "GET", "/v1/me/payments/driver-summary?month=2026-07"), () => getDriverSummary(pool, stub, ana, "2026-07"));
    await same("driver-summary (mes actual)", apiCall(app, world.ana, "GET", `/v1/me/payments/driver-summary?month=${month}`), () => getDriverSummary(pool, stub, ana, month));
    await same("earnings", apiCall(app, world.ana, "GET", "/v1/me/earnings?limit=50"), () => listDriverEarnings(pool, ana, { limit: 50 }));
    await same("earning (abonado)", apiCall(app, world.ana, "GET", `/v1/me/earnings/${a.bookingId}`), () => getDriverEarning(pool, ana, a.bookingId));
    await same("earning (pendiente)", apiCall(app, world.ana, "GET", `/v1/me/earnings/${c.bookingId}`), () => getDriverEarning(pool, ana, c.bookingId));
    await same("payouts", apiCall(app, world.ana, "GET", "/v1/me/payouts"), () => listMyPayouts(pool, stub, ana, {}));
    await same("payout detail", apiCall(app, world.ana, "GET", `/v1/me/payouts/${run.id}`), () => getMyPayout(pool, ana, run.id));
    await same("payment-methods (cobro)", apiCall(app, world.ana, "GET", "/v1/me/payment-methods?purpose=payout"), () => listPaymentMethods(pool, stub, ana, "payout"));

    // ── finanzas ──
    await same("admin refunds", apiCall(app, world.finance, "GET", "/v1/admin/refund-proposals"), () => listAdminRefunds(pool, { tab: "all", period: "30d" }));
    await same("admin refund detail (ejecutada)", apiCall(app, world.finance, "GET", `/v1/admin/refund-proposals/${refundId}`), () => getAdminRefund(pool, refundId));
    const open = await apiCall(app, world.finance, "GET", "/v1/admin/refund-proposals?tab=cancelled");
    assert.ok(open.json.items.length >= 1, "la cancelación de la conductora figura como consecuencia abierta");
    await same("admin refund detail (abierta)", apiCall(app, world.finance, "GET", `/v1/admin/refund-proposals/${open.json.items[0].id}`), () => getAdminRefund(pool, open.json.items[0].id));
    await same("admin payout-runs", apiCall(app, world.finance, "GET", "/v1/admin/payout-runs"), () => listAdminPayoutRuns(pool, {}));

    // ── planes ──
    await same("plans", apiCall(app, null, "GET", "/v1/plans"), async () => ({ items: await listPlans(pool) }));
    await same("me/plan", apiCall(app, world.miguel, "GET", "/v1/me/plan"), async () => getMyPlan());

    // ── propiedades transversales de TODO lo devuelto ──
    const everything = bodies.join("\n");
    assert.ok(bodies.length >= 30);
    assert.doesNotMatch(everything, /illustrative/, "el backend real nunca emite importes ilustrativos");
    assert.doesNotMatch(everything, /pi_stub|cs_stub|pm_tok|po_stub|re_stub|stubpay/, "ninguna referencia del proveedor sale en las lecturas");
    assert.doesNotMatch(everything, /tok_card|tok_iban/, "los tokens del proveedor nunca se devuelven");
    assert.doesNotMatch(everything, /"(phone|email|iban|pan|cvv)"/i, "ningún dato personal sensible");
    // todo importe es céntimos enteros
    for (const money of everything.matchAll(/"cents":(-?[0-9.]+)/g)) assert.match(money[1]!, /^-?[0-9]+$/, "céntimos enteros");
  });
});
