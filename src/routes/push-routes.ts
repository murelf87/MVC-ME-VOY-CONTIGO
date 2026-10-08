import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import { registerPushDevice,unregisterPushDevice } from "../services/push-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const sec=[{bearerAuth:[]}];
const tokenProp={type:"string",minLength:10,maxLength:4096};

export async function registerPushRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.post("/v1/me/push-devices",{
    schema:{security:sec,body:{type:"object",additionalProperties:false,required:["platform","token"],
      properties:{platform:{type:"string",enum:["ios","android"]},token:tokenProp}}}
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    return reply.code(201).send(await registerPushDevice(pool,auth,request.body as {platform:"ios"|"android";token:string}));
  });

  app.post("/v1/me/push-devices/unregister",{
    schema:{security:sec,body:{type:"object",additionalProperties:false,required:["token"],properties:{token:tokenProp}}}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return unregisterPushDevice(pool,auth,(request.body as {token:string}).token);
  });
}
