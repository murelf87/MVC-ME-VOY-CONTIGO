/**
 * Backend en memoria de la vista previa para el slice `live` (pasajero en directo): estado del coche y llegada estimada,
 * código de recogida (lo sirve el núcleo), cambio de ruta, valoraciones, incidencias con adjuntos privados, compartir
 * viaje con enlace revocable, vista pública del enlace y preferencia de privacidad. Contrato: `docs/contracts/live.md`.
 *
 * SIMULACIÓN: este fichero solo se carga con `EXPO_PUBLIC_PREVIEW=1` (lo importa `src/preview/register.ts`, que a su vez
 * solo se importa desde el `require` protegido de `App.tsx`); no llega a las compilaciones de producción.
 *
 * El núcleo ya sirve `GET|POST /v1/trips/:id/location`, `start`, `complete`, `pickup-code` y `pickup-verify`; este
 * slice no los repite. La parte del conductor (proponer y retirar un cambio de ruta, consola) es del paquete `driver-ops`.
 */
import { pendingRouteChangeForPassenger, type PreviewDb, type PreviewProfileId, type PreviewRouter } from "@/preview";
import { registerBookingViews } from "./bookingViews";
import { registerIncidents } from "./incidents";
import { registerPrivacy } from "./privacy";
import { registerRatings } from "./ratings";
import { registerLiveSeedRefs } from "./refs";
import { LIVE_SEED_VARIANTS, buildLiveScene } from "./scenes";
import { registerShares } from "./shares";
import { setPendingRouteChangeResolver } from "./views";

export const seedVariants: Readonly<Record<string, string>> = LIVE_SEED_VARIANTS;

export function registerPreview(r: PreviewRouter, db: PreviewDb): void {
  registerBookingViews(r, db);
  registerRatings(r, db);
  registerIncidents(r, db);
  registerShares(r, db);
  registerPrivacy(r, db);
  registerLiveSeedRefs();
  // La propuesta de cambio de ruta la crea la persona que conduce (paquete `driver-ops`); aquí solo se consulta.
  setPendingRouteChangeResolver((database, ctx) => pendingRouteChangeForPassenger(database, ctx.trip.id, ctx.request.passenger_user_id));
}

export function seedSlice(db: PreviewDb, _profile: PreviewProfileId, seed: string): void {
  buildLiveScene(db, seed);
}
