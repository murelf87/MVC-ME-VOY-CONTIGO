/**
 * `useApiMutation(fn, options)`: acciones que escriben en el servidor (solicitar plaza, pagar, publicar, valorar…).
 *
 *  - Estado tipado: idle → pending → success | error | offline. Un doble toque mientras está pendiente NO lanza una
 *    segunda petición: devuelve la misma.
 *  - `Idempotency-Key`: `fn` la recibe en su contexto y debe enviarla (`apiRequest(..., { idempotencyKey })`).
 *    Reintentar las mismas variables tras un fallo indeterminado (sin red a mitad, timeout, 5xx) reutiliza la clave;
 *    un éxito, un rechazo claro (4xx) o variables distintas empiezan una intención nueva con clave nueva.
 *  - `invalidates`: tras el éxito marca como obsoletas (y revalida si están a la vista) las consultas con esos prefijos.
 *  - `mutate` NUNCA rechaza (devuelve los datos o `undefined`); `mutateAsync` rechaza con el error.
 *  - Desmontar la pantalla NO cancela la petición (una acción ya enviada debe poder terminar); solo deja de pintar.
 *
 * Ejemplo:
 *   const request = useApiMutation((vars: RequestVars, { idempotencyKey, signal }) =>
 *     createRideRequest(vars, { idempotencyKey, signal }), { invalidates: [["my-trips"]] });
 *   <Button loading={request.isPending} onPress={() => request.mutate({ tripId, pickupPointId })} />
 *   {request.error && <ErrorBanner error={request.error} onRetry={request.retry} />}
 */
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import { createIdempotencyChain, type IdempotencyChain } from "@/api/idempotency";
import { isAbortError, isOfflineError } from "@/api/errors";
import { queryCache, type QueryKey } from "./queryCache";

export type MutationStatus = "idle" | "pending" | "success" | "error" | "offline";

export interface MutationContext {
  /** Enviar como cabecera `Idempotency-Key` en acciones que crean cosas. */
  idempotencyKey: string;
  /** Se aborta con `cancel()`. */
  signal: AbortSignal;
}

export type MutationFn<TData, TVariables> = (variables: TVariables, context: MutationContext) => Promise<TData>;

export interface UseApiMutationOptions<TData, TVariables> {
  /** Se ejecuta tras el éxito (antes de invalidar). No debe lanzar: si lanza, se ignora. */
  onSuccess?(data: TData, variables: TVariables): void | Promise<void>;
  onError?(error: Error, variables: TVariables): void;
  onSettled?(data: TData | undefined, error: Error | null, variables: TVariables): void;
  /** Prefijos de clave de consulta a invalidar tras el éxito. */
  invalidates?: readonly QueryKey[];
}

export interface UseApiMutationResult<TData, TVariables> {
  status: MutationStatus;
  isIdle: boolean;
  isPending: boolean;
  isSuccess: boolean;
  /** Falló (incluye `offline`). */
  isError: boolean;
  /** Falló por falta de red: ofrecer «Reintentar cuando tengas conexión». */
  isOffline: boolean;
  data: TData | undefined;
  error: Error | null;
  /** Variables del último intento. */
  variables: TVariables | undefined;
  /** Lanza la acción. Resuelve con los datos, o con `undefined` si falló (el error queda en `error`). */
  mutate(variables: TVariables): Promise<TData | undefined>;
  /** Como `mutate` pero rechaza con el error. */
  mutateAsync(variables: TVariables): Promise<TData>;
  /** Repite el último intento (misma `Idempotency-Key` si el fallo fue indeterminado). */
  retry(): Promise<TData | undefined>;
  /** Aborta la petición en curso (queda en idle). */
  cancel(): void;
  /** Vuelve a idle y olvida el error, los datos y la clave de idempotencia pendiente. */
  reset(): void;
}

interface MutationState<TData, TVariables> {
  status: MutationStatus;
  data: TData | undefined;
  error: Error | null;
  variables: TVariables | undefined;
}

type MutationAction<TData, TVariables> =
  | { type: "start"; variables: TVariables }
  | { type: "success"; data: TData }
  | { type: "failure"; error: Error }
  | { type: "reset" };

function reducer<TData, TVariables>(
  state: MutationState<TData, TVariables>,
  action: MutationAction<TData, TVariables>,
): MutationState<TData, TVariables> {
  switch (action.type) {
    case "start":
      return { status: "pending", data: undefined, error: null, variables: action.variables };
    case "success":
      return { ...state, status: "success", data: action.data, error: null };
    case "failure":
      return { ...state, status: isOfflineError(action.error) ? "offline" : "error", data: undefined, error: action.error };
    case "reset":
      return { status: "idle", data: undefined, error: null, variables: undefined };
  }
}

type Outcome<TData> = { ok: true; data: TData } | { ok: false; error: Error };

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export function useApiMutation<TData, TVariables = void>(
  fn: MutationFn<TData, TVariables>,
  options: UseApiMutationOptions<TData, TVariables> = {},
): UseApiMutationResult<TData, TVariables> {
  const [state, dispatch] = useReducer(
    reducer as (s: MutationState<TData, TVariables>, a: MutationAction<TData, TVariables>) => MutationState<TData, TVariables>,
    { status: "idle", data: undefined, error: null, variables: undefined },
  );

  const fnRef = useRef(fn);
  const optionsRef = useRef(options);
  useEffect(() => {
    fnRef.current = fn;
    optionsRef.current = options;
  });

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const chain = useRef<IdempotencyChain | null>(null);
  chain.current ??= createIdempotencyChain();
  const inflight = useRef<{ promise: Promise<Outcome<TData>>; controller: AbortController } | null>(null);
  const lastVariables = useRef<{ value: TVariables } | null>(null);

  const execute = useCallback((variables: TVariables): Promise<Outcome<TData>> => {
    if (inflight.current) return inflight.current.promise;

    const idempotency = chain.current as IdempotencyChain;
    const controller = new AbortController();
    const idempotencyKey = idempotency.begin(variables);
    lastVariables.current = { value: variables };
    if (mounted.current) dispatch({ type: "start", variables });

    const promise = (async (): Promise<Outcome<TData>> => {
      const callbacks = optionsRef.current;
      try {
        const data = await fnRef.current(variables, { idempotencyKey, signal: controller.signal });
        idempotency.succeeded();
        if (mounted.current) dispatch({ type: "success", data });
        try {
          await callbacks.onSuccess?.(data, variables);
        } catch {
          // un callback defectuoso no convierte una acción hecha en un fallo
        }
        for (const key of callbacks.invalidates ?? []) void queryCache.invalidate(key);
        try {
          callbacks.onSettled?.(data, null, variables);
        } catch {
          // ídem
        }
        return { ok: true, data };
      } catch (raised) {
        const error = toError(raised);
        if (isAbortError(error)) {
          idempotency.failed(error);
          if (mounted.current) dispatch({ type: "reset" });
          return { ok: false, error };
        }
        idempotency.failed(error);
        if (mounted.current) dispatch({ type: "failure", error });
        try {
          callbacks.onError?.(error, variables);
          callbacks.onSettled?.(undefined, error, variables);
        } catch {
          // ídem
        }
        return { ok: false, error };
      } finally {
        inflight.current = null;
      }
    })();

    inflight.current = { promise, controller };
    return promise;
  }, []);

  const mutate = useCallback(async (variables: TVariables) => {
    const outcome = await execute(variables);
    return outcome.ok ? outcome.data : undefined;
  }, [execute]);

  const mutateAsync = useCallback(async (variables: TVariables) => {
    const outcome = await execute(variables);
    if (!outcome.ok) throw outcome.error;
    return outcome.data;
  }, [execute]);

  const retry = useCallback(async () => {
    const last = lastVariables.current;
    return last ? mutate(last.value) : undefined;
  }, [mutate]);

  const cancel = useCallback(() => {
    inflight.current?.controller.abort();
  }, []);

  const reset = useCallback(() => {
    inflight.current?.controller.abort();
    (chain.current as IdempotencyChain).reset();
    lastVariables.current = null;
    dispatch({ type: "reset" });
  }, []);

  return useMemo(
    () => ({
      status: state.status,
      isIdle: state.status === "idle",
      isPending: state.status === "pending",
      isSuccess: state.status === "success",
      isError: state.status === "error" || state.status === "offline",
      isOffline: state.status === "offline",
      data: state.data,
      error: state.error,
      variables: state.variables,
      mutate,
      mutateAsync,
      retry,
      cancel,
      reset,
    }),
    [state, mutate, mutateAsync, retry, cancel, reset],
  );
}
