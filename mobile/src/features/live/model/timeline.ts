/**
 * «Tu trayecto» (23): paradas del recorrido del pasajero con su hora y su estado.
 */
import type { LiveTimelineRole, LiveTimelineStop } from "@/api/types";
import { formatTime } from "@/i18n";
import { liveStrings } from "../strings";

const copy = liveStrings.inCar;

export interface TimelineRow {
  key: string;
  /** «C. Luis Montoto (recogida)». */
  title: string;
  /** «07:25»; vacío si el servidor no dio una hora válida. */
  time: string;
  state: LiveTimelineStop["state"];
  /** «En curso» solo en la parada en la que estamos. */
  caption: string | null;
}

function roleLabel(role: LiveTimelineRole): string {
  switch (role) {
    case "pickup":
      return copy.pickupRole;
    case "stop":
      return copy.stopRole;
    case "dropoff":
      return copy.dropoffRole;
  }
}

export function stopName(stop: Pick<LiveTimelineStop, "label" | "seq">): string {
  const label = stop.label === null ? "" : stop.label.trim();
  return label === "" ? liveStrings.common.unknownStop(stop.seq) : label;
}

export function timelineRows(stops: readonly LiveTimelineStop[]): TimelineRow[] {
  return [...stops]
    .sort((a, b) => a.seq - b.seq)
    .map((stop) => ({
      key: `${stop.seq}-${stop.role}`,
      title: `${stopName(stop)} (${roleLabel(stop.role)})`,
      time: formatTime(stop.eta),
      state: stop.state,
      caption: stop.state === "current" ? copy.inProgress : null,
    }));
}

/** El tramo que SALE de una parada se pinta en azul si esa parada ya se hizo o está en curso; si no, en gris. */
export function connectorIsActive(state: LiveTimelineStop["state"]): boolean {
  return state === "done" || state === "current";
}
