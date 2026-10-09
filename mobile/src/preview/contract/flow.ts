/**
 * Recorrido de 119 peticiones que se ejecutó UNA vez contra las rutas REALES del backend 0.14 (Fastify + Postgres de
 * prueba + proveedores falsos) y cuyas respuestas están en `real-backend-steps.json`. Aquí se repite, paso a paso,
 * contra el backend en memoria para comprobar que responde igual (estado, código de error, mensaje y forma del cuerpo).
 *
 * Lo que el arnés real hacía con SQL (crear un administrador, dar por analizado el seguro, aprobar la foto de perfil,
 * confirmar el pago) aquí se hace con las mismas funciones de dominio que usan los manejadores: no hay rutas HTTP para
 * ello, ni en el backend real.
 */
import { createSession } from "../core/auth";
import { confirmProviderPayment } from "../domain/requests";
import { recordInsuranceAnalysisResult } from "../domain/documents";
import { createUser } from "../domain/users";
import { sevillaProvince } from "../data/provinces";
import type { PreviewRuntime } from "../runtime";
import { createApi, asRecord, str, type Api } from "../testing/harness";

export interface FlowStep {
  label: string;
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

/** Contraseña del «proveedor SMS falso» del arnés real: acepta solo este código. */
export const FLOW_OTP = "123456";

interface CallOptions {
  token?: string | null | undefined;
  payload?: unknown;
  headers?: Record<string, string>;
}

function query(params: Record<string, string>): string {
  return `?${new URLSearchParams(params).toString()}`;
}

/** Ejecuta el recorrido. El runtime debe estar SIN sembrar (`skipSeed`) y con el visor falso `{ otp: FLOW_OTP }`. */
export async function runRealBackendFlow(runtime: PreviewRuntime): Promise<FlowStep[]> {
  const { db } = runtime;
  const api: Api = createApi(runtime);
  const rawFetch = runtime.createFetch();
  const steps: FlowStep[] = [];

  async function call(label: string, method: string, url: string, options: CallOptions = {}): Promise<{ status: number; body: Record<string, unknown> }> {
    const result = await api(method, url, {
      token: options.token,
      ...(options.payload !== undefined ? { body: options.payload } : {}),
      ...(options.headers ? { headers: options.headers } : {}),
    });
    steps.push({
      label,
      method,
      url,
      status: result.status,
      headers: { "content-type": result.headers["content-type"] ?? "" },
      body: result.body,
    });
    const body = typeof result.body === "object" && result.body !== null && !Array.isArray(result.body) ? (result.body as Record<string, unknown>) : {};
    return { status: result.status, body };
  }

  // La provincia la deja la migración de importación en el backend real; aquí, el sembrado de la provincia.
  db.provinces.insert(sevillaProvince());
  const provinceId = sevillaProvince().id;

  // ---------- Flujo 1: registro de la persona conductora
  let r = await call("start driver", "POST", "/v1/auth/phone/start", { payload: { phone: "+34 600 123 456", roles: ["driver", "passenger"] } });
  const challengeId = str(r.body.challengeId, "challengeId");
  await call("start again (cooldown)", "POST", "/v1/auth/phone/start", { payload: { phone: "+34600123456" } });
  await call("verify wrong", "POST", "/v1/auth/phone/verify", { payload: { challengeId, code: "000000" } });
  r = await call("verify ok", "POST", "/v1/auth/phone/verify", { payload: { challengeId, code: FLOW_OTP } });
  const token = str(r.body.token, "token");
  await call("verify again (used)", "POST", "/v1/auth/phone/verify", { payload: { challengeId, code: FLOW_OTP } });
  await call("verify unknown", "POST", "/v1/auth/phone/verify", { payload: { challengeId: db.ids.uuid(), code: FLOW_OTP } });
  await call("session", "GET", "/v1/auth/session", { token });
  await call("me", "GET", "/me", { token });
  await call("patch profile", "PATCH", "/v1/me/profile", { token, payload: { displayName: "  Ana   García López " } });
  await call("me after", "GET", "/me", { token });
  await call("patch profile short", "PATCH", "/v1/me/profile", { token, payload: { displayName: "A" } });
  r = await call("create vehicle", "POST", "/v1/me/vehicles", { token, payload: { make: "Seat", model: "Arona", plate: "1234 mbc", passengerSeats: 3 } });
  const vehicleId = str(r.body.id, "vehicle id");
  await call("create vehicle dup", "POST", "/v1/me/vehicles", { token, payload: { make: "Seat", model: "Arona", plate: "1234-MBC", passengerSeats: 3 } });
  await call("list vehicles", "GET", "/v1/me/vehicles", { token });
  await call("put vehicle", "PUT", `/v1/me/vehicles/${vehicleId}`, { token, payload: { make: "SEAT", model: "Arona", plate: "1234 MBC", passengerSeats: 3 } });
  await call("put vehicle notfound", "PUT", `/v1/me/vehicles/${db.ids.uuid()}`, { token, payload: { make: "SEAT", model: "Arona", plate: "1234 MBX", passengerSeats: 3 } });
  await call("vehicle bad seats", "POST", "/v1/me/vehicles", { token, payload: { make: "Seat", model: "Arona", plate: "9999 XXX", passengerSeats: 9 } });

  // ---------- Subidas privadas
  await call("intent bad type", "POST", "/v1/me/uploads/intents", { token, payload: { kind: "vehicle_photo", vehicleId, contentType: "application/pdf", sizeBytes: 100 } });
  await call("intent too big", "POST", "/v1/me/uploads/intents", { token, payload: { kind: "vehicle_photo", vehicleId, contentType: "image/jpeg", sizeBytes: 30000000 } });
  r = await call("intent photo", "POST", "/v1/me/uploads/intents", { token, payload: { kind: "vehicle_photo", vehicleId, contentType: "image/jpeg", sizeBytes: 11 } });
  const intentPhoto = str(r.body.intentId, "intentId");
  const photoUpload = { url: str(r.body.uploadUrl, "uploadUrl"), headers: asRecord(r.body.headers, "headers") as Record<string, string> };
  await call("complete photo (not uploaded)", "POST", `/v1/me/uploads/${intentPhoto}/complete`, { token });
  const putPhoto = await rawFetch(photoUpload.url, { method: "PUT", headers: photoUpload.headers, body: new Uint8Array(11) });
  if (!putPhoto.ok) throw new Error(`La subida simulada de la foto falló (${putPhoto.status})`);
  await call("complete photo", "POST", `/v1/me/uploads/${intentPhoto}/complete`, { token });
  await call("complete photo again", "POST", `/v1/me/uploads/${intentPhoto}/complete`, { token });
  r = await call("intent insurance", "POST", "/v1/me/uploads/intents", { token, payload: { kind: "vehicle_insurance", vehicleId, contentType: "application/pdf", sizeBytes: 20 } });
  const intentIns = str(r.body.intentId, "intentId");
  const insUpload = { url: str(r.body.uploadUrl, "uploadUrl"), headers: asRecord(r.body.headers, "headers") as Record<string, string> };
  const putIns = await rawFetch(insUpload.url, { method: "PUT", headers: insUpload.headers, body: new Uint8Array(20) });
  if (!putIns.ok) throw new Error(`La subida simulada del seguro falló (${putIns.status})`);
  r = await call("complete insurance", "POST", `/v1/me/uploads/${intentIns}/complete`, { token });
  const insDoc = str(asRecord(r.body.document, "document").id, "document id");
  await call("list documents", "GET", "/v1/me/documents", { token });
  await call("download doc", "GET", `/v1/me/documents/${insDoc}/download`, { token });
  await call("download doc notfound", "GET", `/v1/me/documents/${db.ids.uuid()}/download`, { token });
  await call("list vehicles after docs", "GET", "/v1/me/vehicles", { token });

  // ---------- Administración
  const admin = createUser(db, { phone: "+34699000001", roles: ["admin"], displayName: "Admin MVC" });
  const adminTok = createSession(db, admin.id, { ttlSeconds: 86_400 }).token;
  await call("review vehicle (forbidden)", "POST", `/v1/admin/vehicles/${vehicleId}/review`, { token, payload: { area: "vehicle", decision: "approved" } });
  await call("review vehicle ok", "POST", `/v1/admin/vehicles/${vehicleId}/review`, { token: adminTok, payload: { area: "vehicle", decision: "approved" } });
  await call("review docs ok", "POST", `/v1/admin/vehicles/${vehicleId}/review`, { token: adminTok, payload: { area: "documentation", decision: "approved" } });
  await call("review reject no reason", "POST", `/v1/admin/vehicles/${vehicleId}/review`, { token: adminTok, payload: { area: "vehicle", decision: "rejected" } });
  await call("review doc insurance no expiry", "POST", `/v1/admin/documents/${insDoc}/review`, { token: adminTok, payload: { decision: "approved" } });
  await call("review doc insurance expired", "POST", `/v1/admin/documents/${insDoc}/review`, { token: adminTok, payload: { decision: "approved", verifiedExpiresOn: "2020-01-01" } });
  recordInsuranceAnalysisResult(db, insDoc, { status: "succeeded", detectedExpiresOn: "2027-06-30", confidence: 0.95, provider: "fake_ocr" });
  await call("review doc insurance ok (OCR simulated by SQL)", "POST", `/v1/admin/documents/${insDoc}/review`, { token: adminTok, payload: { decision: "approved" } });
  const photoDoc = db.documents.find((d) => d.kind === "vehicle_photo");
  if (!photoDoc) throw new Error("No se encontró el documento de la foto");
  await call("review doc photo ok", "POST", `/v1/admin/documents/${photoDoc.id}/review`, { token: adminTok, payload: { decision: "approved" } });
  await call("review doc notfound", "POST", `/v1/admin/documents/${db.ids.uuid()}/review`, { token: adminTok, payload: { decision: "approved" } });
  const driver = db.users.find((u) => u.phone_e164 === "+34600123456");
  if (!driver) throw new Error("No se encontró a la persona conductora");
  db.profiles.update(driver.id, { public_photo_status: "approved", identity_status: "verified" });
  await call("list vehicles approved", "GET", "/v1/me/vehicles", { token });
  await call("list documents approved", "GET", "/v1/me/documents", { token });

  // ---------- Provincias y mapas
  await call("provinces", "GET", "/v1/provinces");
  await call("province resolve ok", "GET", "/v1/provinces/resolve?latitude=37.389&longitude=-5.984");
  await call("province resolve none", "GET", "/v1/provinces/resolve?latitude=37.2614&longitude=-6.9447");
  await call("geocode", "GET", "/v1/maps/geocode?query=Montequinto", { token });
  await call("reverse", "GET", "/v1/maps/reverse?latitude=37.38&longitude=-5.98", { token });

  // ---------- Viajes
  const departureAt = new Date(db.nowMs() + 3_600_000).toISOString();
  await call("trip no auth", "POST", "/v1/me/trips", { payload: {} });
  const tripBody = {
    vehicleId,
    provinceId,
    category: "university",
    leg: "outbound",
    departureAt,
    flexibilityMinutes: 10,
    maxDetourM: 5000,
    offeredSeats: 3,
    origin: { latitude: 37.3256, longitude: -5.9396 },
    destination: { latitude: 37.3796, longitude: -5.9919 },
    intermediates: [{ latitude: 37.2829, longitude: -5.9209 }],
  };
  await call("trip past", "POST", "/v1/me/trips", { token, payload: { ...tripBody, departureAt: "2020-01-01T00:00:00.000Z" } });
  await call("trip seats exceed", "POST", "/v1/me/trips", { token, payload: { ...tripBody, offeredSeats: 4 } });
  await call("trip outside province", "POST", "/v1/me/trips", { token, payload: { ...tripBody, destination: { latitude: 37.2614, longitude: -6.9447 } } });
  r = await call("create trip", "POST", "/v1/me/trips", { token, payload: tripBody });
  const tripId = str(r.body.id, "trip id");
  await call("list trips", "GET", "/v1/me/trips", { token });
  await call("publish trip", "POST", `/v1/me/trips/${tripId}/publish`, { token });
  await call("publish again", "POST", `/v1/me/trips/${tripId}/publish`, { token });
  await call("list trips after", "GET", "/v1/me/trips", { token });

  // ---------- Búsqueda
  const sq = {
    provinceId,
    originLatitude: "37.3256",
    originLongitude: "-5.9396",
    destinationLatitude: "37.3796",
    destinationLongitude: "-5.9919",
  };
  await call("search", "GET", `/v1/trips/search${query(sq)}`);
  await call("search radius", "GET", `/v1/trips/search${query({ ...sq, radiusM: "100", limit: "5" })}`);
  await call("search window bad", "GET", `/v1/trips/search${query({ ...sq, departureAfter: "2030-01-01T00:00:00Z", departureBefore: "2029-01-01T00:00:00Z" })}`);

  // ---------- Persona pasajera
  r = await call("start passenger", "POST", "/v1/auth/phone/start", { payload: { phone: "+34612345678" } });
  r = await call("verify passenger", "POST", "/v1/auth/phone/verify", { payload: { challengeId: str(r.body.challengeId, "challengeId"), code: FLOW_OTP } });
  const pTok = str(r.body.token, "token");
  const pId = str(asRecord(r.body.user, "user").id, "user id");
  await call("passenger session", "GET", "/v1/auth/session", { token: pTok });
  await call("passenger me", "GET", "/me", { token: pTok });
  await call("passenger vehicles (no role needed)", "GET", "/v1/me/vehicles", { token: pTok });
  await call("passenger create vehicle (not driver)", "POST", "/v1/me/vehicles", { token: pTok, payload: { make: "A", model: "B", plate: "ZZ 11", passengerSeats: 2 } });
  await call("request bad range", "POST", `/v1/trips/${tripId}/requests`, { token: pTok, payload: { fromSegmentSeq: 1, toSegmentSeq: 1 } });
  await call("request out of range", "POST", `/v1/trips/${tripId}/requests`, { token: pTok, payload: { fromSegmentSeq: 0, toSegmentSeq: 5 } });
  r = await call("request ok", "POST", `/v1/trips/${tripId}/requests`, { token: pTok, payload: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
  const reqId = str(r.body.id, "request id");
  await call("request dup", "POST", `/v1/trips/${tripId}/requests`, { token: pTok, payload: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
  await call("request own trip (driver)", "POST", `/v1/trips/${tripId}/requests`, { token, payload: { fromSegmentSeq: 0, toSegmentSeq: 2 } });
  await call("my requests", "GET", "/v1/me/ride-requests", { token: pTok });
  await call("trip requests (driver)", "GET", `/v1/trips/${tripId}/requests`, { token });
  await call("trip requests (passenger forbidden)", "GET", `/v1/trips/${tripId}/requests`, { token: pTok });
  await call("decide (passenger forbidden)", "POST", `/v1/ride-requests/${reqId}/decision`, { token: pTok, payload: { decision: "accept" } });
  await call("decide accept", "POST", `/v1/ride-requests/${reqId}/decision`, { token, payload: { decision: "accept" } });
  await call("decide again", "POST", `/v1/ride-requests/${reqId}/decision`, { token, payload: { decision: "accept" } });
  await call("my requests after accept", "GET", "/v1/me/ride-requests", { token: pTok });
  await call("trip requests after", "GET", `/v1/trips/${tripId}/requests`, { token });
  await call("search after hold", "GET", `/v1/trips/search${query(sq)}`);

  // El pago lo confirma el módulo de pagos (no hay ruta HTTP): se llama a la función de dominio.
  const conf = confirmProviderPayment(db, { requestId: reqId, providerPaymentId: `pay_${db.ids.uuid()}`, amountCents: 0 });
  steps.push({ label: "confirmProviderPayment (service)", method: "-", url: "-", status: 0, headers: {}, body: conf });
  if (conf.status !== "confirmed") throw new Error("El pago simulado no confirmó la reserva");
  const bookingId = conf.bookingId;

  await call("my requests confirmed", "GET", "/v1/me/ride-requests", { token: pTok });
  await call("pickup code (trip not live)", "POST", `/v1/bookings/${bookingId}/pickup-code`, { token: pTok });
  await call("location get (not active)", "GET", `/v1/trips/${tripId}/location`);
  await call("live map empty", "GET", `/v1/live/map?provinceId=${provinceId}`);
  await call("start trip (not driver)", "POST", `/v1/me/trips/${tripId}/start`, { token: pTok });
  await call("start trip", "POST", `/v1/me/trips/${tripId}/start`, { token });
  await call("start trip again", "POST", `/v1/me/trips/${tripId}/start`, { token });

  // ---------- Posición en directo
  const eventId = db.ids.uuid();
  const nowIso = (): string => new Date(db.nowMs()).toISOString();
  await call("location post", "POST", `/v1/trips/${tripId}/location`, {
    token,
    payload: { eventId, recordedAt: nowIso(), latitude: 37.3256, longitude: -5.9396, accuracyM: 5, speedMps: 12.5, headingDegrees: 90 },
  });
  await call("location dup", "POST", `/v1/trips/${tripId}/location`, { token, payload: { eventId, recordedAt: nowIso(), latitude: 37.3256, longitude: -5.9396 } });
  await call("location post non-v4 uuid", "POST", `/v1/trips/${tripId}/location`, {
    token,
    payload: { eventId: "00000000-0000-0000-0000-000000000000", recordedAt: nowIso(), latitude: 37.3256, longitude: -5.9396 },
  });
  await call("location future", "POST", `/v1/trips/${tripId}/location`, {
    token,
    payload: { eventId: db.ids.uuid(), recordedAt: new Date(db.nowMs() + 600_000).toISOString(), latitude: 37.3256, longitude: -5.9396 },
  });
  await call("location post (passenger forbidden)", "POST", `/v1/trips/${tripId}/location`, {
    token: pTok,
    payload: { eventId: db.ids.uuid(), recordedAt: nowIso(), latitude: 37.3256, longitude: -5.9396 },
  });
  await call("location get anon", "GET", `/v1/trips/${tripId}/location`);
  await call("location get passenger", "GET", `/v1/trips/${tripId}/location`, { token: pTok });
  await call("location get driver", "GET", `/v1/trips/${tripId}/location`, { token });
  await call("location get notfound", "GET", `/v1/trips/${db.ids.uuid()}/location`);
  await call("live map", "GET", `/v1/live/map?provinceId=${provinceId}`);

  // ---------- Recogida
  r = await call("pickup code", "POST", `/v1/bookings/${bookingId}/pickup-code`, { token: pTok });
  const code = str(r.body.code, "pickup code");
  await call("pickup code (driver forbidden)", "POST", `/v1/bookings/${bookingId}/pickup-code`, { token });
  await call("pickup verify wrong", "POST", `/v1/bookings/${bookingId}/pickup-verify`, { token, payload: { code: code === "111111" ? "222222" : "111111" } });
  await call("pickup verify ok", "POST", `/v1/bookings/${bookingId}/pickup-verify`, { token, payload: { code } });
  await call("pickup verify again", "POST", `/v1/bookings/${bookingId}/pickup-verify`, { token, payload: { code } });

  // ---------- Chat y bloqueos
  const driverId = driver.id;
  const clientMessageId = db.ids.uuid();
  await call("chat send", "POST", `/v1/trips/${tripId}/chat/${driverId}/messages`, { token: pTok, payload: { clientMessageId, body: "  Hola Ana, ya estoy  " } });
  await call("chat send dup", "POST", `/v1/trips/${tripId}/chat/${driverId}/messages`, { token: pTok, payload: { clientMessageId, body: "Hola Ana, ya estoy" } });
  await call("chat send conflict", "POST", `/v1/trips/${tripId}/chat/${driverId}/messages`, { token: pTok, payload: { clientMessageId, body: "Otro texto" } });
  await call("chat reply", "POST", `/v1/trips/${tripId}/chat/${pId}/messages`, { token, payload: { clientMessageId: db.ids.uuid(), body: "Perfecto" } });
  await call("chat list", "GET", `/v1/trips/${tripId}/chat/${driverId}/messages`, { token: pTok });
  await call("chat list limit", "GET", `/v1/trips/${tripId}/chat/${driverId}/messages?limit=1`, { token: pTok });
  await call("chat self", "GET", `/v1/trips/${tripId}/chat/${pId}/messages`, { token: pTok });
  await call("block", "PUT", `/v1/me/blocks/${driverId}`, { token: pTok });
  await call("chat blocked", "GET", `/v1/trips/${tripId}/chat/${driverId}/messages`, { token: pTok });
  await call("unblock", "DELETE", `/v1/me/blocks/${driverId}`, { token: pTok });
  await call("block self", "PUT", `/v1/me/blocks/${pId}`, { token: pTok });
  await call("block unknown", "PUT", `/v1/me/blocks/${db.ids.uuid()}`, { token: pTok });

  // ---------- Fin del viaje y cierre de sesión
  await call("complete trip", "POST", `/v1/me/trips/${tripId}/complete`, { token });
  await call("complete again", "POST", `/v1/me/trips/${tripId}/complete`, { token });
  await call("location get completed", "GET", `/v1/trips/${tripId}/location`);
  await call("my requests final", "GET", "/v1/me/ride-requests", { token: pTok });
  await call("logout", "POST", "/v1/auth/logout", { token: pTok });
  await call("session after logout", "GET", "/v1/auth/session", { token: pTok });
  await call("me after logout", "GET", "/me", { token: pTok });

  return steps;
}
