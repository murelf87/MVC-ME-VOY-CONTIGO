/** Detalle del viaje (lámina 12): formato de paradas, totales y estado del botón «Solicitar plaza» (lógica pura). */
import type { TripDetail, TripDetailStop } from "@/api/types";
import { formatMoney, formatTime } from "@/i18n";
import { browseStrings } from "../strings";

const copy = browseStrings.tripDetail;

export interface StopView {
  seq: number;
  label: string;
  time: string;
  optional: boolean;
  note: string | null;
  highlight: boolean;
  kind: "first" | "middle" | "last";
}

function noteFor(stop: TripDetailStop, last: boolean): string | null {
  if (stop.isYourPickup) return copy.youBoard;
  if (last) return copy.arrival;
  if (stop.isYourDropoff) return copy.youAlight;
  if (stop.optional && stop.detourMinutes !== null) return copy.detour(stop.detourMinutes);
  return null;
}

export function stopViews(stops: readonly TripDetailStop[]): StopView[] {
  const ordered = [...stops].sort((a, b) => a.seq - b.seq);
  return ordered.map((stop, index) => ({
    seq: stop.seq,
    label: stop.label ?? "",
    time: formatTime(stop.etaLocal),
    optional: stop.optional,
    note: noteFor(stop, index === ordered.length - 1),
    highlight: stop.isYourPickup || stop.isYourDropoff,
    kind: index === 0 ? "first" : index === ordered.length - 1 ? "last" : "middle",
  }));
}

export interface TotalsView {
  distance: string;
  duration: string;
  detour: string;
}

export function totalsView(trip: TripDetail): TotalsView {
  return {
    distance: copy.km(trip.totals.roadDistanceM),
    duration: copy.minutes(trip.totals.durationMinutes),
    detour: copy.minutes(trip.totals.detourMinutes),
  };
}

export interface PriceView {
  defined: boolean;
  text: string;
}

/** «Propuesta: 3,50 €» solo con importe definido; si no, «Por definir» (nunca un importe inventado). */
export function priceView(trip: TripDetail): PriceView {
  if (trip.price.status === "defined" && trip.price.cents !== null) return { defined: true, text: copy.priceProposal(formatMoney(trip.price)) };
  if (trip.price.status === "illustrative" && trip.price.cents !== null) return { defined: true, text: copy.priceProposal(formatMoney(trip.price)) };
  return { defined: false, text: copy.pricePending };
}

export type RequestAction =
  | { kind: "request"; label: string }
  | { kind: "auth"; label: string }
  | { kind: "existing"; label: string; requestId: string }
  | { kind: "owner"; label: string }
  | { kind: "blocked"; label: string };

export function requestAction(trip: TripDetail): RequestAction {
  if (trip.owner !== null || trip.viewer.relation === "driver") return { kind: "owner", label: copy.ownerManage };
  if (trip.canRequest) return { kind: "request", label: copy.request };
  switch (trip.cannotRequestReason) {
    case "AUTH_REQUIRED":
      return { kind: "auth", label: copy.request };
    case "OPEN_REQUEST_EXISTS":
      return trip.viewer.openRequest !== null ? { kind: "existing", label: copy.openRequest, requestId: trip.viewer.openRequest.id } : { kind: "blocked", label: copy.requestExisting };
    case "NO_CAPACITY":
      return { kind: "blocked", label: copy.requestFull };
    case "DRIVER_CANNOT_REQUEST_OWN_TRIP":
      return { kind: "blocked", label: copy.requestOwn };
    default:
      return { kind: "blocked", label: copy.requestUnavailable };
  }
}

export function plateText(trip: TripDetail): string | null {
  if (trip.vehicle.plate !== null) return copy.plateFull(trip.vehicle.plate);
  if (trip.vehicle.plateHint !== null) return copy.plateHint(trip.vehicle.plateHint);
  return null;
}

export function vehicleText(trip: TripDetail): string {
  const color = trip.vehicle.color;
  return color !== null && color !== "" ? `${trip.vehicle.displayName} · ${color}` : trip.vehicle.displayName;
}
