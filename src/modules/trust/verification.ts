import type { AuthPrincipal } from "../../auth/session.js";
import { writeAudit } from "../../lib/audit.js";
import { trustError } from "./common.js";
import type { TrustContext } from "./context.js";
import { getIdentityState } from "./identity-docs.js";
import { getPrivateCheckState } from "./identity-check.js";
import { getPhotoState } from "./photo.js";

export type SelfRole = "passenger" | "driver";
const SELF_ROLES: readonly SelfRole[] = ["passenger", "driver"];

export function selfRolesOf(roles: readonly string[]): SelfRole[] {
  return SELF_ROLES.filter(role => roles.includes(role));
}

/** Agregado de la pantalla 05: roles, foto de perfil, comprobación privada e identidad. */
export async function getVerificationOverview(ctx: TrustContext, principal: AuthPrincipal) {
  const [photo, privateCheck, identity] = await Promise.all([
    getPhotoState(ctx, principal.userId),
    getPrivateCheckState(ctx, principal.userId),
    getIdentityState(ctx, principal.userId, principal.roles)
  ]);
  return { roles: selfRolesOf(principal.roles), photo, privateCheck, identity };
}

/** Chips «Conductor / Pasajero» de la pantalla 05. Nunca concede ni quita roles de personal. */
export async function updateOwnRoles(ctx: TrustContext, principal: AuthPrincipal, requested: readonly string[], requestId: string) {
  const unique = [...new Set(requested)];
  if (unique.length < 1 || unique.some(role => !(SELF_ROLES as readonly string[]).includes(role))) {
    throw trustError("ROLES_INVALID", "Elige al menos un rol: pasajero, conductor o ambos.", 422);
  }
  const wanted = unique as SelfRole[];
  const client = await ctx.pool.connect();
  try {
    await client.query("begin");
    await client.query(`select id from app_users where id = $1 for update`, [principal.userId]);
    const current = await client.query<{ role: string }>(`select role::text as role from user_roles where user_id = $1`, [principal.userId]);
    const have = selfRolesOf(current.rows.map(r => r.role));
    const toAdd = wanted.filter(role => !have.includes(role));
    const toRemove = have.filter(role => !wanted.includes(role));

    if (toRemove.includes("driver")) {
      const inUse = await client.query(
        `select 1 from trips where driver_user_id = $1 and status in ('published','active') limit 1`,
        [principal.userId]
      );
      if (inUse.rowCount) {
        throw trustError("ROLE_IN_USE", "No puedes dejar de ser conductor mientras tengas viajes publicados o en curso.", 409, { role: "driver" });
      }
    }
    if (toRemove.includes("passenger")) {
      const inUse = await client.query(
        `select 1
           from ride_requests rr
           join trips t on t.id = rr.trip_id
           left join bookings b on b.request_id = rr.id
          where rr.passenger_user_id = $1
            and (rr.status in ('pending','accepted','payment_pending')
                 or (b.status = 'confirmed' and t.status in ('published','active')))
          limit 1`,
        [principal.userId]
      );
      if (inUse.rowCount) {
        throw trustError("ROLE_IN_USE", "No puedes dejar de ser pasajero mientras tengas solicitudes o reservas abiertas.", 409, { role: "passenger" });
      }
    }
    for (const role of toAdd) {
      await client.query(`insert into user_roles(user_id, role) values($1, $2::user_role) on conflict do nothing`, [principal.userId, role]);
    }
    if (toRemove.length > 0) {
      await client.query(`delete from user_roles where user_id = $1 and role::text = any($2::text[])`, [principal.userId, toRemove]);
    }
    if (toAdd.length > 0 || toRemove.length > 0) {
      await writeAudit(client, {
        actorUserId: principal.userId,
        action: "user.roles.updated",
        entityType: "user",
        entityId: principal.userId,
        requestId,
        metadata: { added: toAdd, removed: toRemove }
      });
    }
    await client.query("commit");
    return { roles: SELF_ROLES.filter(role => wanted.includes(role)) };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
