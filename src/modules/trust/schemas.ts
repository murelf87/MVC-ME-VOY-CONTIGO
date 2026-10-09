/**
 * Piezas reutilizables para los schemas JSON de las rutas. Se usan objetos planos (sin app.addSchema) para que
 * no haya colisiones de `$id` entre módulos y el OpenAPI generado sea autocontenido.
 */
export type Schema = Record<string, unknown>;

export const str = (extra: Schema = {}): Schema => ({ type: "string", ...extra });
export const int = (extra: Schema = {}): Schema => ({ type: "integer", ...extra });
export const num = (extra: Schema = {}): Schema => ({ type: "number", ...extra });
export const bool = (extra: Schema = {}): Schema => ({ type: "boolean", ...extra });
export const arr = (items: Schema, extra: Schema = {}): Schema => ({ type: "array", items, ...extra });
export const enumOf = (values: readonly string[], extra: Schema = {}): Schema => ({ type: "string", enum: [...values], ...extra });

/** Hace nulable un schema simple (string/integer/number/boolean/object/array). */
export function nullable(schema: Schema): Schema {
  const type = schema.type;
  if (typeof type === "string") return { ...schema, type: [type, "null"] };
  throw new Error("nullable() solo admite schemas con un único tipo");
}
export const nstr = (extra: Schema = {}): Schema => nullable(str(extra));
/** Enumeración nulable (el `null` debe figurar en `enum` para que el OpenAPI sea válido). */
export const nenum = (values: readonly string[]): Schema => ({ type: ["string", "null"], enum: [...values, null] });
export const nint = (extra: Schema = {}): Schema => nullable(int(extra));
export const nnum = (extra: Schema = {}): Schema => nullable(num(extra));

export function obj(properties: Record<string, Schema>, required?: string[], extra: Schema = {}): Schema {
  const req = required ?? Object.keys(properties);
  return { type: "object", properties, ...(req.length > 0 ? { required: req } : {}), additionalProperties: false, ...extra };
}
/** Querystring: todos los parámetros son opcionales salvo los indicados. */
export const queryObj = (properties: Record<string, Schema>, required: string[] = []): Schema => obj(properties, required);
/** Objeto con claves libres (metadatos, `data`): fast-json-stringify conserva todas las propiedades. */
export const freeObject = (extra: Schema = {}): Schema => ({ type: "object", additionalProperties: true, ...extra });

export const uuidParam = (name: string): Schema => obj({ [name]: str({ format: "uuid" }) });

/* ───────────── Respuestas de error ───────────── */

export const errorBody: Schema = obj(
  {
    error: obj({ code: str(), message: str(), details: {} }, ["code", "message"]),
    requestId: str()
  },
  ["error"]
);

/** Respuestas de error documentadas para una ruta. `auth`: 401 (+403 si `staff`). */
export function errorResponses(statuses: readonly number[]): Record<number, Schema> {
  const out: Record<number, Schema> = {};
  for (const status of statuses) out[status] = errorBody;
  return out;
}

export const BEARER: Array<Record<string, string[]>> = [{ bearerAuth: [] }];

/* ───────────── Piezas del contrato ───────────── */

export const moneyS: Schema = obj({
  cents: nint(),
  currency: enumOf(["EUR"]),
  status: enumOf(["defined", "pending_definition", "illustrative"])
});

export const provinceRefS: Schema = obj({ id: str(), code: str(), name: str() });
export const nProvinceRefS: Schema = nullable(provinceRefS);

export const actorRefS: Schema = obj({ id: str(), displayName: nstr() });
export const nActorRefS: Schema = nullable(actorRefS);

export const pageQuery = {
  cursor: str({ minLength: 1, maxLength: 200 }),
  limit: int({ minimum: 1, maximum: 50, default: 20 })
};

export const reasonS: Schema = obj({ code: str(), title: nstr(), message: str() });
export const nReasonS: Schema = nullable(reasonS);
