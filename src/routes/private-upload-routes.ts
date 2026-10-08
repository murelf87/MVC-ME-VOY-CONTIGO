import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import type { PrivateObjectStorage } from "../storage/private-object-storage.js";
import type { InsuranceOcrProvider } from "../documents/insurance-ocr-provider.js";
import {
  completePrivateUploadIntent,
  createOwnDocumentDownloadUrl,
  createPrivateUploadIntent
} from "../documents/private-upload-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}

export async function registerPrivateUploadRoutes(
  app:FastifyInstance,
  pool:Pool,
  storage:PrivateObjectStorage,
  ocr:InsuranceOcrProvider,
  uploadTtlSeconds:number
):Promise<void>{
  app.post("/v1/me/uploads/intents",{
    schema:{
      security:[{bearerAuth:[]}],
      body:{
        type:"object",
        additionalProperties:false,
        required:["kind","vehicleId","contentType","sizeBytes"],
        properties:{
          kind:{type:"string",enum:["vehicle_photo","vehicle_insurance"]},
          vehicleId:{type:"string",format:"uuid"},
          contentType:{type:"string",minLength:3,maxLength:120},
          sizeBytes:{type:"integer",minimum:1,maximum:20971520}
        }
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const body=request.body as {
      kind:"vehicle_photo"|"vehicle_insurance";
      vehicleId:string;
      contentType:string;
      sizeBytes:number;
    };
    const intent=await createPrivateUploadIntent(
      pool,auth,storage,uploadTtlSeconds,body
    );
    return reply.code(201).send(intent);
  });

  app.post("/v1/me/uploads/:intentId/complete",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",
        required:["intentId"],
        properties:{intentId:{type:"string",format:"uuid"}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {intentId:string};
    return completePrivateUploadIntent(
      pool,auth,storage,ocr,params.intentId
    );
  });

  app.get("/v1/me/documents/:documentId/download",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",
        required:["documentId"],
        properties:{documentId:{type:"string",format:"uuid"}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {documentId:string};
    return createOwnDocumentDownloadUrl(
      pool,auth,storage,params.documentId
    );
  });
}
