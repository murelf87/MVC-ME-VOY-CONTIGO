/** Perfil propio: `GET /me` y `PATCH /v1/me/profile` (`src/routes/me-routes.ts`, `src/profiles/profile-service.ts`). */
import { rolesOf } from "../core/auth";
import type { PreviewDb } from "../core/db";
import { ApiFailure } from "../core/errors";
import type { Principal } from "../core/types";
import { iso } from "../core/wire";
import { writeAudit } from "./audit";
import { requireUser } from "./users";
import { meWire } from "./wire";

export function getMe(db: PreviewDb, principal: Principal) {
  const user = requireUser(db, principal.userId);
  return meWire(user, db.profiles.get(user.id), rolesOf(db, user.id));
}

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 80) {
    throw new ApiFailure("INVALID_DISPLAY_NAME", "Display name must contain 2 to 80 characters");
  }
  return normalized;
}

export function updateOwnProfile(db: PreviewDb, principal: Principal, input: { displayName: string }, requestId?: string) {
  const displayName = normalizeDisplayName(input.displayName);
  const current = db.profiles.get(principal.userId);
  if (!current) throw new ApiFailure("PROFILE_NOT_FOUND", "Profile not found", 404);
  const row = db.profiles.update(principal.userId, { display_name: displayName, updated_at: db.nowMs() });
  writeAudit(db, {
    actorUserId: principal.userId,
    action: "profile.updated",
    entityType: "profile",
    entityId: principal.userId,
    requestId: requestId ?? null,
    metadata: { fields: ["display_name"] },
  });
  return {
    user_id: row.user_id,
    display_name: row.display_name,
    public_photo_status: row.public_photo_status,
    identity_status: row.identity_status,
    presence_status: row.presence_status,
    updated_at: iso(row.updated_at),
  };
}
