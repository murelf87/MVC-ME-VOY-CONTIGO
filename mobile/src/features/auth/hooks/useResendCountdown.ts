import { formatClock } from "../logic/format";
import { isChallengeExpired, resendRemainingSeconds, sentAtMs } from "../logic/otp";
import { useNow } from "./useNow";

export interface ResendCountdown {
  /** Segundos que faltan para poder pedir otro código (0 = ya se puede). */
  seconds: number;
  /** «00:32». */
  clock: string;
  /** Ya se puede pedir otro código. */
  ready: boolean;
  /** El código actual ya caducó (pasaron 10 minutos). */
  expired: boolean;
  /** Hora (ms) de la que parte la cuenta (la del último envío), o `null` si la caducidad no es válida. */
  sentAt: number | null;
}

/**
 * Cuenta atrás de «Reenviar código» y caducidad del código, derivadas de `expiresAt` (la respuesta de «iniciar» solo
 * trae la caducidad; el envío fue 600 s antes). Se recalcula cada segundo mientras la pantalla está a la vista.
 */
export function useResendCountdown(expiresAtIso: string): ResendCountdown {
  const now = useNow(1_000);
  const sentAt = sentAtMs(expiresAtIso);
  const seconds = resendRemainingSeconds(sentAt, now);
  return { seconds, clock: formatClock(seconds), ready: seconds === 0, expired: isChallengeExpired(expiresAtIso, now), sentAt };
}
