/**
 * Llegada estimada («Llegada estimada · 07:25 · 8 min · 2,4 km»). La distancia es opcional: el servidor la omite
 * (`distanceM: null`) cuando revelaría la posición exacta de una persona que no comparte su ubicación; entonces la
 * pantalla pinta el ETA solo con los minutos, sin inventar nada.
 */
import type { LiveEta } from "@/api/types";
import { formatDistance, formatDuration, formatTime } from "@/i18n";
import { liveStrings } from "../strings";

const copy = liveStrings.eta;

export interface EtaView {
  /** «Llegada estimada» (con posición viva) o «Hora prevista» (solo planificación). */
  label: string;
  /** «07:25», hora de Madrid. */
  time: string;
  /** «8 min · 2,4 km» · «8 min» · «8 min · aprox.» · «Según la planificación del viaje». */
  line: string;
  approximate: boolean;
  source: LiveEta["source"];
}

export function etaView(eta: LiveEta | null | undefined): EtaView | null {
  if (eta === null || eta === undefined) return null;
  const time = formatTime(eta.at);
  if (time === "") return null;
  if (eta.source === "schedule") {
    return { label: copy.scheduled, time, line: copy.scheduledLine, approximate: true, source: eta.source };
  }
  const parts: string[] = [formatDuration(Math.max(0, eta.minutes))];
  if (eta.distanceM !== null && eta.distanceM !== undefined) {
    const distance = formatDistance(eta.distanceM);
    if (distance !== "") parts.push(distance);
  }
  if (eta.approximate) parts.push(copy.approxTag);
  return { label: copy.estimated, time, line: parts.join(" · "), approximate: eta.approximate, source: eta.source };
}

/** «Faltan 15 min · 6,8 km» (o solo «Faltan 15 min» si no hay distancia). `null` si no hay datos. */
export function remainingLine(remaining: { minutes: number; distanceM: number | null } | null | undefined): string | null {
  if (remaining === null || remaining === undefined) return null;
  const distance = remaining.distanceM === null ? null : formatDistance(remaining.distanceM);
  return copy.remaining(formatDuration(Math.max(0, remaining.minutes)), distance === "" ? null : distance);
}
