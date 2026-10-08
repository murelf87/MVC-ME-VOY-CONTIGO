import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import {
  REPORT_CATEGORIES,
  adminListReports,
  adminUpdateReport,
  createIncidentReport,
  listOwnBlocks,
  listOwnReports,
  rateBooking,
  ratingSummary
} from "../services/feedback-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}

const uuidParam=(name:string)=>({type:"object",required:[name],properties:{[name]:{type:"string",format:"uuid"}}});

export async function registerFeedbackRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.post("/v1/bookings/:bookingId/rating",{
    schema:{
      security:[{bearerAuth:[]}],
      params:uuidParam("bookingId"),
      body:{
        type:"object",additionalProperties:false,required:["score"],
        properties:{score:{type:"integer",minimum:1,maximum:5},comment:{type:["string","null"],maxLength:500}}
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const {bookingId}=request.params as {bookingId:string};
    const body=request.body as {score:number;comment?:string|null};
    return reply.code(201).send(await rateBooking(pool,auth,{bookingId,...body}));
  });

  app.get("/v1/users/:userId/rating",{
    schema:{security:[{bearerAuth:[]}],params:uuidParam("userId")}
  },async request=>{
    await principal(pool,request.headers.authorization);
    const {userId}=request.params as {userId:string};
    return ratingSummary(pool,userId);
  });

  app.post("/v1/reports",{
    schema:{
      security:[{bearerAuth:[]}],
      body:{
        type:"object",additionalProperties:false,required:["tripId","category","description"],
        properties:{
          tripId:{type:"string",format:"uuid"},
          reportedUserId:{type:["string","null"],format:"uuid"},
          category:{type:"string",enum:[...REPORT_CATEGORIES]},
          description:{type:"string",minLength:10,maxLength:2000},
          blockUser:{type:"boolean"}
        }
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const body=request.body as {tripId:string;reportedUserId?:string|null;category:string;description:string;blockUser?:boolean};
    return reply.code(201).send(await createIncidentReport(pool,auth,body));
  });

  app.get("/v1/me/reports",{schema:{security:[{bearerAuth:[]}]}},async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {reports:await listOwnReports(pool,auth)};
  });

  app.get("/v1/me/blocks",{schema:{security:[{bearerAuth:[]}]}},async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {blocks:await listOwnBlocks(pool,auth)};
  });

  app.get("/v1/admin/reports",{
    schema:{
      security:[{bearerAuth:[]}],
      querystring:{type:"object",additionalProperties:false,properties:{status:{type:"string",enum:["open","reviewing","resolved","dismissed"]}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {status}=request.query as {status?:string};
    return {reports:await adminListReports(pool,auth,status)};
  });

  app.post("/v1/admin/reports/:reportId/status",{
    schema:{
      security:[{bearerAuth:[]}],
      params:uuidParam("reportId"),
      body:{
        type:"object",additionalProperties:false,required:["status"],
        properties:{status:{type:"string",enum:["reviewing","resolved","dismissed"]},note:{type:["string","null"],maxLength:2000}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {reportId}=request.params as {reportId:string};
    const body=request.body as {status:"reviewing"|"resolved"|"dismissed";note?:string|null};
    return adminUpdateReport(pool,auth,{reportId,...body});
  });
}
