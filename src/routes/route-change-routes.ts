import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import type { RouteProvider } from "../maps/types.js";
import {
  decideRouteChange,listOwnRouteChanges,listTripRouteChanges,requestRouteChange,respondRouteChange,searchDetourCandidates
} from "../services/route-change-service.js";
import { tripEtaForViewer } from "../services/trip-progress-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const sec=[{bearerAuth:[]}];
const uuidParam=(name:string)=>({type:"object",required:[name],properties:{[name]:{type:"string",format:"uuid"}}});
const latLng={
  type:"object",additionalProperties:false,required:["latitude","longitude"],
  properties:{latitude:{type:"number",minimum:-90,maximum:90},longitude:{type:"number",minimum:-180,maximum:180}}
};
const decision={type:"object",additionalProperties:false,required:["decision"],properties:{decision:{enum:["accept","reject"]}}};

export async function registerRouteChangeRoutes(app:FastifyInstance,pool:Pool,provider:RouteProvider|null):Promise<void>{
  app.get("/v1/trips/detour-search",{
    schema:{
      querystring:{
        type:"object",additionalProperties:false,
        required:["provinceId","originLatitude","originLongitude","destinationLatitude","destinationLongitude"],
        properties:{
          provinceId:{type:"string",format:"uuid"},
          originLatitude:{type:"number"},originLongitude:{type:"number"},
          destinationLatitude:{type:"number"},destinationLongitude:{type:"number"},
          limit:{type:"integer",minimum:1,maximum:50}
        }
      }
    }
  },async request=>{
    const q=request.query as any;
    return {trips:await searchDetourCandidates(pool,{
      provinceId:q.provinceId,
      origin:{latitude:q.originLatitude,longitude:q.originLongitude},
      destination:{latitude:q.destinationLatitude,longitude:q.destinationLongitude},
      ...(q.limit?{limit:q.limit}:{})
    })};
  });

  app.post("/v1/trips/:tripId/route-changes",{
    schema:{
      security:sec,params:uuidParam("tripId"),
      body:{
        type:"object",additionalProperties:false,required:["pickup","dropoff"],
        properties:{
          pickup:latLng,dropoff:latLng,
          pickupLabel:{type:["string","null"],maxLength:200},dropoffLabel:{type:["string","null"],maxLength:200}
        }
      }
    }
  },async(request,reply)=>{
    const {tripId}=request.params as {tripId:string};
    const b=request.body as any;
    const out=await requestRouteChange(pool,provider,await principal(pool,request.headers.authorization),{
      tripId,pickup:b.pickup,dropoff:b.dropoff,pickupLabel:b.pickupLabel??null,dropoffLabel:b.dropoffLabel??null
    });
    return reply.code(201).send(out);
  });

  app.get("/v1/me/trips/:tripId/route-changes",{schema:{security:sec,params:uuidParam("tripId")}},async request=>{
    const {tripId}=request.params as {tripId:string};
    return {routeChanges:await listTripRouteChanges(pool,await principal(pool,request.headers.authorization),tripId)};
  });

  app.get("/v1/me/route-changes",{schema:{security:sec}},async request=>
    listOwnRouteChanges(pool,await principal(pool,request.headers.authorization)));

  app.post("/v1/route-changes/:id/decision",{schema:{security:sec,params:uuidParam("id"),body:decision}},async request=>{
    const {id}=request.params as {id:string};
    return decideRouteChange(pool,await principal(pool,request.headers.authorization),id,(request.body as any).decision);
  });

  app.post("/v1/route-changes/:id/response",{schema:{security:sec,params:uuidParam("id"),body:decision}},async request=>{
    const {id}=request.params as {id:string};
    return respondRouteChange(pool,await principal(pool,request.headers.authorization),id,(request.body as any).decision);
  });

  app.get("/v1/trips/:tripId/eta",{schema:{security:sec,params:uuidParam("tripId")}},async request=>{
    const {tripId}=request.params as {tripId:string};
    return tripEtaForViewer(pool,await principal(pool,request.headers.authorization),tripId);
  });
}
