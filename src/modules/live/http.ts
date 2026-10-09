import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession, type AuthPrincipal, type UserRole } from "../../auth/session.js";
import { DomainError } from "../../errors.js";

const KNOWN_ROLES: ReadonlySet<string> = new Set(["passenger", "driver", "admin", "verification_admin", "finance_admin", "support_admin"]);

/**
 * `resolveSession` entrega los roles como TEXTO de Postgres (`{driver,passenger}`): `array_agg` de un tipo enumerado no lo
 * convierte `pg` en array y `requireAnyRole` fallaría con TypeError (500). Aquí se acepta un array real o ese literal; los
 * valores desconocidos se descartan (nunca se concede un permiso por un valor inesperado). Defecto del núcleo (src/auth/session.ts),
 * que ya sortean también los módulos `money` y `trust`.
 */
export function normalizeRoles(input: unknown): UserRole[] {
  let values: string[] = [];
  if (Array.isArray(input)) values = input.filter((value): value is string => typeof value === "string");
  else if (typeof input === "string") {
    const inner = input.trim().replace(/^\{/, "").replace(/\}$/, "");
    values = inner.length === 0 ? [] : inner.split(",").map(value => value.trim().replace(/^"|"$/g, ""));
  }
  return [...new Set(values.filter(value => KNOWN_ROLES.has(value)))] as UserRole[];
}

export async function authenticate(pool: Pool, request: FastifyRequest): Promise<AuthPrincipal> {
  const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
  return { ...principal, roles: normalizeRoles(principal.roles) };
}

type ValidationIssue = { instancePath?: string; message?: string };

/**
 * Manejador de errores encapsulado del módulo: mismo formato `{ error:{code,message,details?}, requestId }` que el global,
 * pero convierte los errores de validación de Fastify en 400 VALIDATION_ERROR, el límite de tasa en 429 RATE_LIMITED y los
 * 4xx propios de Fastify (JSON mal formado, tipo de contenido) en 4xx estables. El manejador global de `app.ts` los devolvería como 500.
 */
export function installLiveErrorHandler(scope: FastifyInstance): void {
  scope.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    if (error instanceof DomainError) {
      return reply.code(error.statusCode).send({
        error: { code: error.code, message: error.message, details: error.details },
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
      return reply.code(statusCode).send({
        error: { code: "VALIDATION_ERROR", message: "La petición no se pudo interpretar." },
        requestId: request.id
      });
    }

    request.log.error(error);
    return reply.code(500).send({
      error: { code: "INTERNAL_ERROR", message: "Error interno del servidor." },
      requestId: request.id
    });
  });
}
