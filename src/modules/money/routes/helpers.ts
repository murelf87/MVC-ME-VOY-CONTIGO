import type { FastifyReply } from "fastify";
import type { IdempotentOutcome } from "../lib/idempotency.js";

export const BEARER = [{ bearerAuth: [] }];

/** Envía el resultado de una operación idempotente; un reintento lleva la cabecera `Idempotency-Replayed: true`. */
export function sendIdempotent<T extends object>(reply: FastifyReply, outcome: IdempotentOutcome<T>): FastifyReply {
  if (outcome.replayed) reply.header("idempotency-replayed", "true");
  return reply.code(outcome.status).send(outcome.body);
}
