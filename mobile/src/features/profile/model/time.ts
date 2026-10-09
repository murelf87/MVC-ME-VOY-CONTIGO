/**
 * Horas de reloj «HH:mm» (Europe/Madrid) de la rutina semanal: lectura, formato y comprobación. Funciones puras.
 */
export interface ClockTime {
  hour: number;
  minute: number;
}

const CLOCK = /^(\d{1,2}):(\d{2})$/;

/** `7:05` | `07:05` → `{ hour: 7, minute: 5 }`. `null` si no es una hora válida (00:00–23:59). */
export function parseClock(value: string): ClockTime | null {
  const match = CLOCK.exec(value.trim());
  if (match === null) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `{ hour: 7, minute: 5 }` → `07:05`. */
export function formatClock(time: ClockTime): string {
  return `${pad2(time.hour)}:${pad2(time.minute)}`;
}

export function isClock(value: string): boolean {
  return parseClock(value) !== null;
}

/** Horas del selector (0–23) y minutos de 5 en 5, como en los selectores de las láminas. */
export const CLOCK_HOURS: readonly number[] = Array.from({ length: 24 }, (_, hour) => hour);
export const CLOCK_MINUTE_STEPS: readonly number[] = Array.from({ length: 12 }, (_, index) => index * 5);

/** Minuto del selector más cercano (de 5 en 5) a un minuto cualquiera: `07:32` → 30. */
export function nearestMinuteStep(minute: number): number {
  const clamped = Math.min(59, Math.max(0, Math.round(minute)));
  return Math.min(55, Math.round(clamped / 5) * 5);
}

/** Orden de horas «HH:mm» (texto con ceros a la izquierda ordena como el reloj). */
export function compareClock(a: string, b: string): number {
  const left = parseClock(a);
  const right = parseClock(b);
  if (left === null || right === null) return a.localeCompare(b);
  return left.hour * 60 + left.minute - (right.hour * 60 + right.minute);
}
