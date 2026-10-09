/** Todos los endpoints del backend 0.14 (núcleo) que la vista previa sirve por sí misma. */
import type { PreviewDb } from "../core/db";
import type { PreviewRouter } from "../core/router";
import { expireStaleHolds } from "../domain/requests";
import { registerAdminReview } from "./admin";
import { registerAuth } from "./auth";
import { registerChat } from "./chat";
import { registerHealth } from "./health";
import { registerLive } from "./live";
import { registerMaps } from "./maps";
import { registerMe } from "./me";
import { registerTrips } from "./trips";

export function registerCoreHandlers(r: PreviewRouter, db: PreviewDb): void {
  // Regla dependiente del tiempo: un hold cuya hora pasó libera la plaza y caduca la solicitud (§7.3 del contrato `trips`).
  db.jobs.register("core.expire-stale-holds", (target) => {
    expireStaleHolds(target);
  });
  registerHealth(r, db);
  registerAuth(r, db);
  registerMe(r, db);
  registerTrips(r, db);
  registerLive(r, db);
  registerChat(r, db);
  registerMaps(r, db);
  registerAdminReview(r, db);
}
