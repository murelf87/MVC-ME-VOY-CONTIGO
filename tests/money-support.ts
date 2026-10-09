/**
 * Soporte de las pruebas del módulo `money` (solo pruebas; NO es código de producción).
 *
 * Contiene un proveedor de pagos DE PRUEBA que implementa la interfaz `PaymentProvider` para poder ejercitar los caminos con
 * proveedor activo (intentos, devoluciones, abonos, webhooks firmados). No existe ningún proveedor real ni se simula uno en `src/`.
 * Los importes de las cotizaciones de este fichero son datos de prueba, NO tarifas.
 */
import { createHash, randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import pg from "pg";
import { createRawSessionToken, hashSessionToken } from "../src/auth/session.js";
import { DomainError } from "../src/errors.js";
import { registerMoneyRoutes } from "../src/modules/money/routes/register.js";
import { computeHmacSha256Hex, verifyHmacSha256Signature, WEBHOOK_SIGNATURE_HEADER } from "../src/modules/money/provider/webhook-signature.js";
import type {
  AttachedMethod,
  AttachMethodInput,
  CreatedPaymentIntent,
  CreatePaymentIntentInput,
  CreatePayoutInput,
  NormalizedProviderEvent,
  PaymentProvider,
  RefundPaymentInput,
  SubmittedPayout,
  SubmittedRefund,
  WebhookHeaders
} from "../src/modules/money/provider/types.js";

const { Pool } = pg;

export function createTestPool(): pg.Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL required for integration tests");
  return new Pool({ connectionString: databaseUrl });
}

/* ───────────────────────── Proveedor de pruebas ───────────────────────── */

export const TEST_WEBHOOK_SECRET = "whsec_test_secret_0123456789abcdef";

export type StubWebhookEvent = {
  id: string;
  object: "payment" | "refund" | "payout";
  type: string;
  /** payment: ref del pago · refund: ref de la devolución · payout: ref del abono */
  ref: string;
  paymentRef?: string;
  amountCents?: number | null;
  currency?: string | null;
  failureCode?: string | null;
  occurredAt?: string;
};

export class StubPaymentProvider implements PaymentProvider {
  readonly name = "stubpay";
  readonly enabled = true;
  readonly capabilities: PaymentProvider["capabilities"];
  readonly intents = new Map<string, CreatedPaymentIntent & { input: CreatePaymentIntentInput }>();
  readonly refunds = new Map<string, SubmittedRefund & { input: RefundPaymentInput }>();
  readonly payouts = new Map<string, SubmittedPayout & { input: CreatePayoutInput }>();
  readonly detached: string[] = [];
  calls = { createPaymentIntent: 0, refundPayment: 0, createPayout: 0 };
  /** Si se rellena, la siguiente llamada al proveedor (intento, devolución, abono, alta o baja de método) falla con un error genérico. */
  failNext = false;
  private counter = 0;

  constructor(
    /** `null` = secreto de webhook NO configurado (el adaptador debe rechazar todo con 503). */
    readonly secret: string | null = TEST_WEBHOOK_SECRET,
    capabilities?: Partial<PaymentProvider["capabilities"]>
  ) {
    this.capabilities = { chargeMethods: ["apple_pay", "google_pay", "card"], payouts: true, refunds: true, ...capabilities };
  }

  private maybeFail(): void {
    if (this.failNext) {
      this.failNext = false;
      throw new Error("simulated provider outage");
    }
  }

  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<CreatedPaymentIntent> {
    this.calls.createPaymentIntent += 1;
    this.maybeFail();
    const prior = this.intents.get(input.idempotencyKey);
    if (prior) return prior;
    this.counter += 1;
    const created: CreatedPaymentIntent = {
      providerPaymentRef: `pi_stub_${this.counter}`,
      status: "requires_action",
      clientAction: { type: "sdk_payment_sheet", clientSecret: `cs_stub_${this.counter}`, redirectUrl: null }
    };
    this.intents.set(input.idempotencyKey, { ...created, input });
    return created;
  }

  async refundPayment(input: RefundPaymentInput): Promise<SubmittedRefund> {
    this.calls.refundPayment += 1;
    this.maybeFail();
    const prior = this.refunds.get(input.idempotencyKey);
    if (prior) return prior;
    this.counter += 1;
    const submitted: SubmittedRefund = { providerRefundRef: `re_stub_${this.counter}` };
    this.refunds.set(input.idempotencyKey, { ...submitted, input });
    return submitted;
  }

  async attachMethod(input: AttachMethodInput): Promise<AttachedMethod> {
    this.maybeFail();
    const card = /^tok_card_([a-z]+)_([0-9]{4})$/.exec(input.providerToken);
    if (card) {
      return { providerMethodRef: `pm_${input.providerToken}`, kind: "card", brand: card[1]!, last4: card[2]!, country: "ES", expMonth: 12, expYear: 2031 };
    }
    const iban = /^tok_iban_([0-9]{4})$/.exec(input.providerToken);
    if (iban) {
      return { providerMethodRef: `pm_${input.providerToken}`, kind: "bank_account", brand: null, last4: iban[1]!, country: "ES", expMonth: null, expYear: null };
    }
    throw new DomainError("PAYMENT_METHOD_NOT_AVAILABLE", "Token no reconocido por el proveedor de pruebas.", 409);
  }

  async detachMethod(providerMethodRef: string): Promise<void> {
    this.maybeFail();
    this.detached.push(providerMethodRef);
  }

  async createPayout(input: CreatePayoutInput): Promise<SubmittedPayout> {
    this.calls.createPayout += 1;
    this.maybeFail();
    const prior = this.payouts.get(input.idempotencyKey);
    if (prior) return prior;
    this.counter += 1;
    const submitted: SubmittedPayout = { providerPayoutRef: `po_stub_${this.counter}` };
    this.payouts.set(input.idempotencyKey, { ...submitted, input });
    return submitted;
  }

  verifyAndParseWebhook(rawBody: Buffer, headers: WebhookHeaders): NormalizedProviderEvent[] {
    const header = headers[WEBHOOK_SIGNATURE_HEADER];
    verifyHmacSha256Signature({ secret: this.secret ?? undefined, rawBody, header: Array.isArray(header) ? header[0] : header });
    let parsed: { events?: StubWebhookEvent[] };
    try {
      parsed = JSON.parse(rawBody.toString("utf8")) as { events?: StubWebhookEvent[] };
    } catch {
      throw new DomainError("WEBHOOK_PAYLOAD_INVALID", "Cuerpo no interpretable.", 400);
    }
    if (!Array.isArray(parsed.events)) throw new DomainError("WEBHOOK_PAYLOAD_INVALID", "Faltan eventos.", 400);
    return parsed.events.map(event => {
      const base = { provider: this.name, eventId: event.id, occurredAt: new Date(event.occurredAt ?? Date.now()) };
      if (event.object === "payment") {
        return {
          ...base,
          object: "payment" as const,
          type: event.type as "requires_action" | "processing" | "succeeded" | "failed" | "expired",
          providerPaymentRef: event.ref,
          amountCents: event.amountCents ?? null,
          currency: event.currency ?? null,
          failureCode: event.failureCode ?? null
        };
      }
      if (event.object === "refund") {
        return {
          ...base,
          object: "refund" as const,
          type: event.type as "succeeded" | "failed",
          providerRefundRef: event.ref,
          providerPaymentRef: event.paymentRef ?? "",
          amountCents: event.amountCents ?? 0,
          failureCode: event.failureCode ?? null
        };
      }
      return {
        ...base,
        object: "payout" as const,
        type: event.type as "paid" | "failed",
        providerPayoutRef: event.ref,
        amountCents: event.amountCents ?? 0,
        failureCode: event.failureCode ?? null
      };
    });
  }
}

/* ───────────────────────── Aplicación y peticiones ───────────────────────── */

export async function buildTestApp(pool: pg.Pool, provider: PaymentProvider): Promise<FastifyInstance> {
  // MONEY_TEST_LOG=1 activa el registro de errores del servidor para depurar un 500 inesperado.
  const app = Fastify({ logger: process.env.MONEY_TEST_LOG ? { level: "error" } : false });
  await app.register(async scope => {
    await registerMoneyRoutes(scope, { pool }, { provider });
  });
  await app.ready();
  return app;
}

export type Actor = { id: string; token: string; name: string };

export function bearer(actor: Actor): Record<string, string> {
  return { authorization: `Bearer ${actor.token}` };
}

export function newKey(): string {
  return randomUUID();
}

export function signedWebhookHeaders(
  body: string,
  options: { secret?: string; timestampSeconds?: number } = {}
): Record<string, string> {
  const t = options.timestampSeconds ?? Math.floor(Date.now() / 1000);
  const signature = computeHmacSha256Hex(options.secret ?? TEST_WEBHOOK_SECRET, t, Buffer.from(body, "utf8"));
  return { "content-type": "application/json", [WEBHOOK_SIGNATURE_HEADER]: `t=${t},v1=${signature}` };
}

let eventCounter = 0;
export function nextEventId(prefix = "evt"): string {
  eventCounter += 1;
  return `${prefix}_${process.pid}_${eventCounter}`;
}

export async function postWebhook(
  app: FastifyInstance,
  events: StubWebhookEvent[],
  options: { secret?: string; timestampSeconds?: number; headers?: Record<string, string> } = {}
) {
  const body = JSON.stringify({ events });
  return app.inject({
    method: "POST",
    url: "/v1/webhooks/payments",
    headers: options.headers ?? signedWebhookHeaders(body, options),
    payload: body
  });
}

/* ───────────────────────── Datos ───────────────────────── */

export async function resetMoneyData(pool: pg.Pool): Promise<void> {
  // `plans` (catálogo sembrado por la migración) NO se trunca.
  await pool.query(`
    truncate table
      payout_run_items, payout_runs, refund_requests, receipts, receipt_counters, ledger_entries, ledger_transactions,
      payment_events, payments, cancellation_policies, payment_methods, idempotency_keys, notifications, audit_events,
      auth_sessions, quote_snapshots, tariff_versions, payment_compensations, bookings, seat_holds, ride_requests,
      trip_segments, trip_stops, trips, vehicles, profiles, user_roles, app_users, provinces
    restart identity cascade`);
}

export async function createActor(
  pool: pg.Pool,
  name: string,
  roles: Array<"passenger" | "driver" | "admin" | "finance_admin" | "support_admin" | "verification_admin">
): Promise<Actor> {
  const user = (await pool.query<{ id: string }>(`insert into app_users default values returning id`)).rows[0]!.id;
  for (const role of roles) await pool.query(`insert into user_roles(user_id,role) values($1,$2)`, [user, role]);
  await pool.query(
    `insert into profiles(user_id,display_name,public_photo_status,identity_status) values($1,$2,'approved','verified')`,
    [user, name]
  );
  const token = createRawSessionToken();
  await pool.query(`insert into auth_sessions(user_id,token_hash,expires_at) values($1,$2,now() + interval '1 day')`, [
    user,
    hashSessionToken(token)
  ]);
  return { id: user, token, name };
}

export type World = {
  ana: Actor;
  miguel: Actor;
  lucia: Actor;
  finance: Actor;
  admin: Actor;
  support: Actor;
  verification: Actor;
  provinceId: string;
  vehicleId: string;
};

/** Sevilla: conductora Ana García López, pasajeros Miguel Torres y Lucía Ramos, y un usuario de cada rol administrativo. */
export async function seedWorld(pool: pg.Pool): Promise<World> {
  const ana = await createActor(pool, "Ana García López", ["driver", "passenger"]);
  const miguel = await createActor(pool, "Miguel Torres", ["passenger"]);
  const lucia = await createActor(pool, "Lucía Ramos", ["passenger"]);
  const finance = await createActor(pool, "Elena Finanzas", ["finance_admin"]);
  const admin = await createActor(pool, "Root Admin", ["admin"]);
  const support = await createActor(pool, "Sara Soporte", ["support_admin"]);
  const verification = await createActor(pool, "Víctor Verificación", ["verification_admin"]);
  const province = (
    await pool.query<{ id: string }>(`
      insert into provinces(code,name,source_name,geom)
      values('SE','Sevilla','integration-test',
        ST_Multi(ST_GeomFromText('POLYGON((0 0,10 0,10 10,0 10,0 0))',4326)))
      returning id`)
  ).rows[0]!.id;
  const vehicle = (
    await pool.query<{ id: string }>(
      `insert into vehicles(driver_user_id,make,model,plate,passenger_seats,review_status,documentation_status,vehicle_photo_status,insurance_status,insurance_expires_on)
       values($1,'Seat','Ibiza','1234-ABC',3,'approved','approved','approved','approved',current_date+30) returning id`,
      [ana.id]
    )
  ).rows[0]!.id;
  return { ana, miguel, lucia, finance, admin, support, verification, provinceId: province, vehicleId: vehicle };
}

/** Viaje publicado Sevilla Centro → Isla Mágica con 2 segmentos de capacidad `capacity`. */
export async function seedTrip(
  pool: pg.Pool,
  world: World,
  options: { capacity?: number; departureInterval?: string } = {}
): Promise<string> {
  const capacity = options.capacity ?? 2;
  const trip = (
    await pool.query<{ id: string }>(
      `insert into trips(driver_user_id,vehicle_id,province_id,category,kind,leg,status,departure_at,offered_seats,
                         origin_geom,destination_geom,route_geom,route_distance_m,route_duration_s,route_provider,route_provider_ref)
       values($1,$2,$3,'work','single','outbound','published', now() + $5::interval, $4,
              ST_SetSRID(ST_Point(1,1),4326),ST_SetSRID(ST_Point(9,9),4326),
              ST_GeomFromText('LINESTRING(1 1,5 5,9 9)',4326),10000,900,'integration-test','route-1')
       returning id`,
      [world.ana.id, world.vehicleId, world.provinceId, capacity, options.departureInterval ?? "3 days"]
    )
  ).rows[0]!.id;
  await pool.query(
    `insert into trip_stops(trip_id,seq,kind,label,geom) values
       ($1,0,'origin','Sevilla Centro',ST_SetSRID(ST_Point(1,1),4326)),
       ($1,1,'stop','Triana',ST_SetSRID(ST_Point(5,5),4326)),
       ($1,2,'destination','Isla Mágica',ST_SetSRID(ST_Point(9,9),4326))`,
    [trip]
  );
  await pool.query(
    `insert into trip_segments(trip_id,seq,from_stop_seq,to_stop_seq,distance_m,duration_s,capacity) values
       ($1,0,0,1,5000,450,$2),
       ($1,1,1,2,5000,450,$2)`,
    [trip, capacity]
  );
  return trip;
}

/** Cifras de PRUEBA (no son tarifas): aportación 10,00 €, gestión pasajero 1,00 €, comisión conductor 0,50 €. */
export const TEST_QUOTE = {
  contributionCents: 1000,
  passengerCommissionCents: 100,
  driverCommissionCents: 50,
  processingCents: 0,
  taxesCents: 0,
  totalCents: 1100,
  driverNetCents: 950
} as const;
export type TestQuote = { -readonly [K in keyof typeof TEST_QUOTE]: number };

export async function approveTariff(pool: pg.Pool): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `insert into tariff_versions(version,status,rate_micros_per_km,passenger_commission_bps,driver_commission_bps,shared_cost_cap_cents,effective_from,notes)
       values((select coalesce(max(version),0)+1 from tariff_versions),'approved',200000,1000,500,100000,now(),'fixture de pruebas')
       returning id`
    )
  ).rows[0]!.id;
}

export async function draftTariff(pool: pg.Pool): Promise<string> {
  return (
    await pool.query<{ id: string }>(
      `insert into tariff_versions(version,status,notes)
       values((select coalesce(max(version),0)+1 from tariff_versions),'draft','fixture de pruebas') returning id`
    )
  ).rows[0]!.id;
}

export async function addQuote(
  pool: pg.Pool,
  requestId: string,
  tariffVersionId: string | null,
  quote: Partial<TestQuote> = {}
): Promise<string> {
  const q = { ...TEST_QUOTE, ...quote };
  return (
    await pool.query<{ id: string }>(
      `insert into quote_snapshots(request_id,tariff_version_id,road_distance_m,contribution_cents,passenger_commission_cents,
                                   driver_commission_cents,processing_cents,taxes_cents,passenger_total_cents,driver_net_cents)
       values($1,$2,10000,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [requestId, tariffVersionId, q.contributionCents, q.passengerCommissionCents, q.driverCommissionCents, q.processingCents, q.taxesCents, q.totalCents, q.driverNetCents]
    )
  ).rows[0]!.id;
}

/** Solicitud en `payment_pending` con reserva provisional activa (10 min) y cotización definida si se pasa tarifa. */
export async function seedPayableRequest(
  pool: pg.Pool,
  tripId: string,
  passenger: Actor,
  options: { tariffId?: string | null; quote?: Partial<TestQuote>; holdSeconds?: number; from?: number; to?: number } = {}
): Promise<{ requestId: string; holdId: string }> {
  const requestId = (
    await pool.query<{ id: string }>(
      `insert into ride_requests(trip_id,passenger_user_id,from_segment_seq,to_segment_seq,status)
       values($1,$2,$3,$4,'payment_pending') returning id`,
      [tripId, passenger.id, options.from ?? 0, options.to ?? 2]
    )
  ).rows[0]!.id;
  const holdId = (
    await pool.query<{ id: string }>(
      `insert into seat_holds(request_id,status,expires_at) values($1,'active', now() + ($2::int * interval '1 second')) returning id`,
      [requestId, options.holdSeconds ?? 600]
    )
  ).rows[0]!.id;
  if (options.tariffId) await addQuote(pool, requestId, options.tariffId, options.quote);
  return { requestId, holdId };
}

export async function scalar<T = number>(pool: pg.Pool, sql: string, params: unknown[] = []): Promise<T> {
  const result = await pool.query(sql, params);
  const row = result.rows[0] as Record<string, T>;
  return Object.values(row)[0] as T;
}

/** Crea el intento de pago por la API y devuelve identificadores. */
export async function createIntent(
  app: FastifyInstance,
  actor: Actor,
  requestId: string,
  kind: "apple_pay" | "google_pay" | "card" = "apple_pay",
  key: string = newKey()
) {
  const response = await app.inject({
    method: "POST",
    url: `/v1/ride-requests/${requestId}/payment-intents`,
    headers: { ...bearer(actor), "idempotency-key": key },
    payload: { method: { kind } }
  });
  return { response, key, json: response.json() as Record<string, any> };
}

export function payloadHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Evento firmado `payment.succeeded` por el importe indicado. */
export function succeededEvent(providerRef: string, amountCents: number, extra: Partial<StubWebhookEvent> = {}): StubWebhookEvent {
  return { id: nextEventId(), object: "payment", type: "succeeded", ref: providerRef, amountCents, currency: "EUR", ...extra };
}

/** Intento + `succeeded` firmado: devuelve la reserva creada. */
export async function payRequest(
  pool: pg.Pool,
  app: FastifyInstance,
  actor: Actor,
  requestId: string,
  totalCents: number = TEST_QUOTE.totalCents
): Promise<{ paymentId: string; providerRef: string; bookingId: string }> {
  const { response, json } = await createIntent(app, actor, requestId);
  if (response.statusCode !== 201) throw new Error(`intent failed: ${response.statusCode} ${response.body}`);
  const paymentId = json.payment.id as string;
  const providerRef = (
    await pool.query<{ provider_payment_ref: string }>(`select provider_payment_ref from payments where id=$1`, [paymentId])
  ).rows[0]!.provider_payment_ref;
  const hook = await postWebhook(app, [succeededEvent(providerRef, totalCents)]);
  if (hook.statusCode !== 200) throw new Error(`webhook failed: ${hook.statusCode} ${hook.body}`);
  const bookingId = (await pool.query<{ id: string }>(`select id from bookings where request_id=$1`, [requestId])).rows[0]?.id;
  if (!bookingId) throw new Error("booking was not created");
  return { paymentId, providerRef, bookingId };
}

/* ───────────────────────── Helpers de escenarios compartidos ───────────────────────── */

/** Reutiliza la tarifa aprobada de la prueba o crea una (las cifras de cotización son de prueba, no tarifas). */
export async function ensureTariff(pool: pg.Pool): Promise<string> {
  const existing = await pool.query<{ id: string }>(`select id from tariff_versions where status='approved' order by version desc limit 1`);
  return existing.rows[0]?.id ?? approveTariff(pool);
}

/**
 * Reglas de una política de cancelación DE PRUEBA (fixture, NO es la política de MVC, que no existe):
 * ≥ 48 h antes: devolución íntegra; menos: el 50 % de la aportación, sin comisión (aquí la retención de MVC es un dato de la política).
 */
export const TEST_POLICY_RULES = [
  {
    scenario: "passenger_cancellation",
    minHoursBeforeDeparture: 48,
    refundContributionBps: 10_000,
    refundCommissionBps: 10_000,
    refundProcessingBps: 10_000,
    refundTaxesBps: 10_000
  },
  {
    scenario: "passenger_cancellation",
    minHoursBeforeDeparture: 0,
    refundContributionBps: 5_000,
    refundCommissionBps: 0,
    refundProcessingBps: 10_000,
    refundTaxesBps: 10_000
  }
] as const;

/** Inserta una política `approved` (fixture SQL: no existe API para aprobarlas todavía). */
export async function insertApprovedPolicy(
  pool: pg.Pool,
  approver: Actor,
  options: { rules?: readonly unknown[]; summary?: string } = {}
): Promise<{ id: string; version: number }> {
  const row = (
    await pool.query<{ id: string; version: number }>(
      `insert into cancellation_policies(version,status,title,summary,rules,effective_from,approved_by_user_id,approved_at,created_by_user_id)
       values((select coalesce(max(version),0)+1 from cancellation_policies),'approved','Política de pruebas',$1,$2::jsonb,
              now() - interval '1 day',$3,now(),$3)
       returning id, version`,
      [options.summary ?? "Fixture de pruebas, no es la política de MVC", JSON.stringify(options.rules ?? TEST_POLICY_RULES), approver.id]
    )
  ).rows[0]!;
  return row;
}

/** Retira la política aprobada vigente (sigue aplicando a los pagos que la aceptaron). */
export async function retireApprovedPolicy(pool: pg.Pool): Promise<void> {
  await pool.query(`update cancellation_policies set status='retired' where status='approved'`);
}

export type PaidBooking = {
  tripId: string;
  requestId: string;
  bookingId: string;
  paymentId: string;
  providerRef: string;
  passenger: Actor;
};

/** Viaje + solicitud en `payment_pending` + intento + `succeeded` firmado = reserva confirmada con asientos contables. */
export async function paidBooking(
  pool: pg.Pool,
  app: FastifyInstance,
  world: World,
  options: {
    passenger?: Actor;
    capacity?: number;
    departureInterval?: string;
    quote?: Partial<TestQuote>;
  } = {}
): Promise<PaidBooking> {
  const tariff = await ensureTariff(pool);
  const passenger = options.passenger ?? world.miguel;
  const tripId = await seedTrip(pool, world, {
    ...(options.capacity !== undefined ? { capacity: options.capacity } : {}),
    ...(options.departureInterval !== undefined ? { departureInterval: options.departureInterval } : {})
  });
  const quote = { ...TEST_QUOTE, ...(options.quote ?? {}) };
  const { requestId } = await seedPayableRequest(pool, tripId, passenger, {
    tariffId: tariff,
    ...(options.quote ? { quote: options.quote } : {})
  });
  const paid = await payRequest(pool, app, passenger, requestId, quote.totalCents);
  return { tripId, requestId, passenger, ...paid };
}

/** Marca el viaje como empezado (el pasajero ya no puede cancelar desde la app). */
export async function startTrip(pool: pg.Pool, tripId: string): Promise<void> {
  await pool.query(`update trips set status='active', started_at=now() where id=$1`, [tripId]);
}

/** Completa el viaje y la reserva (lo haría el módulo de viaje en vivo). */
export async function completeTrip(pool: pg.Pool, tripId: string, completedAt: string = "now()"): Promise<void> {
  await pool.query(`update trips set status='completed', started_at=coalesce(started_at, now()), completed_at=${completedAt === "now()" ? "now()" : "$2::timestamptz"} where id=$1`, completedAt === "now()" ? [tripId] : [tripId, completedAt]);
  await pool.query(
    `update bookings b set status='completed', updated_at=now()
       from ride_requests r where r.id=b.request_id and r.trip_id=$1 and b.status='confirmed'`,
    [tripId]
  );
}

/* ───────────────────────── Helpers compartidos por las suites de libro mayor, informes y contrato HTTP ───────────────────────── */

/** Llamada a la API como `actor` (o sin sesión). Los POST llevan una `Idempotency-Key` nueva salvo que se indique otra (o `null`). */
export async function apiCall(
  app: FastifyInstance,
  actor: Actor | null,
  method: "GET" | "POST" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
  key: string | null = method === "POST" ? newKey() : null
) {
  const headers: Record<string, string> = {};
  if (actor) Object.assign(headers, bearer(actor));
  if (key) headers["idempotency-key"] = key;
  const response = await app.inject({ method, url, headers, ...(payload !== undefined ? { payload } : {}) });
  return { response, json: response.json() as Record<string, any>, key };
}

/** Evento firmado de devolución (`refund.succeeded|failed`) para el stub. */
export function refundEvent(
  type: "succeeded" | "failed",
  ref: string,
  paymentRef: string,
  amountCents: number,
  extra: Partial<StubWebhookEvent> = {}
): StubWebhookEvent {
  return { id: nextEventId("evt_re"), object: "refund", type, ref, paymentRef, amountCents, ...extra };
}

/** Evento firmado de abono (`payout.paid|failed`) para el stub. */
export function payoutEvent(
  type: "paid" | "failed",
  ref: string,
  amountCents: number,
  extra: Partial<StubWebhookEvent> = {}
): StubWebhookEvent {
  return { id: nextEventId("evt_po"), object: "payout", type, ref, amountCents, ...extra };
}

export async function providerRefundRef(pool: pg.Pool, refundId: string): Promise<string> {
  return scalar<string>(pool, `select provider_refund_ref from refund_requests where id=$1`, [refundId]);
}

export async function providerPayoutRef(pool: pg.Pool, payoutId: string): Promise<string> {
  return scalar<string>(pool, `select provider_payout_ref from payout_runs where id=$1`, [payoutId]);
}

export async function countRows(pool: pg.Pool, table: string, where = "true", params: unknown[] = []): Promise<number> {
  return Number(await scalar<string>(pool, `select count(*)::text from ${table} where ${where}`, params));
}

/** Suma de los desequilibrios de todas las transacciones del libro (debe ser 0). */
export async function ledgerImbalance(pool: pg.Pool): Promise<number> {
  return Number(
    await scalar<string>(
      pool,
      `select coalesce(sum(abs(s)),0)::text from (select sum(amount_cents) s from ledger_entries group by transaction_id) t`
    )
  );
}

export async function accountNet(pool: pg.Pool, account: string, userId?: string): Promise<number> {
  return Number(
    await scalar<string>(
      pool,
      `select coalesce(sum(amount_cents),0)::text from ledger_entries where account=$1 ${userId ? "and user_id=$2" : ""}`,
      userId ? [account, userId] : [account]
    )
  );
}

/** Generador pseudoaleatorio reproducible (mulberry32): los fallos de las pruebas de propiedades se repiten con la misma semilla. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ejecuta `fn` en una transacción (commit al terminar, rollback si falla; las restricciones diferidas se comprueban en el commit). */
export async function inTransaction<T>(pool: pg.Pool, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const value = await fn(client);
    await client.query("commit");
    return value;
  } catch (error) {
    try {
      await client.query("rollback");
    } catch {
      // la transacción ya se había cerrado en el servidor
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Año natural actual en Europe/Madrid (el de la numeración de recibos). */
export async function madridYear(pool: pg.Pool): Promise<number> {
  return Number(await scalar<string>(pool, `select extract(year from now() at time zone 'Europe/Madrid')::int::text`));
}
