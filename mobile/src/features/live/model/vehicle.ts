/**
 * Datos del coche tal y como los muestran las pantallas en directo: «Seat León · Blanco», matrícula y, solo si coincide
 * con una ilustración empaquetada, su foto. El contrato NO trae foto del vehículo: nunca se enseña la imagen de otro
 * modelo ni de otro color (sería un dato falso); si no hay una que coincida se pinta un icono de coche.
 */
import type { LiveVehicle } from "@/api/types";

/** Ilustraciones empaquetadas en `@/assets` (las resuelve el componente: este módulo es puro). */
export type VehicleImageKey = "seatLeon";

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

/** Clave de la ilustración que representa EXACTAMENTE ese coche (marca, modelo y color), o `null`. */
export function vehicleImageKey(vehicle: Pick<LiveVehicle, "make" | "model" | "color">): VehicleImageKey | null {
  const make = fold(vehicle.make);
  const model = fold(vehicle.model);
  const color = vehicle.color === null ? null : fold(vehicle.color);
  if (make === "seat" && model === "leon" && color === "blanco") return "seatLeon";
  return null;
}

/** «Seat León · Blanco» (o «Seat León» si el conductor no indicó color). */
export function vehicleLine(vehicle: Pick<LiveVehicle, "make" | "model" | "color">): string {
  const name = `${vehicle.make} ${vehicle.model}`.replace(/\s+/g, " ").trim();
  const color = vehicle.color === null ? "" : vehicle.color.trim();
  return color === "" ? name : `${name} · ${color}`;
}

/** Matrícula normalizada para mostrarla: espacios simples y mayúsculas («1234 lbc» → «1234 LBC»). */
export function plateText(plate: string): string {
  return plate.replace(/\s+/g, " ").trim().toUpperCase();
}
