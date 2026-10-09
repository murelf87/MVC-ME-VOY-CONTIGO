import test from "node:test";
import assert from "node:assert/strict";
import { DomainError } from "../../src/errors.js";
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  iso,
  isoOrNull,
  maskPhone,
  moneyIllustrative,
  nameParts,
  sliceOverflow,
  trustError
} from "../../src/modules/trust/common.js";

const UUID = "3f6c1d4e-8a52-4c2b-9b1e-6d0a7e5c1a01";

test("trust/common: trustError devuelve un DomainError con código, estado y detalles", () => {
  const error = trustError("TARIFF_INVALID", "No válido", 422, { fields: [] });
  assert.ok(error instanceof DomainError);
  assert.equal(error.code, "TARIFF_INVALID");
  assert.equal(error.statusCode, 422);
  assert.deepEqual(error.details, { fields: [] });
  assert.equal(trustError("X_Y", "m").statusCode, 400);
});

test("trust/common: nameParts usa «Usuario» cuando no hay nombre y normaliza espacios", () => {
  assert.deepEqual(nameParts(null), { displayName: "Usuario", firstName: "Usuario" });
  assert.deepEqual(nameParts(undefined), { displayName: "Usuario", firstName: "Usuario" });
  assert.deepEqual(nameParts("   "), { displayName: "Usuario", firstName: "Usuario" });
  assert.deepEqual(nameParts("  Ana   López  "), { displayName: "Ana López", firstName: "Ana" });
  assert.deepEqual(nameParts("Miguel"), { displayName: "Miguel", firstName: "Miguel" });
});

test("trust/common: maskPhone enseña el prefijo del país y solo los 3 últimos dígitos", () => {
  const cases: Array<[string, string]> = [
    ["+34600111222", "+34 ••• ••• 222"], // España
    ["+351912345678", "+351 ••• ••• 678"], // Portugal (3 dígitos)
    ["+14155550123", "+1 ••• ••• 123"], // EE. UU. (1 dígito)
    ["+79123456789", "+7 ••• ••• 789"], // Rusia (1 dígito)
    ["+447911123456", "+44 ••• ••• 456"], // Reino Unido
    ["+5215512345678", "+52 ••• ••• 678"], // México
    ["+593987654321", "+593 ••• ••• 321"], // Ecuador (3 dígitos)
    ["+971501234567", "+971 ••• ••• 567"], // Emiratos (3 dígitos)
    ["+886912345678", "+886 ••• ••• 678"], // Taiwán (3 dígitos)
    ["+27821234567", "+27 ••• ••• 567"], // Sudáfrica (2 dígitos)
    ["+212612345678", "+212 ••• ••• 678"], // Marruecos (3 dígitos)
    ["+8613812345678", "+86 ••• ••• 678"] // China
  ];
  for (const [input, expected] of cases) assert.equal(maskPhone(input), expected, input);
});

test("trust/common: maskPhone no enseña el resto del número y es seguro con entradas raras", () => {
  assert.equal(maskPhone(null), null);
  assert.equal(maskPhone(undefined), null);
  assert.equal(maskPhone(""), null);
  for (const input of ["600111222", "+34 600 111 222", "abc", "+0123456789", "+3412", "+34600111222; drop table"]) {
    assert.equal(maskPhone(input), "••• ••• •••", input);
  }
  // Con un número nacional corto no hay últimos dígitos que enseñar.
  assert.equal(maskPhone("+35312345"), "+353 ••• •••");
  const masked = maskPhone("+34600111222") ?? "";
  assert.doesNotMatch(masked, /600|111/);
  assert.equal((masked.match(/\d/g) ?? []).length, 5); // 34 + 222
});

test("trust/common: iso e isoOrNull normalizan fechas", () => {
  assert.equal(iso(new Date("2026-10-09T13:41:00Z")), "2026-10-09T13:41:00.000Z");
  assert.equal(iso("2026-10-09T15:41:00+02:00"), "2026-10-09T13:41:00.000Z");
  assert.equal(isoOrNull(null), null);
  assert.equal(isoOrNull(undefined), null);
  assert.equal(isoOrNull(new Date("2026-10-09T13:41:00Z")), "2026-10-09T13:41:00.000Z");
});

test("trust/common: moneyIllustrative solo admite céntimos enteros y marca el importe como ilustrativo", () => {
  assert.deepEqual(moneyIllustrative(324), { cents: 324, currency: "EUR", status: "illustrative" });
  assert.deepEqual(moneyIllustrative(0), { cents: 0, currency: "EUR", status: "illustrative" });
  assert.throws(() => moneyIllustrative(3.24), /integer cents/);
});

test("trust/common: el cursor es opaco (base64url de un JSON) y vuelve idéntico", () => {
  const payload = { t: "2026-10-09T13:41:00.000Z", id: UUID };
  const cursor = encodeCursor(payload);
  assert.match(cursor, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")), payload);
  assert.deepEqual(decodeCursor(cursor, { t: "iso", id: "uuid" }), payload);
  assert.deepEqual(decodeCursor(encodeCursor({ v: 3 }), { v: "number" }), { v: 3 });
  assert.deepEqual(decodeCursor(encodeCursor({ id: "10482" }), { id: "bigint" }), { id: "10482" });
});

function rejectsCursor(raw: string, shape: Parameters<typeof decodeCursor>[1]) {
  assert.throws(
    () => decodeCursor(raw, shape),
    (error: unknown) => error instanceof DomainError && error.code === "CURSOR_INVALID" && error.statusCode === 400
  );
}

test("trust/common: un cursor manipulado responde 400 CURSOR_INVALID", () => {
  const good = { t: "iso", id: "uuid" } as const;
  rejectsCursor("!!!no-es-base64!!!", good);
  rejectsCursor("", good);
  rejectsCursor(Buffer.from("no es json").toString("base64url"), good);
  rejectsCursor(Buffer.from("[1,2]").toString("base64url"), good);
  rejectsCursor(Buffer.from("null").toString("base64url"), good);
  rejectsCursor(encodeCursor({ t: "2026-10-09T13:41:00.000Z" }), good); // falta id
  rejectsCursor(encodeCursor({ t: "ayer", id: UUID }), good); // fecha inválida
  rejectsCursor(encodeCursor({ t: "2026-10-09T13:41:00.000Z", id: "no-uuid" }), good);
  rejectsCursor(encodeCursor({ v: "3" }), { v: "number" }); // número como texto
  rejectsCursor(encodeCursor({ id: "abc" }), { id: "bigint" });
  rejectsCursor(encodeCursor({ id: "1".repeat(19) }), { id: "bigint" });
  rejectsCursor(encodeCursor({ s: "x".repeat(101) }), { s: "string" });
  rejectsCursor(encodeCursor({ s: "" }), { s: "string" });
});

test("trust/common: clampLimit acota a 1–50 con 20 por defecto", () => {
  assert.equal(clampLimit(undefined), 20);
  assert.equal(clampLimit(Number.NaN), 20);
  assert.equal(clampLimit(Number.POSITIVE_INFINITY), 20);
  assert.equal(clampLimit(0), 1);
  assert.equal(clampLimit(-5), 1);
  assert.equal(clampLimit(7.9), 7);
  assert.equal(clampLimit(50), 50);
  assert.equal(clampLimit(100), 50);
  assert.equal(clampLimit(undefined, 10, 100), 10);
  assert.equal(clampLimit(500, 10, 100), 100);
});

test("trust/common: sliceOverflow implementa el patrón «una fila de más»", () => {
  assert.deepEqual(sliceOverflow([1, 2, 3], 3), { page: [1, 2, 3], hasMore: false });
  assert.deepEqual(sliceOverflow([1, 2, 3, 4], 3), { page: [1, 2, 3], hasMore: true });
  assert.deepEqual(sliceOverflow([], 3), { page: [], hasMore: false });
  assert.deepEqual(sliceOverflow([1], 1), { page: [1], hasMore: false });
});
