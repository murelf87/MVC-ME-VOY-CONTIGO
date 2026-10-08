import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import { activeTariff,adminApproveTariff,adminCreateTariff,adminListTariffs,quoteRange } from "../services/tariff-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const sec=[{bearerAuth:[]}];

export async function registerTariffRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.get("/v1/tariff",async()=>{
    const t=await activeTariff(pool);
    return {tariff:t?{version:t.version,rateMicrosPerKm:t.rate_micros_per_km,passengerCommissionBps:t.passenger_commission_bps,
      driverCommissionBps:t.driver_commission_bps,sharedCostCapCents:t.shared_cost_cap_cents}:null};
  });

  app.get("/v1/trips/:tripId/quote",{
    schema:{
      params:{type:"object",required:["tripId"],properties:{tripId:{type:"string",format:"uuid"}}},
      querystring:{
        type:"object",additionalProperties:false,required:["fromSegmentSeq","toSegmentSeq"],
        properties:{fromSegmentSeq:{type:"integer",minimum:0},toSegmentSeq:{type:"integer",minimum:1}}
      }
    }
  },async request=>{
    const {tripId}=request.params as {tripId:string};
    const q=request.query as {fromSegmentSeq:number;toSegmentSeq:number};
    return quoteRange(pool,tripId,q.fromSegmentSeq,q.toSegmentSeq);
  });

  app.get("/v1/admin/tariffs",{schema:{security:sec}},async request=>
    ({tariffs:await adminListTariffs(pool,await principal(pool,request.headers.authorization))}));

  app.post("/v1/admin/tariffs",{
    schema:{
      security:sec,
      body:{
        type:"object",additionalProperties:false,required:["rateMicrosPerKm","passengerCommissionBps","driverCommissionBps"],
        properties:{
          rateMicrosPerKm:{type:"integer",minimum:0,maximum:10000000},
          passengerCommissionBps:{type:"integer",minimum:0,maximum:10000},
          driverCommissionBps:{type:"integer",minimum:0,maximum:10000},
          sharedCostCapCents:{type:["integer","null"],minimum:0},
          notes:{type:["string","null"],maxLength:2000}
        }
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    return reply.code(201).send(await adminCreateTariff(pool,auth,request.body as any));
  });

  app.post("/v1/admin/tariffs/:tariffId/approve",{
    schema:{security:sec,params:{type:"object",required:["tariffId"],properties:{tariffId:{type:"string",format:"uuid"}}}}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {tariffId}=request.params as {tariffId:string};
    return adminApproveTariff(pool,auth,tariffId);
  });
}
