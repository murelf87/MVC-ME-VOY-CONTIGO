/**
 * Base de datos EN MEMORIA de la vista previa (SIMULACIÓN, no es el servidor de producción).
 *
 *  - Colecciones tipadas con clave primaria, índices únicos (parciales) y filas congeladas (inmutables).
 *  - Transacciones síncronas con deshacer (`db.tx`): si el callback lanza, se revierte TODO lo escrito dentro.
 *  - `snapshot()` / `restore()` serializables a JSON (la vista previa los guarda en `sessionStorage`).
 *  - Reloj virtual (`db.clock`) y azar determinista (`db.ids`) compartidos por todo el mundo simulado.
 *  - Los slices crean sus propias colecciones con `db.collection<Fila>("nombre")` (se crean al primer uso).
 *
 * REGLA: muta de forma SÍNCRONA. Entre dos `await` otra petición podría ejecutarse; los servicios de dominio
 * del backend real usan transacciones con bloqueo y aquí el equivalente es no ceder el control a mitad de una
 * operación.
 */
import { PreviewClock, DEFAULT_PREVIEW_NOW, type ClockInput, type ClockMode, type ClockState } from "./clock";
import { PreviewEvents, PreviewJobs } from "./events";
import { PreviewIds, type IdsState } from "./ids";
import type {
  AuditRow,
  BlockRow,
  BookingRow,
  ChallengeRow,
  DirectMessageRow,
  DocumentRow,
  LiveStateRow,
  LocationEventRow,
  PickupCodeRow,
  ProfileRow,
  ProvinceRow,
  RideRequestRow,
  SeatHoldRow,
  SessionRow,
  SimSmsVerificationRow,
  TripRow,
  TripSegmentRow,
  TripStopRow,
  UploadIntentRow,
  UserRoleRow,
  UserRow,
  VehicleRow,
} from "./rows";
import { BlobStore, type StoredBlobMeta } from "./storage";
import type { JsonValue, PreviewProfileId } from "./types";

export const SNAPSHOT_VERSION = 1;

/** Equivale al error 23505 (`unique_violation`) de PostgreSQL. */
export class UniqueViolation extends Error {
  readonly collection: string;
  readonly constraint: string;
  constructor(collection: string, constraint: string) {
    super(`duplicate key value violates unique constraint "${collection}_${constraint}"`);
    this.name = "UniqueViolation";
    this.collection = collection;
    this.constraint = constraint;
  }
}

export function isUniqueViolation(error: unknown): error is UniqueViolation {
  return error instanceof UniqueViolation;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  if (value instanceof Date) return value;
  Object.freeze(value);
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return value;
}

function clone<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

interface UniqueIndex<T> {
  name: string;
  keyOf: (row: T) => string | null | undefined;
  entries: Map<string, string>;
}

type Undo = () => void;

/** Servicios que una colección necesita de su base (diario de transacciones y notificación de cambios). */
interface DbHooks {
  record(undo: Undo): void;
  touch(): void;
}

export class Collection<T extends object> {
  readonly name: string;
  readonly pk: string;
  private readonly rows = new Map<string, Readonly<T>>();
  private readonly indexes: Array<UniqueIndex<T>> = [];
  private readonly hooks: DbHooks;

  constructor(name: string, pk: string, hooks: DbHooks) {
    this.name = name;
    this.pk = pk;
    this.hooks = hooks;
  }

  private keyOf(row: T): string {
    const key = (row as unknown as Record<string, unknown>)[this.pk];
    if (typeof key !== "string" && typeof key !== "number") {
      throw new Error(`${this.name}: la fila no tiene clave primaria «${this.pk}»`);
    }
    return String(key);
  }

  /**
   * Declara un índice único. `keyOf` devuelve `null`/`undefined` para las filas que NO participan (índice
   * parcial, p. ej. `where status in ('pending', …)`). Debe declararse antes de insertar filas.
   */
  unique(name: string, keyOf: (row: T) => string | null | undefined): this {
    const index: UniqueIndex<T> = { name, keyOf, entries: new Map() };
    for (const [pk, row] of this.rows) {
      const key = keyOf(row as T);
      if (key !== null && key !== undefined) index.entries.set(key, pk);
    }
    this.indexes.push(index);
    return this;
  }

  get size(): number {
    return this.rows.size;
  }

  all(): Array<Readonly<T>> {
    return [...this.rows.values()];
  }

  get(key: string): Readonly<T> | undefined {
    return this.rows.get(key);
  }

  has(key: string): boolean {
    return this.rows.has(key);
  }

  find(predicate: (row: Readonly<T>) => boolean): Readonly<T> | undefined {
    for (const row of this.rows.values()) if (predicate(row)) return row;
    return undefined;
  }

  filter(predicate: (row: Readonly<T>) => boolean): Array<Readonly<T>> {
    const out: Array<Readonly<T>> = [];
    for (const row of this.rows.values()) if (predicate(row)) out.push(row);
    return out;
  }

  count(predicate?: (row: Readonly<T>) => boolean): number {
    if (!predicate) return this.rows.size;
    let n = 0;
    for (const row of this.rows.values()) if (predicate(row)) n += 1;
    return n;
  }

  /** `insert`: falla con `UniqueViolation` si la clave o un índice único ya existen. */
  insert(row: T): Readonly<T> {
    const stored = deepFreeze(clone(row));
    const key = this.keyOf(stored);
    if (this.rows.has(key)) throw new UniqueViolation(this.name, "pkey");
    const claimed = this.claim(stored, key, null);
    this.rows.set(key, stored);
    this.hooks.record(() => {
      this.rows.delete(key);
      this.release(claimed);
    });
    this.hooks.touch();
    return stored;
  }

  /** `update`: mezcla `patch` con la fila existente. Falla si la fila no existe. */
  update(key: string, patch: Partial<T> | ((row: Readonly<T>) => Partial<T>)): Readonly<T> {
    const previous = this.rows.get(key);
    if (!previous) throw new Error(`${this.name}: no existe la fila ${key}`);
    const delta = typeof patch === "function" ? patch(previous) : patch;
    const next = deepFreeze(clone({ ...previous, ...delta } as T));
    if (this.keyOf(next) !== key) throw new Error(`${this.name}: no se puede cambiar la clave primaria`);
    const oldClaims = this.claimsOf(previous as T, key);
    this.release(oldClaims);
    let claimed: Array<[UniqueIndex<T>, string]>;
    try {
      claimed = this.claim(next, key, null);
    } catch (error) {
      for (const [index, value] of oldClaims) index.entries.set(value, key);
      throw error;
    }
    this.rows.set(key, next);
    this.hooks.record(() => {
      this.release(claimed);
      for (const [index, value] of oldClaims) index.entries.set(value, key);
      this.rows.set(key, previous);
    });
    this.hooks.touch();
    return next;
  }

  /** Inserta o sustituye (equivale a `insert … on conflict (pk) do update`). */
  put(row: T): Readonly<T> {
    const key = this.keyOf(row);
    return this.rows.has(key) ? this.update(key, row) : this.insert(row);
  }

  delete(key: string): boolean {
    const previous = this.rows.get(key);
    if (!previous) return false;
    const oldClaims = this.claimsOf(previous as T, key);
    this.release(oldClaims);
    this.rows.delete(key);
    this.hooks.record(() => {
      this.rows.set(key, previous);
      for (const [index, value] of oldClaims) index.entries.set(value, key);
    });
    this.hooks.touch();
    return true;
  }

  deleteWhere(predicate: (row: Readonly<T>) => boolean): number {
    let n = 0;
    for (const row of this.filter(predicate)) {
      if (this.delete(String((row as unknown as Record<string, unknown>)[this.pk]))) n += 1;
    }
    return n;
  }

  /** Vacía la colección sin pasar por el diario (reinicio / restauración). */
  clearSilently(): void {
    this.rows.clear();
    for (const index of this.indexes) index.entries.clear();
  }

  /** Carga una fila sin diario ni notificación (restauración de una instantánea). */
  loadSilently(row: T): void {
    const stored = deepFreeze(clone(row));
    const key = this.keyOf(stored);
    this.claim(stored, key, null);
    this.rows.set(key, stored);
  }

  toJSON(): T[] {
    return this.all() as T[];
  }

  private claimsOf(row: T, pk: string): Array<[UniqueIndex<T>, string]> {
    const out: Array<[UniqueIndex<T>, string]> = [];
    for (const index of this.indexes) {
      const value = index.keyOf(row);
      if (value !== null && value !== undefined && index.entries.get(value) === pk) out.push([index, value]);
    }
    return out;
  }

  private claim(row: T, pk: string, ignorePk: string | null): Array<[UniqueIndex<T>, string]> {
    const taken: Array<[UniqueIndex<T>, string]> = [];
    for (const index of this.indexes) {
      const value = index.keyOf(row);
      if (value === null || value === undefined) continue;
      const owner = index.entries.get(value);
      if (owner !== undefined && owner !== pk && owner !== ignorePk) {
        for (const [i, v] of taken) i.entries.delete(v);
        throw new UniqueViolation(this.name, index.name);
      }
      index.entries.set(value, pk);
      taken.push([index, value]);
    }
    return taken;
  }

  private release(claims: Array<[UniqueIndex<T>, string]>): void {
    for (const [index, value] of claims) index.entries.delete(value);
  }
}

export interface CollectionOptions {
  /** Nombre de la propiedad que actúa como clave primaria (por defecto `id`). */
  pk?: string;
}

export interface DbSnapshot {
  version: number;
  profile: PreviewProfileId;
  seedName: string;
  clock: ClockState;
  ids: IdsState;
  kv: Record<string, JsonValue>;
  blobs: StoredBlobMeta[];
  collections: Record<string, { pk: string; rows: unknown[] }>;
}

export interface PreviewDbOptions {
  /** Semilla del azar determinista. */
  seed?: string;
  /** Instante inicial del reloj virtual (por defecto, el de las láminas). */
  now?: ClockInput;
  clockMode?: ClockMode;
}

export class PreviewDb {
  readonly clock: PreviewClock;
  readonly ids: PreviewIds;
  readonly blobs = new BlobStore();
  /** Eventos de dominio síncronos (los slices se suscriben en `registerPreview`). */
  readonly events = new PreviewEvents();
  /** Tareas dependientes del tiempo (caducidad de holds…); se ejecutan al inicio de cada petición. */
  readonly jobs = new PreviewJobs();

  /** Perfil de prueba con el que se sembró el mundo. */
  profile: PreviewProfileId = "new";
  /** Nombre de la variante de datos («seed» del escenario). */
  seedName = "default";

  private readonly collections = new Map<string, Collection<object>>();
  private readonly kv = new Map<string, JsonValue>();
  private journal: Undo[] = [];
  private depth = 0;
  private readonly listeners = new Set<() => void>();
  private revision = 0;

  private readonly hooks: DbHooks = {
    record: (undo) => {
      if (this.depth > 0) this.journal.push(undo);
    },
    touch: () => {
      this.revision += 1;
      for (const listener of [...this.listeners]) listener();
    },
  };

  // ---- tablas base (migraciones 001–012) ----
  readonly users: Collection<UserRow>;
  readonly userRoles: Collection<UserRoleRow>;
  readonly profiles: Collection<ProfileRow>;
  readonly challenges: Collection<ChallengeRow>;
  readonly sessions: Collection<SessionRow>;
  readonly vehicles: Collection<VehicleRow>;
  readonly documents: Collection<DocumentRow>;
  readonly uploadIntents: Collection<UploadIntentRow>;
  readonly provinces: Collection<ProvinceRow>;
  readonly trips: Collection<TripRow>;
  readonly tripStops: Collection<TripStopRow>;
  readonly tripSegments: Collection<TripSegmentRow>;
  readonly rideRequests: Collection<RideRequestRow>;
  readonly seatHolds: Collection<SeatHoldRow>;
  readonly bookings: Collection<BookingRow>;
  readonly pickupCodes: Collection<PickupCodeRow>;
  readonly locationEvents: Collection<LocationEventRow>;
  readonly liveState: Collection<LiveStateRow>;
  readonly messages: Collection<DirectMessageRow>;
  readonly blocks: Collection<BlockRow>;
  readonly audit: Collection<AuditRow>;
  readonly simSms: Collection<SimSmsVerificationRow>;

  constructor(options: PreviewDbOptions = {}) {
    this.clock = new PreviewClock({ now: options.now ?? DEFAULT_PREVIEW_NOW, mode: options.clockMode ?? "frozen" });
    this.ids = new PreviewIds(options.seed ?? "mvc-preview-v1");

    this.users = this.collection<UserRow>("users").unique("phone_e164", (r) => r.phone_e164);
    this.userRoles = this.collection<UserRoleRow>("user_roles");
    this.profiles = this.collection<ProfileRow>("profiles", { pk: "user_id" });
    this.challenges = this.collection<ChallengeRow>("auth_challenges");
    this.sessions = this.collection<SessionRow>("auth_sessions").unique("token_hash", (r) => r.token_hash);
    this.vehicles = this.collection<VehicleRow>("vehicles").unique("plate_normalized", (r) => r.plate_normalized);
    this.documents = this.collection<DocumentRow>("private_documents").unique(
      "storage_key",
      (r) => `${r.storage_provider}|${r.storage_key}`
    );
    this.uploadIntents = this.collection<UploadIntentRow>("private_upload_intents");
    this.provinces = this.collection<ProvinceRow>("provinces");
    this.trips = this.collection<TripRow>("trips");
    this.tripStops = this.collection<TripStopRow>("trip_stops").unique("trip_seq", (r) => `${r.trip_id}:${r.seq}`);
    this.tripSegments = this.collection<TripSegmentRow>("trip_segments").unique("trip_seq", (r) => `${r.trip_id}:${r.seq}`);
    this.rideRequests = this.collection<RideRequestRow>("ride_requests").unique("open_exact_uidx", (r) =>
      ["pending", "accepted", "payment_pending", "confirmed"].includes(r.status)
        ? `${r.trip_id}|${r.passenger_user_id}|${r.from_segment_seq}|${r.to_segment_seq}`
        : null
    );
    this.seatHolds = this.collection<SeatHoldRow>("seat_holds").unique("request_id", (r) => r.request_id);
    this.bookings = this.collection<BookingRow>("bookings")
      .unique("request_id", (r) => r.request_id)
      .unique("provider_payment_id", (r) => r.provider_payment_id);
    this.pickupCodes = this.collection<PickupCodeRow>("booking_pickup_codes");
    this.locationEvents = this.collection<LocationEventRow>("trip_location_events").unique(
      "trip_event",
      (r) => `${r.trip_id}|${r.event_id}`
    );
    this.liveState = this.collection<LiveStateRow>("trip_live_state");
    this.messages = this.collection<DirectMessageRow>("trip_direct_messages").unique(
      "sender_client_message",
      (r) => `${r.sender_user_id}|${r.client_message_id}`
    );
    this.blocks = this.collection<BlockRow>("user_blocks");
    this.audit = this.collection<AuditRow>("audit_events");
    this.simSms = this.collection<SimSmsVerificationRow>("sim_sms_verifications");
  }

  /** Colección por nombre; se crea en el primer uso (así cada slice añade las suyas sin tocar el núcleo). */
  collection<T extends object>(name: string, options: CollectionOptions = {}): Collection<T> {
    const pk = options.pk ?? "id";
    const existing = this.collections.get(name);
    if (existing) {
      if (existing.pk !== pk) throw new Error(`La colección «${name}» ya existe con otra clave primaria («${existing.pk}»)`);
      return existing as unknown as Collection<T>;
    }
    const created = new Collection<T>(name, pk, this.hooks);
    this.collections.set(name, created as unknown as Collection<object>);
    return created;
  }

  collectionNames(): string[] {
    return [...this.collections.keys()];
  }

  // ---- tiempo ----

  nowMs(): number {
    return this.clock.nowMs();
  }

  // ---- ajustes clave/valor (JSON) ----

  getSetting<T extends JsonValue>(key: string): T | undefined {
    return this.kv.get(key) as T | undefined;
  }

  setSetting(key: string, value: JsonValue): void {
    this.kv.set(key, value);
    this.hooks.touch();
  }

  deleteSetting(key: string): void {
    if (this.kv.delete(key)) this.hooks.touch();
  }

  // ---- transacciones ----

  /**
   * Ejecuta `fn` de forma atómica: si lanza, se deshacen todas las escrituras hechas dentro (incluidas las de
   * transacciones anidadas ya «confirmadas»). `fn` debe ser síncrona.
   */
  tx<R>(fn: () => R): R {
    const mark = this.journal.length;
    this.depth += 1;
    let result: R;
    try {
      result = fn();
      if (typeof (result as { then?: unknown } | null)?.then === "function") {
        throw new Error("db.tx() solo admite funciones síncronas");
      }
    } catch (error) {
      for (let i = this.journal.length - 1; i >= mark; i -= 1) this.journal[i]?.();
      this.journal.length = mark;
      this.depth -= 1;
      this.hooks.touch();
      throw error;
    }
    this.depth -= 1;
    if (this.depth === 0) this.journal.length = 0;
    return result;
  }

  // ---- cambios ----

  /** Se llama tras cada escritura. Devuelve la función para darse de baja. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Contador que aumenta con cada escritura (útil para cachés y pruebas). */
  getRevision(): number {
    return this.revision;
  }

  // ---- instantáneas ----

  snapshot(): DbSnapshot {
    const collections: DbSnapshot["collections"] = {};
    for (const [name, collection] of this.collections) {
      collections[name] = { pk: collection.pk, rows: collection.all() as unknown[] };
    }
    const kv: Record<string, JsonValue> = {};
    for (const [key, value] of this.kv) kv[key] = value;
    return clone({
      version: SNAPSHOT_VERSION,
      profile: this.profile,
      seedName: this.seedName,
      clock: this.clock.state(),
      ids: this.ids.state(),
      kv,
      blobs: this.blobs.metadata(),
      collections,
    });
  }

  restore(snapshot: DbSnapshot): void {
    if (snapshot.version !== SNAPSHOT_VERSION) throw new Error(`Versión de instantánea no soportada: ${snapshot.version}`);
    this.clearAll();
    this.profile = snapshot.profile;
    this.seedName = snapshot.seedName;
    this.clock.restore(snapshot.clock);
    this.ids.restore(snapshot.ids);
    for (const [key, value] of Object.entries(snapshot.kv)) this.kv.set(key, value);
    this.blobs.restoreMetadata(snapshot.blobs);
    for (const [name, data] of Object.entries(snapshot.collections)) {
      const collection = this.collection<object>(name, { pk: data.pk });
      for (const row of data.rows) collection.loadSilently(row as object);
    }
    this.journal.length = 0;
    this.hooks.touch();
  }

  /** Vacía todo (colecciones, ajustes, objetos) sin tocar reloj ni azar. */
  clearAll(): void {
    for (const collection of this.collections.values()) collection.clearSilently();
    this.kv.clear();
    this.blobs.clear();
    this.journal.length = 0;
    this.depth = 0;
  }

  /**
   * Reinicia el mundo: vacía los datos, reinicia el azar con `seed` y fija el reloj. NO siembra; el sembrado lo
   * hace `seedWorld` (`seeds/index.ts`).
   */
  resetEmpty(options: { seed?: string; now?: ClockInput; clockMode?: ClockMode } = {}): void {
    this.clearAll();
    this.ids.reseed(options.seed ?? this.ids.seed);
    this.clock.set(options.now ?? DEFAULT_PREVIEW_NOW, options.clockMode ?? this.clock.getMode());
    this.hooks.touch();
  }
}

export function createPreviewDb(options: PreviewDbOptions = {}): PreviewDb {
  return new PreviewDb(options);
}
