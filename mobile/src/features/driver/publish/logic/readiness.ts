/**
 * Requisitos para publicar rutas (`GET /v1/me/driver/readiness`) convertidos en filas para la pantalla 17: qué se enseña,
 * con qué tono y a dónde lleva cada una. El servidor decide SIEMPRE si se puede publicar (`canPublish`); aquí solo se
 * presenta lo que dice y se explica cómo resolverlo.
 */
import type { DriverReadiness, ReadinessItem, ReadinessKey } from "@/api/types/trips";
import type { IconName } from "@/icons";
import { publishStrings } from "../strings";

export type RequirementTone = "success" | "warning" | "danger" | "neutral";

/** Pantalla que resuelve un requisito (rutas de `auth` y de este mismo paquete). */
export type RequirementTarget =
  | { route: "ProfilePhoto" }
  | { route: "PrivateCheckCapture" }
  | { route: "PrivateCheckStatus" }
  | { route: "VehicleForm"; vehicleId?: string }
  | { route: "VehicleDocuments"; vehicleId: string };

export interface RequirementRow {
  key: ReadinessKey;
  title: string;
  state: ReadinessItem["state"];
  tone: RequirementTone;
  icon: IconName;
  /** Texto bajo el título: «Documento subido», «En revisión»… */
  detail: string;
  blocking: boolean;
  /** Verbo de la acción que lo resuelve («Subir», «Renovar»…); `null` si no hay nada que hacer. */
  actionLabel: string | null;
  target: RequirementTarget;
  /** Filas de la lámina 17: siempre visibles. Las demás solo se enseñan mientras no estén aprobadas. */
  inLamina: boolean;
  /** Frase accesible completa de la fila. */
  accessibilityLabel: string;
}

const copy = publishStrings.readiness;

/** Orden de las filas: primero las de la lámina 17 (permiso y seguro), y antes de ellas los requisitos pendientes. */
const ORDER: readonly ReadinessKey[] = [
  "public_photo",
  "identity",
  "vehicle",
  "vehicle_documents",
  "vehicle_photo",
  "driver_license",
  "insurance",
];

const LAMINA_KEYS: ReadonlySet<ReadinessKey> = new Set<ReadinessKey>(["driver_license", "insurance"]);

const ICONS: Record<ReadinessKey, IconName> = {
  public_photo: "camera",
  identity: "idCard",
  vehicle: "car",
  vehicle_documents: "document",
  vehicle_photo: "image",
  insurance: "document",
  driver_license: "card",
};

export function toneOf(state: ReadinessItem["state"]): RequirementTone {
  switch (state) {
    case "approved":
      return "success";
    case "in_review":
      return "neutral";
    case "missing":
      return "warning";
    case "rejected":
    case "expired":
      return "danger";
  }
}

export function iconFor(tone: RequirementTone): IconName {
  switch (tone) {
    case "success":
      return "checkCircle";
    case "neutral":
      return "clock";
    case "warning":
      return "exclaim";
    case "danger":
      return "alertCircle";
  }
}

function actionFor(key: ReadinessKey, state: ReadinessItem["state"]): string | null {
  switch (state) {
    case "approved":
    case "in_review":
      return null;
    case "missing":
      return key === "vehicle" ? copy.actions.add : copy.actions.upload;
    case "rejected":
      return copy.actions.fix;
    case "expired":
      return copy.actions.renew;
  }
}

function targetFor(key: ReadinessKey, state: ReadinessItem["state"], vehicleId: string | null): RequirementTarget {
  switch (key) {
    case "public_photo":
      return { route: "ProfilePhoto" };
    case "identity":
      return state === "in_review" || state === "approved" ? { route: "PrivateCheckStatus" } : { route: "PrivateCheckCapture" };
    case "vehicle":
      return vehicleId === null ? { route: "VehicleForm" } : { route: "VehicleForm", vehicleId };
    case "vehicle_documents":
    case "vehicle_photo":
    case "insurance":
    case "driver_license":
      // Sin vehículo aún no hay dónde subir nada: primero se da de alta.
      return vehicleId === null ? { route: "VehicleForm" } : { route: "VehicleDocuments", vehicleId };
  }
}

/** Texto bajo el título. Si el servidor trae uno propio («Documento subido») se respeta. */
function detailFor(item: ReadinessItem): string {
  if (item.detail !== null && item.detail.trim() !== "") return item.detail;
  return copy.states[item.state];
}

/** «Caduca el …» solo cuando falta poco o ya caducó: el resto del tiempo basta con el visto. */
export function expiryNote(item: ReadinessItem, todayIso: string, formatDate: (iso: string) => string): string | null {
  if (item.expiresOn === null) return null;
  if (item.state === "expired" || item.expiresOn < todayIso) return copy.expiredOn(formatDate(item.expiresOn));
  const days = daysBetween(todayIso, item.expiresOn);
  return days <= 30 ? copy.expiresSoon(formatDate(item.expiresOn)) : null;
}

/** Días enteros entre dos fechas ISO `YYYY-MM-DD` (mismo día = 0). */
export function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.UTC(Number(fromIso.slice(0, 4)), Number(fromIso.slice(5, 7)) - 1, Number(fromIso.slice(8, 10)));
  const to = Date.UTC(Number(toIso.slice(0, 4)), Number(toIso.slice(5, 7)) - 1, Number(toIso.slice(8, 10)));
  return Math.round((to - from) / 86_400_000);
}

/**
 * Todas las filas del servidor, en el orden de la pantalla. `rows` incluye también las aprobadas que no son de la
 * lámina; la pantalla usa {@link visibleRows} para decidir cuáles dibuja.
 */
export function buildRows(readiness: DriverReadiness): RequirementRow[] {
  const vehicleId = readiness.vehicle?.id ?? null;
  const byKey = new Map<ReadinessKey, ReadinessItem>(readiness.items.map((item) => [item.key, item]));
  const rows: RequirementRow[] = [];
  for (const key of ORDER) {
    const item = byKey.get(key);
    if (item === undefined) continue;
    const tone = toneOf(item.state);
    const detail = detailFor(item);
    const title = item.label.trim() !== "" ? item.label : copy.keys[key];
    rows.push({
      key,
      title,
      state: item.state,
      tone,
      icon: ICONS[key],
      detail,
      blocking: item.blocking,
      actionLabel: actionFor(key, item.state),
      target: targetFor(key, item.state, vehicleId),
      inLamina: LAMINA_KEYS.has(key),
      accessibilityLabel: `${title}. ${detail}`,
    });
  }
  return rows;
}

/** Filas que se dibujan: las de la lámina siempre y el resto solo mientras no estén aprobadas. */
export function visibleRows(rows: readonly RequirementRow[]): RequirementRow[] {
  return rows.filter((row) => row.inLamina || row.state !== "approved");
}

/** Requisitos que bloquean la publicación y siguen sin cumplirse. */
export function pendingBlockers(rows: readonly RequirementRow[]): RequirementRow[] {
  return rows.filter((row) => row.blocking && row.state !== "approved");
}

/** ¿Hay algo que enseñar bajo el título «Para poder publicar»? (Con todo aprobado se ven solo las filas de la lámina.) */
export function hasPendingRows(rows: readonly RequirementRow[]): boolean {
  return rows.some((row) => row.state !== "approved");
}
