import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { DomainError } from "../errors.js";

export async function registerProvinceRoutes(
  app: FastifyInstance,
  pool: Pool
): Promise<void> {
  app.get("/v1/provinces", async () => {
    const result = await pool.query(
      `select
         id,
         code,
         name,
         source_name as "sourceName",
         source_url as "sourceUrl",
         source_date as "sourceDate",
         source_license as "sourceLicense"
       from provinces
       order by name asc`
    );
    return { provinces: result.rows };
  });

  app.get("/v1/provinces/resolve", {
    schema: {
      querystring: {
        type: "object",
        additionalProperties: false,
        required: ["latitude", "longitude"],
        properties: {
          latitude: { type: "number", minimum: -90, maximum: 90 },
          longitude: { type: "number", minimum: -180, maximum: 180 }
        }
      }
    }
  }, async request => {
    const query = request.query as {
      latitude: number;
      longitude: number;
    };

    const result = await pool.query(
      `select
         id,
         code,
         name,
         source_name as "sourceName",
         source_url as "sourceUrl",
         source_date as "sourceDate",
         source_license as "sourceLicense"
       from provinces
       where ST_CoveredBy(
         ST_SetSRID(ST_Point($1,$2),4326),
         geom
       )
       order by name asc
       limit 1`,
      [query.longitude, query.latitude]
    );

    const province = result.rows[0];
    if (!province) {
      throw new DomainError(
        "PROVINCE_NOT_FOUND",
        "No province boundary contains the supplied point",
        404
      );
    }

    return { province };
  });
}
