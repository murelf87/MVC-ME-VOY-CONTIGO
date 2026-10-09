/**
 * Formatos «de cable» del backend real (lo que ve el cliente tras `JSON.stringify` de una fila de `pg`):
 *  - `timestamptz`  → ISO-8601 UTC con milisegundos (`2026-10-05T05:17:00.000Z`).
 *  - `date`         → `YYYY-MM-DD` (el backend registra un parser de tipos que evita el desfase de zona).
 *  - `bigint`       → STRING (`"11"`); `numeric` → STRING (`"0.9500"`). `integer`/`double` → número.
 * Las filas internas de la vista previa guardan números; estas funciones los convierten al emitir la respuesta.
 */

const RealDate: DateConstructor = Date;

export function iso(value: number | string | Date | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const ms = value instanceof RealDate ? value.getTime() : typeof value === "number" ? value : RealDate.parse(value);
  return new RealDate(ms).toISOString();
}

/** Como `iso`, pero para columnas NOT NULL. */
export function isoReq(value: number | string | Date): string {
  const out = iso(value);
  if (out === null) throw new Error("Fecha obligatoria ausente");
  return out;
}

/** `bigint` de PostgreSQL tal y como lo serializa `pg`: texto. */
export function bigintText(value: number | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/** `numeric(p, scale)` de PostgreSQL tal y como lo serializa `pg`: texto con `scale` decimales. */
export function numericText(value: number | null | undefined, scale: number): string | null {
  if (value === null || value === undefined) return null;
  return value.toFixed(scale);
}

/** `ST_SnapToGrid(geom, 0.01, 0.01)`: redondea a la cuadrícula de 0,01° (≈1,1 km). */
export function snapToGrid(value: number, step = 0.01): number {
  const decimals = Math.max(0, Math.round(-Math.log10(step)));
  return Number((Math.round(value / step) * step).toFixed(decimals));
}

export function round(value: number, decimals = 0): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
