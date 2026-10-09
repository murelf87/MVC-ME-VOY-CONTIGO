// Pruebas de la traducción de errores a texto del conductor (driver-ops).
// Ejecutar:  cd mobile && node --import tsx --test "src/features/driver/**/*.test.ts"
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { opsErrorView, type GenericErrorDescription } from "./errors";

function api(code: string, status: number, details?: unknown): { error: unknown; base: GenericErrorDescription } {
  const error = { kind: "api", code, status, details };
  const base: GenericErrorDescription = {
    kind: "api",
    title: "Genérico",
    message: "Texto genérico.",
    code,
    status,
    requestId: "req-1",
    retryable: status >= 500 || status === 429,
  };
  return { error, base };
}

const view = (code: string, status: number, details?: unknown) => {
  const { error, base } = api(code, status, details);
  return opsErrorView(error, base);
};

describe("sin red y tiempo agotado", () => {
  it("se pueden reintentar", () => {
    const offline = opsErrorView({ kind: "offline" }, { kind: "offline", title: "Sin conexión", message: "Sin red.", code: "OFFLINE", status: null, requestId: null, retryable: true });
    assert.equal(offline.kind, "offline");
    assert.equal(offline.retryable, true);
    assert.equal(offline.action, "retry");
    const timeout = opsErrorView({ kind: "timeout" }, { kind: "timeout", title: "Tarda", message: "Tarda.", code: "TIMEOUT", status: null, requestId: null, retryable: true });
    assert.equal(timeout.kind, "timeout");
  });
});

describe("iniciar el viaje: vehículo en regla", () => {
  it("falta la foto → acción para arreglar el vehículo", () => {
    const v = view("VEHICLE_PHOTO_REQUIRED", 409);
    assert.equal(v.action, "fixVehicle");
    assert.equal(v.vehicleIssue, "photo");
    assert.equal(v.actionLabel, "Añadir foto del vehículo");
    assert.equal(v.retryable, false);
  });
  it("seguro caducado: dice cuándo caducó", () => {
    const v = view("VEHICLE_INSURANCE_EXPIRED", 409, { expiresOn: "2026-09-01" });
    assert.equal(v.vehicleIssue, "insuranceExpired");
    assert.match(v.message, /caducó el 1 sept 2026|caducó el 1 sep 2026|caducó el/);
  });
  it("seguro sin fecha de vencimiento y seguro ausente", () => {
    assert.equal(view("VEHICLE_INSURANCE_EXPIRY_REQUIRED", 409).vehicleIssue, "insuranceExpiry");
    assert.equal(view("VEHICLE_INSURANCE_REQUIRED", 409).vehicleIssue, "insurance");
  });
  it("el viaje ya no se puede iniciar → actualizar", () => {
    const v = view("TRIP_NOT_STARTABLE", 409);
    assert.equal(v.action, "refresh");
    assert.equal(v.kind, "conflict");
  });
});

describe("código de recogida", () => {
  it("código equivocado: texto de la lámina e intentos", () => {
    const v = view("PICKUP_CODE_INVALID", 401, { attempts: 2, maxAttempts: 5 });
    assert.equal(v.message, "Código incorrecto: inténtalo de nuevo.");
    assert.deepEqual(v.attempts, { used: 2, max: 5, remaining: 3 });
    assert.equal(v.kind, "validation");
  });
  it("intentos agotados: bloqueado y sin reintento", () => {
    const v = view("PICKUP_ATTEMPTS_EXCEEDED", 429);
    assert.equal(v.kind, "locked");
    assert.equal(v.retryable, false);
  });
  it("sin código generado, viaje parado, reserva no elegible", () => {
    assert.equal(view("PICKUP_CODE_NOT_GENERATED", 409).title, "Aún no hay código");
    assert.equal(view("TRIP_NOT_LIVE", 409).action, "openConsole");
    assert.equal(view("BOOKING_NOT_PICKUP_ELIGIBLE", 409).title, "Esta reserva ya no admite recogida");
  });
});

describe("cambio de ruta", () => {
  it("desvío demasiado grande: usa los números del servidor", () => {
    const v = view("ROUTE_CHANGE_DETOUR_TOO_LARGE", 422, { addedDistanceM: 4200, maxDetourM: 3000 });
    assert.deepEqual(v.detour, { addedDistanceM: 4200, maxDetourM: 3000 });
    assert.match(v.message, /4,2.km/);
    assert.match(v.message, /3.km/);
  });
  it("desvío sin detalles: texto general", () => {
    const v = view("ROUTE_CHANGE_DETOUR_TOO_LARGE", 422);
    assert.equal(v.detour, null);
    assert.equal(v.message, "Esa parada supera el desvío máximo de tu viaje.");
  });
  it("ya hay una propuesta; proveedor de mapas caído se puede reintentar", () => {
    assert.equal(view("ROUTE_CHANGE_ALREADY_PENDING", 409).title, "Ya hay una propuesta pendiente");
    const maps = view("MAPS_PROVIDER_UNAVAILABLE", 503);
    assert.equal(maps.retryable, true);
    assert.equal(maps.action, "retry");
  });
});

describe("lo desconocido cae al texto genérico", () => {
  it("5xx se puede reintentar; 404 desconocido no", () => {
    const server = view("ALGO_RARO", 500);
    assert.equal(server.title, "Genérico");
    assert.equal(server.retryable, true);
    assert.equal(server.action, "retry");
    const notFound = view("OTRA_COSA", 404);
    assert.equal(notFound.kind, "notFound");
    assert.equal(notFound.action, "none");
  });
  it("un error que no es de la API", () => {
    const v = opsErrorView(new Error("x"), { kind: "unknown", title: "Algo", message: "Algo salió mal.", code: null, status: null, requestId: null, retryable: true });
    assert.equal(v.kind, "unknown");
    assert.equal(v.code, null);
  });
  it("conserva el identificador de la petición", () => {
    assert.equal(view("TRIP_NOT_OWNED", 403).requestId, "req-1");
    assert.equal(view("TRIP_NOT_OWNED", 403).kind, "forbidden");
  });
});
