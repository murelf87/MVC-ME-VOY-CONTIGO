import type { FastifyError, FastifyInstance, FastifyRequest } from "fastify";
import type { Pool } from "pg";
import { readBearerToken, resolveSession, requireAnyRole, type AuthPrincipal, type UserRole } from "../../../auth/session.js";
import { DomainError } from "../../../errors.js";
import { writeAudit } from "../../../lib/audit.js";

const KNOWN_ROLES: ReadonlySet<string> = new Set(["passenger", "driver", "admin", "verification_admin", "finance_admin", "support_admin"]);

/**
 * `resolveSession` entrega los roles como TEXTO de Postgres (`{driver,passenger}`): `array_agg` de un tipo enumerado no lo
 * convierte `pg` en array (defecto del núcleo, `requireAnyRole` fallaría con TypeError → 500). Aquí se acepta un array real
 * o ese literal; los valores desconocidos se descartan (nunca se concede un permiso por un valor inesperado).
 */
export function normalizeRoles(input: unknown): UserRole[] {
  let values: string[] = [];
  if (Array.isArray(input)) values = input.filter((v): v is string => typeof v === "string");
  else if (typeof input === "string") {
    const inner = input.trim().replace(/^\{/, "").replace(/\}$/, "");
    values = inner.length === 0 ? [] : inner.split(",").map(v => v.trim().replace(/^"|"$/g, ""));
  }
  return [...new Set(values.filter(v => KNOWN_ROLES.has(v)))] as UserRole[];
}

export async function authenticate(pool: Pool, request: FastifyRequest): Promise<AuthPrincipal> {
  const principal = await resolveSession(pool, readBearerToken(request.headers.authorization));
  return { ...principal, roles: normalizeRoles(principal.roles) };
}

/**
 * Guardia del panel de finanzas: `finance_admin` o `admin`; cualquier otro rol → 403 AUTH_FORBIDDEN.
 * Un intento denegado (sesión válida sin permiso) queda auditado como `admin.access_denied`; sin sesión → 401 (sin actor, sin auditoría).
 */
export async function authenticateFinance(pool: Pool, request: FastifyRequest): Promise<AuthPrincipal> {
  const principal = await authenticate(pool, request);
  try {
    requireAnyRole(principal, ["finance_admin", "admin"]);
  } catch (error) {
    try {
      await writeAudit(pool, {
        actorUserId: principal.userId,
        action: "admin.access_denied",
        entityType: "admin_resource",
        entityId: "finance",
        requestId: request.id,
        metadata: { resource: "finance", method: request.method, route: request.routeOptions?.url ?? null, roles: principal.roles }
      });
    } catch (auditError) {
      request.log.error({ err: auditError }, "no se pudo auditar un acceso denegado");
    }
    throw error;
  }
  return principal;
}

type ValidationIssue = { instancePath?: string; message?: string };

/**
 * Manejador de errores encapsulado del módulo: mismo formato `{ error:{code,message,details?}, requestId }` que el global,
 * pero convierte los errores de validación de Fastify en 400 VALIDATION_ERROR (el global los devuelve como 500)
 * y los 4xx del propio Fastify (JSON mal formado, tipo de contenido) en 4xx estables.
 */
export function installMoneyErrorHandler(scope: FastifyInstance): void {
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
