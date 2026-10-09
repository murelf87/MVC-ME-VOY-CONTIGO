/**
 * Barril de la capa de red. Importa desde aquí (`@/api`) en lugar de rutas internas.
 * Los tipos de contrato siguen en `@/api/types`.
 */
export {
  API_URL,
  ApiError,
  AuthExpiredError,
  OfflineError,
  TimeoutError,
  apiRequest,
  apiRequestDetailed,
  buildQueryString,
  checkApiHealth,
  getApiBaseUrl,
  type ApiResponse,
  type HttpMethod,
  type QueryValue,
  type RequestOptions,
} from "./client";
export {
  describeError,
  errorMessage,
  isAbortError,
  isApiError,
  isApiErrorWithCode,
  isAuthExpiredError,
  isAuthRequiredError,
  isOfflineError,
  isRequestError,
  isTimeoutError,
  registerErrorMessages,
  type ErrorDescription,
  type RequestError,
} from "./errors";
export { newIdempotencyKey } from "./idempotency";
export { putToSignedUrl, type SignedUploadTarget, type UploadSource } from "./signedUpload";
export { formatNationalSpanishPhone, maskPhoneE164, normalizePhoneE164 } from "./phone";
export {
  fetchAuthSession,
  logoutSession,
  startPhoneVerification,
  verifyPhoneCode,
  type CallOptions,
} from "./endpoints/auth";
export { getMe, listProvinces, resolveProvince, updateProfile } from "./endpoints/me";
