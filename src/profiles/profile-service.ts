import type { Pool } from "pg";
import type { AuthPrincipal } from "../auth/session.js";
import { DomainError } from "../errors.js";

function normalizeDisplayName(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized.length < 2 || normalized.length > 80) {
    throw new DomainError("INVALID_DISPLAY_NAME", "Display name must contain 2 to 80 characters");
  }
  return normalized;
}

export async function updateOwnProfile(
  pool: Pool,
  principal: AuthPrincipal,
  input: { displayName: string }
) {
  const displayName = normalizeDisplayName(input.displayName);
  const result = await pool.query(
    `update profiles
        set display_name=$2,updated_at=now()
      where user_id=$1
      returning user_id,display_name,public_photo_status,identity_status,presence_status,updated_at`,
    [principal.userId, displayName]
  );
  const row = result.rows[0];
  if (!row) throw new DomainError("PROFILE_NOT_FOUND", "Profile not found", 404);

  await pool.query(
    `insert into audit_events(actor_user_id,action,entity_type,entity_id,metadata)
     values($1,'profile.updated','profile',$1,$2::jsonb)`,
    [principal.userId, JSON.stringify({ fields: ["display_name"] })]
  );

  return row;
}
