/**
 * Rutina semanal: lectura y escrituras (crear filas, editarlas, eliminarlas, suspender o reanudar la próxima semana y
 * guardar la plaza semanal). Las escrituras que cambian solicitudes (suspender una semana) también refrescan «Mis viajes»
 * y los detalles de reserva.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { describeError } from "@/api";
import type {
  CreateRoutineEntryBody,
  CreateRoutineSuspensionBody,
  CreateRoutineSuspensionResponse,
  RoutineEntriesResponse,
  RoutineEntry,
  RoutineResponse,
  UpdateRoutineEntryBody,
  UpdateWeeklySeatOfferBody,
  WeeklySeatOffer,
} from "@/api/types";
import { queryCache, useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { showToast } from "@/ui";
import {
  createRoutineEntries,
  deleteRoutineEntry,
  getRoutine,
  resumeRoutineWeek,
  saveWeeklySeatOffer,
  suspendRoutineWeek,
  updateRoutineEntry,
} from "../api";
import { profileStrings } from "../strings";
import { REQUEST_DETAILS, ROUTINE, TRIPS_OVERVIEW, WEEKLY_RESERVATIONS } from "./keys";

const copy = profileStrings.favorites;

export function useRoutine(): UseApiQueryResult<RoutineResponse> {
  return useApiQuery<RoutineResponse>(ROUTINE, ({ signal }) => getRoutine({ signal }), { staleTimeMs: 15_000 });
}

export function useCreateRoutineEntries(): UseApiMutationResult<RoutineEntriesResponse, CreateRoutineEntryBody> {
  return useApiMutation<RoutineEntriesResponse, CreateRoutineEntryBody>(
    (body, { idempotencyKey, signal }) => createRoutineEntries(body, { idempotencyKey, signal }),
    { invalidates: [ROUTINE] },
  );
}

export interface UpdateRoutineEntryVars {
  id: string;
  body: UpdateRoutineEntryBody;
}

export function useUpdateRoutineEntry(): UseApiMutationResult<RoutineEntry, UpdateRoutineEntryVars> {
  return useApiMutation<RoutineEntry, UpdateRoutineEntryVars>(
    ({ id, body }, { signal }) => updateRoutineEntry(id, body, { signal }),
    { invalidates: [ROUTINE] },
  );
}

export function useDeleteRoutineEntry(): UseApiMutationResult<void, string> {
  return useApiMutation<void, string>((id, { signal }) => deleteRoutineEntry(id, { signal }), { invalidates: [ROUTINE] });
}

/** Lo que cambia al suspender o reanudar una semana: la rutina, «Mis viajes» y las reservas que se retiran. */
const SUSPENSION_INVALIDATES = [ROUTINE, TRIPS_OVERVIEW, REQUEST_DETAILS, WEEKLY_RESERVATIONS] as const;

/** Suspende una semana (por defecto, la próxima). Idempotente en el servidor: repetirla devuelve la misma suspensión. */
export function useSuspendWeek(): UseApiMutationResult<CreateRoutineSuspensionResponse, CreateRoutineSuspensionBody> {
  return useApiMutation<CreateRoutineSuspensionResponse, CreateRoutineSuspensionBody>(
    (body, { idempotencyKey, signal }) => suspendRoutineWeek(body, { idempotencyKey, signal }),
    { invalidates: SUSPENSION_INVALIDATES },
  );
}

/** Reanuda una semana suspendida (el argumento es el lunes de esa semana). */
export function useResumeWeek(): UseApiMutationResult<void, string> {
  return useApiMutation<void, string>((weekStart, { signal }) => resumeRoutineWeek(weekStart, { signal }), {
    invalidates: SUSPENSION_INVALIDATES,
  });
}

export function useSaveWeeklyOffer(): UseApiMutationResult<WeeklySeatOffer, UpdateWeeklySeatOfferBody> {
  return useApiMutation<WeeklySeatOffer, UpdateWeeklySeatOfferBody>(
    (body, { idempotencyKey, signal }) => saveWeeklySeatOffer(body, { idempotencyKey, signal }),
    { invalidates: [ROUTINE] },
  );
}

// ── Activar o desactivar filas ───────────────────────────────────────────────────────────────────────────────────────

export interface RoutineToggle {
  /** Estado que se muestra: el pedido mientras se guarda, o el que tiene la fila. */
  isEnabled(entry: Pick<RoutineEntry, "id" | "enabled">): boolean;
  /** La fila está guardando su cambio (se ignoran más toques hasta que termine). */
  isPending(entryId: string): boolean;
  toggle(entry: Pick<RoutineEntry, "id" | "enabled">): void;
}

/**
 * Casillas de la rutina. Cada fila guarda por su cuenta (varias a la vez, sin que una espere a otra): el valor pedido se ve
 * al instante, y si el servidor lo rechaza la casilla vuelve a su valor y se explica con un aviso.
 */
export function useRoutineToggle(): RoutineToggle {
  const [requested, setRequested] = useState<Readonly<Record<string, boolean>>>({});
  const inFlight = useRef<Set<string>>(new Set());
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const clear = useCallback((entryId: string) => {
    inFlight.current.delete(entryId);
    if (!mounted.current) return;
    setRequested((previous) => {
      if (!(entryId in previous)) return previous;
      const next = { ...previous };
      delete next[entryId];
      return next;
    });
  }, []);

  const toggle = useCallback(
    (entry: Pick<RoutineEntry, "id" | "enabled">) => {
      if (inFlight.current.has(entry.id)) return;
      const next = !entry.enabled;
      inFlight.current.add(entry.id);
      setRequested((previous) => ({ ...previous, [entry.id]: next }));
      void updateRoutineEntry(entry.id, { enabled: next }).then(
        (updated) => {
          const current = queryCache.getData<RoutineResponse>(ROUTINE);
          if (current !== undefined) {
            queryCache.setData<RoutineResponse>(ROUTINE, {
              ...current,
              entries: current.entries.map((row) => (row.id === updated.id ? updated : row)),
            });
          }
          clear(entry.id);
          // «Ofrezco 1 plaza de lunes a viernes» sale de los días activos: se vuelve a pedir.
          void queryCache.invalidate(ROUTINE);
        },
        (error: unknown) => {
          clear(entry.id);
          const described = describeError(error);
          showToast({ kind: "error", message: described.message !== "" ? described.message : copy.toggleFailed, id: "profile.routine.toggle" });
        },
      );
    },
    [clear],
  );

  const isEnabled = useCallback(
    (entry: Pick<RoutineEntry, "id" | "enabled">): boolean => requested[entry.id] ?? entry.enabled,
    [requested],
  );
  const isPending = useCallback((entryId: string): boolean => entryId in requested, [requested]);

  return { isEnabled, isPending, toggle };
}
