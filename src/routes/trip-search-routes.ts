import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { searchPublishedTrips } from "../services/trip-search-service.js";

export async function registerTripSearchRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.get("/v1/trips/search",{
    schema:{
      querystring:{
        type:"object",additionalProperties:false,
        required:[
          "provinceId","originLatitude","originLongitude",
          "destinationLatitude","destinationLongitude"
        ],
        properties:{
          provinceId:{type:"string",format:"uuid"},
          originLatitude:{type:"number",minimum:-90,maximum:90},
          originLongitude:{type:"number",minimum:-180,maximum:180},
          destinationLatitude:{type:"number",minimum:-90,maximum:90},
          destinationLongitude:{type:"number",minimum:-180,maximum:180},
          radiusM:{type:"integer",minimum:100,maximum:50000},
          departureAfter:{type:"string",format:"date-time"},
          departureBefore:{type:"string",format:"date-time"},
          limit:{type:"integer",minimum:1,maximum:100}
        }
      }
    }
  },async request=>{
    const q=request.query as any;
    return {trips:await searchPublishedTrips(pool,q)};
  });
}
