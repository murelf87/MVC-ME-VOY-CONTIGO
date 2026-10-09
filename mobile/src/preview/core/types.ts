/**
 * Tipos compartidos del núcleo de la vista previa.
 *
 * SIMULACIÓN: todo lo que hay bajo `mobile/src/preview/**` es un backend en memoria que solo existe en la
 * compilación de vista previa (`EXPO_PUBLIC_PREVIEW=1`). No es el servidor de producción ni lo sustituye.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export const HTTP_METHODS: readonly HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"];

/** Mismo orden que el enum `user_role` de PostgreSQL (migración 001). */
export const USER_ROLES = [
  "passenger",
  "driver",
  "admin",
  "verification_admin",
  "finance_admin",
  "support_admin",
] as const;
export type UserRole = (typeof USER_ROLES)[number];
export type SelfServiceRole = "passenger" | "driver";

/** Perfiles de prueba del visor: Persona nueva · Pasajero (Miguel) · Conductor (Ana) · Administración. */
export const PREVIEW_PROFILE_IDS = ["new", "passenger", "driver", "admin"] as const;
export type PreviewProfileId = (typeof PREVIEW_PROFILE_IDS)[number];

export interface PreviewProfile {
  id: PreviewProfileId;
  /** Etiqueta en español para el visor. */
  label: string;
  description: string;
  /** Clave estable del usuario con el que se inicia sesión (`null` = nadie: pantalla de Bienvenida). */
  userKey: "miguel" | "ana" | "staff" | null;
}

export const PREVIEW_PROFILES: Readonly<Record<PreviewProfileId, PreviewProfile>> = {
  new: {
    id: "new",
    label: "Persona nueva",
    description: "Sin sesión: Bienvenida, registro con teléfono y código SMS simulado.",
    userKey: null,
  },
  passenger: {
    id: "passenger",
    label: "Pasajero (Miguel)",
    description: "Miguel Torres, pasajero con 12 viajes y valoración 4,8.",
    userKey: "miguel",
  },
  driver: {
    id: "driver",
    label: "Conductor (Ana)",
    description: "Ana García López, conductora con Seat Arona verificado.",
    userKey: "ana",
  },
  admin: {
    id: "admin",
    label: "Administración",
    description: "Personal de MVC con todos los roles de revisión.",
    userKey: "staff",
  },
};

export function isPreviewProfileId(value: unknown): value is PreviewProfileId {
  return typeof value === "string" && (PREVIEW_PROFILE_IDS as readonly string[]).includes(value);
}

/** Resultado de resolver el token Bearer (equivale a `AuthPrincipal` del backend). */
export interface Principal {
  sessionId: string;
  userId: string;
  roles: UserRole[];
  expiresAt: string;
}

export interface GeoLatLng {
  latitude: number;
  longitude: number;
}
