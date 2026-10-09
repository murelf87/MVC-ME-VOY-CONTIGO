import type { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import type { AuthPrincipal } from "../../auth/session.js";
import { readBearerToken, resolveSession } from "../../auth/session.js";
import { DomainError } from "../../errors.js";
import { writeAudit } from "../../lib/audit.js";
import type { TrustContext } from "./context.js";
import { trustError } from "./common.js";
import { type AdminResource, normalizeRoles, permissionFor, permits, staffRolesOf } from "./rbac.js";

/**
 * Manejador de errores del plugin (encapsulado: no afecta a otros módulos).
 * Convierte la validación de Fastify en 400 VALIDATION_ERROR y el límite de frecuencia en 429 RATE_LIMITED;
 * los DomainError conservan su estado HTTP. Todo lo demás se relanza al manejador global (500 INTERNAL_ERROR).
 */
export function trustErrorHandler(error: FastifyError | Error, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof DomainError) {
    return reply.code(error.statusCode).send({
      error: { code: error.code, message: error.message, ...(error.details !== undefined ? { details: error.details } : {}) },
      requestId: request.id
    });
  }
  const fastifyError = error as FastifyError;
  if (fastifyError.validation) {
    const issues = fastifyError.validation.map(issue => ({
      path: (issue.instancePath || "").replace(/^\//, "").replace(/\//g, ".") || (issue.params as { missingProperty?: string } | undefined)?.missingProperty || "",
      message: issue.message ?? "valor no válido"
    }));
    return reply.code(400).send({
      error: { code: "VALIDATION_ERROR", message: "Los datos enviados no son válidos.", details: { issues } },
      requestId: request.id
    });
  }
  if (fastifyError.statusCode === 429) {
    return reply.code(429).send({
      error: { code: "RATE_LIMITED", message: "Demasiadas solicitudes. Inténtalo de nuevo en unos instantes." },
      requestId: request.id
    });
  }
  if (fastifyError.statusCode !== undefined && fastifyError.statusCode >= 400 && fastifyError.statusCode < 500) {
    return reply.code(fastifyError.statusCode).send({
      error: { code: "VALIDATION_ERROR", message: "La petición no es válida." },
      requestId: request.id
    });
  }
  throw error;
}

/**
 * Sesión válida o 401/403 del núcleo. Los roles se normalizan: `resolveSession` los entrega como texto de Postgres
 * (`{driver,passenger}`) porque `pg` no convierte arrays de tipos enumerados (ver `normalizeRoles`).
 */
export async function authenticate(ctx: TrustContext, request: FastifyRequest): Promise<AuthPrincipal> {
  const principal = await resolveSession(ctx.pool, readBearerToken(request.headers.authorization));
  return { ...principal, roles: normalizeRoles(principal.roles) };
}

async function deny(
  ctx: TrustContext,
  request: FastifyRequest,
  principal: AuthPrincipal,
  resource: string,
  needed: "read" | "write"
): Promise<never> {
  try {
    await writeAudit(ctx.pool, {
      actorUserId: principal.userId,
      action: "admin.access_denied",
      entityType: "admin_resource",
      entityId: resource,
      requestId: request.id,
      metadata: {
        resource,
        needed,
        method: request.method,
        route: request.routeOptions?.url ?? null,
        roles: principal.roles
      }
    });
  } catch (error) {
    request.log.error({ err: error }, "no se pudo auditar un acceso denegado");
  }
  throw trustError("AUTH_FORBIDDEN", "No tienes permiso para esta operación.", 403);
}

/**
 * Autorizaciones ya resueltas en esta petición. Las rutas del panel autorizan en `preValidation` (ver `adminGuard`) y sus
 * manejadores vuelven a pedir el principal: la segunda llamada reutiliza el resultado en lugar de repetir la consulta de
 * sesión (y nunca audita dos veces un acceso denegado, porque solo se guarda lo AUTORIZADO).
 */
const authorized = new WeakMap<FastifyRequest, { scope: string; principal: AuthPrincipal }>();

/**
 * Autoriza un recurso del panel. Un intento denegado (sesión válida sin permiso) queda registrado como `admin.access_denied`
 * y responde 403 AUTH_FORBIDDEN. Sin sesión responde 401 (no se audita: no hay actor).
 */
export async function authorizeAdmin(
  ctx: TrustContext,
  request: FastifyRequest,
  resource: AdminResource,
  needed: "read" | "write"
): Promise<AuthPrincipal> {
  const scope = `${resource}:${needed}`;
  const known = authorized.get(request);
  if (known?.scope === scope) return known.principal;
  const principal = await authenticate(ctx, request);
  if (!permits(permissionFor(principal.roles, resource), needed)) return deny(ctx, request, principal, resource, needed);
  authorized.set(request, { scope, principal });
  return principal;
}

/** Cualquier rol de personal (admin, verification_admin, finance_admin, support_admin). */
export async function authorizeStaff(ctx: TrustContext, request: FastifyRequest): Promise<AuthPrincipal> {
  const known = authorized.get(request);
  if (known?.scope === "staff") return known.principal;
  const principal = await authenticate(ctx, request);
  if (staffRolesOf(principal.roles).length === 0) return deny(ctx, request, principal, "admin_panel", "read");
  authorized.set(request, { scope: "staff", principal });
  return principal;
}

/**
 * Gancho `preValidation` de las rutas del panel: la sesión y el permiso se comprueban ANTES de validar parámetros, query o
 * cuerpo. Así una persona sin sesión o sin permiso recibe 401/403 (y el intento queda auditado) y nunca el detalle de la
 * validación de un endpoint que no puede usar. Debe declararse con el mismo recurso y permiso que usa el manejador
 * (`tests/unit/trust-contract-sync.test.ts` lo verifica para todas las rutas).
 */
export function adminGuard(ctx: TrustContext, resource: AdminResource, needed: "read" | "write") {
  return async (request: FastifyRequest): Promise<void> => {
    await authorizeAdmin(ctx, request, resource, needed);
  };
}

/** Igual que `adminGuard` para los endpoints abiertos a cualquier rol de personal. */
export function staffGuard(ctx: TrustContext) {
  return async (request: FastifyRequest): Promise<void> => {
    await authorizeStaff(ctx, request);
  };
}

/** Auditoría de una operación del panel (falla cerrado: si no se puede auditar, la petición falla). */
export async function auditAdmin(
  ctx: TrustContext,
  request: FastifyRequest,
  principal: AuthPrincipal,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  await writeAudit(ctx.pool, { actorUserId: principal.userId, action, entityType, entityId, requestId: request.id, metadata });
}
