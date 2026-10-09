/**
 * Eventos de dominio y tareas «de fondo» de la base en memoria.
 *
 * El backend real notifica y programa trabajos DENTRO de las transacciones de sus servicios (`notify()`, barridos
 * periódicos). La vista previa no tiene procesos: los servicios de dominio emiten un evento síncrono (`events.emit`)
 * y los slices se suscriben en `registerPreview` (p. ej. el de notificaciones crea una fila de aviso). Las reglas
 * que dependen del tiempo (un hold que caduca, un viaje que arranca) se evalúan en `jobs.run()`, que se invoca al
 * principio de cada petición y, en el navegador, cada pocos segundos.
 *
 * Reglas:
 *  - Los manejadores de eventos son SÍNCRONOS y se ejecutan dentro de la operación que los emite: si lanzan, se
 *    deshace la transacción (igual que un `notify` fallido dentro de la transacción del backend).
 *  - Un nombre de evento es libre; los del núcleo están en `CoreEventName`.
 */
import type { PreviewDb } from "./db";

/**
 * Eventos que emite el núcleo (payload entre llaves). El tipo `unknown` del manejador se afina con una comprobación del slice.
 *
 *   ride_request.created   { request, trip }                 alguien pide plaza (`createRideRequestForTrip`)
 *   ride_request.decided   { request, decision, hold, trip } la conductora acepta o rechaza (`decideRideRequest`); `hold` es { id, expiresAt } o null
 *   ride_request.expired   { request }                       caduca la plaza retenida sin pago (`expireStaleHolds`)
 *   booking.confirmed      { booking, request }              pago confirmado (`confirmProviderPayment`)
 *   trip.published         { trip }                          borrador publicado (`publishTrip`)
 *   trip.started           { trip }                          la conductora inicia el viaje
 *   trip.completed         { trip }                          la conductora lo termina
 *   pickup.verified        { booking, trip }                 código de recogida verificado
 *   message.sent           { message }                       mensaje directo en el chat de un viaje
 *   location.recorded      { trip, event }                   la conductora publica su posición
 *
 * `ride_request.withdrawn` está reservado: el backend 0.14 no tiene endpoint para retirar una solicitud, así que el núcleo
 * no lo emite; el slice que añada «cancelar solicitud» debe emitirlo él.
 */
export type CoreEventName =
  | "ride_request.created"
  | "ride_request.decided"
  | "ride_request.expired"
  | "ride_request.withdrawn"
  | "booking.confirmed"
  | "trip.published"
  | "trip.started"
  | "trip.completed"
  | "pickup.verified"
  | "message.sent"
  | "location.recorded";

export type EventName = CoreEventName | (string & Record<never, never>);
export type EventHandler = (payload: unknown) => void;

export class PreviewEvents {
  private readonly handlers = new Map<string, EventHandler[]>();

  on(name: EventName, handler: EventHandler): () => void {
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
    return () => {
      const current = this.handlers.get(name);
      if (current) this.handlers.set(name, current.filter((h) => h !== handler));
    };
  }

  emit(name: EventName, payload: unknown): void {
    for (const handler of [...(this.handlers.get(name) ?? [])]) handler(payload);
  }

  /** Cuántos manejadores hay para un evento (diagnóstico y pruebas). */
  count(name: EventName): number {
    return this.handlers.get(name)?.length ?? 0;
  }

  clear(): void {
    this.handlers.clear();
  }
}

export type JobFn = (db: PreviewDb) => void;

export class PreviewJobs {
  private readonly jobs = new Map<string, JobFn>();
  private running = false;

  /** Registra (o sustituye) una tarea por nombre. Debe ser idempotente: se llama muchas veces. */
  register(name: string, job: JobFn): void {
    this.jobs.set(name, job);
  }

  unregister(name: string): void {
    this.jobs.delete(name);
  }

  names(): string[] {
    return [...this.jobs.keys()];
  }

  /** Ejecuta todas las tareas una vez. Reentrante-seguro: una tarea no puede lanzar otra pasada. */
  run(db: PreviewDb): void {
    if (this.running) return;
    this.running = true;
    try {
      for (const job of [...this.jobs.values()]) job(db);
    } finally {
      this.running = false;
    }
  }
}
