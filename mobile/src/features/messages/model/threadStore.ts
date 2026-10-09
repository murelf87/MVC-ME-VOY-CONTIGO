/**
 * Almacén en memoria con el hilo de cada chat abierto en esta sesión (pantalla 26).
 *
 * Vive FUERA de los componentes para que lo que ocurre con un mensaje no dependa de que la pantalla siga montada:
 *  - un envío que termina (o falla) cuando la persona ya ha salido del chat se anota igualmente;
 *  - al volver al chat se ve al instante lo que había (y se sincroniza en segundo plano con `afterSeq`);
 *  - un mensaje que no se pudo enviar por falta de red sigue ahí, con su «Reintentar», en vez de perderse.
 *
 * Es una clase sin React ni red (se prueba en Node). Los hooks se suscriben con `useSyncExternalStore`. El almacén se
 * vacía al cerrar sesión (`useChatThread` lo conecta a `onSessionCleared`): jamás se ven mensajes de otra cuenta.
 */
import { EMPTY_THREAD, type ThreadState } from "./chat";

type Listener = () => void;

/** Chats que se conservan a la vez; al pasarse, se descartan los menos recientes que no tengan nada pendiente. */
export const THREAD_STORE_CAPACITY = 30;

export class ThreadStore {
  private readonly threads = new Map<string, ThreadState>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly capacity: number = THREAD_STORE_CAPACITY) {}

  /** Hilo de un chat (`EMPTY_THREAD`, siempre el mismo objeto, si aún no se ha abierto). */
  get(conversationId: string): ThreadState {
    return this.threads.get(conversationId) ?? EMPTY_THREAD;
  }

  /** Cambia el hilo con una función pura de `model/chat`. Si devuelve el mismo objeto, no avisa a nadie. */
  update(conversationId: string, change: (state: ThreadState) => ThreadState): void {
    const current = this.get(conversationId);
    const next = change(current);
    if (next === current) return;
    // Se reinserta para que el orden del mapa sea el de uso (el último, el más reciente).
    this.threads.delete(conversationId);
    this.threads.set(conversationId, next);
    this.evict(conversationId);
    this.emit(conversationId);
  }

  subscribe(conversationId: string, listener: Listener): () => void {
    let set = this.listeners.get(conversationId);
    if (set === undefined) {
      set = new Set();
      this.listeners.set(conversationId, set);
    }
    set.add(listener);
    return () => {
      const current = this.listeners.get(conversationId);
      if (current === undefined) return;
      current.delete(listener);
      if (current.size === 0) this.listeners.delete(conversationId);
    };
  }

  /** Olvida todos los hilos (cierre de sesión). Los observadores vuelven a ver un hilo vacío. */
  clear(): void {
    const ids = [...this.threads.keys()];
    this.threads.clear();
    for (const id of ids) this.emit(id);
  }

  /** Cuántos hilos hay guardados (pruebas). */
  get size(): number {
    return this.threads.size;
  }

  private evict(keep: string): void {
    if (this.threads.size <= this.capacity) return;
    for (const [id, state] of this.threads) {
      if (this.threads.size <= this.capacity) return;
      if (id === keep) continue;
      if (state.pending.length > 0) continue; // un mensaje sin enviar nunca se tira
      if ((this.listeners.get(id)?.size ?? 0) > 0) continue; // ni el de una pantalla que lo está mirando
      this.threads.delete(id);
      this.emit(id);
    }
  }

  private emit(conversationId: string): void {
    const set = this.listeners.get(conversationId);
    if (set === undefined) return;
    for (const listener of [...set]) listener();
  }
}

/** Almacén único de la app. */
export const threadStore = new ThreadStore();
