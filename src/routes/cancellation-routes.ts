import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import {
  adminActivateCancellationPolicy,
  adminCreateCancellationPolicy,
  adminListCancellationPolicies,
  adminListPendingRefunds,
  cancelOwnRideRequest,
  cancelOwnTrip,
  getActiveCancellationPolicy
} from "../services/cancellation-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}

const uuidParam=(name:string)=>({type:"object",required:[name],properties:{[name]:{type:"string",format:"uuid"}}});

export async function registerCancellationRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.get("/v1/cancellation-policy",async()=>({policy:await getActiveCancellationPolicy(pool)}));

  app.post("/v1/ride-requests/:requestId/cancel",{
    schema:{
      security:[{bearerAuth:[]}],
      params:uuidParam("requestId"),
      body:{type:"object",additionalProperties:false,properties:{reason:{type:["string","null"],maxLength:500}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {requestId}=request.params as {requestId:string};
    const body=(request.body??{}) as {reason?:string|null};
    return cancelOwnRideRequest(pool,auth,{requestId,reason:body.reason??null});
  });

  app.post("/v1/me/trips/:tripId/cancel",{
    schema:{
      security:[{bearerAuth:[]}],
      params:uuidParam("tripId"),
      body:{
        type:"object",additionalProperties:false,required:["reason"],
        properties:{reason:{type:"string",minLength:3,maxLength:500},forceMajeure:{type:"boolean"}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {tripId}=request.params as {tripId:string};
    const body=request.body as {reason:string;forceMajeure?:boolean};
    return cancelOwnTrip(pool,auth,{tripId,...body});
  });

  app.get("/v1/admin/cancellation-policies",{schema:{security:[{bearerAuth:[]}]}},async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {policies:await adminListCancellationPolicies(pool,auth)};
  });

  app.post("/v1/admin/cancellation-policies",{
    schema:{
      security:[{bearerAuth:[]}],
      body:{
        type:"object",additionalProperties:false,required:["rules"],
        properties:{rules:{type:"object"},notes:{type:["string","null"],maxLength:2000}}
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const body=request.body as {rules:unknown;notes?:string|null};
    return reply.code(201).send(await adminCreateCancellationPolicy(pool,auth,body));
  });

  app.post("/v1/admin/cancellation-policies/:policyId/activate",{
    schema:{security:[{bearerAuth:[]}],params:uuidParam("policyId")}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {policyId}=request.params as {policyId:string};
    return adminActivateCancellationPolicy(pool,auth,policyId);
  });

  app.get("/v1/admin/refunds/pending",{schema:{security:[{bearerAuth:[]}]}},async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {refunds:await adminListPendingRefunds(pool,auth)};
  });
}
