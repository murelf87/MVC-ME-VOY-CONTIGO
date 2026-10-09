/**
 * Flujo de acceso por teléfono: SMS simulado (visor o aviso de reserva), código, intentos, caducidad, reenvío, sesión y
 * cierre de sesión. Todo por HTTP contra el backend en memoria.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import type { PreviewSms } from "@/platform/previewBridge";
import { getLastSms } from "../providers/sms";
import { SEED_USER_IDS } from "../seeds";
import { asRecord, clearShell, createApi, str, testRuntime, withShell } from "../testing/harness";

function setup() {
  const rt = testRuntime({ profile: "new" });
  return { rt, api: createApi(rt) };
}

async function start(api: ReturnType<typeof createApi>, phone: string, roles?: string[]) {
  return api("POST", "/v1/auth/phone/start", { body: roles ? { phone, roles } : { phone } });
}

afterEach(() => clearShell());

describe("pedir el código", () => {
  it("202 con challengeId y caducidad a los 10 minutos del reloj virtual; el SMS simulado trae el código", async () => {
    const { rt, api } = setup();
    const res = await start(api, "+34 622 111 222");
    assert.equal(res.status, 202);
    const body = asRecord(res.body);
    assert.match(str(body.challengeId), /^[0-9a-f-]{36}$/);
    assert.equal(body.expiresAt, "2026-10-05T05:27:00.000Z", "07:17 + 10 min en Madrid");
    const sms = getLastSms();
    assert.ok(sms);
    assert.match(sms.code, /^[1-9]\d{5}$/);
    assert.equal(sms.phone, "+34622111222", "el número se guarda normalizado");
    assert.equal(rt.db.simSms.size, 1);
  });

  it("entrega el SMS al visor con deliverSms (remitente MVC, cuerpo con el código)", async () => {
    const delivered: Array<Omit<PreviewSms, "id" | "at"> & { id?: string; at?: number }> = [];
    await withShell({ deliverSms: (sms: (typeof delivered)[number]) => void delivered.push(sms) } as never, async () => {
      const { api } = setup();
      await start(api, "+34622111223");
    });
    assert.equal(delivered.length, 1);
    const sms = delivered[0];
    assert.ok(sms);
    assert.equal(sms.to, "+34622111223");
    assert.equal(sms.from, "MVC");
    assert.ok(sms.body.includes(String(sms.code)));
    assert.match(String(sms.code), /^\d{6}$/);
  });

  it("el visor puede fijar el código (automatización)", async () => {
    await withShell({ otp: "424242" } as never, async () => {
      const { api } = setup();
      await start(api, "+34622111224");
      assert.equal(getLastSms()?.code, "424242");
    });
  });

  it("reenviar antes de 60 s es 429 AUTH_RESEND_TOO_SOON; pasado el minuto se crea otro desafío con otro código", async () => {
    const { rt, api } = setup();
    const first = await start(api, "+34622111225");
    const firstCode = getLastSms()?.code;
    const soon = await start(api, "+34622111225");
    assert.equal(soon.status, 429);
    assert.equal(asRecord(asRecord(soon.body).error).code, "AUTH_RESEND_TOO_SOON");
    rt.db.clock.advance(61_000);
    const second = await start(api, "+34622111225");
    assert.equal(second.status, 202);
    assert.notEqual(asRecord(second.body).challengeId, asRecord(first.body).challengeId);
    assert.notEqual(getLastSms()?.code, firstCode);
  });

  it("valida el teléfono (esquema y formato E.164) y los roles", async () => {
    const { api } = setup();
    const short = await start(api, "123");
    assert.equal(short.status, 400);
    assert.equal(asRecord(asRecord(short.body).error).code, "VALIDATION_ERROR");
    const bad = await start(api, "no-es-un-telefono");
    assert.equal(bad.status, 400);
    assert.equal(asRecord(asRecord(bad.body).error).code, "INVALID_PHONE_E164");
    const admin = await start(api, "+34622111226", ["admin"]);
    assert.equal(asRecord(asRecord(admin.body).error).code, "VALIDATION_ERROR");
    const dup = await start(api, "+34622111226", ["driver", "driver"]);
    assert.equal(asRecord(asRecord(dup.body).error).code, "VALIDATION_ERROR");
    const none = await api("POST", "/v1/auth/phone/start", { body: { phone: "+34622111226", roles: [] } });
    assert.equal(asRecord(asRecord(none.body).error).code, "VALIDATION_ERROR");
  });
});

describe("verificar el código", () => {
  it("código correcto: token mvc_sess_…, usuario y roles pedidos; el token abre /v1/auth/session y /me", async () => {
    const { api } = setup();
    const challenge = await start(api, "+34622111230", ["passenger", "driver"]);
    const code = getLastSms()?.code ?? "";
    const verified = await api("POST", "/v1/auth/phone/verify", { body: { challengeId: asRecord(challenge.body).challengeId, code } });
    assert.equal(verified.status, 200);
    const body = asRecord(verified.body);
    assert.match(str(body.token), /^mvc_sess_[A-Za-z0-9_-]{43}$/);
    assert.equal(body.expiresAt, "2026-11-04T05:17:00.000Z", "30 días después (en UTC)");
    const user = asRecord(body.user);
    assert.deepEqual(user.roles, ["passenger", "driver"]);

    const session = await api("GET", "/v1/auth/session", { token: str(body.token) });
    assert.equal(session.status, 200);
    assert.equal(asRecord(asRecord(session.body).user).id, user.id);

    const me = asRecord((await api("GET", "/me", { token: str(body.token) })).body);
    assert.equal(me.phone_e164, "+34622111230");
    assert.equal(me.display_name, null);
    assert.deepEqual(me.roles, ["passenger", "driver"]);
  });

  it("código incorrecto: 401 AUTH_CODE_INVALID_OR_EXPIRED; tras 5 intentos fallidos, 429 aunque el código sea el bueno", async () => {
    const { api } = setup();
    const challenge = await start(api, "+34622111231");
    const code = getLastSms()?.code ?? "";
    const challengeId = asRecord(challenge.body).challengeId;
    for (let i = 0; i < 5; i += 1) {
      const wrong = await api("POST", "/v1/auth/phone/verify", { body: { challengeId, code: "000000" } });
      assert.equal(wrong.status, 401, `intento ${i + 1}`);
      assert.equal(asRecord(asRecord(wrong.body).error).code, "AUTH_CODE_INVALID_OR_EXPIRED");
    }
    const locked = await api("POST", "/v1/auth/phone/verify", { body: { challengeId, code } });
    assert.equal(locked.status, 429);
    assert.equal(asRecord(asRecord(locked.body).error).code, "AUTH_TOO_MANY_ATTEMPTS");
  });

  it("un desafío usado no se puede reutilizar (409) y uno desconocido es 404", async () => {
    const { api } = setup();
    const challenge = await start(api, "+34622111232");
    const code = getLastSms()?.code ?? "";
    const challengeId = asRecord(challenge.body).challengeId;
    assert.equal((await api("POST", "/v1/auth/phone/verify", { body: { challengeId, code } })).status, 200);
    const again = await api("POST", "/v1/auth/phone/verify", { body: { challengeId, code } });
    assert.equal(again.status, 409);
    assert.equal(asRecord(asRecord(again.body).error).code, "AUTH_CHALLENGE_ALREADY_USED");
    const unknown = await api("POST", "/v1/auth/phone/verify", {
      body: { challengeId: "11111111-1111-4111-8111-111111111111", code: "123456" },
    });
    assert.equal(unknown.status, 404);
    assert.equal(asRecord(asRecord(unknown.body).error).code, "AUTH_CHALLENGE_NOT_FOUND");
  });

  it("pasados 10 minutos el desafío caduca (reloj virtual) y el código bueno ya no vale", async () => {
    const { rt, api } = setup();
    const challenge = await start(api, "+34622111233");
    const code = getLastSms()?.code ?? "";
    rt.db.clock.advance(601_000);
    const late = await api("POST", "/v1/auth/phone/verify", { body: { challengeId: asRecord(challenge.body).challengeId, code } });
    assert.equal(late.status, 401);
    assert.equal(asRecord(asRecord(late.body).error).code, "AUTH_CODE_INVALID_OR_EXPIRED");
    assert.equal(rt.db.challenges.all().at(-1)?.status, "expired");
  });

  it("validación del cuerpo: challengeId uuid y código de 4 a 10 caracteres", async () => {
    const { api } = setup();
    const badId = await api("POST", "/v1/auth/phone/verify", { body: { challengeId: "x", code: "123456" } });
    assert.equal(asRecord(asRecord(badId.body).error).code, "VALIDATION_ERROR");
    const shortCode = await api("POST", "/v1/auth/phone/verify", {
      body: { challengeId: "11111111-1111-4111-8111-111111111111", code: "12" },
    });
    assert.equal(asRecord(asRecord(shortCode.body).error).code, "VALIDATION_ERROR");
  });

  it("una persona que ya existe (Miguel Torres) entra con su mismo id y conserva su perfil", async () => {
    const { api } = setup();
    const challenge = await start(api, "+34611000102");
    const code = getLastSms()?.code ?? "";
    const verified = asRecord(
      (await api("POST", "/v1/auth/phone/verify", { body: { challengeId: asRecord(challenge.body).challengeId, code } })).body
    );
    assert.equal(asRecord(verified.user).id, SEED_USER_IDS.miguel);
    const me = asRecord((await api("GET", "/me", { token: str(verified.token) })).body);
    assert.equal(me.display_name, "Miguel Torres");
    assert.deepEqual(me.roles, ["passenger"], "/me devuelve los roles reales aunque la verificación devuelva los pedidos");
  });
});

describe("sesión y cierre de sesión", () => {
  async function login(api: ReturnType<typeof createApi>, phone: string): Promise<string> {
    const challenge = await start(api, phone);
    const code = getLastSms()?.code ?? "";
    const verified = await api("POST", "/v1/auth/phone/verify", { body: { challengeId: asRecord(challenge.body).challengeId, code } });
    return str(asRecord(verified.body).token);
  }

  it("logout devuelve 204 y revoca ese token; los demás de la misma persona siguen valiendo", async () => {
    const { rt, api } = setup();
    const a = await login(api, "+34622111240");
    rt.db.clock.advance(61_000);
    const b = await login(api, "+34622111240");
    assert.notEqual(a, b);
    const out = await api("POST", "/v1/auth/logout", { token: a });
    assert.equal(out.status, 204);
    assert.equal((await api("GET", "/me", { token: a })).status, 401);
    assert.equal((await api("GET", "/me", { token: b })).status, 200);
  });

  it("logout sin token es 401 AUTH_REQUIRED y con un token desconocido no revela nada (204 o 401 estable)", async () => {
    const { api } = setup();
    const none = await api("POST", "/v1/auth/logout");
    assert.equal(none.status, 401);
    assert.equal(asRecord(asRecord(none.body).error).code, "AUTH_REQUIRED");
  });

  it("la sesión caduca a los 30 días del reloj virtual", async () => {
    const { rt, api } = setup();
    const token = await login(api, "+34622111241");
    rt.db.clock.advance(29 * 86_400_000);
    assert.equal((await api("GET", "/me", { token })).status, 200);
    rt.db.clock.advance(2 * 86_400_000);
    const expired = await api("GET", "/me", { token });
    assert.equal(expired.status, 401);
    assert.equal(asRecord(asRecord(expired.body).error).code, "AUTH_INVALID_OR_EXPIRED");
  });

  it("el perfil sembrado de cada perfil de prueba abre sesión con su token determinista", async () => {
    for (const profile of ["passenger", "driver", "admin"] as const) {
      const rt = testRuntime({ profile });
      const api = createApi(rt);
      const me = asRecord((await api("GET", "/me", { token: rt.sessionToken() })).body);
      assert.equal(me.status, "active");
      assert.ok(Array.isArray(me.roles) && me.roles.length > 0);
    }
    const guest = testRuntime({ profile: "new" });
    assert.equal(guest.sessionToken(), null);
  });
});
