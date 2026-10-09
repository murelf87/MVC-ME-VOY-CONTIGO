import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { authenticate } from "../lib/http.js";
import { getMyPayout, listMyPayouts } from "../payouts/payout-service.js";
import type { PaymentProvider } from "../provider/types.js";
import { getDriverEarning, listDriverEarnings, type DriverEarningState } from "../reports/earnings-service.js";
import { getReceipt, listReceipts, renderReceiptHtml, type ReceiptKind } from "../reports/receipt-service.js";
import {
  getDriverSummary,
  getPassengerSummary,
  listPassengerPayments,
  type PassengerPaymentState
} from "../reports/summary-service.js";
import { BEARER } from "./helpers.js";
import {
  cursorQuery,
  driverEarningDetailSchema,
  driverEarningItemSchema,
  driverSummarySchema,
  EARNING_STATES,
  enumOf,
  errorResponses,
  limitQuery,
  monthQuery,
  myPayoutsSchema,
  page,
  paramsOf,
  passengerPaymentItemSchema,
  PASSENGER_STATES,
  passengerSummarySchema,
  payoutDetailSchema,
  queryOf,
  receiptSchema,
  receiptSummarySchema
} from "./schemas.js";

const TAG_SUMMARY = ["Mis pagos y cobros"];
const TAG_RECEIPTS = ["Recibos"];
const TAG_PAYOUTS = ["Liquidaciones"];

type PageQuery = { cursor?: string; limit?: number };

export function registerReportRoutes(app: FastifyInstance, pool: Pool, provider: PaymentProvider): void {
  app.get<{ Querystring: { month?: string } }>("/v1/me/payments/passenger-summary", {
    schema: {
      tags: TAG_SUMMARY,
      security: BEARER,
      summary: "Resumen de pagos como pasajero (Mis pagos y cobros)",
      description:
        "Pendiente del mes, próximos viajes, los 3 movimientos más recientes, método de pago por defecto y comisión de la plataforma («Por definir» sin tarifa aprobada). Importes `pending_definition` mientras no exista tarifa aprobada.",
      querystring: queryOf({ month: monthQuery }),
      response: { 200: passengerSummarySchema, ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getPassengerSummary(pool, provider, principal, request.query.month);
  });

  app.get<{ Querystring: PageQuery & { state?: PassengerPaymentState } }>("/v1/me/payments", {
    schema: {
      tags: TAG_SUMMARY,
      security: BEARER,
      summary: "Mis pagos como pasajero (Ver todos)",
      description: "Pagos propios y solicitudes aceptadas pendientes de pago, de más reciente a más antiguo. Solo los del propio usuario.",
      querystring: queryOf({ state: enumOf(PASSENGER_STATES), cursor: cursorQuery, limit: limitQuery }),
      response: { 200: page(passengerPaymentItemSchema), ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return listPassengerPayments(pool, principal, request.query);
  });

  app.get<{ Querystring: { month?: string } }>("/v1/me/payments/driver-summary", {
    schema: {
      tags: TAG_SUMMARY,
      security: BEARER,
      summary: "Resumen de cobros como conductor (Mis pagos y cobros)",
      description:
        "A cobrar este mes, viajes realizados, próximo abono («Por definir» sin calendario aprobado), últimos cobros, cuenta de cobro y comisión. Derivado del libro mayor: sin asientos no hay importes.",
      querystring: queryOf({ month: monthQuery }),
      response: { 200: driverSummarySchema, ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getDriverSummary(pool, provider, principal, request.query.month);
  });

  app.get<{ Querystring: PageQuery & { state?: DriverEarningState } }>("/v1/me/earnings", {
    schema: {
      tags: TAG_SUMMARY,
      security: BEARER,
      summary: "Mis cobros como conductor (Ver todos)",
      description: "Neto por reserva del conductor autenticado (aportación − comisión del conductor − devoluciones). Estados: Pendiente, Por cobrar, En liquidación, Cobrado.",
      querystring: queryOf({ state: enumOf(EARNING_STATES), cursor: cursorQuery, limit: limitQuery }),
      response: { 200: page(driverEarningItemSchema), ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return listDriverEarnings(pool, principal, request.query);
  });

  app.get<{ Params: { bookingId: string } }>("/v1/me/earnings/:bookingId", {
    schema: {
      tags: TAG_SUMMARY,
      security: BEARER,
      summary: "Detalle de un cobro del conductor",
      description: "Solo el conductor del viaje. El conductor nunca ve la comisión, el procesamiento ni los impuestos del pasajero, ni su método de pago.",
      params: paramsOf("bookingId"),
      response: { 200: driverEarningDetailSchema, ...errorResponses(400, 401, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getDriverEarning(pool, principal, request.params.bookingId);
  });

  /* ─────────────── Recibos ─────────────── */

  app.get<{ Querystring: PageQuery & { kind?: ReceiptKind } }>("/v1/me/receipts", {
    schema: {
      tags: TAG_RECEIPTS,
      security: BEARER,
      summary: "Mis recibos y justificantes",
      description:
        "Justificantes NO fiscales emitidos tras un evento confirmado por el servidor (pago, devolución, abono). No son facturas. Vacío mientras el proveedor de pagos está desactivado.",
      querystring: queryOf({ kind: enumOf(["payment", "refund", "earning_statement"]), cursor: cursorQuery, limit: limitQuery }),
      response: { 200: page(receiptSummarySchema), ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return listReceipts(pool, principal, request.query);
  });

  app.get<{ Params: { receiptId: string } }>("/v1/me/receipts/:receiptId", {
    schema: {
      tags: TAG_RECEIPTS,
      security: BEARER,
      summary: "Recibo estructurado",
      description: "Detalle del justificante (líneas, total, aviso legal). Solo su propietario.",
      params: paramsOf("receiptId"),
      response: { 200: receiptSchema, ...errorResponses(400, 401, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getReceipt(pool, principal, request.params.receiptId);
  });

  app.get<{ Params: { receiptId: string } }>("/v1/me/receipts/:receiptId/printable", {
    schema: {
      tags: TAG_RECEIPTS,
      security: BEARER,
      summary: "Recibo imprimible (HTML)",
      description: "HTML autocontenido, sin scripts, apto para imprimir o convertir a PDF en el dispositivo. La generación de PDF en servidor no está implementada.",
      params: paramsOf("receiptId"),
      response: { 200: { type: "string", description: "Documento HTML" }, ...errorResponses(400, 401, 404) }
    }
  }, async (request, reply) => {
    const principal = await authenticate(pool, request);
    const receipt = await getReceipt(pool, principal, request.params.receiptId);
    return reply
      .type("text/html; charset=utf-8")
      .header("cache-control", "private, no-store")
      .header("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'")
      .header("x-content-type-options", "nosniff")
      .send(renderReceiptHtml(receipt));
  });

  /* ─────────────── Liquidaciones ─────────────── */

  app.get<{ Querystring: PageQuery }>("/v1/me/payouts", {
    schema: {
      tags: TAG_PAYOUTS,
      security: BEARER,
      summary: "Mis liquidaciones (Liquidación mensual)",
      description: "Liquidaciones mensuales del conductor, calendario de abonos («Por definir» mientras no esté aprobado), próximo abono y cuenta de cobro.",
      querystring: queryOf({ cursor: cursorQuery, limit: limitQuery }),
      response: { 200: myPayoutsSchema, ...errorResponses(400, 401) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return listMyPayouts(pool, provider, principal, request.query);
  });

  app.get<{ Params: { payoutId: string } }>("/v1/me/payouts/:payoutId", {
    schema: {
      tags: TAG_PAYOUTS,
      security: BEARER,
      summary: "Detalle de una liquidación",
      description: "Solo el conductor de la liquidación. Incluye los cobros (reservas) que la componen.",
      params: paramsOf("payoutId"),
      response: { 200: payoutDetailSchema, ...errorResponses(400, 401, 404) }
    }
  }, async request => {
    const principal = await authenticate(pool, request);
    return getMyPayout(pool, principal, request.params.payoutId);
  });
}
