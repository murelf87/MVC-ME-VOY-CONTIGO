export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(message: string, code: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/+$/, "");

function requireApiUrl(): string {
  if (!API_URL) {
    throw new ApiError(
      "La dirección del backend no está configurada.",
      "API_NOT_CONFIGURED",
      0
    );
  }
  return API_URL;
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const base = requireApiUrl();
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? "GET",
    signal: options.signal,
    headers: {
      accept: "application/json",
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const text = await response.text();
  let payload: any = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const error = payload?.error;
    throw new ApiError(
      error?.message ?? payload?.message ?? `HTTP ${response.status}`,
      error?.code ?? "HTTP_ERROR",
      response.status,
      error?.details
    );
  }

  return payload as T;
}

export async function checkApiHealth(): Promise<"online" | "offline" | "unconfigured"> {
  if (!API_URL) return "unconfigured";
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const response = await fetch(`${API_URL}/health/live`, { signal: controller.signal });
    clearTimeout(timeout);
    return response.ok ? "online" : "offline";
  } catch {
    return "offline";
  }
}
