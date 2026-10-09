import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ApiError,
  AuthExpiredError,
  OfflineError,
  TimeoutError,
  describeError,
  errorMessage,
  isAbortError,
  isApiError,
  isApiErrorWithCode,
  isAuthExpiredError,
  isAuthRequiredError,
  isRequestError,
  registerErrorMessages,
} from "./errors";

describe("type guards", () => {
  it("distinguen las cuatro clases y no se confunden", () => {
    const api = new ApiError("m", "X", 400);
    const offline = new OfflineError();
    const timeout = new TimeoutError(100);
    const expired = new AuthExpiredError();
    assert.ok(isApiError(api) && !isApiError(offline) && !isApiError(expired));
    assert.ok(isAuthExpiredError(expired) && !isAuthExpiredError(api));
    for (const error of [api, offline, timeout, expired]) assert.ok(isRequestError(error));
    assert.ok(!isRequestError(new Error("x")));
    assert.ok(!isRequestError(null));
  });
  it("instanceof funciona con las subclases de Error", () => {
    assert.ok(new ApiError("m", "X", 400) instanceof ApiError);
    assert.ok(new ApiError("m", "X", 400) instanceof Error);
    assert.ok(new OfflineError() instanceof OfflineError);
  });
  it("isAbortError reconoce AbortError nativo o simulado", () => {
    const abort = new Error("x");
    abort.name = "AbortError";
    assert.ok(isAbortError(abort));
    assert.ok(!isAbortError(new Error("x")));
    assert.ok(!isAbortError(undefined));
  });
  it("isApiErrorWithCode / isAuthRequiredError", () => {
    const error = new ApiError("m", "NO_CAPACITY_ON_SEGMENT", 409);
    assert.ok(isApiErrorWithCode(error, "A", "NO_CAPACITY_ON_SEGMENT"));
    assert.ok(!isApiErrorWithCode(error, "OTHER"));
    assert.ok(isAuthRequiredError(new ApiError("m", "AUTH_REQUIRED", 401)));
    assert.ok(!isAuthRequiredError(new AuthExpiredError()));
  });
});

describe("describeError (siempre en español)", () => {
  it("sin conexión y timeout son reintentables", () => {
    const offline = describeError(new OfflineError());
    assert.equal(offline.kind, "offline");
    assert.equal(offline.title, "Sin conexión");
    assert.equal(offline.retryable, true);
    const timeout = describeError(new TimeoutError(15000));
    assert.equal(timeout.kind, "timeout");
    assert.equal(timeout.retryable, true);
  });
  it("sesión caducada no es reintentable", () => {
    const description = describeError(new AuthExpiredError("AUTH_INVALID", "r1"));
    assert.equal(description.kind, "auth_expired");
    assert.equal(description.retryable, false);
    assert.equal(description.requestId, "r1");
  });
  it("códigos conocidos usan el texto literal del diseño", () => {
    const seats = describeError(new ApiError("No capacity", "NO_CAPACITY_ON_SEGMENT", 409));
    assert.equal(seats.title, "No hay plazas");
    assert.equal(seats.message, "En este momento no hay plazas disponibles para esta ruta.");
    assert.equal(errorMessage(new ApiError("bad", "AUTH_CODE_INVALID_OR_EXPIRED", 401)), "Código incorrecto: inténtalo de nuevo.");
  });
  it("códigos desconocidos caen al mensaje por estado y nunca muestran inglés del servidor", () => {
    const d500 = describeError(new ApiError("Internal server error", "SOMETHING_NEW", 500, undefined, "rid"));
    assert.equal(d500.retryable, true);
    assert.ok(!d500.message.includes("Internal"));
    assert.equal(d500.requestId, "rid");
    const d404 = describeError(new ApiError("Trip not found", "TRIP_NOT_FOUND_X", 404));
    assert.equal(d404.message, "No hemos encontrado lo que buscas.");
    assert.equal(d404.retryable, false);
    const d429 = describeError(new ApiError("Rate limit", "RATE_LIMITED", 429));
    assert.equal(d429.retryable, true);
  });
  it("errores no tipados → mensaje genérico", () => {
    const d = describeError(new Error("boom"));
    assert.equal(d.kind, "unknown");
    assert.equal(d.message, "Ha ocurrido un error inesperado. Inténtalo de nuevo.");
    assert.equal(describeError("texto").kind, "unknown");
  });
  it("registerErrorMessages amplía y sobrescribe el catálogo", () => {
    registerErrorMessages({ MI_CODIGO_NUEVO: { title: "Título", message: "Mensaje propio" }, OTRO_NUEVO: "Solo texto" });
    const d = describeError(new ApiError("english", "MI_CODIGO_NUEVO", 422));
    assert.equal(d.title, "Título");
    assert.equal(d.message, "Mensaje propio");
    assert.equal(errorMessage(new ApiError("english", "OTRO_NUEVO", 422)), "Solo texto");
  });
});
