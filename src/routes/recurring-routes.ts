import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import {
  createTripSeries,
  decideWeeklyGroup,
  listOwnSeries,
  requestSeriesWeek,
  seriesWeek,
  setSeriesStatus
} from "../services/recurring-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const uuidParam=(name:string)=>({type:"object",required:[name],properties:{[name]:{type:"string",format:"uuid"}}});
const sec=[{bearerAuth:[]}];
const weekdays={type:"array",minItems:1,maxItems:7,uniqueItems:true,items:{type:"integer",minimum:1,maximum:7}};
const date={type:"string",pattern:"^\\d{4}-\\d{2}-\\d{2}$"};

export async function registerRecurringRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.post("/v1/me/trips/:tripId/repeat",{
    schema:{
      security:sec,params:uuidParam("tripId"),
      body:{
        type:"object",additionalProperties:false,required:["weekdays"],
        properties:{weekdays,endsOn:{type:["string","null"],pattern:"^\\d{4}-\\d{2}-\\d{2}$"},horizonWeeks:{type:"integer",minimum:1,maximum:8}}
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const {tripId}=request.params as {tripId:string};
    const body=request.body as {weekdays:number[];endsOn?:string|null;horizonWeeks?:number};
    return reply.code(201).send(await createTripSeries(pool,auth,{tripId,...body}));
  });

  app.get("/v1/me/series",{schema:{security:sec}},async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {series:await listOwnSeries(pool,auth)};
  });

  app.post("/v1/me/series/:seriesId/status",{
    schema:{
      security:sec,params:uuidParam("seriesId"),
      body:{type:"object",additionalProperties:false,required:["status"],properties:{status:{type:"string",enum:["active","paused","ended"]}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {seriesId}=request.params as {seriesId:string};
    const {status}=request.body as {status:"active"|"paused"|"ended"};
    return setSeriesStatus(pool,auth,{seriesId,status});
  });

  app.get("/v1/series/:seriesId/week",{
    schema:{
      security:sec,params:uuidParam("seriesId"),
      querystring:{type:"object",additionalProperties:false,required:["weekStart"],properties:{weekStart:date}}
    }
  },async request=>{
    await principal(pool,request.headers.authorization);
    const {seriesId}=request.params as {seriesId:string};
    const {weekStart}=request.query as {weekStart:string};
    return seriesWeek(pool,seriesId,weekStart);
  });

  app.post("/v1/series/:seriesId/weekly-requests",{
    schema:{
      security:sec,params:uuidParam("seriesId"),
      body:{
        type:"object",additionalProperties:false,required:["weekStart","fromSegmentSeq","toSegmentSeq"],
        properties:{weekStart:date,fromSegmentSeq:{type:"integer",minimum:0},toSegmentSeq:{type:"integer",minimum:1},weekdays}
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const {seriesId}=request.params as {seriesId:string};
    const body=request.body as {weekStart:string;fromSegmentSeq:number;toSegmentSeq:number;weekdays?:number[]};
    return reply.code(201).send(await requestSeriesWeek(pool,auth,{seriesId,...body}));
  });

  app.post("/v1/weekly-groups/:groupId/decision",{
    schema:{
      security:sec,params:uuidParam("groupId"),
      body:{type:"object",additionalProperties:false,required:["decision"],properties:{decision:{type:"string",enum:["accept","reject"]}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {groupId}=request.params as {groupId:string};
    const {decision}=request.body as {decision:"accept"|"reject"};
    return decideWeeklyGroup(pool,auth,{groupId,decision});
  });
}
