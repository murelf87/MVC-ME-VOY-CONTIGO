import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import { listOwnNotifications,markNotificationsRead } from "../services/notification-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}

export async function registerNotificationRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.get("/v1/me/notifications",{
    schema:{
      security:[{bearerAuth:[]}],
      querystring:{type:"object",additionalProperties:false,properties:{limit:{type:"integer",minimum:1,maximum:100}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const {limit}=request.query as {limit?:number};
    return listOwnNotifications(pool,auth,limit??50);
  });

  app.post("/v1/me/notifications/read",{
    schema:{
      security:[{bearerAuth:[]}],
      body:{
        type:"object",additionalProperties:false,
        properties:{ids:{type:"array",maxItems:100,items:{type:"string",format:"uuid"}}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const body=(request.body??{}) as {ids?:string[]};
    return markNotificationsRead(pool,auth,body.ids);
  });
}
