import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import {
  completeOwnedTrip,
  generateOwnPickupCode,
  startOwnedTrip,
  verifyPickupCode
} from "../services/trip-execution-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}

export async function registerTripExecutionRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.post("/v1/me/trips/:tripId/start",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{type:"object",required:["tripId"],properties:{tripId:{type:"string",format:"uuid"}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string};
    return startOwnedTrip(pool,auth,params.tripId);
  });

  app.post("/v1/me/trips/:tripId/complete",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{type:"object",required:["tripId"],properties:{tripId:{type:"string",format:"uuid"}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string};
    return completeOwnedTrip(pool,auth,params.tripId);
  });

  app.post("/v1/bookings/:bookingId/pickup-code",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{type:"object",required:["bookingId"],properties:{bookingId:{type:"string",format:"uuid"}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {bookingId:string};
    return generateOwnPickupCode(pool,auth,params.bookingId);
  });

  app.post("/v1/bookings/:bookingId/pickup-verify",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{type:"object",required:["bookingId"],properties:{bookingId:{type:"string",format:"uuid"}}},
      body:{
        type:"object",additionalProperties:false,required:["code"],
        properties:{code:{type:"string",pattern:"^[0-9]{6}$"}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {bookingId:string};
    const body=request.body as {code:string};
    return verifyPickupCode(pool,auth,params.bookingId,body.code);
  });
}
