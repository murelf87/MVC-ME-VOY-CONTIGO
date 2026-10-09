/**
 * Código de recogida (pantalla 23 y tarjeta de la 21). El servidor SOLO guarda la huella del código: el código en claro
 * se obtiene una vez, al generarlo (`POST /v1/bookings/{id}/pickup-code`), y la app lo conserva EN MEMORIA mientras dure la
 * sesión. Si la app lo pierde (se cerró, otro móvil) el estado sigue siendo `active` y la única salida es generar uno nuevo
 * —lo que invalida el anterior—, nunca «recuperarlo».
 *
 * Todo lo de este fichero es puro salvo el almacén en memoria (`Map`), que no toca disco ni red.
 */
import type { LivePhase, LivePickupCodeState, LiveTripStatus } from "@/api/types";

export interface StoredPickupCode {
  code: string;
  generatedAt: string;
}

const store = new Map<string, StoredPickupCode>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of [...listeners]) listener();
}

/** Guarda el código recién generado de una reserva. */
export function rememberPickupCode(bookingId: string, code: string, generatedAt: string): void {
  store.set(bookingId, { code, generatedAt });
  emit();
}

export function forgetPickupCode(bookingId: string): void {
  if (store.delete(bookingId)) emit();
}

export function readPickupCode(bookingId: string): StoredPickupCode | null {
  return store.get(bookingId) ?? null;
}

export function subscribePickupCodes(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Vacía el almacén (cierre de sesión y pruebas). */
export function resetPickupCodes(): void {
  if (store.size === 0) return;
  store.clear();
  emit();
}

function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return false;
  const left = Date.parse(a);
  const right = Date.parse(b);
  return Number.isFinite(left) && Number.isFinite(right) && left === right;
}

/**
 * El código en claro que vale AHORA: el guardado solo si el servidor sigue teniendo ese mismo código activo (misma marca
 * `generatedAt`). Si se generó otro desde otro móvil, o ya se verificó, el guardado ya no sirve.
 */
export function currentPlainCode(stored: StoredPickupCode | null, state: LivePickupCodeState): string | null {
  if (stored === null || state.status !== "active") return null;
  return sameInstant(stored.generatedAt, state.generatedAt) ? stored.code : null;
}

export type CodeCardKind =
  /** Reserva o viaje terminados: no hay tarjeta. */
  | "hidden"
  /** El viaje aún no ha empezado: no se puede generar. */
  | "notStarted"
  /** Se está generando (o está a punto de generarse sola). */
  | "generating"
  /** Código visible. */
  | "ready"
  /** Generado antes pero esta app lo ha perdido: hay que generar uno nuevo. */
  | "lost"
  /** El conductor lo verificó: recogida hecha. */
  | "verified"
  /** Intentos agotados: hay que generar uno nuevo. */
  | "locked"
  /** La generación falló (se muestra el motivo y «Reintentar»). */
  | "error";

export interface CodeCardInput {
  state: LivePickupCodeState;
  tripStatus: LiveTripStatus;
  phase: LivePhase;
  plain: string | null;
  generating: boolean;
  failed: boolean;
}

export function codeCardKind(input: CodeCardInput): CodeCardKind {
  if (input.phase === "cancelled" || input.phase === "completed") return "hidden";
  if (input.state.status === "verified") return "verified";
  if (input.state.status === "locked") return input.generating ? "generating" : input.failed ? "error" : "locked";
  if (input.plain !== null) return "ready";
  if (input.generating) return "generating";
  if (input.failed) return "error";
  if (input.state.status === "active") return "lost";
  return input.tripStatus === "active" ? "generating" : "notStarted";
}

/**
 * ¿Hay que generar el código sin que la persona lo pida? Solo cuando aún no existe ninguno y el viaje está en marcha:
 * no invalida nada. Si ya hay uno activo (aunque esta app lo haya perdido) NO se genera solo: un código nuevo anula el
 * anterior, que la persona puede haber dado ya al conductor.
 */
export function shouldAutoGenerate(state: LivePickupCodeState, tripStatus: LiveTripStatus, phase: LivePhase): boolean {
  if (phase === "cancelled" || phase === "completed" || phase === "in_vehicle") return false;
  return state.status === "not_generated" && tripStatus === "active";
}

/** Los caracteres del código repartidos en `length` casillas (vacías mientras no hay código). */
export function codeDigits(code: string | null, length: number): string[] {
  const size = Math.max(0, Math.floor(length));
  const chars = code === null ? [] : Array.from(code);
  return Array.from({ length: size }, (_, i) => chars[i] ?? "");
}

/** «7 4 1 6 9 5» para lectores de pantalla. */
export function spokenCode(code: string): string {
  return Array.from(code).join(" ");
}

/** Intentos restantes que merece la pena avisar (solo si ya se gastó alguno). */
export function attemptsWarning(state: LivePickupCodeState, maxAttempts = 5): number | null {
  if (state.status !== "active" || state.attemptsRemaining === null) return null;
  return state.attemptsRemaining < maxAttempts ? state.attemptsRemaining : null;
}
