import { DomainError } from "../errors.js";

export type SelfServiceRole = "passenger" | "driver";

export function normalizeRequestedRoles(input: unknown): SelfServiceRole[] {
  if (input === undefined) return ["passenger"];
  if (!Array.isArray(input)) {
    throw new DomainError("INVALID_SELF_SERVICE_ROLES", "roles must be an array");
  }
  const roles = [...new Set(input)];
  if (roles.length < 1 || roles.length > 2) {
    throw new DomainError("INVALID_SELF_SERVICE_ROLES", "Select passenger, driver, or both");
  }
  for (const role of roles) {
    if (role !== "passenger" && role !== "driver") {
      throw new DomainError(
        "INVALID_SELF_SERVICE_ROLES",
        "Only passenger and driver roles may be requested during self-service registration"
      );
    }
  }
  return roles as SelfServiceRole[];
}
