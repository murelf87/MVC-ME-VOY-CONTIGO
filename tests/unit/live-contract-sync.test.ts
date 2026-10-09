import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import Fastify from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../../src/config.js";
import { registerLiveModule } from "../../src/modules/live/index.js";
import type { ModuleDeps } from "../../src/modules/register.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** El cuerpo del contrato del backend debe ser idéntico al de la app (mobile/src/api/types/live.ts). */
test("live: src/modules/live/types.ts es espejo exacto del contrato móvil", () => {
  const mobile = readFileSync(path.join(root, "mobile/src/api/types/live.ts"), "utf8");
  const backend = readFileSync(path.join(root, "src/modules/live/types.ts"), "utf8");
  const mobileMarker = '} from "./common";\n';
  const mobileBody = mobile.slice(mobile.indexOf(mobileMarker) + mobileMarker.length);
  const backendMarker = "// @@CONTRACT-BODY@@\n";
  const backendBody = backend.slice(backend.indexOf(backendMarker) + backendMarker.length);
  assert.ok(mobileBody.length > 5000, "cuerpo móvil no encontrado");
  assert.equal(backendBody, mobileBody);
});

/** Las rutas registradas deben ser exactamente las del índice de docs/contracts/live.md (§1). */
test("live: los endpoints registrados coinciden con el índice de docs/contracts/live.md", async () => {
  const doc = readFileSync(path.join(root, "docs/contracts/live.md"), "utf8");
  const section = doc.slice(doc.indexOf("## 1. Índice de endpoints"), doc.indexOf("## 2. Máquinas de estado"));
  const documented = [...section.matchAll(/^\|\s*(GET|POST|PUT|DELETE)\s*\|\s*`([^`]+)`/gm)]
    .map(match => `${match[1]} ${match[2]}`)
    .sort();
  assert.ok(documented.length >= 20, "no se leyó el índice de endpoints");

  const app = Fastify({ logger: false });
  await app.register(rateLimit, { max: 1000, timeWindow: "1 minute" });
  await app.register(swagger, {
    openapi: {
      info: { title: "live", version: "0" },
      components: { securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } } }
    }
  });
  const deps: ModuleDeps = {
    pool: {} as Pool, config: {} as AppConfig, privateStorage: null, routeProvider: null, geocodingProvider: null
  };
  await registerLiveModule(app, deps);
  await app.ready();
  const spec = app.swagger() as unknown as { paths: Record<string, Record<string, unknown>> };
  const registered = Object.entries(spec.paths)
    .flatMap(([route, methods]) => Object.keys(methods).map(method => `${method.toUpperCase()} ${route}`))
    .sort();
  await app.close();

  assert.deepEqual(registered, documented);
});

/** Los códigos de error del contrato y los que emite el módulo deben ser los mismos. */
test("live: cada código de error documentado existe en el código y cada código emitido está documentado", () => {
  const doc = readFileSync(path.join(root, "docs/contracts/live.md"), "utf8");
  const names = ["route-change-service", "feedback-service", "share-service", "console-service", "passenger-service", "booking-context", "routes", "http"];
  const sources = names.map(name => readFileSync(path.join(root, `src/modules/live/${name}.ts`), "utf8")).join("\n");

  const documented = [...new Set([...doc.matchAll(/`((?:[A-Z][A-Z0-9]+_)+[A-Z0-9]+)`/g)].map(match => match[1]!))]
    // Variables de entorno (LIVE_*, PUBLIC_*, MAPS_PROVIDER, PRIVATE_STORAGE_PROVIDER) y códigos de otros módulos documentados como contexto.
    .filter(code => !/^(AUTH_|PICKUP_|LIVE_|PUBLIC_|MAPS_PROVIDER$|PRIVATE_STORAGE_PROVIDER$|PROVINCE_|QUOTE_)/.test(code));
  const notEmitted = documented.filter(code => !sources.includes(`"${code}"`));
  assert.deepEqual(notEmitted, [], "códigos documentados que ningún fichero del módulo emite");

  const emitted = [...new Set([...sources.matchAll(/DomainError\(\s*"([A-Z][A-Z0-9_]+)"/g)].map(match => match[1]!))];
  assert.ok(emitted.length >= 40, "no se leyeron los códigos emitidos");
  const notDocumented = emitted.filter(code => !doc.includes(code));
  // Errores internos de integridad que no forman parte del contrato con la app.
  assert.deepEqual(notDocumented.filter(code => !["USER_NOT_FOUND", "VEHICLE_NOT_FOUND"].includes(code)), [], "códigos emitidos sin documentar");
});
