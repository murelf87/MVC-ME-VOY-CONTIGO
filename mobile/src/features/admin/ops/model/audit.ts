/**
 * Visor de auditoría (pestaña «Auditoría», docs/contracts/trust.md §4.3 `GET /v1/admin/audit-events`): filtros,
 * validación en español, conversión de fechas de Madrid a instantes y resumen legible de los metadatos.
 * El servidor ya devuelve los metadatos con los datos personales ocultos («[oculto]»): aquí solo se presentan.
 * Funciones puras: se prueban en Node.
 */
import { madridOffsetMinutes } from "@/i18n";
import type { AdminAuditEvent } from "@/api/types";

export type AuditPresetKey = "all" | "admin" | "tariffs" | "support" | "legal" | "payouts";

export interface AuditPreset {
  key: AuditPresetKey;
  /** Acción del servidor: exacta, o prefijo si acaba en `*`. `null` = sin filtrar por acción. */
  action: string | null;
}

export const AUDIT_PRESETS: readonly AuditPreset[] = [
  { key: "all", action: null },
  { key: "admin", action: "admin.*" },
  { key: "tariffs", action: "admin.tariff*" },
  { key: "support", action: "admin.support.*" },
  { key: "legal", action: "admin.legal.*" },
  { key: "payouts", action: "payout.*" },
];

export interface AuditFilter {
  preset: AuditPresetKey;
  /** Acción escrita a mano (sustituye al preajuste cuando no está vacía). */
  action: string;
  actorUserId: string;
  entityType: string;
  entityId: string;
  /** `dd/mm/aaaa` (día natural de Madrid). */
  from: string;
  to: string;
}

export const EMPTY_AUDIT_FILTER: AuditFilter = {
  preset: "all",
  action: "",
  actorUserId: "",
  entityType: "",
  entityId: "",
  from: "",
  to: "",
};

/** Parámetros de `GET /v1/admin/audit-events` (los vacíos no se envían). */
export interface AuditQuery {
  actorUserId: string | null;
  action: string | null;
  entityType: string | null;
  entityId: string | null;
  from: string | null;
  to: string | null;
}

export type AuditFilterField = "action" | "actorUserId" | "entityType" | "entityId" | "from" | "to";
export type AuditFilterErrors = Partial<Record<AuditFilterField, string>>;
export type AuditFilterValidation = { ok: true; query: AuditQuery } | { ok: false; errors: AuditFilterErrors };

export interface CivilDate {
  year: number;
  month: number;
  day: number;
}

/** `05/10/2026` · `5-10-2026` · `2026-10-05` → fecha civil válida; `null` si no existe en el calendario. */
export function parseSpanishDate(text: string): CivilDate | null {
  const trimmed = text.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(trimmed);
  const es = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(trimmed);
  if (iso !== null) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else if (es !== null) {
    day = Number(es[1]);
    month = Number(es[2]);
    year = Number(es[3]);
  } else {
    return null;
  }
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  if (year < 2020 || year > 2100) return null;
  return { year, month, day };
}

/** Instante UTC (ms) de una fecha y hora de reloj de Madrid, respetando el cambio de hora. */
export function madridCivilToUtcMs(date: CivilDate, hour: number, minute: number, second: number, ms: number): number {
  const naive = Date.UTC(date.year, date.month - 1, date.day, hour, minute, second, ms);
  const first = naive - madridOffsetMinutes(naive) * 60_000;
  return naive - madridOffsetMinutes(first) * 60_000;
}

export function dayStartIso(date: CivilDate): string {
  return new Date(madridCivilToUtcMs(date, 0, 0, 0, 0)).toISOString();
}

export function dayEndIso(date: CivilDate): string {
  return new Date(madridCivilToUtcMs(date, 23, 59, 59, 999)).toISOString();
}

const ACTION_PATTERN = /^[A-Za-z0-9_.]{1,100}\*?$/;
const ENTITY_TYPE_PATTERN = /^[A-Za-z0-9_]{1,60}$/;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateAuditFilter(filter: AuditFilter): AuditFilterValidation {
  const errors: AuditFilterErrors = {};
  const preset = AUDIT_PRESETS.find((p) => p.key === filter.preset);

  const typedAction = filter.action.trim();
  let action: string | null = preset?.action ?? null;
  if (typedAction !== "") {
    if (!ACTION_PATTERN.test(typedAction)) {
      errors.action = "Escribe una acción como admin.tariff_draft.saved, o admin.* para buscar por prefijo.";
    } else {
      action = typedAction;
    }
  }

  const actor = filter.actorUserId.trim();
  if (actor !== "" && !UUID_PATTERN.test(actor)) errors.actorUserId = "El identificador de la persona debe ser un UUID.";

  const entityType = filter.entityType.trim();
  if (entityType !== "" && !ENTITY_TYPE_PATTERN.test(entityType)) errors.entityType = "Usa solo letras, números y guiones bajos (por ejemplo tariff_version).";

  const entityId = filter.entityId.trim();
  if (entityId !== "" && !ENTITY_ID_PATTERN.test(entityId)) errors.entityId = "Usa solo letras, números y guiones.";

  let from: string | null = null;
  let to: string | null = null;
  const fromText = filter.from.trim();
  const toText = filter.to.trim();
  const fromDate = fromText === "" ? null : parseSpanishDate(fromText);
  const toDate = toText === "" ? null : parseSpanishDate(toText);
  if (fromText !== "" && fromDate === null) errors.from = "Escribe una fecha válida, por ejemplo 05/10/2026.";
  if (toText !== "" && toDate === null) errors.to = "Escribe una fecha válida, por ejemplo 05/10/2026.";
  if (fromDate !== null) from = dayStartIso(fromDate);
  if (toDate !== null) to = dayEndIso(toDate);
  if (from !== null && to !== null && from > to) errors.to = "La fecha «hasta» no puede ser anterior a «desde».";

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    query: {
      actorUserId: actor === "" ? null : actor.toLowerCase(),
      action,
      entityType: entityType === "" ? null : entityType,
      entityId: entityId === "" ? null : entityId,
      from,
      to,
    },
  };
}

/** Filtros avanzados aplicados (sin contar el preajuste), para el contador de la hoja de filtros. */
export function advancedFilterCount(filter: AuditFilter): number {
  return [filter.action, filter.actorUserId, filter.entityType, filter.entityId, filter.from, filter.to].filter((v) => v.trim() !== "").length;
}

export function hasAnyFilter(filter: AuditFilter): boolean {
  return filter.preset !== "all" || advancedFilterCount(filter) > 0;
}

// ── Presentación de un evento ─────────────────────────────────────────────────────────────────────────────────────

/** Etiquetas en español de las acciones conocidas; una acción desconocida se muestra con su código. */
const ACTION_LABELS: Readonly<Record<string, string>> = {
  "admin.me.viewed": "Consulta de permisos",
  "admin.access_denied": "Acceso denegado",
  "admin.summary.viewed": "Resumen consultado",
  "admin.bookings.listed": "Reservas consultadas",
  "admin.tariffs.viewed": "Tarifas consultadas",
  "admin.tariff_draft.saved": "Borrador de tarifa guardado",
  "admin.tariff_example.calculated": "Ejemplo de aportación calculado",
  "admin.tariff_versions.listed": "Historial de tarifas consultado",
  "admin.tariff.publish_attempted": "Intento de activar una tarifa",
  "admin.tariff.published": "Tarifa activada",
  "admin.operations.viewed": "Operación consultada",
  "admin.operations.updated": "Operación modificada",
  "admin.alerts.listed": "Alertas consultadas",
  "admin.alerts.evaluated": "Reglas de alerta evaluadas",
  "admin.alert.status_changed": "Estado de una alerta cambiado",
  "admin.audit_log.viewed": "Auditoría consultada",
  "admin.legal.listed": "Documentos legales consultados",
  "admin.legal.created": "Versión legal creada",
  "admin.legal.published": "Versión legal publicada",
  "admin.support.tickets_listed": "Cola de atención consultada",
  "admin.support.ticket_viewed": "Consulta de atención abierta",
  "admin.support.ticket_replied": "Consulta de atención respondida",
  "admin.support.ticket_assigned": "Consulta de atención asignada",
  "admin.support.ticket_closed": "Consulta de atención cerrada",
  "admin.support.attachment_access_url_issued": "Acceso a un adjunto de atención",
  "admin.evidence.access_url_issued": "Acceso a una evidencia",
  "payout.run_created": "Liquidación generada",
  "payout.execute_requested": "Abono solicitado",
};

export function actionLabel(action: string): string | null {
  return ACTION_LABELS[action] ?? null;
}

export interface MetadataRow {
  key: string;
  value: string;
  hidden: boolean;
}

export const HIDDEN_VALUE = "[oculto]";

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Filas clave/valor de los metadatos, en el orden en que llegan. */
export function metadataRows(metadata: Record<string, unknown>): MetadataRow[] {
  return Object.keys(metadata).map((key) => {
    const value = stringifyValue(metadata[key]);
    return { key, value, hidden: value === HIDDEN_VALUE };
  });
}

/** Persona que actuó: nombre, o «Sistema» si no hay actor (tarea programada o línea de comandos). */
export function actorName(event: Pick<AdminAuditEvent, "actor">, system: string, unknown: string): string {
  if (event.actor === null) return system;
  return event.actor.displayName ?? unknown;
}
