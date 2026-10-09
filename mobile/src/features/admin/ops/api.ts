/**
 * Cliente de red del paquete «admin-ops» (slice `admin`): tarifas, operación, alertas, auditoría, documentos legales,
 * atención al cliente y liquidaciones.
 *
 *   trust (docs/contracts/trust.md §4.3 y §4.4)
 *   GET  /v1/admin/me                                          → AdminMe                  (permisos; lo registra admin-review)
 *   GET  /v1/admin/tariffs                                     → AdminTariffOverview      (A F)
 *   PUT  /v1/admin/tariffs/draft                               → AdminTariffVersion       (A F)
 *   POST /v1/admin/tariffs/example                             → AdminTariffExample       (A F · sin guardar)
 *   GET  /v1/admin/tariffs/versions                            → Page<AdminTariffVersion> (A F)
 *   POST /v1/admin/tariffs/versions/{versionId}/publish        → AdminTariffVersion       (A · puerta ECONOMICS_ACTIVATION)
 *   GET  /v1/admin/operations · PUT /v1/admin/operations       → AdminOperations          (lectura A F S · edición A)
 *   GET  /v1/admin/alerts                                      → Page<AdminAlert>         (A F S)
 *   POST /v1/admin/alerts/evaluate                             → AdminAlertEvaluation     (A S)
 *   POST /v1/admin/alerts/{alertId}/status                     → AdminAlert               (A S)
 *   GET  /v1/admin/audit-events                                → AdminAuditPage           (A)
 *   GET  /v1/admin/legal/documents                             → { items: LegalDocumentSummary[] } (A)
 *   POST /v1/admin/legal/documents                             → LegalDocument            (A · 201 borrador pendiente de revisión legal)
 *   POST /v1/admin/legal/documents/{documentId}/publish        → LegalDocument            (A · exige referencia de revisión legal)
 *   GET  /v1/legal/documents/{kind}/versions/{version}         → LegalDocument            (público · texto completo de una versión)
 *   GET  /v1/admin/support/tickets                             → AdminSupportTicketsPage  (A S)
 *   GET  /v1/admin/support/tickets/{ticketId}                  → AdminSupportTicketDetail (A S)
 *   POST /v1/admin/support/tickets/{ticketId}/reply|assign|close → AdminSupportTicketDetail (A S)
 *   POST /v1/admin/support/attachments/{attachmentId}/access   → AdminSupportAttachmentAccess (A S · URL firmada, auditada antes)
 *
 *   money (docs/contracts/money.md §8.6) · solo finance_admin | admin
 *   GET  /v1/admin/payout-runs                                 → Page<AdminPayoutRun>
 *   POST /v1/admin/payout-runs                                 → GeneratePayoutRunsResponse (Idempotency-Key obligatoria)
 *   POST /v1/admin/payout-runs/{payoutId}/execute              → AdminPayoutRun             (Idempotency-Key obligatoria)
 *   GET  /v1/me/payment-methods?purpose=payout                 → PaymentMethodsResponse     (solo `availability`: ¿hay proveedor de pago?)
 *
 * Las pantallas NO importan este fichero: pasan por los hooks de `./hooks`.
 */
import { apiRequest, registerErrorMessages, type CallOptions } from "@/api";
import type {
  AdminAlert,
  AdminAlertEvaluation,
  AdminAlertKind,
  AdminAlertStatus,
  AdminAuditPage,
  AdminLegalDocumentCreate,
  AdminLegalPublishRequest,
  AdminMe,
  AdminOperations,
  AdminOperationsUpdate,
  AdminPayoutRunList,
  AdminSupportAssignRequest,
  AdminSupportAttachmentAccess,
  AdminSupportAttachmentAccessRequest,
  AdminSupportReplyRequest,
  AdminSupportTicketCategory,
  AdminSupportTicketDetail,
  AdminSupportTicketStatus,
  AdminSupportTicketsPage,
  AdminTariffDraftInput,
  AdminTariffExample,
  AdminTariffExampleRequest,
  AdminTariffOverview,
  AdminTariffPublishRequest,
  AdminTariffVersion,
  ExecutePayoutRunResponse,
  GeneratePayoutRunsRequest,
  GeneratePayoutRunsResponse,
  LegalDocument,
  LegalDocumentKind,
  LegalDocumentSummary,
  PaymentMethodsResponse,
  Page,
  PayoutStatus,
} from "@/api/types";

/** Opciones de las llamadas que ESCRIBEN: llevan `Idempotency-Key` (la misma al reintentar un fallo indeterminado). */
export type WriteOptions = CallOptions & { idempotencyKey?: string };

const enc = encodeURIComponent;

registerErrorMessages({
  // Tarifas
  ECONOMICS_ACTIVATION_DISABLED: {
    title: "Activación bloqueada",
    message: "La activación de tarifas está desactivada hasta que exista una decisión económica aprobada.",
  },
  TARIFF_INVALID: { title: "Tarifa no válida", message: "Revisa los importes del borrador: alguno está fuera de rango." },
  TARIFF_NOT_FOUND: { title: "Tarifa no encontrada", message: "Esa versión de tarifa ya no existe." },
  TARIFF_NOT_DRAFT: { title: "No es un borrador", message: "Solo se puede activar una versión en borrador." },
  TARIFF_DRAFT_INCOMPLETE: {
    title: "Borrador incompleto",
    message: "Define la tarifa por km y las dos comisiones antes de activar esta versión.",
  },
  TARIFF_EFFECTIVE_FROM_INVALID: { title: "Fecha no válida", message: "La fecha de entrada en vigor debe ser futura." },
  APPROVAL_REFERENCE_REQUIRED: {
    title: "Falta la referencia",
    message: "Indica la referencia de la decisión económica aprobada (acta o ticket).",
  },
  // Operación y alertas
  PROVINCE_ONLY_LOCKED: {
    title: "Restricción bloqueada",
    message: "«Solo trayectos dentro de la provincia» no se puede desactivar: es una regla de producto.",
  },
  ALERT_NOT_FOUND: { title: "Alerta no encontrada", message: "Esa alerta ya no existe." },
  ALERT_INVALID_TRANSITION: { title: "Cambio no permitido", message: "Esa alerta ya no está en el estado que esperabas. Actualiza la lista." },
  // Auditoría
  AUDIT_FILTER_INVALID: { title: "Filtro no válido", message: "Revisa los filtros de la auditoría: alguno no es válido." },
  CURSOR_INVALID: { title: "Lista desactualizada", message: "La lista cambió mientras la mirabas. Actualízala para continuar." },
  // Legal
  LEGAL_DOCUMENT_NOT_FOUND: { title: "Documento no encontrado", message: "Ese documento legal ya no existe." },
  LEGAL_CONTENT_INVALID: { title: "Texto no válido", message: "Revisa el título y las secciones del documento." },
  LEGAL_REVIEW_REFERENCE_REQUIRED: {
    title: "Falta la revisión legal",
    message: "Indica la referencia de la revisión legal que aprueba este texto. Sin ella no se puede publicar.",
  },
  LEGAL_ALREADY_PUBLISHED: { title: "Ya está publicada", message: "Esa versión ya está publicada." },
  LEGAL_DOCUMENT_RETIRED: { title: "Versión retirada", message: "Esa versión está retirada y no puede publicarse." },
  // Atención al cliente
  SUPPORT_UNAVAILABLE: {
    title: "Atención no disponible",
    message: "El centro de ayuda aún no está disponible en este entorno. No se muestra una cola vacía para no ocultar consultas.",
  },
  TICKET_NOT_FOUND: { title: "Consulta no encontrada", message: "Esa consulta ya no existe." },
  TICKET_CLOSED: { title: "Consulta cerrada", message: "La consulta está cerrada: no se puede responder." },
  TICKET_ALREADY_CLOSED: { title: "Ya está cerrada", message: "Esa consulta ya estaba cerrada." },
  ATTACHMENT_NOT_FOUND: { title: "Adjunto no encontrado", message: "Ese adjunto ya no existe." },
  PRIVATE_STORAGE_DISABLED: {
    title: "Archivos privados no disponibles",
    message: "El almacenamiento privado no está activo en este entorno, así que no se puede abrir el adjunto.",
  },
  SELF_REVIEW_FORBIDDEN: { title: "No permitido", message: "No puedes abrir un adjunto que subiste tú." },
  EVIDENCE_STORAGE_MISMATCH: {
    title: "Adjunto no disponible",
    message: "El archivo no coincide con el registrado, así que no se abre. Avisa a Administración.",
  },
  // Liquidaciones
  PAYMENTS_PROVIDER_DISABLED: {
    title: "Pagos aún no disponibles",
    message: "Todavía no hay proveedor de pago activo: no se puede pedir ningún abono. Nada se ha enviado.",
  },
  PAYOUT_ACCOUNT_REQUIRED: {
    title: "Falta la cuenta de cobro",
    message: "Esa persona conductora no tiene una cuenta de cobro activa, así que no se puede pedir el abono.",
  },
  PAYOUT_NOT_EXECUTABLE: {
    title: "Abono no disponible",
    message: "Esa liquidación ya no está en un estado en el que se pueda pedir el abono. Actualiza la lista.",
  },
  PAYOUT_NOT_FOUND: { title: "Liquidación no encontrada", message: "Esa liquidación ya no existe." },
});

// ── Acceso ────────────────────────────────────────────────────────────────────────────────────────────────────────

export function getAdminMe(options: CallOptions = {}): Promise<AdminMe> {
  return apiRequest<AdminMe>("/v1/admin/me", { ...options });
}

// ── Tarifas ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function getTariffOverview(options: CallOptions = {}): Promise<AdminTariffOverview> {
  return apiRequest<AdminTariffOverview>("/v1/admin/tariffs", { ...options });
}

export function saveTariffDraft(input: AdminTariffDraftInput, options: WriteOptions = {}): Promise<AdminTariffVersion> {
  return apiRequest<AdminTariffVersion>("/v1/admin/tariffs/draft", { method: "PUT", body: input, ...options });
}

export function calculateTariffExample(input: AdminTariffExampleRequest, options: CallOptions = {}): Promise<AdminTariffExample> {
  return apiRequest<AdminTariffExample>("/v1/admin/tariffs/example", { method: "POST", body: input, ...options });
}

export function listTariffVersions(input: { cursor?: string | null; limit?: number } = {}, options: CallOptions = {}): Promise<Page<AdminTariffVersion>> {
  return apiRequest<Page<AdminTariffVersion>>("/v1/admin/tariffs/versions", {
    query: { cursor: input.cursor ?? null, limit: input.limit ?? null },
    ...options,
  });
}

export function publishTariffVersion(versionId: string, input: AdminTariffPublishRequest, options: WriteOptions = {}): Promise<AdminTariffVersion> {
  return apiRequest<AdminTariffVersion>(`/v1/admin/tariffs/versions/${enc(versionId)}/publish`, { method: "POST", body: input, ...options });
}

// ── Operación y alertas ───────────────────────────────────────────────────────────────────────────────────────────

export function getOperations(options: CallOptions = {}): Promise<AdminOperations> {
  return apiRequest<AdminOperations>("/v1/admin/operations", { ...options });
}

export function updateOperations(input: AdminOperationsUpdate, options: WriteOptions = {}): Promise<AdminOperations> {
  return apiRequest<AdminOperations>("/v1/admin/operations", { method: "PUT", body: input, ...options });
}

export interface AlertsQuery {
  status: AdminAlertStatus | "all";
  kind: AdminAlertKind | null;
  cursor?: string | null;
  limit?: number;
}

export function listAlerts(input: AlertsQuery, options: CallOptions = {}): Promise<Page<AdminAlert>> {
  return apiRequest<Page<AdminAlert>>("/v1/admin/alerts", {
    query: { status: input.status, kind: input.kind, cursor: input.cursor ?? null, limit: input.limit ?? null },
    ...options,
  });
}

export function evaluateAlerts(options: WriteOptions = {}): Promise<AdminAlertEvaluation> {
  return apiRequest<AdminAlertEvaluation>("/v1/admin/alerts/evaluate", { method: "POST", ...options });
}

export function setAlertStatus(alertId: string, status: "acknowledged" | "resolved", options: WriteOptions = {}): Promise<AdminAlert> {
  return apiRequest<AdminAlert>(`/v1/admin/alerts/${enc(alertId)}/status`, { method: "POST", body: { status }, ...options });
}

// ── Auditoría ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface AuditEventsQuery {
  actorUserId: string | null;
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  from: string | null;
  to: string | null;
  cursor?: string | null;
  limit?: number;
}

export function listAuditEvents(input: AuditEventsQuery, options: CallOptions = {}): Promise<AdminAuditPage> {
  return apiRequest<AdminAuditPage>("/v1/admin/audit-events", {
    query: {
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      from: input.from,
      to: input.to,
      cursor: input.cursor ?? null,
      limit: input.limit ?? null,
    },
    ...options,
  });
}

// ── Documentos legales ────────────────────────────────────────────────────────────────────────────────────────────

export function listLegalDocuments(options: CallOptions = {}): Promise<{ items: LegalDocumentSummary[] }> {
  return apiRequest<{ items: LegalDocumentSummary[] }>("/v1/admin/legal/documents", { ...options });
}

export function createLegalDocument(input: AdminLegalDocumentCreate, options: WriteOptions = {}): Promise<LegalDocument> {
  return apiRequest<LegalDocument>("/v1/admin/legal/documents", { method: "POST", body: input, ...options });
}

export function publishLegalDocument(documentId: string, input: AdminLegalPublishRequest, options: WriteOptions = {}): Promise<LegalDocument> {
  return apiRequest<LegalDocument>(`/v1/admin/legal/documents/${enc(documentId)}/publish`, { method: "POST", body: input, ...options });
}

/** Texto completo de una versión (endpoint público; el listado de administración solo trae el resumen). */
export function getLegalVersion(kind: LegalDocumentKind, version: number, options: CallOptions = {}): Promise<LegalDocument> {
  return apiRequest<LegalDocument>(`/v1/legal/documents/${enc(kind)}/versions/${version}`, { token: null, ...options });
}

// ── Atención al cliente ───────────────────────────────────────────────────────────────────────────────────────────

export interface TicketsQuery {
  status: AdminSupportTicketStatus | "all";
  assigned: "any" | "me" | "unassigned";
  category: AdminSupportTicketCategory | null;
  cursor?: string | null;
  limit?: number;
}

export function listSupportTickets(input: TicketsQuery, options: CallOptions = {}): Promise<AdminSupportTicketsPage> {
  return apiRequest<AdminSupportTicketsPage>("/v1/admin/support/tickets", {
    query: {
      status: input.status,
      assigned: input.assigned,
      category: input.category,
      cursor: input.cursor ?? null,
      limit: input.limit ?? null,
    },
    ...options,
  });
}

export function getSupportTicket(ticketId: string, options: CallOptions = {}): Promise<AdminSupportTicketDetail> {
  return apiRequest<AdminSupportTicketDetail>(`/v1/admin/support/tickets/${enc(ticketId)}`, { ...options });
}

export function replySupportTicket(ticketId: string, input: AdminSupportReplyRequest, options: WriteOptions = {}): Promise<AdminSupportTicketDetail> {
  return apiRequest<AdminSupportTicketDetail>(`/v1/admin/support/tickets/${enc(ticketId)}/reply`, { method: "POST", body: input, ...options });
}

export function assignSupportTicket(ticketId: string, input: AdminSupportAssignRequest, options: WriteOptions = {}): Promise<AdminSupportTicketDetail> {
  return apiRequest<AdminSupportTicketDetail>(`/v1/admin/support/tickets/${enc(ticketId)}/assign`, { method: "POST", body: input, ...options });
}

export function closeSupportTicket(ticketId: string, options: WriteOptions = {}): Promise<AdminSupportTicketDetail> {
  return apiRequest<AdminSupportTicketDetail>(`/v1/admin/support/tickets/${enc(ticketId)}/close`, { method: "POST", ...options });
}

export function requestAttachmentAccess(
  attachmentId: string,
  input: AdminSupportAttachmentAccessRequest,
  options: WriteOptions = {},
): Promise<AdminSupportAttachmentAccess> {
  return apiRequest<AdminSupportAttachmentAccess>(`/v1/admin/support/attachments/${enc(attachmentId)}/access`, {
    method: "POST",
    body: input,
    ...options,
  });
}

// ── Liquidaciones ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface PayoutRunsQuery {
  period: string | null;
  status: PayoutStatus | null;
  cursor?: string | null;
  limit?: number;
}

export function listPayoutRuns(input: PayoutRunsQuery, options: CallOptions = {}): Promise<AdminPayoutRunList> {
  return apiRequest<AdminPayoutRunList>("/v1/admin/payout-runs", {
    query: { period: input.period, status: input.status, cursor: input.cursor ?? null, limit: input.limit ?? null },
    ...options,
  });
}

export function generatePayoutRuns(input: GeneratePayoutRunsRequest, options: WriteOptions = {}): Promise<GeneratePayoutRunsResponse> {
  return apiRequest<GeneratePayoutRunsResponse>("/v1/admin/payout-runs", { method: "POST", body: input, ...options });
}

export function executePayoutRun(payoutId: string, options: WriteOptions = {}): Promise<ExecutePayoutRunResponse> {
  return apiRequest<ExecutePayoutRunResponse>(`/v1/admin/payout-runs/${enc(payoutId)}/execute`, { method: "POST", ...options });
}

/** Disponibilidad del proveedor de pago (la misma que ven las personas conductoras): `availability.payoutsEnabled`. */
export function getPayoutAvailability(options: CallOptions = {}): Promise<PaymentMethodsResponse> {
  return apiRequest<PaymentMethodsResponse>("/v1/me/payment-methods", { query: { purpose: "payout" }, ...options });
}

