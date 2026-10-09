/**
 * Schemas JSON de Fastify del módulo `money`. Producen EXACTAMENTE las formas de mobile/src/api/types/money.ts:
 * todos los objetos de respuesta son cerrados (`additionalProperties:false`) y con todas sus propiedades requeridas,
 * salvo las marcadas como opcionales. Un campo ausente del schema se perdería silenciosamente al serializar, por eso
 * tests/money-http.integration.test.ts compara las claves de cada respuesta con el contrato.
 */
export type Schema = Record<string, unknown>;

/* ───────────────────────────── Constructores ───────────────────────────── */

export function obj(properties: Record<string, Schema>, optional: readonly string[] = []): Schema {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties).filter(key => !optional.includes(key)),
    properties
  };
}

export function arr(items: Schema): Schema {
  return { type: "array", items };
}

/** Admite `null` además del tipo original. */
export function nul(schema: Schema): Schema {
  const type = schema.type;
  const withNull = Array.isArray(schema.enum) ? { ...schema, enum: [...(schema.enum as unknown[]), null] } : schema;
  if (Array.isArray(type)) return { ...withNull, type: [...type, "null"] };
  if (typeof type === "string") return { ...withNull, type: [type, "null"] };
  return { anyOf: [{ type: "null" }, schema] };
}

export function enumOf(values: readonly string[]): Schema {
  return { type: "string", enum: [...values] };
}

export const str: Schema = { type: "string" };
export const int: Schema = { type: "integer" };
export const num: Schema = { type: "number" };
export const bool: Schema = { type: "boolean" };
export const uuid: Schema = { type: "string", format: "uuid" };
export const dt: Schema = { type: "string", format: "date-time" };
export const day: Schema = { type: "string" };

export function page(items: Schema, extra: Record<string, Schema> = {}): Schema {
  return obj({ items: arr(items), nextCursor: nul(str), ...extra });
}

/* ───────────────────────────── Errores ───────────────────────────── */

export const errorEnvelope: Schema = {
  type: "object",
  required: ["error", "requestId"],
  properties: {
    error: {
      type: "object",
      required: ["code", "message"],
      properties: { code: { type: "string" }, message: { type: "string" }, details: {} }
    },
    requestId: { type: "string" }
  }
};

export function errorResponses(...codes: number[]): Record<number, Schema> {
  return Object.fromEntries(codes.map(code => [code, errorEnvelope]));
}

/* ───────────────────────────── Entrada común ───────────────────────────── */

export function paramsOf(...names: string[]): Schema {
  return {
    type: "object",
    required: names,
    properties: Object.fromEntries(names.map(name => [name, { type: "string", format: "uuid" }]))
  };
}

/** No se valida el formato aquí: el servicio responde 400 IDEMPOTENCY_KEY_REQUIRED con un mensaje específico. */
export const idempotencyHeaderSchema: Schema = {
  type: "object",
  properties: {
    "idempotency-key": {
      type: "string",
      description: "Obligatoria. 8–128 caracteres [A-Za-z0-9_-] (p. ej. un UUID v4). Un reintento con la misma clave y cuerpo devuelve la misma respuesta (cabecera Idempotency-Replayed: true)."
    }
  }
};

const MONTH_PATTERN = "^[0-9]{4}-(0[1-9]|1[0-2])$";
export const monthQuery: Schema = { type: "string", pattern: MONTH_PATTERN, description: "Mes natural «AAAA-MM» (Europe/Madrid). Por defecto, el mes actual." };
export const cursorQuery: Schema = { type: "string", maxLength: 300 };
export const limitQuery: Schema = { type: "integer", minimum: 1, maximum: 50 };

export function queryOf(properties: Record<string, Schema>): Schema {
  return { type: "object", properties };
}

/* ───────────────────────────── Piezas comunes ───────────────────────────── */

export const moneySchema = obj({
  cents: nul(int),
  currency: enumOf(["EUR"]),
  status: enumOf(["defined", "pending_definition", "illustrative"])
});

export const publicUserSchema = obj({
  id: uuid,
  displayName: str,
  firstName: str,
  photoUrl: nul(str),
  ratingAverage: nul(num),
  ratingCount: int
});

export const tripRefSchema = obj({
  tripId: uuid,
  departureAt: nul(dt),
  originLabel: nul(str),
  destinationLabel: nul(str)
});

const CHARGE_METHODS = ["apple_pay", "google_pay", "card"] as const;
const METHOD_KINDS = [...CHARGE_METHODS, "sepa_debit", "bank_account"] as const;

export const availabilitySchema = obj({
  enabled: bool,
  status: enumOf(["enabled", "provider_disabled"]),
  message: nul(str),
  chargeMethods: arr(enumOf(CHARGE_METHODS)),
  payoutsEnabled: bool,
  refundsEnabled: bool
});

export const paymentMethodSchema = obj({
  id: uuid,
  purpose: enumOf(["charge", "payout"]),
  kind: enumOf(METHOD_KINDS),
  brand: nul(str),
  last4: nul(str),
  country: nul(str),
  expMonth: nul(int),
  expYear: nul(int),
  title: str,
  maskedLabel: str,
  isDefault: bool,
  status: enumOf(["active", "requires_action", "expired"]),
  createdAt: dt
});

export const paymentMethodsResponseSchema = obj({ items: arr(paymentMethodSchema), availability: availabilitySchema });

export const paymentViewSchema = obj({
  id: uuid,
  requestId: uuid,
  bookingId: nul(uuid),
  status: enumOf(["requires_action", "processing", "succeeded", "failed", "expired", "refunded"]),
  outcome: enumOf([
    "awaiting_payment",
    "booking_confirmed",
    "late_payment",
    "amount_mismatch",
    "duplicate_payment",
    "request_not_payable",
    "failed",
    "expired",
    "refunded"
  ]),
  amount: moneySchema,
  refunded: moneySchema,
  method: obj({ kind: enumOf(METHOD_KINDS), maskedLabel: nul(str) }),
  failureCode: nul(str),
  createdAt: dt,
  updatedAt: dt,
  succeededAt: nul(dt)
});

export const paymentSummarySchema = obj({
  contribution: moneySchema,
  platformFee: moneySchema,
  processing: moneySchema,
  taxes: moneySchema,
  total: moneySchema,
  tariffVersion: nul(int),
  quoteSnapshotId: nul(uuid)
});

export const requestPaymentContextSchema = obj({
  requestId: uuid,
  requestStatus: enumOf(["pending", "accepted", "rejected", "payment_pending", "confirmed", "expired", "cancelled", "payment_late"]),
  driver: publicUserSchema,
  trip: tripRefSchema,
  hold: obj({
    status: enumOf(["active", "released", "consumed", "none"]),
    expiresAt: nul(dt),
    secondsRemaining: nul(int)
  }),
  availability: availabilitySchema,
  methods: arr(obj({ kind: enumOf(CHARGE_METHODS), available: bool })),
  savedMethods: arr(paymentMethodSchema),
  summary: paymentSummarySchema,
  canPay: bool,
  cannotPayReason: nul(
    obj({
      code: enumOf([
        "PAYMENTS_PROVIDER_DISABLED",
        "REQUEST_NOT_PAYABLE",
        "HOLD_EXPIRED",
        "PAYMENT_AMOUNT_NOT_DEFINED",
        "PAYMENT_ALREADY_OPEN",
        "REQUEST_ALREADY_PAID"
      ]),
      message: str
    })
  ),
  payment: nul(paymentViewSchema),
  bookingId: nul(uuid)
});

export const createPaymentIntentResponseSchema = obj({
  payment: paymentViewSchema,
  clientAction: obj({
    type: enumOf(["none", "sdk_payment_sheet", "redirect"]),
    clientSecret: nul(str),
    redirectUrl: nul(str)
  })
});

/* ───────────────────────────── Mis pagos y cobros ───────────────────────────── */

export const PASSENGER_STATES = ["pending", "under_review", "paid", "partially_refunded", "refunded", "failed", "expired"] as const;
export const EARNING_STATES = ["pending", "available", "in_payout", "paid_out"] as const;

const commissionSchema = obj({
  status: enumOf(["pending_definition", "defined"]),
  passengerRateBps: nul(int),
  driverRateBps: nul(int)
});

export const passengerPaymentItemSchema = obj({
  key: str,
  kind: enumOf(["payment", "pending_request"]),
  requestId: uuid,
  bookingId: nul(uuid),
  paymentId: nul(uuid),
  driver: publicUserSchema,
  trip: tripRefSchema,
  amount: moneySchema,
  state: enumOf(PASSENGER_STATES),
  occurredAt: dt
});

export const passengerSummarySchema = obj({
  month: str,
  availability: availabilitySchema,
  pendingThisMonth: moneySchema,
  upcomingTripsCount: int,
  recent: arr(passengerPaymentItemSchema),
  paymentMethod: nul(paymentMethodSchema),
  platformCommission: commissionSchema
});

export const driverEarningItemSchema = obj({
  bookingId: uuid,
  passenger: publicUserSchema,
  trip: tripRefSchema,
  net: moneySchema,
  state: enumOf(EARNING_STATES),
  occurredAt: dt
});

export const driverEarningDetailSchema = obj({
  bookingId: uuid,
  passenger: publicUserSchema,
  trip: tripRefSchema,
  net: moneySchema,
  state: enumOf(EARNING_STATES),
  occurredAt: dt,
  lines: obj({
    contribution: moneySchema,
    driverCommission: moneySchema,
    refundAdjustments: moneySchema,
    net: moneySchema
  }),
  payoutId: nul(uuid)
});

export const nextPayoutSchema = obj({
  status: enumOf(["pending_definition", "scheduled", "processing"]),
  date: nul(day),
  amount: moneySchema
});

export const driverSummarySchema = obj({
  month: str,
  availability: availabilitySchema,
  toCollectThisMonth: moneySchema,
  completedTripsCount: int,
  nextPayout: nextPayoutSchema,
  recent: arr(driverEarningItemSchema),
  payoutAccount: nul(paymentMethodSchema),
  platformCommission: commissionSchema
});

/* ───────────────────────────── Recibos y liquidaciones ───────────────────────────── */

const RECEIPT_KINDS = ["payment", "refund", "earning_statement"] as const;
const receiptSummaryProps: Record<string, Schema> = {
  id: uuid,
  number: str,
  kind: enumOf(RECEIPT_KINDS),
  issuedAt: dt,
  total: moneySchema,
  trip: nul(tripRefSchema),
  counterpart: nul(publicUserSchema),
  bookingId: nul(uuid),
  paymentId: nul(uuid)
};
export const receiptSummarySchema = obj(receiptSummaryProps);
export const receiptSchema = obj({
  ...receiptSummaryProps,
  fiscalInvoice: bool,
  lines: arr(
    obj({
      key: enumOf(["contribution", "platform_fee", "processing", "taxes", "refund", "driver_commission", "refund_adjustments", "net"]),
      amount: moneySchema
    })
  ),
  notice: str
});

export const PAYOUT_STATUSES = ["draft", "processing", "paid", "failed", "cancelled"] as const;
const payoutViewProps: Record<string, Schema> = {
  id: uuid,
  period: str,
  status: enumOf(PAYOUT_STATUSES),
  net: moneySchema,
  bookingsCount: int,
  scheduledFor: nul(day),
  paidAt: nul(dt),
  failureCode: nul(str),
  createdAt: dt
};
export const payoutViewSchema = obj(payoutViewProps);
export const myPayoutsSchema = page(payoutViewSchema, {
  availability: availabilitySchema,
  schedule: obj({
    frequency: enumOf(["monthly"]),
    dayStatus: enumOf(["pending_definition", "defined"]),
    dayOfMonth: nul(int)
  }),
  nextPayout: nextPayoutSchema,
  payoutAccount: nul(paymentMethodSchema)
});
export const payoutDetailSchema = obj({ ...payoutViewProps, items: arr(driverEarningItemSchema) });
export const adminPayoutRunSchema = obj({ ...payoutViewProps, driver: publicUserSchema });
export const generatePayoutRunsSchema = obj({
  period: str,
  created: arr(adminPayoutRunSchema),
  skipped: int
});

/* ───────────────────────────── Cancelación y devoluciones ───────────────────────────── */

const BOOKING_STATUSES = ["confirmed", "completed", "cancelled", "driver_cancelled", "no_show"] as const;
export const PASSENGER_REASONS = ["no_longer_needed", "schedule_change", "found_other_option", "other"] as const;
export const DRIVER_REASONS = ["schedule_change", "vehicle_issue", "emergency", "passenger_issue", "other"] as const;
export const REFUND_STATUSES = ["pending_review", "approved", "executing", "refunded", "rejected", "failed", "not_applicable"] as const;
export const REFUND_ORIGINS = [
  "passenger_cancellation",
  "driver_cancellation",
  "platform_cancellation",
  "force_majeure",
  "no_show",
  "late_payment",
  "other"
] as const;

const policyRefSchema = obj({
  status: enumOf(["pending_review", "approved"]),
  version: nul(int),
  effectiveFrom: nul(dt),
  summary: nul(str)
});

export const cancellationPreviewSchema = obj({
  booking: obj({
    id: uuid,
    status: enumOf(BOOKING_STATUSES),
    seats: int,
    trip: tripRefSchema,
    driver: publicUserSchema,
    paid: moneySchema
  }),
  canCancel: bool,
  blocked: nul(
    obj({ code: enumOf(["BOOKING_ALREADY_CANCELLED", "BOOKING_NOT_CANCELLABLE", "TRIP_ALREADY_STARTED"]), message: str })
  ),
  scenario: enumOf(["passenger_cancellation"]),
  reasons: arr(enumOf(PASSENGER_REASONS)),
  policy: policyRefSchema,
  lines: arr(
    obj({
      key: enumOf(["trip_contribution", "platform_fee"]),
      amount: moneySchema,
      noteCode: enumOf(["subject_to_conditions", "policy_pending_review", "per_policy"])
    })
  ),
  proposedRefund: moneySchema,
  decisionMode: enumOf(["admin_review"]),
  legalNotice: str
});

const refundViewProps: Record<string, Schema> = {
  id: uuid,
  status: enumOf(REFUND_STATUSES),
  origin: enumOf(REFUND_ORIGINS),
  bookingId: nul(uuid),
  requestId: uuid,
  paymentId: nul(uuid),
  paid: moneySchema,
  proposedRefund: moneySchema,
  approvedRefund: moneySchema,
  platformFee: moneySchema,
  finalPassengerCost: moneySchema,
  executionStatus: enumOf(["not_started", "awaiting_provider", "submitted", "succeeded", "failed"]),
  policy: policyRefSchema,
  createdAt: dt,
  decidedAt: nul(dt),
  refundedAt: nul(dt)
};
export const refundViewSchema = obj(refundViewProps);
export const myRefundsSchema = page(refundViewSchema);

export const cancelBookingResponseSchema = obj({
  booking: obj({ id: uuid, status: enumOf(BOOKING_STATUSES) }),
  refund: nul(refundViewSchema),
  alreadyCancelled: bool
});

const adminRefundItemProps: Record<string, Schema> = {
  ...refundViewProps,
  passenger: publicUserSchema,
  driver: nul(publicUserSchema),
  trip: tripRefSchema,
  cancelledBy: nul(enumOf(["passenger", "driver", "platform", "system"])),
  cancelledAt: nul(dt),
  cancelReason: nul(str),
  cancelNote: nul(str),
  decision: nul(
    obj({
      by: nul(publicUserSchema),
      at: dt,
      note: nul(str),
      basis: nul(enumOf(["policy", "manual_override", "manual_without_policy", "late_payment_full_refund"]))
    })
  )
};
export const adminRefundItemSchema = obj(adminRefundItemProps);
export const adminRefundListSchema = page(adminRefundItemSchema, {
  counts: obj({ all: int, cancelled: int, refunded: int })
});
export const adminRefundDetailSchema = obj({
  ...adminRefundItemProps,
  payment: nul(paymentViewSchema),
  maxRefundable: moneySchema,
  ledger: arr(obj({ id: int, createdAt: dt, transactionKind: str, account: str, amountCents: int }))
});

/* ───────────────────────────── Planes ───────────────────────────── */

export const planViewSchema = obj({
  code: enumOf(["free", "premium_driver", "membership"]),
  name: str,
  tagline: str,
  status: enumOf(["active", "proposal", "unavailable"]),
  features: arr(str),
  economicsNote: nul(obj({ title: str, detail: str })),
  availabilityNote: nul(str),
  price: moneySchema
});
export const plansResponseSchema = obj({ items: arr(planViewSchema) });
export const myPlanSchema = obj({
  planCode: enumOf(["free", "premium_driver", "membership"]),
  status: enumOf(["active"]),
  purchasable: bool
});

/* ───────────────────────────── Webhook ───────────────────────────── */

export const webhookResponseSchema = obj({
  received: bool,
  results: arr(
    obj({ eventId: str, result: enumOf(["applied", "duplicate", "ignored"]), reason: str }, ["reason"])
  )
});

/* ───────────────────────────── Cuerpos de petición ───────────────────────────── */

export const createPaymentIntentBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["method"],
  properties: {
    method: {
      type: "object",
      additionalProperties: false,
      required: ["kind"],
      properties: {
        kind: enumOf(CHARGE_METHODS),
        paymentMethodId: { type: "string", format: "uuid" }
      }
    }
  }
};

export const addPaymentMethodBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["purpose", "providerToken"],
  properties: {
    purpose: enumOf(["charge", "payout"]),
    providerToken: { type: "string", minLength: 3, maxLength: 200 },
    setAsDefault: { type: "boolean" }
  }
};

export const cancelBookingBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: {
    reason: enumOf(PASSENGER_REASONS),
    note: { type: "string", maxLength: 500 }
  }
};

export const driverCancelBookingBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["reason"],
  properties: {
    reason: enumOf(DRIVER_REASONS),
    note: { type: "string", maxLength: 500 }
  }
};

export const approveRefundBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  properties: {
    approvedCents: { type: "integer", minimum: 1, maximum: 100_000_00 },
    note: { type: "string", maxLength: 1000 }
  }
};

export const rejectRefundBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["note"],
  properties: { note: { type: "string", minLength: 1, maxLength: 1000 } }
};

export const generatePayoutRunsBodySchema: Schema = {
  type: "object",
  additionalProperties: false,
  required: ["period"],
  properties: { period: { type: "string", pattern: MONTH_PATTERN } }
};
