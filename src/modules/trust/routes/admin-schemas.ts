import { ADMIN_RESOURCES, STAFF_ROLES } from "../rbac.js";
import { PERIODS } from "../period.js";
import {
  type Schema,
  actorRefS,
  arr,
  bool,
  enumOf,
  freeObject,
  int,
  moneyS,
  nActorRefS,
  nProvinceRefS,
  nenum,
  nint,
  nstr,
  nullable,
  num,
  obj,
  provinceRefS,
  str
} from "../schemas.js";

const REVIEW_STATES = ["none", "in_review", "needs_retry", "approved", "rejected"] as const;
const ITEM_KEYS = ["identity", "private_check", "driver_license", "profile_photo"] as const;
const SELF_ROLES = ["passenger", "driver"] as const;

/* ───────── Quién soy ───────── */

export const adminMeS: Schema = obj({
  userId: str(),
  displayName: nstr(),
  roles: arr(enumOf(STAFF_ROLES)),
  permissions: obj(Object.fromEntries(ADMIN_RESOURCES.map(resource => [resource, enumOf(["none", "read", "write"])])))
});

/* ───────── Resumen (pantalla 37) ───────── */

const kpiS: Schema = obj({
  value: nint(),
  previous: nint(),
  deltaPercent: nint(),
  trend: enumOf(["up", "down", "flat", "new", "unavailable"]),
  available: bool(),
  definition: str()
});
const moneyKpiS: Schema = obj({
  amount: moneyS,
  source: enumOf(["commissions_of_confirmed_bookings", "none"]),
  note: nstr()
});

export const summaryS: Schema = obj({
  generatedAt: str(),
  window: obj({
    period: enumOf(PERIODS),
    timeZone: enumOf(["Europe/Madrid"]),
    from: str(),
    to: str(),
    previousFrom: str(),
    previousTo: str()
  }),
  province: nProvinceRefS,
  kpis: obj({ activeTrips: kpiS, requests: kpiS, incidents: kpiS }),
  liveNow: obj({ tripsInProgress: int() }),
  finance: nullable(
    obj({ grossRevenue: moneyKpiS, operatingCosts: moneyKpiS, result: moneyKpiS, economicsActivated: bool() })
  ),
  notes: arr(str())
});

export const vehicleActivityS: Schema = obj({
  generatedAt: str(),
  province: nProvinceRefS,
  label: enumOf(["Actividad de vehículos (aproximada)"]),
  precision: enumOf(["approximate"]),
  gridDegrees: num(),
  freshnessSeconds: int(),
  totalVehicles: int(),
  items: arr(
    obj({
      id: str(),
      kind: enumOf(["vehicle", "cluster"]),
      count: int(),
      lat: num(),
      lng: num(),
      precisionMeters: int()
    })
  )
});

/* ───────── Usuarios y revisión (pantalla 38) ───────── */

export const queueItemS: Schema = obj({
  userId: str(),
  displayName: str(),
  firstName: str(),
  photoUrl: nstr(),
  roles: arr(enumOf(SELF_ROLES)),
  tab: enumOf(["pending", "approved", "rejected", "none"]),
  statusLabel: str(),
  submittedAt: str(),
  rows: arr(
    obj({
      key: enumOf(ITEM_KEYS),
      label: str(),
      state: enumOf(REVIEW_STATES),
      badge: nstr()
    })
  ),
  pendingCount: int(),
  canDecide: bool()
});

export const queuePageS: Schema = obj({
  items: arr(queueItemS),
  nextCursor: nstr(),
  counts: obj({ pending: int(), approved: int(), rejected: int() })
});

const decisionS = enumOf(["approved", "rejected", "needs_retry"]);

const evidenceRefS: Schema = obj({
  kind: enumOf(["profile_photo", "identity_selfie", "private_document"]),
  id: str(),
  label: str(),
  contentType: str(),
  sizeBytes: int(),
  submittedAt: str(),
  status: str()
});

const dossierItemS: Schema = obj({
  key: enumOf(ITEM_KEYS),
  label: str(),
  state: enumOf(REVIEW_STATES),
  badge: nstr(),
  submittedAt: nstr(),
  decidedAt: nstr(),
  decidedBy: nActorRefS,
  reason: nstr(),
  evidence: arr(evidenceRefS),
  allowedDecisions: arr(decisionS),
  reasonOptions: arr(obj({ code: str(), label: str(), decisions: arr(decisionS) }))
});

export const dossierS: Schema = obj({
  user: obj({
    id: str(),
    displayName: str(),
    firstName: str(),
    photoUrl: nstr(),
    roles: arr(enumOf(SELF_ROLES)),
    status: enumOf(["active", "suspended", "deleted"]),
    phoneMasked: nstr(),
    createdAt: str()
  }),
  summary: queueItemS,
  items: arr(dossierItemS),
  vehicles: arr(
    obj({
      id: str(),
      label: str(),
      plate: str(),
      reviewStatus: enumOf(["pending", "approved", "rejected"]),
      documentationStatus: enumOf(["pending", "approved", "rejected"]),
      vehiclePhotoStatus: enumOf(["pending", "approved", "rejected"]),
      insuranceStatus: enumOf(["pending", "approved", "rejected"]),
      reviewEndpoint: str()
    })
  ),
  history: arr(obj({ at: str(), action: str(), actor: nActorRefS, summary: str() })),
  accessNote: str()
});

export const decisionResultS: Schema = obj({
  userId: str(),
  results: arr(
    obj({
      item: enumOf(ITEM_KEYS),
      outcome: enumOf(["approved", "rejected", "needs_retry", "skipped"]),
      errorCode: nstr(),
      message: nstr()
    })
  ),
  summary: nullable(queueItemS)
});

export const evidenceAccessS: Schema = obj({
  url: str(),
  expiresAt: str(),
  ttlSeconds: int(),
  contentType: str(),
  evidence: obj({ kind: enumOf(["profile_photo", "identity_selfie", "private_document"]), id: str() })
});

/* ───────── Reservas y devoluciones (pantalla 39) ───────── */

const bookingPartyS: Schema = obj({ id: str(), displayName: str(), firstName: str(), photoUrl: nstr() });

export const bookingsPageS: Schema = obj({
  items: arr(
    obj({
      bookingId: str(),
      tripId: str(),
      status: enumOf(["confirmed", "completed", "cancelled", "driver_cancelled", "no_show"]),
      statusLabel: str(),
      passenger: bookingPartyS,
      driver: bookingPartyS,
      tripDepartureAt: nstr(),
      route: obj({ originLabel: nstr(), destinationLabel: nstr() }),
      cancelledBy: nenum(["passenger", "driver"]),
      cancelledAt: nstr(),
      money: obj({
        amountPaid: moneyS,
        proposedRefund: moneyS,
        platformCommission: moneyS,
        finalPassengerCost: moneyS
      }),
      refund: obj({
        status: enumOf(["not_applicable", "pending_definition", "proposed", "refunded"]),
        actionOwner: enumOf(["money"])
      })
    })
  ),
  nextCursor: nstr(),
  counts: obj({ all: int(), cancelled: int(), refunded: nint() })
});

/* ───────── Tarifas y operaciones (pantalla 40) ───────── */

export const tariffVersionS: Schema = obj({
  id: str(),
  version: int(),
  status: enumOf(["draft", "approved", "retired"]),
  ratePerKmMicros: nint(),
  passengerCommissionBps: nint(),
  driverCommissionBps: nint(),
  sharedCostCapCents: nint(),
  premiumMonthlyCents: nint(),
  effectiveFrom: nstr(),
  notes: nstr(),
  approvalReference: nstr(),
  createdAt: str(),
  updatedAt: str(),
  createdBy: nActorRefS,
  updatedBy: nActorRefS
});

export const tariffOverviewS: Schema = obj({
  active: nullable(tariffVersionS),
  draft: nullable(tariffVersionS),
  activation: obj({ mode: enumOf(["disabled", "enabled"]), canPublish: bool(), message: str() }),
  applyNote: str(),
  auditNote: str()
});

export const tariffVersionsPageS: Schema = obj({ items: arr(tariffVersionS), nextCursor: nstr() });

export const tariffExampleS: Schema = obj({
  distanceMeters: int(),
  ratePerKmMicros: nint(),
  contribution: moneyS,
  passengerCommission: moneyS,
  driverCommission: moneyS,
  passengerTotal: moneyS,
  driverNet: moneyS,
  disclaimer: str(),
  roundingRule: enumOf(["half_up_cents"])
});

const ALERT_KINDS = ["unusual_cancellations", "schedule_price_changes", "route_incidents"] as const;

export const ruleParamsS: Schema = obj({ thresholdCount: int(), windowMinutes: int(), maxPendingMinutes: int() }, []);

export const operationsS: Schema = obj({
  provinceOnly: obj({ enabled: bool(), locked: bool(), label: str() }),
  realtimeAlerts: obj({
    enabled: bool(),
    rules: arr(
      obj({
        kind: enumOf(ALERT_KINDS),
        label: str(),
        enabled: bool(),
        params: ruleParamsS,
        source: enumOf(["available", "unavailable"]),
        sourceNote: nstr()
      })
    )
  }),
  updatedAt: nstr(),
  updatedBy: nActorRefS
});

export const alertS: Schema = obj({
  id: str(),
  kind: enumOf(ALERT_KINDS),
  severity: enumOf(["info", "warning", "critical"]),
  status: enumOf(["open", "acknowledged", "resolved"]),
  title: str(),
  body: str(),
  detectedAt: str(),
  province: nullable(provinceRefS),
  data: freeObject(),
  acknowledgedAt: nstr(),
  resolvedAt: nstr()
});

export const alertsPageS: Schema = obj({ items: arr(alertS), nextCursor: nstr() });

export const alertEvaluationS: Schema = obj({
  evaluatedAt: str(),
  created: int(),
  autoResolved: int(),
  rules: arr(
    obj({
      kind: enumOf(ALERT_KINDS),
      enabled: bool(),
      evaluated: bool(),
      created: int(),
      skippedReason: nenum(["disabled", "realtime_alerts_off", "source_unavailable"])
    })
  )
});

/* ───────── Auditoría ───────── */

export const auditPageS: Schema = obj({
  items: arr(
    obj({
      id: str(),
      createdAt: str(),
      actor: nActorRefS,
      action: str(),
      entityType: str(),
      entityId: nstr(),
      requestId: nstr(),
      metadata: freeObject(),
      redactions: int()
    })
  ),
  nextCursor: nstr()
});

/* ───────── Documentos legales (admin) ───────── */

/* ───────── Atención al cliente ───────── */

const ticketStatusS = enumOf(["open", "answered", "closed"]);
const ticketCategoryS = enumOf(["trip_issue", "payment_issue", "account_profile"]);

const ticketRowProps: Record<string, Schema> = {
  id: str(),
  reference: str(),
  status: ticketStatusS,
  category: ticketCategoryS,
  categoryLabel: str(),
  user: obj({ id: str(), displayName: str(), firstName: str(), photoUrl: nstr() }),
  preview: str(),
  createdAt: str(),
  lastUserMessageAt: str(),
  lastStaffMessageAt: nstr(),
  assignedTo: nullable(actorRefS),
  messageCount: int(),
  attachmentCount: int(),
  waitingForStaff: bool()
};

export const ticketsPageS: Schema = obj({
  items: arr(obj(ticketRowProps)),
  nextCursor: nstr(),
  counts: obj({ open: int(), answered: int(), closed: int() })
});

const attachmentS: Schema = obj({ id: str(), contentType: str(), sizeBytes: int(), createdAt: str() });

export const ticketDetailS: Schema = obj({
  ...ticketRowProps,
  tripId: nstr(),
  bookingId: nstr(),
  closedAt: nstr(),
  closedBy: nenum(["user", "staff"]),
  messages: arr(
    obj({
      id: str(),
      authorType: enumOf(["user", "staff"]),
      author: nullable(actorRefS),
      body: str(),
      createdAt: str(),
      attachments: arr(attachmentS)
    })
  ),
  attachments: arr(attachmentS)
});

export const attachmentAccessS: Schema = obj({
  url: str(),
  expiresAt: str(),
  ttlSeconds: int(),
  contentType: str(),
  attachmentId: str()
});
