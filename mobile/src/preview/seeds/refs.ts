/**
 * Referencias simbólicas a datos sembrados.
 *
 * Un escenario de diseño (`design/scenarios/*.json`) necesita ids para abrir pantallas como «Estado de la solicitud»
 * (`requestId`) o «Esperando al coche» (`bookingId`), pero esos ids nacen al sembrar. En lugar del id, el escenario escribe
 *
 *     "params": { "requestId": { "$ref": "request.miguel" } }
 *
 * y `window.__mvc.open(...)` lo sustituye por el id real DESPUÉS de sembrar el mundo. Los nombres de referencia:
 *
 *   user.<clave>        personas del reparto (`user.ana`, `user.miguel`, `user.staff`…)         → constante
 *   trip.<clave>        viajes de las láminas (`trip.anaMorning`, `trip.martaWork`…)             → constante
 *   vehicle.<clave>     vehículos sembrados (`vehicle.anaArona`…)                                → constante
 *   request.<persona>   su solicitud MÁS RECIENTE en el viaje de Ana de las 08:05 (`miguel`, `laura`, `hugo`, `nuria`)
 *   booking.<persona>   la reserva de esa solicitud (`miguel`, `laura`)
 *
 * Los slices añaden las suyas con `registerSeedRef("conversation.miguel", (db) => …)` en `registerPreview`.
 */
import type { PreviewDb } from "../core/db";
import { newestFirst } from "../core/order";
import { SEED_TRIP_IDS, SEED_USER_IDS, SEED_VEHICLE_IDS } from "./ids";

/** Devuelve el id o `undefined` si en este mundo no existe (p. ej. no hay solicitud de Miguel en «default»). */
export type SeedRefResolver = (db: PreviewDb) => string | undefined;

export class SeedRefError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeedRefError";
  }
}

const REF_NAME = /^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;
const registry = new Map<string, SeedRefResolver>();

/** Registra (o sustituye) una referencia. El nombre es `grupo.clave`, por ejemplo `conversation.miguel`. */
export function registerSeedRef(name: string, resolver: SeedRefResolver): void {
  if (!REF_NAME.test(name)) throw new Error(`Nombre de referencia no válido: «${name}» (usa «grupo.clave», p. ej. request.miguel)`);
  registry.set(name, resolver);
}

/** Retira una referencia (pruebas). Devuelve `true` si existía. */
export function unregisterSeedRef(name: string): boolean {
  return registry.delete(name);
}

export function seedRefNames(): string[] {
  return [...registry.keys()].sort();
}

/** Id al que apunta la referencia en este mundo, o `undefined`. Lanza si el nombre no está registrado. */
export function resolveSeedRef(db: PreviewDb, name: string): string | undefined {
  const resolver = registry.get(name);
  if (!resolver) {
    const known = seedRefNames();
    const sample = known.slice(0, 12).join(", ");
    throw new SeedRefError(`Referencia desconocida «${name}». Hay ${known.length}: ${sample}${known.length > 12 ? "…" : ""}`);
  }
  return resolver(db);
}

/** Todas las referencias resueltas en este mundo (`null` = no existe aquí). Lo expone `window.__mvc.refs()`. */
export function resolveAllSeedRefs(db: PreviewDb): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const name of seedRefNames()) out[name] = resolveSeedRef(db, name) ?? null;
  return out;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Sustituye, en cualquier profundidad de `value`, cada objeto `{ "$ref": "nombre" }` por el id que designa. Lanza
 * `SeedRefError` con un mensaje accionable si el nombre no existe o no se puede resolver en este mundo.
 */
export function resolveRefsIn<T>(db: PreviewDb, value: T): T {
  const walk = (node: unknown, path: string): unknown => {
    if (Array.isArray(node)) return node.map((item, index) => walk(item, `${path}[${index}]`));
    if (!isPlainObject(node)) return node;
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === "$ref") {
      const name = node.$ref;
      if (typeof name !== "string") throw new SeedRefError(`${path}.$ref debe ser un texto con el nombre de la referencia`);
      const id = resolveSeedRef(db, name);
      if (id === undefined) {
        throw new SeedRefError(
          `La referencia «${name}» no existe en este mundo (perfil «${db.profile}», variante «${db.seedName}»). ` +
            "Elige otra variante (window.__mvc.seeds()) o consulta window.__mvc.refs()."
        );
      }
      return id;
    }
    const out: Record<string, unknown> = {};
    for (const key of keys) out[key] = walk(node[key], path === "$" ? key : `${path}.${key}`);
    return out;
  };
  return walk(value, "$") as T;
}

// ---------------------------------------------------------------------------------------------------------------
// Referencias incorporadas
// ---------------------------------------------------------------------------------------------------------------

for (const [key, id] of Object.entries(SEED_USER_IDS)) registerSeedRef(`user.${key}`, () => id);
for (const [key, id] of Object.entries(SEED_TRIP_IDS)) registerSeedRef(`trip.${key}`, () => id);
for (const [key, id] of Object.entries(SEED_VEHICLE_IDS)) registerSeedRef(`vehicle.${key}`, () => id);

type PassengerKey = "miguel" | "laura" | "hugo" | "nuria";
const PASSENGERS: readonly PassengerKey[] = ["miguel", "laura", "hugo", "nuria"];

function latestRequestId(db: PreviewDb, person: PassengerKey): string | undefined {
  const mine = db.rideRequests.filter((r) => r.trip_id === SEED_TRIP_IDS.anaMorning && r.passenger_user_id === SEED_USER_IDS[person]);
  return newestFirst(mine, (r) => r.requested_at)[0]?.id;
}

for (const person of PASSENGERS) {
  registerSeedRef(`request.${person}`, (db) => latestRequestId(db, person));
  registerSeedRef(`booking.${person}`, (db) => {
    const requestId = latestRequestId(db, person);
    return requestId === undefined ? undefined : db.bookings.find((b) => b.request_id === requestId)?.id;
  });
}
