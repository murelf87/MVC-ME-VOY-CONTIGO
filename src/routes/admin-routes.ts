import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import {
  ADMIN_ROLES,
  adminListAudit,
  adminListTrips,
  adminOverview,
  adminReviewProfile,
  adminSearchUsers,
  adminSetRole,
  adminSetUserStatus,
  adminVerificationQueue
} from "../services/admin-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const uuidParam=(name:string)=>({type:"object",required:[name],properties:{[name]:{type:"string",format:"uuid"}}});
const sec=[{bearerAuth:[]}];

/** Which external providers are wired in this deployment; "disabled" means the feature is blocked, never faked. */
export type IntegrationStatus=Record<"email"|"maps"|"storage"|"insuranceOcr"|"payments"|"push",string>;

export async function registerAdminRoutes(app:FastifyInstance,pool:Pool,integrations?:IntegrationStatus):Promise<void>{
  app.get("/v1/admin/overview",{schema:{security:sec}},async request=>
    ({...await adminOverview(pool,await principal(pool,request.headers.authorization)),integrations:integrations??null}));

  app.get("/v1/admin/verification-queue",{schema:{security:sec}},async request=>
    adminVerificationQueue(pool,await principal(pool,request.headers.authorization)));

  app.post("/v1/admin/users/:userId/profile-review",{
    schema:{
      security:sec,params:uuidParam("userId"),
      body:{
        type:"object",additionalProperties:false,required:["area","decision"],
        properties:{
          area:{type:"string",enum:["photo","identity"]},
          decision:{type:"string",enum:["approved","rejected"]},
          reason:{type:["string","null"],maxLength:1000}
        }
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {userId}=request.params as {userId:string};
    const body=request.body as {area:"photo"|"identity";decision:"approved"|"rejected";reason?:string|null};
    return adminReviewProfile(pool,auth,{userId,...body});
  });

  app.get("/v1/admin/users",{
    schema:{security:sec,querystring:{type:"object",additionalProperties:false,properties:{q:{type:"string",maxLength:80}}}}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {q}=request.query as {q?:string};
    return {users:await adminSearchUsers(pool,auth,q)};
  });

  app.post("/v1/admin/users/:userId/status",{
    schema:{
      security:sec,params:uuidParam("userId"),
      body:{
        type:"object",additionalProperties:false,required:["status","reason"],
        properties:{status:{type:"string",enum:["active","suspended"]},reason:{type:"string",minLength:3,maxLength:1000}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {userId}=request.params as {userId:string};
    const body=request.body as {status:"active"|"suspended";reason:string};
    return adminSetUserStatus(pool,auth,{userId,...body});
  });

  app.post("/v1/admin/users/:userId/roles",{
    schema:{
      security:sec,params:uuidParam("userId"),
      body:{
        type:"object",additionalProperties:false,required:["role","grant"],
        properties:{role:{type:"string",enum:[...ADMIN_ROLES]},grant:{type:"boolean"}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {userId}=request.params as {userId:string};
    const body=request.body as {role:typeof ADMIN_ROLES[number];grant:boolean};
    return adminSetRole(pool,auth,{userId,...body});
  });

  app.get("/v1/admin/trips",{
    schema:{security:sec,querystring:{type:"object",additionalProperties:false,properties:{status:{type:"string",enum:["published","active","completed","cancelled"]}}}}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {status}=request.query as {status?:string};
    return {trips:await adminListTrips(pool,auth,status)};
  });

  app.get("/v1/admin/audit",{
    schema:{
      security:sec,
      querystring:{type:"object",additionalProperties:false,properties:{
        entityType:{type:"string",maxLength:64},limit:{type:"integer",minimum:1,maximum:200}
      }}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const q=request.query as {entityType?:string;limit?:number};
    return {events:await adminListAudit(pool,auth,q)};
  });
}
