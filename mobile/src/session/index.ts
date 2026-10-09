export { AuthProvider, useAuth, type AuthContextValue } from "./AuthContext";
export { sessionService } from "./session";
export { getSessionSnapshot, sessionStore } from "./sessionStore";
export {
  STAFF_ROLES,
  getFirstName,
  getOnboardingRequirements,
  hasStaffRole,
  isStaffRole,
  resolveActiveRole,
  selfServiceRoles,
  type OnboardingRequirement,
} from "./selectors";
export type { ActiveRole, SessionSnapshot, SessionState, SessionStatus, SignOutReason } from "./types";
