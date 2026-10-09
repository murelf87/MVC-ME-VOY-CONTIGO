/** Identidades con las que los sembrados llaman a los servicios de dominio (como si lo hiciera esa persona). */
import { rolesOf } from "../core/auth";
import type { PreviewDb } from "../core/db";
import type { Principal } from "../core/types";
import { SEED_USER_IDS, type SeedUserKey } from "./ids";

export function actingAs(db: PreviewDb, key: SeedUserKey): Principal {
  const userId = SEED_USER_IDS[key];
  return {
    sessionId: `seed-${key}`,
    userId,
    roles: rolesOf(db, userId),
    expiresAt: new Date(db.nowMs() + 3_600_000).toISOString(),
  };
}
