import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** El cuerpo del contrato del backend debe ser idéntico al de la app (mobile/src/api/types/trips.ts). */
test("trips: src/modules/trips/types.ts es espejo exacto del contrato móvil", () => {
  const mobile = readFileSync(path.join(root, "mobile/src/api/types/trips.ts"), "utf8");
  const backend = readFileSync(path.join(root, "src/modules/trips/types.ts"), "utf8");
  const mobileMarker = '} from "./common";\n';
  const mobileBody = mobile.slice(mobile.indexOf(mobileMarker) + mobileMarker.length);
  const backendMarker = "// @@CONTRACT-BODY@@\n";
  const backendBody = backend.slice(backend.indexOf(backendMarker) + backendMarker.length);
  assert.ok(mobileBody.length > 1000, "cuerpo móvil no encontrado");
  assert.equal(backendBody, mobileBody);
});
