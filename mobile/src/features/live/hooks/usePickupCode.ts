import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { LiveInCarState, LivePhase, LivePickupCodeState, LiveTripStatus } from "@/api/types";
import { queryCache, useApiMutation } from "@/hooks";
import { copyToClipboard } from "@/platform";
import { generatePickupCode } from "../api";
import {
  attemptsWarning,
  codeCardKind,
  codeDigits,
  currentPlainCode,
  readPickupCode,
  rememberPickupCode,
  shouldAutoGenerate,
  subscribePickupCodes,
  type CodeCardKind,
} from "../model/pickupCode";
import { liveKeys } from "./keys";

export interface PickupCodeController {
  kind: CodeCardKind;
  /** Código en claro vigente (solo si esta app lo generó y el servidor lo sigue teniendo activo). */
  plain: string | null;
  /** Una casilla por dígito (`codeLength`); vacías mientras no hay código. */
  digits: string[];
  generating: boolean;
  /** Error de la última generación (motivo del contrato: BOOKING_NOT_PICKUP_ELIGIBLE, TRIP_NOT_LIVE…). */
  error: Error | null;
  /** Intentos restantes del conductor, solo si ya se gastó alguno. */
  attemptsLeft: number | null;
  generate(): void;
  /** Copia el código al portapapeles. `false` si no hay código o el sistema lo impidió. */
  copy(): Promise<boolean>;
}

interface Context {
  tripStatus: LiveTripStatus;
  phase: LivePhase;
}

/**
 * Código de recogida de una reserva: lo genera `POST /v1/bookings/{id}/pickup-code` (devuelve el código en claro UNA vez),
 * lo conserva en memoria y lo muestra mientras el servidor siga teniendo ese mismo código activo. Si aún no existe
 * ninguno y el viaje está en marcha, lo genera solo (no invalida nada); si existe pero esta app lo perdió, NO lo regenera
 * sin que la persona lo pida.
 */
export function usePickupCode(bookingId: string, state: LivePickupCodeState | undefined, context: Context): PickupCodeController {
  const stored = useSyncExternalStore(
    subscribePickupCodes,
    () => readPickupCode(bookingId),
    () => null,
  );
  const mutation = useApiMutation(
    (_variables: void, { signal }) => generatePickupCode(bookingId, { signal }),
    {
      onSuccess: (data) => {
        rememberPickupCode(bookingId, data.code, data.generatedAt);
        const old = queryCache.getData<LiveInCarState>(liveKeys.inCar(bookingId));
        if (old !== undefined) {
          queryCache.setData<LiveInCarState>(liveKeys.inCar(bookingId), {
            ...old,
            pickupCode: {
              status: "active",
              codeLength: data.code.length,
              generatedAt: data.generatedAt,
              verifiedAt: null,
              attemptsRemaining: old.pickupCode.attemptsRemaining ?? 5,
            },
          });
        }
      },
      invalidates: [liveKeys.inCar(bookingId), liveKeys.status(bookingId)],
    },
  );

  const plain = state === undefined ? null : currentPlainCode(stored, state);
  const autoTried = useRef<string | null>(null);

  // Generación automática: una sola vez por reserva y solo cuando no existe ningún código.
  const { mutate } = mutation;
  useEffect(() => {
    if (state === undefined || autoTried.current === bookingId) return;
    if (!shouldAutoGenerate(state, context.tripStatus, context.phase)) return;
    autoTried.current = bookingId;
    void mutate();
  }, [state, context.tripStatus, context.phase, bookingId, mutate]);

  const generate = useCallback(() => {
    void mutate();
  }, [mutate]);

  const copy = useCallback(async (): Promise<boolean> => {
    if (plain === null) return false;
    return copyToClipboard(plain);
  }, [plain]);

  const kind: CodeCardKind =
    state === undefined
      ? "generating"
      : codeCardKind({
          state,
          tripStatus: context.tripStatus,
          phase: context.phase,
          plain,
          generating: mutation.isPending,
          failed: mutation.isError,
        });

  return {
    kind,
    plain,
    digits: codeDigits(plain, state?.codeLength ?? 6),
    generating: mutation.isPending,
    error: mutation.error,
    attemptsLeft: state === undefined ? null : attemptsWarning(state),
    generate,
    copy,
  };
}
