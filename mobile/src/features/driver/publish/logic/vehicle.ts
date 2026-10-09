/**
 * Lógica pura del vehículo del conductor (sin React ni red): catálogo de marcas y modelos para los selectores de la 17,
 * normalización y validación de la matrícula, formulario ↔ cuerpo de la API y elección del vehículo que se enseña.
 *
 * Las reglas de validación REPITEN las del servidor (`src/vehicles/vehicle-service.ts`: marca y modelo 1–80 caracteres,
 * matrícula normalizada de 2 a 16, plazas 1–8, color ≤ 40) para avisar antes de enviar; el servidor decide siempre.
 */
import type { ReviewState, VehicleBody, VehicleFormErrors, VehicleFormValues, VehicleRecord } from "../types";
import { publishStrings } from "../strings";

export const MIN_SEATS = 1;
export const MAX_SEATS = 8;
export const DEFAULT_SEATS = 3;
export const MAX_TEXT = 80;
export const MAX_COLOR = 40;

/** Marcas y modelos habituales en España (orden alfabético de marca; el primero de cada lista es el más frecuente). */
export const VEHICLE_CATALOGUE: ReadonlyArray<{ make: string; models: readonly string[] }> = [
  { make: "Audi", models: ["A1", "A3", "A4", "Q2", "Q3", "Q5"] },
  { make: "BMW", models: ["Serie 1", "Serie 3", "X1", "X3", "Serie 2"] },
  { make: "Citroën", models: ["C3", "C4", "Berlingo", "C3 Aircross", "C5 Aircross", "C1", "C-Elysée"] },
  { make: "Cupra", models: ["Formentor", "Born", "León", "Ateca"] },
  { make: "Dacia", models: ["Sandero", "Duster", "Logan", "Jogger", "Spring"] },
  { make: "Fiat", models: ["500", "Panda", "Tipo", "500X", "Punto"] },
  { make: "Ford", models: ["Fiesta", "Focus", "Kuga", "Puma", "Mondeo", "C-Max", "Ka"] },
  { make: "Honda", models: ["Civic", "Jazz", "CR-V", "HR-V"] },
  { make: "Hyundai", models: ["i10", "i20", "i30", "Tucson", "Kona", "Ioniq"] },
  { make: "Jeep", models: ["Renegade", "Compass", "Avenger"] },
  { make: "Kia", models: ["Picanto", "Rio", "Ceed", "Sportage", "Niro", "Stonic"] },
  { make: "Mazda", models: ["2", "3", "CX-3", "CX-5", "CX-30"] },
  { make: "Mercedes-Benz", models: ["Clase A", "Clase C", "CLA", "GLA", "Clase B"] },
  { make: "MINI", models: ["Cooper", "Countryman", "Clubman"] },
  { make: "Nissan", models: ["Micra", "Qashqai", "Juke", "Leaf", "X-Trail"] },
  { make: "Opel", models: ["Corsa", "Astra", "Mokka", "Crossland", "Grandland", "Insignia"] },
  { make: "Peugeot", models: ["208", "308", "2008", "3008", "5008", "207", "307", "508", "Rifter"] },
  { make: "Renault", models: ["Clio", "Captur", "Mégane", "Kadjar", "Austral", "Twingo", "Scénic", "Arkana", "Zoe"] },
  { make: "SEAT", models: ["Ibiza", "León", "Arona", "Ateca", "Tarraco", "Altea", "Toledo", "Mii"] },
  { make: "Škoda", models: ["Fabia", "Octavia", "Karoq", "Kamiq", "Superb", "Scala"] },
  { make: "Suzuki", models: ["Swift", "Vitara", "Ignis", "S-Cross"] },
  { make: "Tesla", models: ["Model 3", "Model Y", "Model S"] },
  { make: "Toyota", models: ["Yaris", "Corolla", "C-HR", "RAV4", "Aygo", "Auris", "Prius"] },
  { make: "Volkswagen", models: ["Polo", "Golf", "T-Roc", "Tiguan", "Passat", "Touran", "T-Cross", "Up!", "ID.3"] },
  { make: "Volvo", models: ["XC40", "XC60", "V40", "XC90"] },
];

export const MAKE_NAMES: readonly string[] = VEHICLE_CATALOGUE.map((entry) => entry.make);

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Entrada del catálogo que corresponde a una marca escrita de cualquier forma («Seat», «seat», «SEAT »). */
export function catalogueEntry(make: string): { make: string; models: readonly string[] } | undefined {
  const key = fold(make);
  return VEHICLE_CATALOGUE.find((entry) => fold(entry.make) === key);
}

/** Modelos sugeridos para una marca (vacío si es una marca fuera del catálogo). */
export function modelsFor(make: string): readonly string[] {
  return catalogueEntry(make)?.models ?? [];
}

/** Filtra una lista por lo escrito (sin tildes ni mayúsculas). */
export function filterOptions(options: readonly string[], query: string): string[] {
  const key = fold(query);
  if (key === "") return [...options];
  return options.filter((option) => fold(option).includes(key));
}

/** `true` si `text` es exactamente (salvo tildes y mayúsculas) una de las opciones. */
export function isListed(options: readonly string[], text: string): boolean {
  const key = fold(text);
  return key !== "" && options.some((option) => fold(option) === key);
}

/** Quita espacios sobrantes y compacta los intermedios. */
export function cleanText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

// ── Matrícula ───────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Solo letras y dígitos, en mayúsculas (la forma que compara el servidor para detectar duplicados). */
export function plateKey(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * Formatea lo que se escribe: mayúsculas, sin símbolos raros y, para la matrícula actual (4 cifras + 3 letras), con el
 * espacio de siempre («1234MBC» → «1234 MBC»). Las antiguas («SE-1234-AB») y las extranjeras se dejan como se escriben.
 */
export function formatPlateInput(text: string): string {
  const upper = text.toUpperCase().replace(/[^A-Z0-9 -]/g, "").replace(/ {2,}/g, " ");
  const modern = /^(\d{4})\s?([A-Z]{1,3})$/.exec(upper.trim());
  if (modern !== null) return `${modern[1]} ${modern[2]}`;
  return upper.slice(0, 14);
}

export type PlateCheck = "ok" | "empty" | "format";

/** Validación local: de 4 a 10 caracteres alfanuméricos con al menos una letra y una cifra. */
export function checkPlate(text: string): PlateCheck {
  const key = plateKey(text);
  if (key === "") return "empty";
  if (key.length < 4 || key.length > 10 || !/[A-Z]/.test(key) || !/[0-9]/.test(key)) return "format";
  return "ok";
}

// ── Formulario ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function clampSeats(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_SEATS;
  return Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(value)));
}

export function emptyValues(): VehicleFormValues {
  return { make: "", model: "", plate: "", seats: DEFAULT_SEATS, color: "" };
}

export function valuesFromVehicle(vehicle: VehicleRecord): VehicleFormValues {
  return {
    make: vehicle.make,
    model: vehicle.model,
    plate: vehicle.plate,
    seats: clampSeats(vehicle.passenger_seats),
    color: vehicle.color ?? "",
  };
}

/** Errores de cada campo (vacío = válido). `withColor` es `false` en la 17, que no pide el color. */
export function validateVehicle(values: VehicleFormValues, options: { withColor: boolean }): VehicleFormErrors {
  const copy = publishStrings.vehicle;
  const errors: VehicleFormErrors = {};
  const make = cleanText(values.make);
  if (make.length < 1 || make.length > MAX_TEXT) errors.make = copy.makeError;
  const model = cleanText(values.model);
  if (model.length < 1 || model.length > MAX_TEXT) errors.model = copy.modelError;
  const plate = checkPlate(values.plate);
  if (plate === "empty") errors.plate = copy.plateErrorEmpty;
  else if (plate === "format") errors.plate = copy.plateErrorFormat;
  if (!Number.isInteger(values.seats) || values.seats < MIN_SEATS || values.seats > MAX_SEATS) errors.seats = copy.seatsError;
  if (options.withColor && cleanText(values.color).length > MAX_COLOR) errors.color = copy.colorError;
  return errors;
}

export function hasErrors(errors: VehicleFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Cuerpo de la API. En la actualización (`PUT`) el color se envía SOLO si el formulario lo pide, para no borrar el que ya
 * tenía el vehículo cuando se edita desde la 17 (que no lo muestra).
 */
export function toBody(values: VehicleFormValues, options: { withColor: boolean }): VehicleBody {
  const body: VehicleBody = {
    make: cleanText(values.make),
    model: cleanText(values.model),
    plate: cleanText(values.plate).toUpperCase(),
    passengerSeats: clampSeats(values.seats),
  };
  const color = cleanText(values.color);
  if (options.withColor && color !== "") body.color = color;
  return body;
}

/** ¿Ha cambiado algo respecto al vehículo guardado? (La matrícula se compara sin espacios ni guiones). */
export function isDirty(values: VehicleFormValues, vehicle: VehicleRecord | undefined, options: { withColor: boolean }): boolean {
  if (vehicle === undefined) {
    return cleanText(values.make) !== "" || cleanText(values.model) !== "" || plateKey(values.plate) !== "";
  }
  return (
    cleanText(values.make) !== cleanText(vehicle.make) ||
    cleanText(values.model) !== cleanText(vehicle.model) ||
    plateKey(values.plate) !== plateKey(vehicle.plate) ||
    clampSeats(values.seats) !== vehicle.passenger_seats ||
    (options.withColor && cleanText(values.color) !== cleanText(vehicle.color ?? ""))
  );
}

// ── Vehículos ──────────────────────────────────────────────────────────────────────────────────────────────────────────

export function vehicleName(vehicle: Pick<VehicleRecord, "make" | "model">): string {
  return cleanText(`${vehicle.make} ${vehicle.model}`);
}

/**
 * El vehículo que se enseña: el pedido (`preferredId`) si existe; si no, el primero de la lista (el servidor devuelve el
 * más reciente primero, que es también el que evalúa `GET /v1/me/driver/readiness`).
 */
export function pickVehicle(vehicles: readonly VehicleRecord[], preferredId?: string | null): VehicleRecord | undefined {
  if (preferredId !== undefined && preferredId !== null) {
    const chosen = vehicles.find((vehicle) => vehicle.id === preferredId);
    if (chosen !== undefined) return chosen;
  }
  return vehicles[0];
}

/** Vehículos que no son el que se enseña. */
export function otherVehicles(vehicles: readonly VehicleRecord[], current: VehicleRecord | undefined): VehicleRecord[] {
  return vehicles.filter((vehicle) => vehicle.id !== current?.id);
}

function asReview(value: string): ReviewState {
  return value === "approved" || value === "rejected" ? value : "pending";
}

/** Estado de la revisión de los DATOS del vehículo (marca, modelo, matrícula y plazas) y de su documentación. */
export function vehicleReview(vehicle: VehicleRecord): ReviewState {
  const data = asReview(vehicle.review_status);
  const docs = asReview(vehicle.documentation_status);
  if (data === "rejected" || docs === "rejected") return "rejected";
  if (data === "approved" && docs === "approved") return "approved";
  return "pending";
}

/** ¿Ya fue aprobado alguna vez? Sirve para avisar antes de guardar cambios («lo revisaremos de nuevo»). */
export function needsReviewWarning(vehicle: VehicleRecord | undefined): boolean {
  return vehicle !== undefined && vehicleReview(vehicle) === "approved";
}
