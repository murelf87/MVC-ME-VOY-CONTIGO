/**
 * Registro de peticiones del backend simulado (para el visor y las pruebas). Cada entrada lleva `simulated: true`:
 * nada de esto salió a ninguna red.
 */

export interface RequestLogEntry {
  /** Número de orden (1, 2, 3…). */
  seq: number;
  requestId: string;
  method: string;
  /** URL completa tal y como la pidió la app (con query). */
  url: string;
  path: string;
  /** `null` si la petición falló sin respuesta (modo avión, cancelación). */
  status: number | null;
  durationMs: number;
  /** Instante del reloj virtual al atender la petición. */
  virtualTime: string;
  /** Instante real (ms) del navegador. */
  hostTime: number;
  /** Latencia simulada que se aplicó. */
  latencyMs: number;
  origin: "api" | "storage";
  requestBody?: unknown;
  responseBody?: unknown;
  error?: string;
  /** Marca explícita: respuesta del backend en memoria, no de un servidor. */
  simulated: true;
}

const MAX_BODY_CHARS = 4000;

/** Trunca cuerpos grandes para no inflar la memoria del visor. */
export function clip(value: unknown): unknown {
  if (value === undefined || value === null) return value;
  try {
    const text = JSON.stringify(value);
    if (text.length <= MAX_BODY_CHARS) return value;
    return { truncated: true, preview: `${text.slice(0, MAX_BODY_CHARS)}…` };
  } catch {
    return "[no serializable]";
  }
}

export class RequestLog {
  private readonly items: RequestLogEntry[] = [];
  private counter = 0;
  private readonly listeners = new Set<(entry: RequestLogEntry) => void>();
  constructor(private readonly capacity = 300) {}

  nextSeq(): number {
    this.counter += 1;
    return this.counter;
  }

  push(entry: RequestLogEntry): void {
    this.items.push(entry);
    if (this.items.length > this.capacity) this.items.splice(0, this.items.length - this.capacity);
    for (const listener of [...this.listeners]) listener(entry);
  }

  entries(): readonly RequestLogEntry[] {
    return this.items;
  }

  last(): RequestLogEntry | undefined {
    return this.items[this.items.length - 1];
  }

  clear(): void {
    this.items.length = 0;
  }

  subscribe(listener: (entry: RequestLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
