import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import type { RouteProvider } from "../maps/types.js";
import {
  createTripDraftWithServerRoute,
  listOwnDriverTrips,
  publishOwnedTrip
} from "../services/trip-draft-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}

const pointSchema={
  type:"object",additionalProperties:false,required:["latitude","longitude"],
  properties:{
    latitude:{type:"number",minimum:-90,maximum:90},
    longitude:{type:"number",minimum:-180,maximum:180}
  }
} as const;

export async function registerTripDraftRoutes(
  app:FastifyInstance,pool:Pool,routeProvider:RouteProvider|null
):Promise<void>{
  app.post("/v1/me/trips",{
    schema:{
      security:[{bearerAuth:[]}],
      body:{
        type:"object",additionalProperties:false,
        required:[
          "vehicleId","provinceId","category","leg","departureAt",
          "flexibilityMinutes","maxDetourM","offeredSeats","origin","destination"
        ],
        properties:{
          vehicleId:{type:"string",format:"uuid"},
          provinceId:{type:"string",format:"uuid"},
          category:{type:"string",enum:["work","university","fp_academies","hospital","sport","other"]},
          leg:{type:"string",enum:["outbound","return"]},
          departureAt:{type:"string",format:"date-time"},
          flexibilityMinutes:{type:"integer",minimum:0,maximum:60},
          maxDetourM:{type:"integer",minimum:0,maximum:100000},
          offeredSeats:{type:"integer",minimum:1,maximum:8},
          origin:pointSchema,
          destination:pointSchema,
          intermediates:{type:"array",maxItems:10,items:pointSchema}
        }
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const trip=await createTripDraftWithServerRoute(pool,auth,routeProvider,request.body as any);
    return reply.code(201).send(trip);
  });

  app.get("/v1/me/trips",{
    schema:{security:[{bearerAuth:[]}]}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {trips:await listOwnDriverTrips(pool,auth)};
  });

  app.post("/v1/me/trips/:tripId/publish",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",required:["tripId"],
        properties:{tripId:{type:"string",format:"uuid"}}
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string};
    await publishOwnedTrip(pool,auth,params.tripId);
    return reply.code(204).send();
  });
}
