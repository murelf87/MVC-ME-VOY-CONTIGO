/**
 * Formato de cuentas atrás y horas de la cuenta (lámina 04: «00:32»). Funciones puras: se prueban en Node.
 */

/** Segundos → «mm:ss». Negativos y no finitos cuentan como 0. */
export function formatClock(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** «29/09/2026»: fecha corta es-ES de una marca ISO; `null` si no es válida. */
export function formatShortDate(iso: string | null | undefined, timeZone = "Europe/Madrid"): string | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  try {
    return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone }).format(new Date(ms));
  } catch {
    return null;
  }
}
