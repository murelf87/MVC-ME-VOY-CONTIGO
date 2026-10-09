/**
 * Expediente de una persona usuaria: modelos de presentación de elementos, decisiones, vehículos e historial.
 * Reglas de docs/contracts/trust.md §2 y §4.3. Funciones puras: se prueban en Node.
 */
import type {
  AdminDossier,
  AdminDossierEvent,
  AdminDossierItem,
  AdminDossierVehicle,
  AdminReasonOption,
  AdminReviewDecision,
  ReviewState,
} from "@/api/types";
import { formatDateTime } from "@/i18n";
import type { StatusTone } from "@/ui";
import { reviewStrings } from "../strings";
import { formatBytes } from "./evidence";

const d = reviewStrings.dossier;

export type DossierTab = "items" | "vehicles" | "history";

export const DOSSIER_TABS: ReadonlyArray<{ value: DossierTab; label: string }> = [
  { value: "items", label: d.tabs.items },
  { value: "vehicles", label: d.tabs.vehicles },
  { value: "history", label: d.tabs.history },
];

export function stateTone(state: ReviewState): StatusTone {
  switch (state) {
    case "in_review":
      return "amber";
    case "approved":
      return "green";
    case "rejected":
      return "red";
    case "needs_retry":
      return "orange";
    case "none":
      return "gray";
  }
}

export function stateLabel(state: ReviewState): string {
  return reviewStrings.users.rowStates[state];
}

/** ¿Es el expediente de la propia persona que mira? (nadie revisa lo propio: 403 `SELF_REVIEW_FORBIDDEN`). */
export function isOwnDossier(dossier: Pick<AdminDossier, "user">, meUserId: string | null | undefined): boolean {
  return meUserId !== null && meUserId !== undefined && dossier.user.id === meUserId;
}

export interface EvidenceView {
  kind: AdminDossierItem["evidence"][number]["kind"];
  id: string;
  label: string;
  meta: string;
}

export interface DossierItemView {
  key: AdminDossierItem["key"];
  label: string;
  state: ReviewState;
  stateLabel: string;
  tone: StatusTone;
  badge: string | null;
  submitted: string;
  decided: string | null;
  reason: string | null;
  evidence: EvidenceView[];
  /** Decisiones que se ofrecen: las que el servidor permite, solo si el rol escribe y no es el propio expediente. */
  decisions: AdminReviewDecision[];
  /** Por qué no hay botones (rol sin escritura o expediente propio), para decirlo en vez de callar. */
  decisionsBlockedReason: string | null;
}

export function dossierItemView(item: AdminDossierItem, ctx: { canWrite: boolean; isOwn: boolean }): DossierItemView {
  const decided =
    item.decidedAt !== null ? (item.decidedBy?.displayName ? d.decidedBy(item.decidedBy.displayName, formatDateTime(item.decidedAt)) : d.decidedAt(formatDateTime(item.decidedAt))) : null;
  let blocked: string | null = null;
  let decisions: AdminReviewDecision[] = [];
  if (ctx.isOwn) blocked = d.selfReview;
  else if (!ctx.canWrite) blocked = d.decisionNoPermission;
  else decisions = item.allowedDecisions;
  return {
    key: item.key,
    label: item.label,
    state: item.state,
    stateLabel: stateLabel(item.state),
    tone: stateTone(item.state),
    badge: item.badge,
    submitted: item.submittedAt !== null ? d.submittedAt(formatDateTime(item.submittedAt)) : d.notSubmitted,
    decided,
    reason: item.reason !== null && item.reason !== "" ? d.reasonLine(item.reason) : null,
    evidence: item.evidence.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      label: ref.label !== "" ? ref.label : d.evidenceKinds[ref.kind],
      meta: d.evidenceMeta(formatBytes(ref.sizeBytes), formatDateTime(ref.submittedAt)),
    })),
    decisions,
    decisionsBlockedReason: blocked,
  };
}

/** Motivos estándar que admite una decisión sobre un elemento (filtrados por `decisions` del servidor). */
export function reasonOptionsFor(item: Pick<AdminDossierItem, "reasonOptions">, decision: AdminReviewDecision): AdminReasonOption[] {
  return item.reasonOptions.filter((option) => option.decisions.includes(decision));
}

// ── Vehículos ─────────────────────────────────────────────────────────────────────────────────────────────────────

export type VehicleArea = "vehicle" | "documentation";
export type VehicleStatus = AdminDossierVehicle["reviewStatus"];

export function vehicleStatusTone(status: VehicleStatus): StatusTone {
  return status === "approved" ? "green" : status === "rejected" ? "red" : "amber";
}

export interface VehicleAreaView {
  area: VehicleArea;
  label: string;
  status: VehicleStatus;
  statusLabel: string;
  tone: StatusTone;
  /** Solo lo pendiente se puede decidir (y solo con permiso de escritura y fuera del expediente propio). */
  decidable: boolean;
}

export interface VehicleView {
  id: string;
  title: string;
  plate: string;
  areas: VehicleAreaView[];
  photoStatus: { label: string; tone: StatusTone };
  insuranceStatus: { label: string; tone: StatusTone };
}

export function vehicleView(vehicle: AdminDossierVehicle, ctx: { canWrite: boolean; isOwn: boolean }): VehicleView {
  const allowed = ctx.canWrite && !ctx.isOwn;
  const area = (key: VehicleArea, status: VehicleStatus): VehicleAreaView => ({
    area: key,
    label: d.vehicleAreas[key],
    status,
    statusLabel: d.vehicleStatus[status],
    tone: vehicleStatusTone(status),
    decidable: allowed && status === "pending",
  });
  return {
    id: vehicle.id,
    title: vehicle.label,
    plate: vehicle.plate,
    areas: [area("vehicle", vehicle.reviewStatus), area("documentation", vehicle.documentationStatus)],
    photoStatus: { label: d.vehicleStatus[vehicle.vehiclePhotoStatus], tone: vehicleStatusTone(vehicle.vehiclePhotoStatus) },
    insuranceStatus: { label: d.vehicleStatus[vehicle.insuranceStatus], tone: vehicleStatusTone(vehicle.insuranceStatus) },
  };
}

// ── Historial ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HistoryView {
  key: string;
  when: string;
  summary: string;
  actor: string | null;
}

/** Más reciente primero. */
export function historyView(events: readonly AdminDossierEvent[]): HistoryView[] {
  return [...events]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .map((event, index) => ({
      key: `${event.at}:${event.action}:${index}`,
      when: formatDateTime(event.at),
      summary: event.summary,
      actor: event.actor?.displayName ? d.historyBy(event.actor.displayName) : null,
    }));
}
