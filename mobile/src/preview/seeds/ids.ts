/**
 * Identificadores estables de los datos sembrados. Los de Ana, Miguel, Laura y los viajes de las láminas coinciden
 * con los ejemplos de `docs/contracts/trips.md`; el resto se derivan de un nombre (`stableUuid`), de modo que cualquier
 * escenario `design/scenarios/*.json` puede referirse a ellos sin depender del orden de creación.
 *
 * SIMULACIÓN: personas ficticias del diseño. Ningún dato de aquí es real.
 */
import { stableUuid } from "../core/ids";
import { SEVILLA_PROVINCE_ID } from "../data/provinces";

export type SeedUserKey =
  | "ana"
  | "miguel"
  | "laura"
  | "carlos"
  | "marta"
  | "miguelAngel"
  | "daniel"
  | "carmen"
  | "lucia"
  | "javier"
  | "elena"
  | "pablo"
  | "sofia"
  | "irene"
  | "alvaro"
  | "nuria"
  | "hugo"
  | "rafael"
  | "ines"
  | "staff";

export const SEED_USER_IDS: Readonly<Record<SeedUserKey, string>> = {
  ana: "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa01",
  miguel: "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa02",
  laura: "7a1c0d52-3b1e-4c8a-9d21-0a5e7f10aa03",
  carlos: stableUuid("user:carlos"),
  marta: stableUuid("user:marta"),
  miguelAngel: stableUuid("user:miguel-angel"),
  daniel: stableUuid("user:daniel"),
  carmen: stableUuid("user:carmen"),
  lucia: stableUuid("user:lucia"),
  javier: stableUuid("user:javier"),
  elena: stableUuid("user:elena"),
  pablo: stableUuid("user:pablo"),
  sofia: stableUuid("user:sofia"),
  irene: stableUuid("user:irene"),
  alvaro: stableUuid("user:alvaro"),
  nuria: stableUuid("user:nuria"),
  hugo: stableUuid("user:hugo"),
  rafael: stableUuid("user:rafael"),
  ines: stableUuid("user:ines"),
  staff: stableUuid("user:staff"),
};

export type SeedVehicleKey = "anaArona" | "anaLeon" | "miguelAngelLeon" | "carlosClio" | "martaYaris" | "danielFocus" | "carmen208" | "rafaelSandero" | "inesCorsa";

export const SEED_VEHICLE_IDS: Readonly<Record<SeedVehicleKey, string>> = {
  anaArona: stableUuid("vehicle:ana-arona"),
  anaLeon: stableUuid("vehicle:ana-leon"),
  miguelAngelLeon: stableUuid("vehicle:miguel-angel-leon"),
  carlosClio: stableUuid("vehicle:carlos-clio"),
  martaYaris: stableUuid("vehicle:marta-yaris"),
  danielFocus: stableUuid("vehicle:daniel-focus"),
  carmen208: stableUuid("vehicle:carmen-208"),
  rafaelSandero: stableUuid("vehicle:rafael-sandero"),
  inesCorsa: stableUuid("vehicle:ines-corsa"),
};

/** Viajes de las láminas 09, 11 y 12 (ids del contrato `trips`) y el resto de la oferta de la mañana. */
export const SEED_TRIP_IDS = {
  /** Ana · Montequinto → Dos Hermanas (opcional) → Universidad · 08:05 · Seat Arona gris. Láminas 11, 12. */
  anaMorning: "9f0e1d2c-4b3a-4a59-8877-665544330001",
  /** Miguel Á. · Mairena del Aljarafe → Universidad · 08:03. Lámina 11. */
  miguelAngelMorning: "9f0e1d2c-4b3a-4a59-8877-665544330002",
  /** Carlos · Mairena del Aljarafe → Sevilla (Trabajo) · 07:40. Lámina 09 (1 plaza). */
  carlosWork: "9f0e1d2c-4b3a-4a59-8877-665544330009",
  /** Marta · San Juan de Aznalfarache → Sevilla (Trabajo) · 08:30 · completo. Lámina 09. */
  martaWork: "9f0e1d2c-4b3a-4a59-8877-665544330010",
  /** Ana · vuelta · Universidad → Montequinto · 18:00. */
  anaReturn: "9f0e1d2c-4b3a-4a59-8877-665544330011",
  /** Daniel · Alcalá de Guadaíra → Parque Científico y Tecnológico Cartuja · 07:50. */
  danielAlcala: stableUuid("trip:daniel-alcala-cartuja"),
  miguelAngelReturn: stableUuid("trip:miguel-angel-return"),
  carlosReturn: stableUuid("trip:carlos-return"),
  /** Carmen · Camas → Hospital Virgen Macarena · 07:35. */
  carmenHospital: stableUuid("trip:carmen-hospital-macarena"),
  /** Carmen · Tomares → Estadio Benito Villamarín · 19:45. */
  carmenSport: stableUuid("trip:carmen-sport"),
  /** Mismas rutas de la mañana, un día después. */
  anaTomorrow: stableUuid("trip:ana-tomorrow"),
  martaTomorrow: stableUuid("trip:marta-tomorrow"),
  /** Borrador de Ana para mañana (aparece en «Mis viajes» como borrador). */
  anaDraft: stableUuid("trip:ana-draft"),
} as const;

export const SEED_IDS = {
  province: SEVILLA_PROVINCE_ID,
  users: SEED_USER_IDS,
  vehicles: SEED_VEHICLE_IDS,
  trips: SEED_TRIP_IDS,
} as const;
