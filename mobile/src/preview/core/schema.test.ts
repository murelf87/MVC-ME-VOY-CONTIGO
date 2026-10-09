/**
 * Validador «tipo Ajv» (opciones por defecto de Fastify 5): coerción, defaults, propiedades no declaradas, formatos y
 * mensajes de error iguales a los de Ajv.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkFormat, validateSchema, type JsonSchema, type ValidationIssue } from "./schema";

function value(schema: JsonSchema, data: unknown): unknown {
  const result = validateSchema(schema, data);
  if (!result.ok) throw new Error(`Debía ser válido: ${JSON.stringify(result.issues)}`);
  return result.value;
}

function issue(schema: JsonSchema, data: unknown): ValidationIssue {
  const result = validateSchema(schema, data);
  if (result.ok) throw new Error(`Debía ser inválido: ${JSON.stringify(result.value)}`);
  assert.equal(result.issues.length, 1, "allErrors: false → solo el primer error");
  return result.issues[0] as ValidationIssue;
}

describe("coerceTypes: array (query y params llegan como texto)", () => {
  it("convierte texto en número, entero y booleano", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { n: { type: "number" }, i: { type: "integer" }, b: { type: "boolean" } },
    };
    assert.deepEqual(value(schema, { n: "1.5", i: "7", b: "true" }), { n: 1.5, i: 7, b: true });
    assert.deepEqual(value(schema, { b: "false" }), { b: false });
  });

  it("no convierte lo que no es un número ni un entero", () => {
    const schema: JsonSchema = { type: "object", properties: { i: { type: "integer" } } };
    assert.equal(issue(schema, { i: "1.5" }).message, "must be integer");
    assert.equal(issue(schema, { i: "abc" }).message, "must be integer");
    assert.equal(issue(schema, { i: "" }).keyword, "type");
  });

  it("un texto de un solo elemento [x] se trata como x, y un escalar se envuelve si se espera un array", () => {
    const scalar: JsonSchema = { type: "object", properties: { n: { type: "integer" } } };
    assert.deepEqual(value(scalar, { n: ["3"] }), { n: 3 });
    const list: JsonSchema = { type: "object", properties: { ids: { type: "array", items: { type: "string" } } } };
    assert.deepEqual(value(list, { ids: "a" }), { ids: ["a"] });
    assert.deepEqual(value(list, { ids: ["a", "b"] }), { ids: ["a", "b"] });
  });

  it("un número se convierte en texto cuando se espera texto", () => {
    assert.deepEqual(value({ type: "object", properties: { s: { type: "string" } } }, { s: 12 }), { s: "12" });
  });
});

describe("defaults y propiedades no declaradas", () => {
  it("useDefaults rellena lo que falta antes de comprobar required", () => {
    const schema: JsonSchema = {
      type: "object",
      required: ["limit"],
      properties: { limit: { type: "integer", default: 20 } },
    };
    assert.deepEqual(value(schema, {}), { limit: 20 });
  });

  it("additionalProperties:false ELIMINA en silencio lo desconocido (no falla)", () => {
    const schema: JsonSchema = { type: "object", additionalProperties: false, properties: { a: { type: "string" } } };
    assert.deepEqual(value(schema, { a: "x", b: "y" }), { a: "x" });
  });

  it("sin additionalProperties:false se conservan las propiedades extra", () => {
    const schema: JsonSchema = { type: "object", properties: { a: { type: "string" } } };
    assert.deepEqual(value(schema, { a: "x", b: "y" }), { a: "x", b: "y" });
  });

  it("additionalProperties con schema valida los valores extra", () => {
    const schema: JsonSchema = { type: "object", additionalProperties: { type: "integer" } };
    assert.deepEqual(value(schema, { a: "1", b: 2 }), { a: 1, b: 2 });
    assert.equal(issue(schema, { a: "x" }).instancePath, "/a");
  });

  it("no muta la entrada", () => {
    const input = { limit: "5", extra: 1 };
    value({ type: "object", additionalProperties: false, properties: { limit: { type: "integer" } } }, input);
    assert.deepEqual(input, { limit: "5", extra: 1 });
  });
});

describe("mensajes y rutas de error iguales a Ajv", () => {
  const schema: JsonSchema = {
    type: "object",
    required: ["name"],
    properties: {
      name: { type: "string", minLength: 2, maxLength: 5 },
      age: { type: "integer", minimum: 18, maximum: 99 },
      kind: { type: "string", enum: ["a", "b"] },
      id: { type: "string", format: "uuid" },
      when: { type: "string", format: "date-time" },
      day: { type: "string", format: "date" },
      code: { type: "string", pattern: "^[0-9]{6}$" },
      tags: { type: "array", minItems: 1, maxItems: 2, uniqueItems: true, items: { type: "string" } },
      point: { type: "object", required: ["lat"], properties: { lat: { type: "number", minimum: -90, maximum: 90 } } },
    },
  };

  it("required: ruta vacía y nombre en el mensaje", () => {
    const found = issue(schema, {});
    assert.deepEqual(found, {
      instancePath: "",
      keyword: "required",
      message: "must have required property 'name'",
      params: { missingProperty: "name" },
    });
  });

  it("longitudes, rangos y enum", () => {
    assert.equal(issue(schema, { name: "A" }).message, "must NOT have fewer than 2 characters");
    assert.equal(issue(schema, { name: "Abcdef" }).message, "must NOT have more than 5 characters");
    assert.equal(issue(schema, { name: "Ana", age: 17 }).message, "must be >= 18");
    assert.equal(issue(schema, { name: "Ana", age: 100 }).message, "must be <= 99");
    assert.equal(issue(schema, { name: "Ana", kind: "z" }).message, "must be equal to one of the allowed values");
  });

  it("formatos y patrones", () => {
    assert.equal(issue(schema, { name: "Ana", id: "no-uuid" }).message, 'must match format "uuid"');
    assert.equal(issue(schema, { name: "Ana", when: "ayer" }).message, 'must match format "date-time"');
    assert.equal(issue(schema, { name: "Ana", day: "2026-02-30" }).message, 'must match format "date"');
    assert.equal(issue(schema, { name: "Ana", code: "12345" }).message, 'must match pattern "^[0-9]{6}$"');
    assert.deepEqual(value(schema, { name: "Ana", id: "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001", day: "2028-02-29", code: "123456" }), {
      name: "Ana",
      id: "5e2c1a52-0a43-4e6b-9c11-5c1a0b7f0001",
      day: "2028-02-29",
      code: "123456",
    });
  });

  it("arrays y objetos anidados: la ruta apunta al elemento", () => {
    assert.equal(issue(schema, { name: "Ana", tags: [] }).message, "must NOT have fewer than 1 items");
    assert.equal(issue(schema, { name: "Ana", tags: ["a", "b", "c"] }).message, "must NOT have more than 2 items");
    const dup = issue(schema, { name: "Ana", tags: ["a", "a"] });
    assert.equal(dup.keyword, "uniqueItems");
    assert.equal(dup.message, "must NOT have duplicate items (items ## 0 and 1 are identical)");
    const nested = issue(schema, { name: "Ana", point: { lat: 100 } });
    assert.equal(nested.instancePath, "/point/lat");
    const missing = issue(schema, { name: "Ana", point: {} });
    assert.equal(missing.instancePath, "/point");
    assert.equal(missing.message, "must have required property 'lat'");
    assert.equal(issue(schema, { name: "Ana", tags: ["a", {}] }).instancePath, "/tags/1");
  });

  it("solo se informa del primer error (allErrors: false)", () => {
    const result = validateSchema(schema, { name: "A", age: 5, kind: "z" });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.issues.length, 1);
  });

  it("el tipo erróneo dice qué se esperaba", () => {
    assert.equal(issue({ type: "object" }, "texto").message, "must be object");
    assert.equal(issue({ type: "array" }, { a: 1 }).message, "must be array");
    assert.equal(issue({ type: ["string", "null"] }, { a: 1 }).message, "must be string,null");
  });

  it("las claves con / o ~ se escapan en el puntero JSON", () => {
    const found = issue({ type: "object", properties: { "a/b": { type: "integer" } } }, { "a/b": "x" });
    assert.equal(found.instancePath, "/a~1b");
  });
});

describe("combinadores, nulos y constantes", () => {
  it("nullable y type con null", () => {
    assert.deepEqual(value({ type: "object", properties: { a: { type: "string", nullable: true } } }, { a: null }), { a: null });
    assert.deepEqual(value({ type: "object", properties: { a: { type: ["integer", "null"] } } }, { a: null }), { a: null });
  });

  it("oneOf exige exactamente una coincidencia; anyOf, al menos una", () => {
    const one: JsonSchema = { oneOf: [{ type: "string" }, { type: "integer" }] };
    assert.equal(value(one, "x"), "x");
    assert.equal(issue({ oneOf: [{ type: "integer" }, { type: "number" }] }, 3).keyword, "oneOf");
    const any: JsonSchema = { anyOf: [{ type: "integer" }, { type: "string", format: "date" }] };
    assert.equal(value(any, "2026-10-05"), "2026-10-05");
    assert.equal(issue(any, "ayer").keyword, "anyOf");
  });

  it("const y enum comparan en profundidad", () => {
    assert.deepEqual(value({ enum: [{ a: [1, 2] }] }, { a: [1, 2] }), { a: [1, 2] });
    assert.equal(issue({ const: "x" }, "y").message, "must be equal to constant");
  });
});

describe("checkFormat", () => {
  it("date: calendario real (años bisiestos incluidos)", () => {
    assert.equal(checkFormat("date", "2028-02-29"), true);
    assert.equal(checkFormat("date", "2026-02-29"), false);
    assert.equal(checkFormat("date", "2026-13-01"), false);
    assert.equal(checkFormat("date", "2026-1-01"), false);
  });

  it("date-time exige zona horaria; time también", () => {
    assert.equal(checkFormat("date-time", "2026-10-05T07:17:00Z"), true);
    assert.equal(checkFormat("date-time", "2026-10-05T07:17:00.123+02:00"), true);
    assert.equal(checkFormat("date-time", "2026-10-05T07:17:00"), false);
    assert.equal(checkFormat("date-time", "2026-10-05T25:00:00Z"), false);
    assert.equal(checkFormat("time", "07:17:00Z"), true);
  });

  it("uuid, email y uri; un formato desconocido se ignora (strict: false)", () => {
    assert.equal(checkFormat("uuid", "00000000-0000-0000-0000-000000000000"), true);
    assert.equal(checkFormat("uuid", "00000000-0000-0000-0000-00000000000"), false);
    assert.equal(checkFormat("email", "ana@example.com"), true);
    assert.equal(checkFormat("email", "ana@"), false);
    assert.equal(checkFormat("uri", "https://example.com/x"), true);
    assert.equal(checkFormat("uri", "no uri"), false);
    assert.equal(checkFormat("inventado", "lo que sea"), true);
  });
});

describe("modo estricto (respuestas): sin coerción, sin defaults, sin eliminar propiedades", () => {
  const strict = (schema: JsonSchema, data: unknown) => validateSchema(schema, data, { strict: true });

  it("un texto no se convierte en número ni un número en texto", () => {
    assert.equal(strict({ type: "number" }, "5").ok, false);
    assert.equal(strict({ type: "string" }, 5).ok, false);
    assert.equal(strict({ type: "boolean" }, "true").ok, false);
    assert.equal(strict({ type: "integer" }, 1.5).ok, false);
    assert.equal(strict({ type: "integer" }, 2).ok, true);
    assert.equal(strict({ type: "array", items: { type: "string" } }, "x").ok, false, "un escalar no se envuelve en lista");
    assert.equal(strict({ type: "string" }, ["x"]).ok, false, "una lista de un elemento no se desenvuelve");
    assert.equal(strict({ type: "string", nullable: true }, null).ok, true);
  });

  it("no rellena defaults y exige lo obligatorio", () => {
    const schema: JsonSchema = { type: "object", required: ["a"], properties: { a: { type: "string" }, b: { type: "integer", default: 3 } } };
    const result = strict(schema, { a: "x" });
    assert.ok(result.ok);
    assert.deepEqual(result.value, { a: "x" });
    const missing = strict(schema, { b: 1 });
    assert.ok(!missing.ok);
    assert.equal(missing.issues[0]?.keyword, "required");
  });

  it("additionalProperties:false falla (en modo normal se elimina) y las propiedades libres se conservan", () => {
    const closed: JsonSchema = { type: "object", additionalProperties: false, properties: { a: { type: "string" } } };
    const result = strict(closed, { a: "x", extra: 1 });
    assert.ok(!result.ok);
    assert.equal(result.issues[0]?.keyword, "additionalProperties");
    assert.deepEqual(result.issues[0]?.params, { additionalProperty: "extra" });
    const normal = validateSchema(closed, { a: "x", extra: 1 });
    assert.ok(normal.ok);
    assert.deepEqual(normal.value, { a: "x" });
    const open = strict({ type: "object", properties: { a: { type: "string" } } }, { a: "x", extra: 1 });
    assert.ok(open.ok);
    assert.deepEqual(open.value, { a: "x", extra: 1 });
  });

  it("anidados: el error indica la ruta exacta", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: { trips: { type: "array", items: { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } } } },
    };
    const result = strict(schema, { trips: [{ id: "00000000-0000-4000-8000-000000000000" }, { id: "no" }] });
    assert.ok(!result.ok);
    assert.equal(result.issues[0]?.instancePath, "/trips/1/id");
  });
});
