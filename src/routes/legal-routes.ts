import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import {
  acceptLegalDocuments,adminCreateLegalDocument,adminListLegalDocuments,adminPublishLegalDocument,
  currentLegalDocuments,ownLegalStatus
} from "../services/legal-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const sec=[{bearerAuth:[]}];
const idParam={type:"object",required:["documentId"],properties:{documentId:{type:"string",format:"uuid"}}};

export async function registerLegalRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  // Public: anyone may read the conditions before signing up.
  app.get("/v1/legal/current",async()=>({documents:await currentLegalDocuments(pool)}));

  app.get("/v1/me/legal",{schema:{security:sec}},async request=>
    ownLegalStatus(pool,await principal(pool,request.headers.authorization)));

  app.post("/v1/me/legal/accept",{
    schema:{
      security:sec,
      body:{type:"object",additionalProperties:false,required:["documentIds"],
        properties:{documentIds:{type:"array",minItems:1,maxItems:10,items:{type:"string",format:"uuid"}}}}
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return acceptLegalDocuments(pool,auth,(request.body as {documentIds:string[]}).documentIds);
  });

  app.get("/v1/admin/legal-documents",{schema:{security:sec}},async request=>
    ({documents:await adminListLegalDocuments(pool,await principal(pool,request.headers.authorization))}));

  app.post("/v1/admin/legal-documents",{
    schema:{
      security:sec,
      body:{type:"object",additionalProperties:false,required:["kind","title","body"],
        properties:{
          kind:{type:"string",enum:["terms","privacy"]},
          title:{type:"string",minLength:1,maxLength:200},
          body:{type:"string",minLength:1,maxLength:200000}
        }}
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    return reply.code(201).send(await adminCreateLegalDocument(pool,auth,request.body as any));
  });

  app.post("/v1/admin/legal-documents/:documentId/publish",{schema:{security:sec,params:idParam}},async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return adminPublishLegalDocument(pool,auth,(request.params as {documentId:string}).documentId);
  });
}
