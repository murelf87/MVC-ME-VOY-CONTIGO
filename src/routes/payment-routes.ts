import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import { readBearerToken,requireAnyRole,resolveSession } from "../auth/session.js";
import type { AppConfig } from "../config.js";
import { DomainError } from "../errors.js";
import { parseStripeEvent,verifyStripeSignature } from "../payments/stripe-adapter.js";
import {
  adminPaymentsOverview,ingestProviderEvent,myEarnings,preparePayouts,retryDeferredEvents
} from "../services/payments-service.js";

async function principal(pool:Pool,authorization:string|undefined){
  return resolveSession(pool,readBearerToken(authorization));
}
const sec=[{bearerAuth:[]}];

export async function registerPaymentRoutes(app:FastifyInstance,pool:Pool,config:AppConfig):Promise<void>{
  const stripeReady=config.paymentsProvider==="stripe"&&Boolean(config.stripeWebhookSecret);

  // Webhooks need the exact bytes the provider signed, so this scope keeps the raw body.
  await app.register(async scope=>{
    scope.removeContentTypeParser("application/json");
    scope.addContentTypeParser("application/json",{parseAs:"buffer",bodyLimit:1_000_000},(_req,body,done)=>done(null,body));
    scope.post("/v1/payments/webhooks/stripe",{config:{rateLimit:false}},async(request,reply)=>{
      if(!stripeReady){
        throw new DomainError("PAYMENTS_PROVIDER_UNAVAILABLE","No payment provider is configured",503);
      }
      const raw=request.body as Buffer;
      verifyStripeSignature(raw,request.headers["stripe-signature"] as string|undefined,config.stripeWebhookSecret!);
      let payload:any;
      try{ payload=JSON.parse(raw.toString("utf8")); }catch{ throw new DomainError("WEBHOOK_PAYLOAD_INVALID","Body is not JSON",400); }
      const out=await ingestProviderEvent(pool,"stripe",parseStripeEvent(payload),payload);
      // 200 even for deferred or failed processing: the event is stored and retried on our side.
      return reply.code(200).send({received:true,...out});
    });
  });

  app.get("/v1/me/earnings",{schema:{security:sec}},async request=>
    myEarnings(pool,await principal(pool,request.headers.authorization),stripeReady));

  app.get("/v1/admin/payments",{schema:{security:sec}},async request=>
    adminPaymentsOverview(pool,await principal(pool,request.headers.authorization),stripeReady));

  app.post("/v1/admin/payouts/prepare",{
    schema:{security:sec,body:{type:"object",additionalProperties:false,required:["month"],
      properties:{month:{type:"string",pattern:"^\\d{4}-(0[1-9]|1[0-2])$"}}}}
  },async request=>preparePayouts(pool,await principal(pool,request.headers.authorization),(request.body as any).month));

  app.post("/v1/admin/payments/retry-deferred",{schema:{security:sec}},async request=>{
    requireAnyRole(await principal(pool,request.headers.authorization),["admin","finance_admin"]);
    return {results:await retryDeferredEvents(pool)};
  });
}
