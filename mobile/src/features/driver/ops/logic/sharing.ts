/**
 * Compartir la ubicación del conductor con sus pasajeros (lógica PURA). El permiso y el GPS los resuelve `@/platform`;
 * aquí se decide qué estado mostrar, qué botones ofrecer y cómo se convierte una posición en el cuerpo de
 * `POST /v1/trips/{id}/location`. Nunca se bloquea el viaje por falta de GPS: siempre queda «Seguir sin compartir».
 */
import type { LivePostLocationBody, LiveSignal } from "@/api/types";
import { opsStrings } from "../strings";
import type { DriverFix } from "../types";
import { bearingDegrees, haversineM } from "./geo";

const S = opsStrings.sharing;

export type SharingStatus =
  | "inactive" // el viaje no está en curso: no se comparte nada
  | "checking" // leyendo el permiso
  | "needs_permission" // nunca se ha preguntado
  | "denied" // rechazado, se puede volver a pedir
  | "blocked" // bloqueado: solo se arregla en Ajustes
  | "services_off" // GPS apagado
  | "searching" // permiso concedido, esperando la primera posición
  | "sharing" // enviando
  | "paused"; // la persona eligió seguir sin compartir

export interface PermissionLike {
  status: "granted" | "denied" | "blocked" | "unavailable";
  canAskAgain: boolean;
  undetermined: boolean;
}

export type FailureReason = "permission_denied" | "permission_blocked" | "services_disabled" | "timeout" | "unavailable";

export function statusForPermission(result: PermissionLike): SharingStatus {
  if (result.status === "granted") return "searching";
  if (result.status === "unavailable") return "services_off";
  if (result.undetermined) return "needs_permission";
  if (result.status === "blocked" || !result.canAskAgain) return "blocked";
  return "denied";
}

export function statusForFailure(reason: FailureReason): SharingStatus {
  switch (reason) {
    case "permission_denied":
      return "denied";
    case "permission_blocked":
      return "blocked";
    case "services_disabled":
      return "services_off";
    case "timeout":
    case "unavailable":
      return "searching";
  }
}

export type SharingAction = "allow" | "settings" | "continue_without" | "resume" | "retry";
export type SharingTone = "green" | "amber" | "red" | "blue" | "gray";
/** Nombres de `@/icons` que usa la tarjeta (la lógica no importa la capa de interfaz). */
export type SharingIcon = "locate" | "lock" | "gpsOff" | "pause" | "signal" | "offline";

export interface SharingCardModel {
  visible: boolean;
  /** Se está compartiendo y el servidor te ve en directo: no hace falta tarjeta, basta la franja de «última actualización». */
  ok: boolean;
  tone: SharingTone;
  icon: SharingIcon;
  title: string;
  detail: string | null;
  actions: SharingAction[];
}

export interface SharingContext {
  /** Señal que ve el servidor (la consola). */
  signal: LiveSignal;
  /** «hace 2 min», para la señal vieja. */
  ageText: string | null;
  /** Los últimos envíos han fallado (sin red, servidor caído…). */
  sendFailed: boolean;
}

export function sharingCard(status: SharingStatus, context: SharingContext): SharingCardModel {
  const card = (tone: SharingTone, icon: SharingIcon, title: string, detail: string | null, actions: SharingAction[]): SharingCardModel => ({
    visible: true,
    ok: false,
    tone,
    icon,
    title,
    detail,
    actions,
  });
  switch (status) {
    case "inactive":
      return { visible: false, ok: false, tone: "gray", icon: "locate", title: "", detail: null, actions: [] };
    case "checking":
      return card("blue", "locate", S.noneTitle, null, []);
    case "needs_permission":
      return card("blue", "locate", S.permission.undeterminedTitle, S.permission.undeterminedMessage, ["allow", "continue_without"]);
    case "denied":
      return card("amber", "locate", S.permission.deniedTitle, S.permission.deniedMessage, ["allow", "continue_without"]);
    case "blocked":
      return card("red", "lock", S.permission.blockedTitle, S.permission.blockedMessage, ["settings", "continue_without"]);
    case "services_off":
      return card("amber", "gpsOff", S.gpsOffTitle, S.gpsOffMessage, ["settings", "retry", "continue_without"]);
    case "paused":
      return card("gray", "pause", S.pausedTitle, S.pausedDetail, ["resume"]);
    case "searching":
      return card("blue", "locate", S.unavailableTitle, S.unavailableMessage, []);
    case "sharing": {
      if (context.sendFailed) return card("amber", "offline", S.sendFailedTitle, S.sendFailedDetail, []);
      if (context.signal === "stale") return card("amber", "signal", S.staleTitle, context.ageText ? S.staleDetail(context.ageText) : null, []);
      if (context.signal === "none") return card("blue", "locate", S.noneTitle, S.noneDetail, []);
      return { visible: false, ok: true, tone: "green", icon: "locate", title: S.liveTitle, detail: S.liveDetail, actions: [] };
    }
  }
}

// ── Posiciones ──────────────────────────────────────────────────────────────────────────────────────────────────────

const MAX_SPEED_MPS = 150;
const MIN_MOVE_FOR_HEADING_M = 5;

const round = (value: number, digits: number): number => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** Velocidad y rumbo: los del sistema si los hay; si no, se deducen de las dos últimas posiciones. */
export function deriveMotion(previous: DriverFix | null, next: DriverFix): { speedMps: number | null; headingDegrees: number | null } {
  if (!previous || next.recordedAtMs <= previous.recordedAtMs) {
    return { speedMps: next.speedMps, headingDegrees: next.headingDegrees };
  }
  const seconds = (next.recordedAtMs - previous.recordedAtMs) / 1000;
  const from = { lat: previous.latitude, lng: previous.longitude };
  const to = { lat: next.latitude, lng: next.longitude };
  const moved = haversineM(from, to);
  const speed = next.speedMps ?? Math.min(MAX_SPEED_MPS, moved / seconds);
  const heading = next.headingDegrees ?? (moved >= MIN_MOVE_FOR_HEADING_M ? bearingDegrees(from, to) : null);
  return { speedMps: round(speed, 1), headingDegrees: heading === null ? null : round(heading, 1) % 360 };
}

/** Cuerpo de `POST /v1/trips/{id}/location`. Recorta cada campo al rango que acepta el servidor. */
export function toLocationBody(fix: DriverFix, eventId: string): LivePostLocationBody {
  const body: LivePostLocationBody = {
    eventId,
    recordedAt: new Date(fix.recordedAtMs).toISOString(),
    latitude: Math.min(90, Math.max(-90, fix.latitude)),
    longitude: Math.min(180, Math.max(-180, fix.longitude)),
  };
  if (fix.accuracyM !== null && Number.isFinite(fix.accuracyM) && fix.accuracyM >= 0) {
    body.accuracyM = Math.min(10_000, round(fix.accuracyM, 1));
  }
  if (fix.speedMps !== null && Number.isFinite(fix.speedMps) && fix.speedMps >= 0) {
    body.speedMps = Math.min(MAX_SPEED_MPS, round(fix.speedMps, 1));
  }
  if (fix.headingDegrees !== null && Number.isFinite(fix.headingDegrees)) {
    body.headingDegrees = round(((fix.headingDegrees % 360) + 360) % 360, 1) % 360;
  }
  return body;
}

/** La marca de tiempo nunca retrocede (relojes que se corrigen, simulaciones con el reloj congelado). */
export function monotonicRecordedAt(recordedAtMs: number, lastRecordedAtMs: number | null): number {
  if (lastRecordedAtMs === null) return recordedAtMs;
  return recordedAtMs > lastRecordedAtMs ? recordedAtMs : lastRecordedAtMs + 1;
}

/** Cada cuánto se envía la posición: 5 s mientras el coche se mueve; hasta 15 s si está parado. */
export const SEND_INTERVAL_MS = 5_000;
export const SEND_INTERVAL_STOPPED_MS = 15_000;
/** Tras tantos envíos fallidos seguidos se avisa de que no se está compartiendo. */
export const SEND_FAILURES_BEFORE_WARNING = 2;
