/**
 * Plazas retenidas que este dispositivo conoce: id de solicitud → instante en que caduca el tiempo de pago.
 *
 * El contrato de la bandeja (`DriverRequestItem`) aún no informa de la retención de una solicitud ya aceptada; la
 * respuesta de la decisión sí (`hold.expiresAt`). Se recuerda aquí para pintar la cuenta atrás mientras el pasajero
 * paga, también si la app se reinicia. Cuando el servidor devuelva `hold` en la bandeja, este almacén deja de hacer falta.
 *
 * Almacén externo mínimo (`useSyncExternalStore`) con copia en preferencias (no secretas).
 */
import { useEffect, useSyncExternalStore } from "react";
import { getJson, preferences, setJson } from "@/platform";
import type { HoldMap } from "../types";

const STORAGE_KEY = "driver.publish.holds.v1";
/** Entradas caducadas hace más de esto se olvidan al arrancar. */
const KEEP_AFTER_EXPIRY_MS = 60 * 60_000;

let state: HoldMap = {};
let hydrated = false;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function persist(): void {
  void setJson(preferences, STORAGE_KEY, state);
}

function isHoldMap(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value as Record<string, unknown>).every((item) => typeof item === "string");
}

/** Quita las retenciones caducadas hace mucho. Pura: la usa la hidratación y las pruebas. */
export function pruneHolds(holds: HoldMap, nowMs: number): HoldMap {
  const next: Record<string, string> = {};
  for (const [id, expiresAt] of Object.entries(holds)) {
    const at = Date.parse(expiresAt);
    if (Number.isFinite(at) && at + KEEP_AFTER_EXPIRY_MS > nowMs) next[id] = expiresAt;
  }
  return next;
}

export const holdStore = {
  get(): HoldMap {
    return state;
  },
  /** Recuerda cuándo caduca la retención de una solicitud (o reserva semanal) recién aceptada. */
  remember(id: string, expiresAt: string): void {
    state = { ...state, [id]: expiresAt };
    emit();
    persist();
  },
  forget(id: string): void {
    if (!(id in state)) return;
    const { [id]: _removed, ...rest } = state;
    state = rest;
    emit();
    persist();
  },
  /** Carga lo guardado la primera vez que se usa (una sola vez por arranque). */
  hydrate(): void {
    if (hydrated) return;
    hydrated = true;
    void getJson<unknown>(preferences, STORAGE_KEY).then((stored) => {
      if (!isHoldMap(stored)) return;
      state = pruneHolds({ ...stored, ...state }, Date.now());
      emit();
    });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useHolds(): HoldMap {
  useEffect(() => holdStore.hydrate(), []);
  return useSyncExternalStore(holdStore.subscribe, holdStore.get, holdStore.get);
}
