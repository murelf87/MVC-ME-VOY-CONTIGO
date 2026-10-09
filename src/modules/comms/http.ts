import { createHash } from "node:crypto";
import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import type { AuthPrincipal } from "../../auth/session.js";
import { DomainError } from "../../errors.js";
import { authenticate as authenticateRequest } from "./common.js";

type ValidationIssue = { instancePath?: string; message?: string };

export function authenticate(pool: Pool, request: FastifyRequest): Promise<AuthPrincipal> {
  return authenticateRequest(pool, request);
}

const SESSION_AUTHORIZATION_RE = /^Bearer (mvc_sess_[A-Za-z0-9_-]{43})$/;

/**
 * Clave de los límites de frecuencia de las rutas del módulo: la SESIÓN (hash del token) y, si la petición no trae unas
 * credenciales con forma de token, la IP. Tras el NAT de un operador móvil o la wifi de un campus muchas personas comparten IP:
 * con la IP como clave, el sondeo del chat de unas pocas bastaría para dejar sin servicio al resto. Los topes de negocio por
 * persona (consultas, denuncias, exportaciones) se imponen además en la base de datos.
 */
export function rateLimitKey(request: FastifyRequest): string {
  const header = request.headers.authorization;
  const match = typeof header === "string" ? SESSION_AUTHORIZATION_RE.exec(header) : null;
  if (match?.[1]) return `s:${createHash("sha256").update(match[1]).digest("hex").slice(0, 32)}`;
  return `ip:${request.ip}`;
}

/** Cabecera `Idempotency-Key` (uuid validado por el schema de la ruta). */
export function idempotencyKeyOf(request: FastifyRequest): string | undefined {
  const value = request.headers["idempotency-key"];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Tolerancia a cuerpos vacíos. Fastify responde 400 a un `POST` con `Content-Type: application/json` y cuerpo vacío, y los
 * clientes HTTP suelen enviar esa cabecera siempre; varias rutas del módulo no necesitan cuerpo («marcar todas como leídas»,
 * «cancelar eliminación», «cerrar consulta»…). Un cuerpo vacío se interpreta como «sin cuerpo». El resto del análisis JSON es el de Fastify
 * (con protección contra `__proto__`/`constructor`).
 */
export function installEmptyBodyTolerance(scope: FastifyInstance): void {
  const parseJson = scope.getDefaultJsonParser("error", "error");
  scope.addContentTypeParser("application/json", { parseAs: "string" }, (request, body, done) => {
    if (typeof body === "string" && body.trim() === "") {
      done(null, undefined);
      return;
    }
    parseJson(request, body as string, done);
  });
}

/** `preValidation` de las rutas con cuerpo opcional: sin cuerpo se valida `{}` (si no, Fastify validaría `undefined` y daría 400). */
export async function defaultEmptyBody(request: FastifyRequest): Promise<void> {
  if (request.body === undefined || request.body === null) request.body = {};
}

/**
 * Manejador de errores encapsulado del módulo: mismo formato `{ error:{code,message,details?}, requestId }` que el global,
 * pero convierte la validación de Fastify en 400 VALIDATION_ERROR, el límite de frecuencia en 429 RATE_LIMITED y los
 * 4xx propios de Fastify (JSON mal formado, tipo de contenido) en 4xx estables. El manejador global de `app.ts` los devolvería como 500.
 */
export function installCommsErrorHandler(scope: FastifyInstance): void {
  scope.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, ...(error.details === undefined ? {} : { details: error.details }) },
        requestId: request.id
      });
    }

    const validation = (error as FastifyError).validation as ValidationIssue[] | undefined;
    if (validation) {
      return reply.code(400).send({
        error: {
          code: "VALIDATION_ERROR",
          message: "La petición no es válida.",
          details: validation.map(issue => ({ path: issue.instancePath ?? "", message: issue.message ?? "inválido" }))
        },
        requestId: request.id
      });
    }

    const statusCode = (error as FastifyError).statusCode;
    if (statusCode === 429) {
      return reply.code(429).send({
        error: { code: "RATE_LIMITED", message: "Demasiadas peticiones. Inténtalo de nuevo en unos instantes." },
        requestId: request.id
      });
    }
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const known: Record<number, { code: string; message: string }> = {
        413: { code: "PAYLOAD_TOO_LARGE", message: "El cuerpo de la petición es demasiado grande." },
        415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "Tipo de contenido no admitido: usa application/json." }
      };
      const { code, message } = known[statusCode] ?? { code: "VALIDATION_ERROR", message: "La petición no se pudo interpretar." };
      return reply.code(statusCode).send({ error: { code, message }, requestId: request.id });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      requestId: request.id
    });
  });
}
