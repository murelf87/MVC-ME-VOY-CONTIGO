/**
 * Datos sembrados del backend en memoria de «pagos y cobros» (SIMULACIÓN, solo vista previa).
 *
 * Variantes de datos (`seed` de un escenario). Todas las horas son RELATIVAS a «ahora» (reloj virtual): valen con cualquier
 * `clock`. Las láminas 33a/33b/34b están hechas con un reloj de mayo de 2025 (sus fechas «Vie, 16 may», «Mié, 14 may»…
 * solo son ciertas ese año), así que sus escenarios fijan ese reloj.
 *
 *   money-resumen          33a · los dos roles, importes «Por definir» (--,-- €), un viaje por pagar y un cobro
 *   money-con-importes     33b y 34b · importes ILUSTRATIVOS (24,00 €, 12,00 €, 48,00 €) y el historial de la lámina
 *   money-vacio            proveedor simulado activo, sin pagos, cobros, métodos ni justificantes
 *   money-sin-proveedor    el estado real actual: «Pagos aún no disponibles», una solicitud por pagar sin importe
 *   money-historial-largo  listas largas (paginación), todos los estados, justificantes, liquidaciones y devoluciones
 *
 * Honestidad: ningún importe se siembra como `defined` (no hay tarifa aprobada): o `pending_definition` o `illustrative`.
 * Un pago solo es «paid» y un cobro solo «paid_out» en filas sembradas explícitamente (historial simulado); nada se
 * convierte en pagado por una acción de la persona (la vista previa no tiene intento de pago en este paquete).
 */
import {
  SEED_USER_IDS,
  addDaysToDate,
  addRole,
  madridDate,
  madridDateTimeMs,
  madridParts,
  profileUserId,
  registerSeedRef,
  stableUuid,
  type PreviewDb,
  type PreviewProfileId,
  type SeedUserKey,
} from "@/preview";
import { DEFAULT_CONFIG, moneyTables, writeConfig, type AmountRow, type EarningRow, type MethodRow, type PaymentRow, type PayoutRow, type ReceiptLineRow, type ReceiptRow, type RefundRow, type TripRefRow } from "./moneyRows";

export const MONEY_SEED_VARIANTS: Readonly<Record<string, string>> = {
  "money-resumen": "Pagos y cobros (33a): los dos roles, importes «Por definir», un viaje por pagar y un cobro reciente.",
  "money-con-importes": "Pagos y cobros (33b, 34b): importes ILUSTRATIVOS de las láminas (24,00 €, 12,00 €, 48,00 €) y su historial.",
  "money-vacio": "Pagos y cobros: proveedor simulado activo y nada que mostrar (estados vacíos).",
  "money-sin-proveedor": "Pagos y cobros: el estado real actual, «Pagos aún no disponibles», sin métodos ni importes.",
  "money-historial-largo": "Pagos y cobros: listas largas con todos los estados, justificantes, liquidaciones y devoluciones.",
};

const ill = (cents: number): AmountRow => ({ cents, status: "illustrative" });
const PENDING: AmountRow = { cents: null, status: "pending_definition" };
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

interface Ctx {
  db: PreviewDb;
  profile: PreviewProfileId;
  userId: string;
  userKey: SeedUserKey | null;
  now: number;
  today: string;
  tag: string;
}

function userKeyOf(userId: string): SeedUserKey | null {
  const found = (Object.entries(SEED_USER_IDS) as Array<[SeedUserKey, string]>).find(([, id]) => id === userId);
  return found === undefined ? null : found[0];
}

function makeCtx(db: PreviewDb, profile: PreviewProfileId, tag: string): Ctx | null {
  const userId = profileUserId(profile);
  if (userId === null || profile === "admin") return null;
  return { db, profile, userId, userKey: userKeyOf(userId), now: db.nowMs(), today: madridDate(db.nowMs()), tag };
}

/** Instante local (Madrid) `dayOffset` días respecto a hoy a las `hhmm`. */
function at(ctx: Ctx, dayOffset: number, hhmm: string): number {
  return madridDateTimeMs(addDaysToDate(ctx.today, dayOffset), hhmm);
}

function id(ctx: Ctx, ...parts: Array<string | number>): string {
  return stableUuid(`money:${ctx.profile}:${ctx.tag}:${parts.join(":")}`);
}

function trip(ctx: Ctx, key: string, departureAt: number, origin: string, destination: string): TripRefRow {
  return { trip_id: id(ctx, "trip", key), departure_at: departureAt, origin_label: origin, destination_label: destination };
}

/** Persona de contrapartida: la primera de la lista que no sea la propia persona de la sesión. */
function counterpart(ctx: Ctx, ...keys: SeedUserKey[]): string {
  const key = keys.find((candidate) => candidate !== ctx.userKey) ?? "carlos";
  return SEED_USER_IDS[key];
}

// ── Inserciones ─────────────────────────────────────────────────────────────────────────────────────────────────

type PaymentSeed = Omit<PaymentRow, "id" | "user_id" | "request_id" | "payment_id" | "booking_id">;

/** Un pago confirmado (`payment`) tiene reserva y pago; una solicitud por pagar (`pending_request`) no tiene ninguno de los dos. */
function insertPayment(ctx: Ctx, key: string, row: PaymentSeed): PaymentRow {
  const requestId = id(ctx, "request", key);
  const paymentId = row.kind === "payment" ? id(ctx, "payment", key) : null;
  const stored: PaymentRow = {
    ...row,
    id: paymentId !== null ? `payment:${paymentId}` : `request:${requestId}`,
    user_id: ctx.userId,
    request_id: requestId,
    booking_id: row.kind === "payment" ? id(ctx, "booking", key) : null,
    payment_id: paymentId,
  };
  moneyTables(ctx.db).payments.insert(stored);
  return stored;
}

function insertEarning(ctx: Ctx, key: string, row: Omit<EarningRow, "id" | "user_id">): EarningRow {
  const stored: EarningRow = { ...row, id: id(ctx, "booking", `earning:${key}`), user_id: ctx.userId };
  moneyTables(ctx.db).earnings.insert(stored);
  return stored;
}

function insertMethod(ctx: Ctx, key: string, row: Omit<MethodRow, "id" | "user_id" | "removed_at">): MethodRow {
  const stored: MethodRow = { ...row, id: id(ctx, "method", key), user_id: ctx.userId, removed_at: null };
  moneyTables(ctx.db).methods.insert(stored);
  return stored;
}

function bankAccount(ctx: Ctx, purpose: "charge" | "payout", createdAt: number): MethodRow {
  return insertMethod(ctx, `bank-${purpose}`, {
    purpose,
    kind: purpose === "payout" ? "bank_account" : "sepa_debit",
    brand: null,
    last4: "4589",
    country: "ES",
    exp_month: null,
    exp_year: null,
    title: "Cuenta bancaria",
    masked_label: "ES** **** **** 4589",
    is_default: true,
    status: "active",
    created_at: createdAt,
  });
}

function insertPayout(ctx: Ctx, key: string, row: Omit<PayoutRow, "id" | "user_id">): PayoutRow {
  const stored: PayoutRow = { ...row, id: id(ctx, "payout", key), user_id: ctx.userId };
  moneyTables(ctx.db).payouts.insert(stored);
  return stored;
}

function insertRefund(ctx: Ctx, key: string, row: Omit<RefundRow, "id" | "user_id">): RefundRow {
  const stored: RefundRow = { ...row, id: id(ctx, "refund", key), user_id: ctx.userId };
  moneyTables(ctx.db).refunds.insert(stored);
  return stored;
}

const NOTICES = {
  payment: "Justificante de pago no fiscal emitido por MVC. No es una factura.",
  refund: "Justificante de devolución no fiscal emitido por MVC. No es una factura.",
  earning_statement: "Justificante de abono no fiscal emitido por MVC. No es una factura.",
} as const;

/** Numeración correlativa anual sin huecos: `MVC-J-AAAA-NNNNNN` por orden de emisión. */
function numberReceipts(db: PreviewDb): void {
  const table = moneyTables(db).receipts;
  const counters = new Map<number, number>();
  const sorted = table.all().slice().sort((a, b) => a.issued_at - b.issued_at);
  for (const row of sorted) {
    const year = madridParts(row.issued_at).year;
    const next = (counters.get(year) ?? 0) + 1;
    counters.set(year, next);
    table.update(row.id, { number: `MVC-J-${year}-${String(next).padStart(6, "0")}` });
  }
}

type ReceiptSeed = Omit<ReceiptRow, "id" | "user_id" | "number" | "notice" | "total"> & { total: AmountRow };

function insertReceipt(ctx: Ctx, key: string, row: ReceiptSeed): ReceiptRow {
  const stored: ReceiptRow = {
    ...row,
    id: id(ctx, "receipt", key),
    user_id: ctx.userId,
    number: "MVC-J-0000-000000",
    notice: NOTICES[row.kind],
  };
  moneyTables(ctx.db).receipts.insert(stored);
  return stored;
}

function paymentReceipt(ctx: Ctx, key: string, payment: PaymentRow): ReceiptRow {
  const lines: ReceiptLineRow[] = [
    { key: "contribution", amount: payment.amount },
    { key: "platform_fee", amount: payment.amount.status === "pending_definition" ? PENDING : ill(0) },
  ];
  return insertReceipt(ctx, key, {
    kind: "payment",
    issued_at: payment.occurred_at,
    total: payment.amount,
    trip: payment.trip,
    counterpart_user_id: payment.driver_user_id,
    booking_id: payment.booking_id,
    payment_id: payment.payment_id,
    lines,
  });
}

function earningStatement(ctx: Ctx, key: string, payout: PayoutRow, members: readonly EarningRow[]): ReceiptRow {
  const gross = members.reduce((sum, e) => sum + (e.contribution.cents ?? 0), 0);
  return insertReceipt(ctx, key, {
    kind: "earning_statement",
    issued_at: payout.paid_at ?? payout.created_at,
    total: payout.net,
    trip: null,
    counterpart_user_id: null,
    booking_id: null,
    payment_id: null,
    lines: [
      { key: "contribution", amount: ill(gross) },
      { key: "driver_commission", amount: ill(0) },
      { key: "refund_adjustments", amount: ill(0) },
      { key: "net", amount: payout.net },
    ],
  });
}

// ── Variantes ───────────────────────────────────────────────────────────────────────────────────────────────────

function enableProvider(db: PreviewDb): void {
  writeConfig(db, { provider_enabled: true });
}

/** `money-resumen` (33a). */
function seedResumen(ctx: Ctx): void {
  enableProvider(ctx.db);
  addRole(ctx.db, ctx.userId, "driver");
  bankAccount(ctx, "charge", ctx.now - 40 * DAY);
  bankAccount(ctx, "payout", ctx.now - 40 * DAY);
  const driver = counterpart(ctx, "ana", "carlos");
  insertPayment(ctx, "p1", {
    kind: "pending_request",
    driver_user_id: driver,
    trip: trip(ctx, "p1", at(ctx, 1, "07:25"), "Sevilla", "Camas"),
    amount: PENDING,
    state: "pending",
    occurred_at: ctx.now - 25 * MIN,
  });
  insertPayment(ctx, "p2", {
    kind: "pending_request",
    driver_user_id: driver,
    trip: trip(ctx, "p2", at(ctx, 4, "07:25"), "Sevilla", "Camas"),
    amount: PENDING,
    state: "pending",
    occurred_at: ctx.now - 3 * HOUR,
  });
  const riders: Array<[SeedUserKey, number, string, string]> = [
    ["miguelAngel", -3, "08:10", "Tomares"],
    ["laura", -5, "08:05", "Bormujos"],
    ["carlos", -7, "07:50", "Camas"],
    ["marta", -10, "08:20", "San Juan"],
  ];
  riders.forEach(([key, offset, hhmm, destination], index) => {
    const departure = at(ctx, offset, hhmm);
    insertEarning(ctx, `r${index}`, {
      passenger_user_id: SEED_USER_IDS[key === ctx.userKey ? "daniel" : key],
      trip: trip(ctx, `r${index}`, departure, "Sevilla", destination),
      contribution: PENDING,
      driver_commission: PENDING,
      refund_adjustments: ill(0),
      net: PENDING,
      state: "available",
      occurred_at: departure + 35 * MIN,
      payout_id: null,
    });
  });
}

/** `money-con-importes` (33b pasajero · 34b conductor), importes ilustrativos de las láminas. */
function seedConImportes(ctx: Ctx): void {
  enableProvider(ctx.db);
  const isDriverView = ctx.userKey === "ana";
  if (!isDriverView) {
    bankAccount(ctx, "charge", ctx.now - 60 * DAY);
    const driver = counterpart(ctx, "ana", "carlos");
    insertPayment(ctx, "p1", {
      kind: "pending_request",
      driver_user_id: driver,
      trip: trip(ctx, "p1", at(ctx, 1, "07:25"), "Sevilla", "Camas"),
      amount: ill(1200),
      state: "pending",
      occurred_at: ctx.now - 18 * MIN,
    });
    const p2 = insertPayment(ctx, "p2", {
      kind: "payment",
      driver_user_id: driver,
      trip: trip(ctx, "p2", at(ctx, 2, "07:25"), "Sevilla", "San Juan"),
      amount: ill(1200),
      state: "paid",
      occurred_at: ctx.now - 26 * HOUR,
    });
    paymentReceipt(ctx, "p2", p2);
    numberReceipts(ctx.db);
    return;
  }

  bankAccount(ctx, "payout", ctx.now - 60 * DAY);
  const mayRiders: Array<[SeedUserKey, number, string, string]> = [
    ["miguel", -1, "07:05", "Tomares"],
    ["laura", -3, "07:10", "Bormujos"],
    ["carlos", -6, "07:15", "Camas"],
    ["marta", -9, "07:20", "San Juan"],
  ];
  const aprilRiders: Array<[SeedUserKey, number, string, string]> = [
    ["miguel", -22, "07:05", "Tomares"],
    ["laura", -24, "07:10", "Bormujos"],
    ["marta", -27, "07:20", "San Juan"],
    ["carlos", -29, "07:15", "Camas"],
    ["miguelAngel", -31, "07:25", "Dos Hermanas"],
    ["laura", -34, "07:10", "Bormujos"],
  ];
  const mayPayout = insertPayout(ctx, "may", {
    period: `${ctx.today.slice(0, 7)}`,
    status: "paid",
    net: ill(4800),
    bookings_count: 4,
    scheduled_for: null,
    paid_at: ctx.now - 2 * HOUR,
    failure_code: null,
    created_at: ctx.now - 1 * DAY,
  });
  const aprilPayout = insertPayout(ctx, "april", {
    period: madridDate(ctx.now - 33 * DAY).slice(0, 7),
    status: "paid",
    net: ill(7200),
    bookings_count: 6,
    scheduled_for: null,
    paid_at: ctx.now - 20 * DAY,
    failure_code: null,
    created_at: ctx.now - 21 * DAY,
  });
  const add = (rows: Array<[SeedUserKey, number, string, string]>, tagPrefix: string, payoutId: string): EarningRow[] =>
    rows.map(([key, offset, hhmm, destination], index) => {
      const departure = at(ctx, offset, hhmm);
      return insertEarning(ctx, `${tagPrefix}${index}`, {
        passenger_user_id: SEED_USER_IDS[key],
        trip: trip(ctx, `${tagPrefix}${index}`, departure, "Sevilla", destination),
        contribution: ill(1200),
        driver_commission: ill(0),
        refund_adjustments: ill(0),
        net: ill(1200),
        state: "paid_out",
        occurred_at: departure + 33 * MIN,
        payout_id: payoutId,
      });
    });
  const may = add(mayRiders, "m", mayPayout.id);
  const april = add(aprilRiders, "a", aprilPayout.id);
  earningStatement(ctx, "may", mayPayout, may);
  earningStatement(ctx, "april", aprilPayout, april);
  numberReceipts(ctx.db);
}

/** `money-vacio`. */
function seedVacio(ctx: Ctx): void {
  enableProvider(ctx.db);
}

/** `money-sin-proveedor`: el estado real actual. */
function seedSinProveedor(ctx: Ctx): void {
  writeConfig(ctx.db, { ...DEFAULT_CONFIG });
  if (ctx.userKey === "ana") return;
  insertPayment(ctx, "p1", {
    kind: "pending_request",
    driver_user_id: counterpart(ctx, "ana", "carlos"),
    trip: trip(ctx, "p1", at(ctx, 1, "07:25"), "Sevilla", "Camas"),
    amount: PENDING,
    state: "pending",
    occurred_at: ctx.now - 8 * MIN,
  });
}

const TOWNS = ["Camas", "Tomares", "Bormujos", "San Juan", "Dos Hermanas", "Mairena", "Alcalá", "Montequinto"] as const;
const DRIVERS: SeedUserKey[] = ["ana", "carlos", "marta", "laura", "miguelAngel"];
const RIDERS: SeedUserKey[] = ["miguel", "laura", "carlos", "marta", "miguelAngel", "daniel"];

/** `money-historial-largo`: listas largas con todos los estados (paginación, filtros, justificantes, devoluciones). */
function seedHistorialLargo(ctx: Ctx): void {
  enableProvider(ctx.db);
  addRole(ctx.db, ctx.userId, "driver");

  // Métodos: pagar (Visa predeterminada, Mastercard caducada, cuenta SEPA) y cobrar (cuenta bancaria).
  insertMethod(ctx, "visa", { purpose: "charge", kind: "card", brand: "Visa", last4: "4242", country: "ES", exp_month: 8, exp_year: 2028, title: "Tarjeta Visa", masked_label: "•••• 4242", is_default: true, status: "active", created_at: ctx.now - 90 * DAY });
  insertMethod(ctx, "mastercard", { purpose: "charge", kind: "card", brand: "Mastercard", last4: "4444", country: "ES", exp_month: 3, exp_year: 2025, title: "Tarjeta Mastercard", masked_label: "•••• 4444", is_default: false, status: "expired", created_at: ctx.now - 200 * DAY });
  insertMethod(ctx, "sepa", { purpose: "charge", kind: "sepa_debit", brand: null, last4: "4589", country: "ES", exp_month: null, exp_year: null, title: "Cuenta bancaria", masked_label: "ES** **** **** 4589", is_default: false, status: "requires_action", created_at: ctx.now - 30 * DAY });
  bankAccount(ctx, "payout", ctx.now - 90 * DAY);

  // Pagos como pasajero: 42 filas, del más reciente al más antiguo.
  const stateAt: Record<number, PaymentRow["state"]> = { 0: "pending", 1: "pending", 3: "under_review", 5: "partially_refunded", 7: "refunded", 9: "failed", 11: "expired" };
  const payments: PaymentRow[] = [];
  for (let index = 0; index < 42; index += 1) {
    const state = stateAt[index] ?? "paid";
    const occurred = ctx.now - (index === 0 ? 12 * MIN : index === 1 ? 5 * HOUR : (index * 2 + 1) * DAY - 3 * HOUR);
    const departure = occurred + DAY + 2 * HOUR;
    const amount = index === 1 ? PENDING : ill(900 + ((index * 35) % 1100));
    const driver = counterpart(ctx, DRIVERS[index % DRIVERS.length] ?? "ana", "carlos");
    const kind: PaymentRow["kind"] = state === "pending" ? "pending_request" : "payment";
    const key = `h${index}`;
    payments.push(
      insertPayment(ctx, key, {
        kind,
        driver_user_id: driver,
        trip: trip(ctx, key, departure, "Sevilla", TOWNS[index % TOWNS.length] ?? "Camas"),
        amount,
        state,
        occurred_at: occurred,
      }),
    );
  }

  // Devoluciones (seguimiento) ligadas a los pagos con ese estado.
  const refundDefs: Array<[number, RefundRow["status"], RefundRow["origin"]]> = [
    [3, "pending_review", "passenger_cancellation"],
    [5, "executing", "driver_cancellation"],
    [7, "refunded", "passenger_cancellation"],
    [13, "rejected", "passenger_cancellation"],
    [15, "failed", "platform_cancellation"],
    [17, "not_applicable", "no_show"],
    [19, "approved", "late_payment"],
  ];
  const refundRows: RefundRow[] = [];
  for (const [index, status, origin] of refundDefs) {
    const payment = payments[index];
    if (payment === undefined) continue;
    const paid = payment.amount;
    const cents = paid.cents ?? 0;
    const decided = status !== "pending_review";
    const partial = status === "executing" ? ill(Math.round(cents / 2)) : paid;
    refundRows.push(
      insertRefund(ctx, `h${index}`, {
        status,
        origin,
        booking_id: payment.booking_id,
        request_id: payment.request_id,
        payment_id: payment.payment_id,
        paid,
        proposed: status === "pending_review" ? PENDING : partial,
        approved: status === "pending_review" || status === "rejected" || status === "not_applicable" ? PENDING : partial,
        platform_fee: PENDING,
        final_cost: status === "pending_review" ? PENDING : status === "rejected" || status === "not_applicable" ? paid : ill(cents - (partial.cents ?? 0)),
        execution_status:
          status === "refunded" ? "succeeded" : status === "executing" ? "submitted" : status === "failed" ? "failed" : status === "approved" ? "awaiting_provider" : "not_started",
        policy_status: "pending_review",
        policy_version: null,
        created_at: payment.occurred_at + 6 * HOUR,
        decided_at: decided ? payment.occurred_at + 30 * HOUR : null,
        refunded_at: status === "refunded" ? payment.occurred_at + 50 * HOUR : null,
      }),
    );
  }

  // Cobros como conductor: 36 filas en 6 liquidaciones + pendientes y por cobrar.
  const payoutDefs: Array<[string, PayoutRow["status"], number, string | null]> = [
    ["p6", "paid", 5, null],
    ["p5", "paid", 4, null],
    ["p4", "paid", 3, null],
    ["p3", "failed", 2, "account_closed"],
    ["p2", "processing", 1, null],
    ["p1", "draft", 0, null],
  ];
  const payoutRows: PayoutRow[] = [];
  const earningsByPayout = new Map<string, EarningRow[]>();
  let earningIndex = 0;
  const earn = (payoutId: string | null, state: EarningRow["state"], offsetDays: number): EarningRow => {
    const i = earningIndex;
    earningIndex += 1;
    const departure = at(ctx, offsetDays, "07:30") + (i % 5) * 5 * MIN;
    const cents = 800 + ((i * 45) % 900);
    const row = insertEarning(ctx, `h${i}`, {
      passenger_user_id: SEED_USER_IDS[RIDERS[i % RIDERS.length] === ctx.userKey ? "daniel" : (RIDERS[i % RIDERS.length] ?? "daniel")],
      trip: trip(ctx, `e${i}`, departure, "Sevilla", TOWNS[(i + 3) % TOWNS.length] ?? "Tomares"),
      contribution: ill(cents),
      driver_commission: ill(0),
      refund_adjustments: ill(0),
      net: ill(cents),
      state,
      occurred_at: state === "pending" ? ctx.now - 20 * MIN : departure + 35 * MIN,
      payout_id: payoutId,
    });
    if (payoutId !== null) earningsByPayout.set(payoutId, [...(earningsByPayout.get(payoutId) ?? []), row]);
    return row;
  };
  payoutDefs.forEach(([key, status, monthsAgo, failure], order) => {
    const payoutId = id(ctx, "payout", key);
    const members: EarningRow[] = [];
    const count = status === "draft" ? 0 : 5 - Math.min(order, 2) + (order % 2);
    for (let n = 0; n < count; n += 1) {
      const state: EarningRow["state"] = status === "paid" ? "paid_out" : "in_payout";
      members.push(earn(payoutId, state, -(monthsAgo * 30 + 3 + n * 4)));
    }
    const net = members.reduce((sum, e) => sum + (e.net.cents ?? 0), 0);
    const row = insertPayout(ctx, key, {
      period: madridDate(ctx.now - monthsAgo * 30 * DAY - 31 * DAY).slice(0, 7),
      status,
      net: status === "draft" ? PENDING : ill(net),
      bookings_count: count,
      scheduled_for: null,
      paid_at: status === "paid" ? ctx.now - (monthsAgo * 30 + 5) * DAY : null,
      failure_code: failure,
      created_at: ctx.now - (monthsAgo * 30 + 8) * DAY,
    });
    payoutRows.push(row);
    earningsByPayout.set(payoutId, members);
  });
  for (let n = 0; n < 6; n += 1) earn(null, "available", -(2 + n));
  earn(null, "pending", 2);
  earn(null, "pending", 3);

  // Justificantes: uno por pago confirmado, uno por devolución confirmada y uno por liquidación abonada.
  payments.forEach((payment, index) => {
    if (payment.kind === "payment" && (payment.state === "paid" || payment.state === "refunded" || payment.state === "partially_refunded")) {
      paymentReceipt(ctx, `h${index}`, payment);
    }
  });
  for (const refund of refundRows) {
    if (refund.status === "refunded") {
      const source = payments.find((p) => p.request_id === refund.request_id);
      insertReceipt(ctx, `rf-${refund.id.slice(0, 8)}`, {
        kind: "refund",
        issued_at: refund.refunded_at ?? refund.created_at,
        total: refund.approved,
        trip: source?.trip ?? null,
        counterpart_user_id: source?.driver_user_id ?? null,
        booking_id: refund.booking_id,
        payment_id: refund.payment_id,
        lines: [{ key: "refund", amount: refund.approved }],
      });
    }
  }
  for (const payout of payoutRows) {
    if (payout.status === "paid") earningStatement(ctx, `po-${payout.id.slice(0, 8)}`, payout, earningsByPayout.get(payout.id) ?? []);
  }
  numberReceipts(ctx.db);
}

// ── Punto de entrada ────────────────────────────────────────────────────────────────────────────────────────────

/** Siembra la variante pedida para el perfil de la sesión. Cualquier otro `seed` deja el estado honesto actual (sin datos). */
export function seedMoneyVariant(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  if (MONEY_SEED_VARIANTS[seed] === undefined) return;
  const ctx = makeCtx(db, profile, seed);
  if (ctx === null) return;
  switch (seed) {
    case "money-resumen":
      return seedResumen(ctx);
    case "money-con-importes":
      return seedConImportes(ctx);
    case "money-vacio":
      return seedVacio(ctx);
    case "money-sin-proveedor":
      return seedSinProveedor(ctx);
    case "money-historial-largo":
      return seedHistorialLargo(ctx);
  }
}

// ── Referencias para escenarios (`{ "$ref": "money.xxx" }`) ─────────────────────────────────────────────────────

function ownerOf(db: PreviewDb): string | null {
  return profileUserId(db.profile);
}

function newest<T extends { issued_at?: number; occurred_at?: number; created_at?: number }>(rows: readonly T[]): T | undefined {
  return [...rows].sort((a, b) => (b.issued_at ?? b.occurred_at ?? b.created_at ?? 0) - (a.issued_at ?? a.occurred_at ?? a.created_at ?? 0))[0];
}

/** Registra las referencias de los datos sembrados que necesitan los escenarios (ids de recibos, liquidaciones…). */
export function registerMoneyRefs(): void {
  registerSeedRef("money.receiptPayment", (db) => {
    const owner = ownerOf(db);
    return newest(moneyTables(db).receipts.filter((r) => r.user_id === owner && r.kind === "payment"))?.id;
  });
  registerSeedRef("money.receiptRefund", (db) => {
    const owner = ownerOf(db);
    return newest(moneyTables(db).receipts.filter((r) => r.user_id === owner && r.kind === "refund"))?.id;
  });
  registerSeedRef("money.receiptEarning", (db) => {
    const owner = ownerOf(db);
    return newest(moneyTables(db).receipts.filter((r) => r.user_id === owner && r.kind === "earning_statement"))?.id;
  });
  registerSeedRef("money.payoutPaid", (db) => {
    const owner = ownerOf(db);
    return newest(moneyTables(db).payouts.filter((r) => r.user_id === owner && r.status === "paid"))?.id;
  });
  registerSeedRef("money.payoutOpen", (db) => {
    const owner = ownerOf(db);
    return newest(moneyTables(db).payouts.filter((r) => r.user_id === owner && (r.status === "processing" || r.status === "draft")))?.id;
  });
  registerSeedRef("money.earningLatest", (db) => {
    const owner = ownerOf(db);
    return newest(moneyTables(db).earnings.filter((r) => r.user_id === owner))?.id;
  });
  registerSeedRef("money.earningPaidOut", (db) => {
    const owner = ownerOf(db);
    return newest(moneyTables(db).earnings.filter((r) => r.user_id === owner && r.state === "paid_out"))?.id;
  });
}
