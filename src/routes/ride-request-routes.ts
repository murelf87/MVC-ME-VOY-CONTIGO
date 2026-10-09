import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import {
  listOwnRideRequests,
  listTripRideRequests
} from "../services/request-service.js";

async function principal(pool: Pool, authorization: string | undefined) {
  return resolveSession(pool,readBearerToken(authorization));
}

export async function registerRideRequestRoutes(app: FastifyInstance,pool: Pool): Promise<void> {
  // `POST /v1/trips/:tripId/requests` y `POST /v1/ride-requests/:requestId/decision` pasaron al módulo `trips`
  // (src/modules/trips/routes.ts): misma ruta, cuerpo ampliado (punto de recogida, parada de bajada, mensaje),
  // Idempotency-Key, cuenta atrás de la retención y respuesta con el detalle completo de la solicitud.

  app.get("/v1/me/ride-requests",{
    schema:{security:[{bearerAuth:[]}]}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {requests:await listOwnRideRequests(pool,auth)};
  });

  app.get("/v1/trips/:tripId/requests",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",required:["tripId"],
        properties:{tripId:{type:"string",format:"uuid"}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string};
    return {requests:await listTripRideRequests(pool,auth,params.tripId)};
  });
}
