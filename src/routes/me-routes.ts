import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import { DomainError } from "../errors.js";

export async function registerMeRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  app.get("/me", {
    schema: { security: [{ bearerAuth: [] }] }
  }, async (request) => {
    const token = readBearerToken(request.headers.authorization);
    const principal = await resolveSession(pool, token);

    const result = await pool.query(
      `select
         u.id,u.phone_e164,u.status,
         p.display_name,p.public_photo_key,p.public_photo_status,p.identity_status,p.presence_status,
         coalesce(array_agg(ur.role::text) filter (where ur.role is not null),'{}'::text[]) as roles
       from app_users u
       left join profiles p on p.user_id=u.id
       left join user_roles ur on ur.user_id=u.id
      where u.id=$1
      group by u.id,p.user_id`,
      [principal.userId]
    );
    const row = result.rows[0];
    if (!row) throw new DomainError("USER_NOT_FOUND", "User not found", 404);
    return row;
  });
}
