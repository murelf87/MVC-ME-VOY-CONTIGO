/**
 * Cola «Usuarios y revisión» (pantalla 38): qué se pinta en cada tarjeta, filtros y decisiones.
 * Reglas de docs/contracts/trust.md §2 y §4.3. Funciones puras: se prueban en Node.
 */
import type {
  AdminReviewDecision,
  AdminReviewDecisionResult,
  AdminReviewItemKey,
  AdminReviewQueueItem,
  AdminReviewQueuePage,
  AdminReviewRow,
  AdminReviewTab,
  TrustSelfRole,
} from "@/api/types";
import type { IconName } from "@/icons";
import type { StatusTone } from "@/ui";
import { reviewStrings } from "../strings";

// ── Tarjeta ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RoleChip {
  label: string;
  icon: IconName;
  a11y: string;
}

/**
 * El modelo no guarda el género: el rol se rotula «Conductor» / «Pasajero» (la lámina dice «Conductora», que es de los
 * personajes de ejemplo). Quien tiene los dos roles se muestra como conductor (es el que tiene más que revisar).
 */
export function roleChip(roles: readonly TrustSelfRole[]): RoleChip {
  const driver = roles.includes("driver");
  const passenger = roles.includes("passenger");
  if (driver) {
    return {
      label: reviewStrings.users.roleDriver,
      icon: "car",
      a11y: passenger ? reviewStrings.users.roleBoth : reviewStrings.users.roleDriver,
    };
  }
  return { label: reviewStrings.users.rolePassenger, icon: "person", a11y: reviewStrings.users.rolePassenger };
}

export type RowAccessory =
  | { kind: "badge"; text: string }
  | { kind: "clock" }
  | { kind: "check" }
  | { kind: "cross" }
  | { kind: "retry" }
  | { kind: "none" };

/** Lo que se dibuja a la derecha de cada fila: píldora «Requiere revisión», reloj, visto verde… */
export function rowAccessory(row: Pick<AdminReviewRow, "state" | "badge">): RowAccessory {
  if (row.badge !== null && row.badge !== "") return { kind: "badge", text: row.badge };
  switch (row.state) {
    case "in_review":
      return { kind: "clock" };
    case "approved":
      return { kind: "check" };
    case "rejected":
      return { kind: "cross" };
    case "needs_retry":
      return { kind: "retry" };
    case "none":
      return { kind: "none" };
  }
}

/** Color de la píldora de estado de la tarjeta («Pendiente» = ámbar). */
export function statusTone(tab: AdminReviewQueueItem["tab"]): StatusTone {
  switch (tab) {
    case "pending":
      return "amber";
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "none":
      return "gray";
  }
}

export function itemLabel(key: AdminReviewItemKey): string {
  return reviewStrings.users.filters.itemLabels[key];
}

/** Elementos que esperan a personal (los que se aprobarían o rechazarían de golpe). */
export function pendingItemKeys(item: Pick<AdminReviewQueueItem, "rows">): AdminReviewItemKey[] {
  return item.rows.filter((row) => row.state === "in_review").map((row) => row.key);
}

export function pendingItemNames(item: Pick<AdminReviewQueueItem, "rows">): string[] {
  return pendingItemKeys(item).map(itemLabel);
}

/** ¿Se enseñan «Aprobar» / «Rechazar» en la tarjeta? Solo si el servidor dice que se puede decidir y el rol escribe. */
export function showQuickDecisions(item: Pick<AdminReviewQueueItem, "canDecide" | "pendingCount">, canWriteReview: boolean): boolean {
  return canWriteReview && item.canDecide && item.pendingCount > 0;
}

// ── Filtros ───────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QueueFilters {
  tab: AdminReviewTab;
  role: "driver" | "passenger" | null;
  item: AdminReviewItemKey | null;
  sort: "recent" | "oldest";
}

export const DEFAULT_QUEUE_FILTERS: QueueFilters = { tab: "pending", role: null, item: null, sort: "recent" };

/** Hay un filtro de rol o de elemento activo (la pestaña y el orden no cuentan: siempre hay uno). */
export function hasActiveFilters(filters: QueueFilters): boolean {
  return filters.role !== null || filters.item !== null;
}

export const ITEM_FILTER_ORDER: readonly AdminReviewItemKey[] = ["identity", "driver_license", "profile_photo", "private_check"];

export function itemFilterText(item: AdminReviewItemKey | null): string {
  return item === null ? reviewStrings.users.filters.itemAll : itemLabel(item);
}

export function roleFilterText(role: QueueFilters["role"]): string {
  const f = reviewStrings.users.filters;
  if (role === "driver") return f.roleDriver;
  if (role === "passenger") return f.rolePassenger;
  return f.roleLabel;
}

export function sortText(sort: QueueFilters["sort"]): string {
  return sort === "oldest" ? reviewStrings.users.filters.sortOldest : reviewStrings.users.filters.sortRecent;
}

/** `Pendientes (5)` · `Aprobados` · `Rechazados`: solo la pestaña de pendientes lleva contador (es la cola de trabajo). */
export function tabOptions(counts: AdminReviewQueuePage["counts"] | undefined): Array<{ value: AdminReviewTab; label: string; badge?: number }> {
  const tabs = reviewStrings.users.tabs;
  return [
    counts !== undefined ? { value: "pending", label: tabs.pending, badge: counts.pending } : { value: "pending", label: tabs.pending },
    { value: "approved", label: tabs.approved },
    { value: "rejected", label: tabs.rejected },
  ];
}

// ── Decisiones ────────────────────────────────────────────────────────────────────────────────────────────────────

export const REASON_MIN = 3;
export const REASON_MAX = 1000;

export type ReasonCheck = { ok: true; reason: string } | { ok: false; message: string };

export function validateReason(text: string): ReasonCheck {
  const reason = text.trim();
  if (reason.length < REASON_MIN) return { ok: false, message: reviewStrings.users.rejectReasonTooShort };
  if (reason.length > REASON_MAX) return { ok: false, message: reviewStrings.users.rejectReasonTooLong };
  return { ok: true, reason };
}

export interface DecisionOutcome {
  kind: "success" | "warning" | "error";
  message: string;
}

/** Resume el resultado por elemento de una decisión en un único mensaje para el aviso. */
export function decisionOutcome(result: AdminReviewDecisionResult, decision: AdminReviewDecision, name: string): DecisionOutcome {
  const decided = result.results.filter((r) => r.outcome !== "skipped");
  const skipped = result.results.filter((r) => r.outcome === "skipped");
  const s = reviewStrings.users;
  if (decided.length === 0) {
    const first = skipped[0];
    const reason = first?.errorCode === "REVIEW_ITEM_INVALID" ? s.skippedInvalid : s.skippedNothing;
    return { kind: "error", message: reason };
  }
  if (skipped.length > 0) {
    return { kind: "warning", message: s.decisionPartial(name, decided.length, skipped.length) };
  }
  if (decision === "approved") return { kind: "success", message: s.decisionApproved(name) };
  if (decision === "rejected") return { kind: "success", message: s.decisionRejected(name) };
  return { kind: "success", message: s.decisionRetry(name) };
}

/** Texto accesible de una tarjeta de la cola. */
export function cardA11yLabel(item: AdminReviewQueueItem): string {
  return reviewStrings.users.cardA11y(item.displayName, roleChip(item.roles).a11y, item.statusLabel, item.pendingCount);
}
