import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession } from "../auth/session.js";
import {
  createRideRequest,
  decideRideRequest,
  listOwnRideRequests,
  listTripRideRequests
} from "../services/request-service.js";

async function principal(pool: Pool, authorization: string | undefined) {
  return resolveSession(pool,readBearerToken(authorization));
}

export async function registerRideRequestRoutes(app: FastifyInstance,pool: Pool): Promise<void> {
  app.post("/v1/trips/:tripId/requests",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",required:["tripId"],
        properties:{tripId:{type:"string",format:"uuid"}}
      },
      body:{
        type:"object",additionalProperties:false,
        required:["fromSegmentSeq","toSegmentSeq"],
        properties:{
          fromSegmentSeq:{type:"integer",minimum:0},
          toSegmentSeq:{type:"integer",minimum:1}
        }
      }
    }
  },async (request,reply)=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string};
    const body=request.body as {fromSegmentSeq:number;toSegmentSeq:number};
    const created=await createRideRequest(pool,auth,{tripId:params.tripId,...body});
    return reply.code(201).send(created);
  });

  app.get("/v1/me/ride-requests",{
    schema:{security:[{bearerAuth:[]}]}
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    return {requests:await listOwnRideRequests(pool,auth)};
  });

  app.get("/v1/trips/:tripId/requests",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",required:["tripId"],
        properties:{tripId:{type:"string",format:"uuid"}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {tripId:string};
    return {requests:await listTripRideRequests(pool,auth,params.tripId)};
  });

  app.post("/v1/ride-requests/:requestId/decision",{
    schema:{
      security:[{bearerAuth:[]}],
      params:{
        type:"object",required:["requestId"],
        properties:{requestId:{type:"string",format:"uuid"}}
      },
      body:{
        type:"object",additionalProperties:false,required:["decision"],
        properties:{decision:{type:"string",enum:["accept","reject"]}}
      }
    }
  },async request=>{
    const auth=await principal(pool,request.headers.authorization);
    const params=request.params as {requestId:string};
    const body=request.body as {decision:"accept"|"reject"};
    return decideRideRequest(pool,auth,params.requestId,body.decision);
  });
}
