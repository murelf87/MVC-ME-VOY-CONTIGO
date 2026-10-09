/**
 * Mundo sembrado de la vista previa: Sevilla, personas del diseño, flota, oferta de la mañana del lunes 5 de octubre
 * de 2026 e historial. `seedBase` es el punto de entrada; los slices amplían el mundo con su `seedSlice(db, profile, seed)`
 * y las variantes (`scenarios.ts`) lo dejan en el estado que necesita cada pantalla.
 */
import { createSession, deterministicSessionToken } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { PREVIEW_PROFILES, type PreviewProfileId } from "../core/types";
import { sevillaProvince } from "../data/provinces";
import { seedCast } from "./cast";
import { seedFleet } from "./fleet";
import { seedHistory } from "./history";
import { SEED_USER_IDS } from "./ids";
import { baseOptionsFor, seedPendingForAna, type SeedBaseOptions } from "./scenarios";
import { seedTrips } from "./trips";

export { CAST, castMember, type CastMember } from "./cast";
export { anchorDate, anchorPlusDays, localAt, previousWorkdays } from "./anchor";
export { actingAs } from "./actors";
export { illustrativeFareCents } from "./fares";
export { FLEET } from "./fleet";
export { HISTORY_TRIPS_FOR_MIGUEL, historyTripIds } from "./history";
export { SEED_IDS, SEED_TRIP_IDS, SEED_USER_IDS, SEED_VEHICLE_IDS, type SeedUserKey, type SeedVehicleKey } from "./ids";
export {
  SeedRefError,
  registerSeedRef,
  resolveAllSeedRefs,
  resolveRefsIn,
  resolveSeedRef,
  seedRefNames,
  unregisterSeedRef,
  type SeedRefResolver,
} from "./refs";
export {
  MIGUEL_MESSAGE,
  SEED_VARIANTS,
  applySeedVariant,
  baseOptionsFor,
  isKnownSeedVariant,
  seedAccepted,
  seedMiguelChat,
  seedMiguelRequest,
  seedPaid,
  seedPendingForAna,
  seedVariantNames,
  type SeedBaseOptions,
  type SeedVariant,
} from "./scenarios";
export { TRIP_SPECS, planFor, seedConfirmedRider, seedTrip, tripSpec, type SeedRider, type SeedStop, type TripSpec } from "./trips";

/** Token de sesión (determinista) del perfil de prueba, o `null` para «Persona nueva». */
export function profileSessionToken(profile: PreviewProfileId): string | null {
  return PREVIEW_PROFILES[profile].userKey === null ? null : deterministicSessionToken(`profile:${profile}`);
}

/** `userId` con el que inicia sesión un perfil de prueba, o `null` para «Persona nueva». */
export function profileUserId(profile: PreviewProfileId): string | null {
  const key = PREVIEW_PROFILES[profile].userKey;
  return key === null ? null : SEED_USER_IDS[key];
}

/**
 * Siembra el mundo base en una base VACÍA (`db.resetEmpty()`): provincia, personas, flota, oferta, historial y la sesión
 * del perfil. NO aplica variantes ni slices (`seedWorld` en `register.ts`).
 */
export function seedBase(db: PreviewDb, profile: PreviewProfileId, options: SeedBaseOptions = baseOptionsFor("default")): void {
  db.profile = profile;
  db.provinces.insert(sevillaProvince());
  seedCast(db);
  seedFleet(db, { skipOwners: options.skipDrivers });
  if (options.trips) {
    seedTrips(db, { skipDrivers: options.skipDrivers });
    if (options.history && !options.skipDrivers.includes("ana")) seedHistory(db);
    if (options.pendingForAna && !options.skipDrivers.includes("ana")) seedPendingForAna(db);
  }
  const userId = profileUserId(profile);
  const token = profileSessionToken(profile);
  if (userId !== null && token !== null) createSession(db, userId, { token });
}
