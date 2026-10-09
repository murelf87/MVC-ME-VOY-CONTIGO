/**
 * Backend en memoria de la vista previa · slice `account` · paquete «pagos y cobros».
 * SIMULACIÓN (solo con `EXPO_PUBLIC_PREVIEW=1`). API del núcleo: `mobile/src/preview/index.ts`, ejemplos en
 * `mobile/src/preview/handlers/*.ts` y contrato de los endpoints en `docs/contracts/money.md` (§5–§7 y §8.4).
 *
 * Endpoints que registra este paquete (BUILD_BRIEF §10.6, fila `account-money`):
 *   GET    /v1/me/payments/passenger-summary   GET /v1/me/payments/driver-summary
 *   GET    /v1/me/payments                     GET /v1/me/earnings          GET /v1/me/earnings/{bookingId}
 *   GET    /v1/me/payment-methods              POST /v1/me/payment-methods  DELETE /v1/me/payment-methods/{methodId}
 *   GET    /v1/me/receipts                     GET /v1/me/receipts/{id}     GET /v1/me/receipts/{id}/printable
 *   GET    /v1/me/payouts                      GET /v1/me/payouts/{id}      GET /v1/me/refunds
 * (`GET /v1/payments/{id}` es del paquete `search-request`: aquí solo se consume.)
 *
 * El proveedor de pagos es SIMULADO: `moneyDomain.ts` explica los tokens `tok_sim_*` que acepta. Con la variante de datos
 * por defecto el proveedor está desactivado, que es el estado real hoy («Pagos aún no disponibles»).
 */
import type { DriverEarningState, PassengerPaymentState, PaymentMethodPurpose, ReceiptKind } from "@/api/types/money";
import { fail, reply, uuidParam, type JsonSchema, type PreviewDb, type PreviewProfileId, type PreviewRouter } from "@/preview";
import { addPaymentMethod, removePaymentMethod } from "./moneyDomain";
import { moneyTables, readConfig } from "./moneyRows";
import { MONEY_SEED_VARIANTS, registerMoneyRefs, seedMoneyVariant } from "./moneySeed";
import {
  MONTH_PATTERN,
  activeMethods,
  availabilityDto,
  currentMonth,
  driverSummaryDto,
  earningDetailDto,
  earningItemDto,
  earningsOf,
  methodDto,
  paginate,
  passengerSummaryDto,
  paymentItemDto,
  paymentsOf,
  payoutDetailDto,
  payoutViewDto,
  payoutsResponse,
  receiptDto,
  receiptPrintableHtml,
  receiptSummaryDto,
  refundDto,
} from "./moneyViews";

const TAGS = ["money"] as const;

const PAYMENT_STATES: readonly PassengerPaymentState[] = ["pending", "under_review", "paid", "partially_refunded", "refunded", "failed", "expired"];
const EARNING_STATES: readonly DriverEarningState[] = ["pending", "available", "in_payout", "paid_out"];
const RECEIPT_KINDS: readonly ReceiptKind[] = ["payment", "refund", "earning_statement"];
const PURPOSES: readonly PaymentMethodPurpose[] = ["charge", "payout"];

const pageProperties: Readonly<Record<string, JsonSchema>> = {
  limit: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  cursor: { type: "string", minLength: 1, maxLength: 64 },
};

function queryOf(extra: Readonly<Record<string, JsonSchema>> = {}): JsonSchema {
  return { type: "object", additionalProperties: false, properties: { ...pageProperties, ...extra } };
}

const monthQuery: JsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: { month: { type: "string", pattern: MONTH_PATTERN } },
};

interface PageQuery {
  limit: number;
  cursor?: string;
}

export function registerMoneyPreview(r: PreviewRouter, db: PreviewDb): void {
  registerMoneyRefs();

  // ── «Mis pagos y cobros» (pantalla 33) ────────────────────────────────────────────────────────────────────────

  r.get<{ Query: { month?: string } }>(
    "/v1/me/payments/passenger-summary",
    { summary: "Resumen mensual de pagos del pasajero (33 · «Soy pasajero»)", tags: TAGS, schema: { querystring: monthQuery } },
    (req) => passengerSummaryDto(db, req.auth().userId, req.query.month ?? currentMonth(db)),
  );

  r.get<{ Query: { month?: string } }>(
    "/v1/me/payments/driver-summary",
    { summary: "Resumen mensual de cobros del conductor (33 · «Soy conductor»)", tags: TAGS, schema: { querystring: monthQuery } },
    (req) => driverSummaryDto(db, req.auth().userId, req.query.month ?? currentMonth(db)),
  );

  r.get<{ Query: PageQuery & { state?: PassengerPaymentState } }>(
    "/v1/me/payments",
    {
      summary: "Mis pagos como pasajero (Ver todos)",
      tags: TAGS,
      schema: { querystring: queryOf({ state: { type: "string", enum: PAYMENT_STATES } }) },
    },
    (req) => {
      const { userId } = req.auth();
      const state = req.query.state;
      const rows = paymentsOf(db, userId).filter((row) => state === undefined || row.state === state);
      return paginate(rows, req.query.cursor, req.query.limit, (row) => paymentItemDto(db, row));
    },
  );

  r.get<{ Query: PageQuery & { state?: DriverEarningState } }>(
    "/v1/me/earnings",
    {
      summary: "Mis cobros como conductor",
      tags: TAGS,
      schema: { querystring: queryOf({ state: { type: "string", enum: EARNING_STATES } }) },
    },
    (req) => {
      const { userId } = req.auth();
      const state = req.query.state;
      const rows = earningsOf(db, userId).filter((row) => state === undefined || row.state === state);
      return paginate(rows, req.query.cursor, req.query.limit, (row) => earningItemDto(db, row));
    },
  );

  r.get<{ Params: { bookingId: string } }>(
    "/v1/me/earnings/:bookingId",
    { summary: "Detalle de un cobro", tags: TAGS, schema: { params: uuidParam("bookingId") } },
    (req) => {
      const { userId } = req.auth();
      const row = moneyTables(db).earnings.get(req.params.bookingId);
      if (row === undefined || row.user_id !== userId) return fail("BOOKING_NOT_FOUND", "Booking not found", 404);
      return earningDetailDto(db, row);
    },
  );

  // ── Métodos de pago ───────────────────────────────────────────────────────────────────────────────────────────

  r.get<{ Query: { purpose?: PaymentMethodPurpose } }>(
    "/v1/me/payment-methods",
    {
      summary: "Mis métodos de pago (solo referencias tokenizadas)",
      tags: TAGS,
      schema: { querystring: { type: "object", additionalProperties: false, properties: { purpose: { type: "string", enum: PURPOSES } } } },
    },
    (req) => {
      const { userId } = req.auth();
      return {
        items: activeMethods(db, userId, req.query.purpose ?? null).map(methodDto),
        availability: availabilityDto(readConfig(db)),
      };
    },
  );

  r.post<{ Body: { purpose: PaymentMethodPurpose; providerToken: string; setAsDefault?: boolean } }>(
    "/v1/me/payment-methods",
    {
      summary: "Añadir un método de pago con el token del proveedor (SIMULADO en la vista previa)",
      tags: TAGS,
      idempotent: "required",
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["purpose", "providerToken"],
          properties: {
            purpose: { type: "string", enum: PURPOSES },
            providerToken: { type: "string", minLength: 1, maxLength: 200 },
            setAsDefault: { type: "boolean" },
          },
        },
      },
    },
    (req) => reply.created(addPaymentMethod(db, req.auth().userId, req.body)),
  );

  r.delete<{ Params: { methodId: string } }>(
    "/v1/me/payment-methods/:methodId",
    { summary: "Quitar un método de pago", tags: TAGS, schema: { params: uuidParam("methodId") } },
    (req) => removePaymentMethod(db, req.auth().userId, req.params.methodId),
  );

  // ── Recibos y justificantes (no fiscales) ─────────────────────────────────────────────────────────────────────

  r.get<{ Query: PageQuery & { kind?: ReceiptKind } }>(
    "/v1/me/receipts",
    {
      summary: "Mis justificantes",
      tags: TAGS,
      schema: { querystring: queryOf({ kind: { type: "string", enum: RECEIPT_KINDS } }) },
    },
    (req) => {
      const { userId } = req.auth();
      const kind = req.query.kind;
      const rows = moneyTables(db)
        .receipts.filter((row) => row.user_id === userId && (kind === undefined || row.kind === kind))
        .sort((a, b) => b.issued_at - a.issued_at);
      return paginate(rows, req.query.cursor, req.query.limit, (row) => receiptSummaryDto(db, row));
    },
  );

  r.get<{ Params: { receiptId: string } }>(
    "/v1/me/receipts/:receiptId",
    { summary: "Detalle de un justificante", tags: TAGS, schema: { params: uuidParam("receiptId") } },
    (req) => {
      const { userId } = req.auth();
      const row = moneyTables(db).receipts.get(req.params.receiptId);
      if (row === undefined || row.user_id !== userId) return fail("RECEIPT_NOT_FOUND", "Receipt not found", 404);
      return receiptDto(db, row);
    },
  );

  r.get<{ Params: { receiptId: string } }>(
    "/v1/me/receipts/:receiptId/printable",
    { summary: "Versión imprimible (HTML) de un justificante", tags: TAGS, schema: { params: uuidParam("receiptId") } },
    (req) => {
      const { userId } = req.auth();
      const row = moneyTables(db).receipts.get(req.params.receiptId);
      if (row === undefined || row.user_id !== userId) return fail("RECEIPT_NOT_FOUND", "Receipt not found", 404);
      return receiptPrintableHtml(db, row);
    },
  );

  // ── Liquidaciones y devoluciones ──────────────────────────────────────────────────────────────────────────────

  r.get<{ Query: PageQuery }>(
    "/v1/me/payouts",
    { summary: "Mis liquidaciones (calendario, próximo abono y cuenta de cobro)", tags: TAGS, schema: { querystring: queryOf() } },
    (req) => {
      const { userId } = req.auth();
      const rows = moneyTables(db)
        .payouts.filter((row) => row.user_id === userId)
        .sort((a, b) => b.period.localeCompare(a.period) || b.created_at - a.created_at);
      return payoutsResponse(db, userId, paginate(rows, req.query.cursor, req.query.limit, payoutViewDto));
    },
  );

  r.get<{ Params: { payoutId: string } }>(
    "/v1/me/payouts/:payoutId",
    { summary: "Detalle de una liquidación", tags: TAGS, schema: { params: uuidParam("payoutId") } },
    (req) => {
      const { userId } = req.auth();
      const row = moneyTables(db).payouts.get(req.params.payoutId);
      if (row === undefined || row.user_id !== userId) return fail("PAYOUT_NOT_FOUND", "Payout not found", 404);
      return payoutDetailDto(db, row);
    },
  );

  r.get<{ Query: PageQuery }>(
    "/v1/me/refunds",
    { summary: "Mis devoluciones y su seguimiento", tags: TAGS, schema: { querystring: queryOf() } },
    (req) => {
      const { userId } = req.auth();
      const rows = moneyTables(db)
        .refunds.filter((row) => row.user_id === userId)
        .sort((a, b) => b.created_at - a.created_at);
      return paginate(rows, req.query.cursor, req.query.limit, refundDto);
    },
  );
}

export function seedMoney(db: PreviewDb, profile: PreviewProfileId, seed: string): void {
  seedMoneyVariant(db, profile, seed);
}

/** Variantes de datos propias del paquete: { "nombre-unico": "qué contiene, en una frase" }. */
export const moneySeedVariants: Readonly<Record<string, string>> = MONEY_SEED_VARIANTS;
