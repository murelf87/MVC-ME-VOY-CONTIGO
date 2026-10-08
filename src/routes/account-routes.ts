import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import { deleteOwnAccount,ownAccountDeletionCheck } from "../services/account-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const sec=[{bearerAuth:[]}];

export async function registerAccountRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.get("/v1/me/account/deletion",{schema:{security:sec}},async request=>
    ownAccountDeletionCheck(pool,await principal(pool,request.headers.authorization)));

  app.post("/v1/me/account/delete",{
    schema:{
      security:sec,
      body:{type:"object",additionalProperties:false,required:["confirm"],properties:{confirm:{type:"string",maxLength:20}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return deleteOwnAccount(pool,auth,request.body as {confirm:string});
  });
}
