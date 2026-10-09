/**
 * `Idempotency-Key` de las rutas de creación. Espejo de los dos modos del backend real:
 *
 *   "optional"  `src/modules/trips/idempotency.ts`. Cabecera OPCIONAL (sin ella no hay deduplicación). Formato
 *               `^[A-Za-z0-9._:-]{8,80}$`; si no encaja → 400 `IDEMPOTENCY_KEY_INVALID`. La clave es por (usuario, operación
 *               y recurso, p. ej. `request:<tripId>`): la misma clave en otro viaje es otra operación.
 *   "required"  `src/modules/money/lib/idempotency.ts`. Cabecera OBLIGATORIA. Formato `^[A-Za-z0-9_-]{8,128}$`; falta o no
 *               encaja → 400 `IDEMPOTENCY_KEY_REQUIRED`. La clave es por (usuario, clave): la misma clave en otra ruta u
 *               otro cuerpo → 422 `IDEMPOTENCY_KEY_REUSED`.
 *
 * En los dos: misma clave + mismo cuerpo → se repite la respuesta original (cabecera `Idempotency-Replayed: true`); misma
 * clave + cuerpo distinto → 422 `IDEMPOTENCY_KEY_REUSED`; los ERRORES no se guardan (el reintento se evalúa de nuevo); el
 * cuerpo se compara con las claves ordenadas, así que `{a,b}` y `{b,a}` son el mismo. El servidor simulado lo aplica a las
 * rutas con `idempotent` (ver `core/router.ts`) y solo a peticiones con sesión válida: el backend autentica antes de leer la
 * clave y la guarda por usuario.
 */
import { ApiFailure } from "./errors";
import { sha256Hex } from "./sha256";

export type IdempotencyMode = "optional" | "required";

const OPTIONAL_KEY_RE = /^[A-Za-z0-9._:-]{8,80}$/;
const REQUIRED_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** Las claves se olvidan a las 24 h del reloj virtual (`TRIPS_IDEMPOTENCY_TTL_HOURS`). */
export const IDEMPOTENCY_TTL_MS = 24 * 3_600_000;

/** Lee y valida la cabecera. `null` = no hay clave (solo en modo «optional»). */
export function readIdempotencyKey(raw: string | undefined, mode: IdempotencyMode): string | null {
  if (mode === "required") {
    if (!raw) throw new ApiFailure("IDEMPOTENCY_KEY_REQUIRED", "Falta la cabecera Idempotency-Key.", 400);
    if (!REQUIRED_KEY_RE.test(raw)) {
      throw new ApiFailure("IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key debe tener entre 8 y 128 caracteres [A-Za-z0-9_-].", 400);
    }
    return raw;
  }
  if (raw === undefined || raw.trim() === "") return null;
  const key = raw.trim();
  if (!OPTIONAL_KEY_RE.test(key)) {
    throw new ApiFailure(
      "IDEMPOTENCY_KEY_INVALID",
      "La cabecera Idempotency-Key no es válida (8–80 caracteres: letras, números, . _ : -).",
      400
    );
  }
  return key;
}

/** JSON con las claves ordenadas y sin `undefined`: dos cuerpos equivalentes dan el mismo texto. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`);
  return `{${entries.join(",")}}`;
}

/** Huella (SHA-256) de un cuerpo o de cualquier valor JSON. */
export function fingerprint(value: unknown): string {
  return sha256Hex(stableStringify(value ?? null));
}
