/**
 * Persistencia opcional del mundo simulado en `sessionStorage` de la pestaña: recargar la página conserva lo que la
 * persona hizo (cuenta creada, solicitudes, mensajes). Se descarta si cambian el perfil, la variante de datos o el reloj
 * pedidos, y todo falla en silencio (modo privado, iframe sin almacenamiento, cuota).
 */
import type { DbSnapshot, PreviewDb } from "./core/db";
import { SNAPSHOT_VERSION } from "./core/db";

export const PERSIST_KEY = "mvc.preview.db.v1";

export interface PersistMeta {
  profile: string;
  seed: string;
  /** Reloj pedido al arrancar (texto ISO) o `null`. */
  clock: string | null;
}

interface PersistedWorld {
  meta: PersistMeta;
  snapshot: DbSnapshot;
}

function storage(): Storage | null {
  try {
    const candidate = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return candidate ?? null;
  } catch {
    return null;
  }
}

export function loadPersisted(expected: PersistMeta): DbSnapshot | null {
  try {
    const raw = storage()?.getItem(PERSIST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedWorld;
    const { meta, snapshot } = parsed;
    if (meta.profile !== expected.profile || meta.seed !== expected.seed || meta.clock !== expected.clock) return null;
    if (snapshot.version !== SNAPSHOT_VERSION) return null;
    return snapshot;
  } catch {
    return null;
  }
}

export function clearPersisted(): void {
  try {
    storage()?.removeItem(PERSIST_KEY);
  } catch {
    // nada que borrar
  }
}

export interface PersistHandle {
  stop(): void;
  /** Cambia el contexto con el que se guarda (tras `__mvc.open`). */
  setMeta(meta: PersistMeta): void;
  /** Guarda ya (sin esperar al temporizador). */
  flush(): void;
}

/** Guarda una instantánea (con retardo) tras cada cambio de la base. */
export function startPersisting(db: PreviewDb, initial: PersistMeta, delayMs = 400): PersistHandle {
  let meta = initial;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disabled = false;

  const write = (): void => {
    timer = null;
    if (disabled) return;
    try {
      const payload: PersistedWorld = { meta, snapshot: db.snapshot() };
      storage()?.setItem(PERSIST_KEY, JSON.stringify(payload));
    } catch {
      // cuota llena o almacenamiento bloqueado: se deja de intentar
      disabled = true;
    }
  };
  const off = db.onChange(() => {
    if (disabled || timer) return;
    timer = setTimeout(write, delayMs);
  });
  return {
    stop() {
      off();
      if (timer) clearTimeout(timer);
      timer = null;
    },
    setMeta(next) {
      meta = next;
    },
    flush() {
      if (timer) clearTimeout(timer);
      write();
    },
  };
}
