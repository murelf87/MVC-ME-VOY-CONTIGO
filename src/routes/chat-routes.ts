import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,resolveSession } from "../auth/session.js";
import {
  blockUser,
  listTripDirectMessages,
  sendTripDirectMessage,
  unblockUser
} from "../chat/chat-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}

export async function registerChatRoutes(app:FastifyInstance,pool:Pool):Promise<void>{
  app.post("/v1/trips/:tripId/chat/:peerUserId/messages",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",required:["tripId","peerUserId"],
        properties:{
          tripId:{type:"string",format:"uuid"},
          peerUserId:{type:"string",format:"uuid"}
        }
      },
      body:{
        type:"object",additionalProperties:false,required:["clientMessageId","body"],
        properties:{
          clientMessageId:{type:"string",format:"uuid"},
          body:{type:"string",minLength:1,maxLength:2000}
        }
      }
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string;peerUserId:string};
    const body=request.body as {clientMessageId:string;body:string};
    const message=await sendTripDirectMessage(pool,auth,{...params,...body});
    return reply.code(message.duplicate?200:201).send(message);
  });

  app.get("/v1/trips/:tripId/chat/:peerUserId/messages",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",required:["tripId","peerUserId"],
        properties:{
          tripId:{type:"string",format:"uuid"},
          peerUserId:{type:"string",format:"uuid"}
        }
      },
      querystring:{
        type:"object",additionalProperties:false,
        properties:{limit:{type:"integer",minimum:1,maximum:100}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string;peerUserId:string};
    const query=request.query as {limit?:number};
    return {messages:await listTripDirectMessages(pool,auth,{...params,...query})};
  });

  app.put("/v1/me/blocks/:userId",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{type:"object",required:["userId"],properties:{userId:{type:"string",format:"uuid"}}}
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {userId:string};
    await blockUser(pool,auth,params.userId);
    return reply.code(204).send();
  });

  app.delete("/v1/me/blocks/:userId",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{type:"object",required:["userId"],properties:{userId:{type:"string",format:"uuid"}}}
    }
  },async(request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {userId:string};
    await unblockUser(pool,auth,params.userId);
    return reply.code(204).send();
  });
}
