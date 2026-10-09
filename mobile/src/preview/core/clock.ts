/**
 * Reloj virtual compartido por el servidor simulado (y, opcionalmente, por la app mediante `virtualDate`).
 *
 * Modos:
 *  - `frozen`  el tiempo no avanza (pruebas y capturas reproducibles). Valor por defecto del núcleo.
 *  - `running` avanza a ritmo real a partir de un instante de anclaje (vista previa interactiva: las cuentas
 *              atrás del hold de plaza, «sale en 12 min»… se mueven).
 *  - `host`    sigue el `Date.now()` de la página (Playwright puede controlarlo con su propio reloj).
 *
 * Instante por defecto = el de las láminas: lunes 5 de octubre de 2026, 07:17 (Europe/Madrid, CEST = UTC+2).
 */

/** Se captura al cargar el módulo, ANTES de que `virtualDate` sustituya `Date` global. */
const RealDate: DateConstructor = Date;
const hostNow = (): number => RealDate.now();
/**
 * `Date.now()` del DOCUMENTO tal y como esté ahora: si el visor movió el reloj (`shell.setClock`) lo refleja, y si
 * `virtualDate` está instalado devuelve el virtual (por eso el modo `host` nunca se usa junto a `virtualDate`).
 */
const documentNow = (): number => globalThis.Date.now();

export const DEFAULT_PREVIEW_NOW = "2026-10-05T07:17:00+02:00";
export const DEFAULT_PREVIEW_NOW_MS = RealDate.parse(DEFAULT_PREVIEW_NOW);

export type ClockMode = "frozen" | "running" | "host";

export interface ClockState {
  mode: ClockMode;
  /** Instante virtual (ms desde epoch) en el momento del anclaje. */
  baseMs: number;
  /** `Date.now()` real en el momento del anclaje (solo `running`; 0 en `frozen` y `host`). */
  anchorHostMs: number;
}

export type ClockInput = string | number | Date;

export function parseClockInput(input: ClockInput): number {
  const ms = input instanceof RealDate ? input.getTime() : typeof input === "number" ? input : RealDate.parse(input);
  if (!Number.isFinite(ms)) throw new Error(`Instante no válido para el reloj de la vista previa: ${String(input)}`);
  return ms;
}

export class PreviewClock {
  private mode: ClockMode;
  private baseMs: number;
  private anchorHostMs: number;
  private readonly listeners = new Set<(clock: PreviewClock) => void>();

  constructor(options: { now?: ClockInput; mode?: ClockMode } = {}) {
    this.mode = options.mode ?? "frozen";
    this.baseMs = parseClockInput(options.now ?? DEFAULT_PREVIEW_NOW);
    this.anchorHostMs = hostNow();
  }

  /** Milisegundos virtuales actuales. */
  nowMs(): number {
    switch (this.mode) {
      case "frozen":
        return this.baseMs;
      case "running":
        return this.baseMs + (hostNow() - this.anchorHostMs);
      case "host":
        return documentNow();
    }
  }

  now(): Date {
    return new RealDate(this.nowMs());
  }

  iso(): string {
    return new RealDate(this.nowMs()).toISOString();
  }

  getMode(): ClockMode {
    return this.mode;
  }

  /** Fija el instante (y opcionalmente el modo). En `host` el instante se ignora. */
  set(now: ClockInput, mode?: ClockMode): void {
    this.baseMs = parseClockInput(now);
    this.anchorHostMs = hostNow();
    if (mode) this.mode = mode;
    this.emit();
  }

  setMode(mode: ClockMode): void {
    if (mode === this.mode) return;
    // Conserva el instante actual al cambiar de modo (salvo `host`, que lo impone el navegador).
    const current = this.nowMs();
    this.baseMs = current;
    this.anchorHostMs = hostNow();
    this.mode = mode;
    this.emit();
  }

  /** Adelanta el reloj. En `host` no hace nada (lo controla el navegador). */
  advance(ms: number): void {
    if (this.mode === "host") return;
    this.baseMs = this.nowMs() + ms;
    this.anchorHostMs = hostNow();
    this.emit();
  }

  state(): ClockState {
    // `anchorHostMs` solo significa algo en `running` (recuperar el tiempo real transcurrido al restaurar). En los demás
    // modos vale 0 para que dos mundos iguales produzcan instantáneas idénticas byte a byte.
    return { mode: this.mode, baseMs: this.nowMs(), anchorHostMs: this.mode === "running" ? hostNow() : 0 };
  }

  /**
   * Restaura un estado guardado. Con `catchUp` (por defecto) un reloj `running` recupera el tiempo real que ha
   * pasado desde que se guardó (recarga de la página), para que las cuentas atrás no retrocedan.
   */
  restore(state: ClockState, catchUp = true): void {
    this.mode = state.mode;
    this.baseMs = state.mode === "running" && catchUp ? state.baseMs + Math.max(0, hostNow() - state.anchorHostMs) : state.baseMs;
    this.anchorHostMs = hostNow();
    this.emit();
  }

  onChange(listener: (clock: PreviewClock) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this);
  }
}

/** `Date` original del navegador / Node, por si algún módulo necesita saltarse la sustitución. */
export function realDate(): DateConstructor {
  return RealDate;
}

export function realNowMs(): number {
  return hostNow();
}
