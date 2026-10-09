/**
 * Tipos propios del paquete `driver` · «publicar rutas». Los del cable (`DriverReadiness`, `DriverRequestItem`,
 * `RoutePlanResponse`…) son los del contrato `trips` en `@/api/types`; aquí solo lo que el contrato aún no declara.
 */
import type { PrivateDocument, Vehicle } from "@/api/types";
import type { DriverRequestItem } from "@/api/types/trips";

/**
 * Vehículo del conductor. `GET /v1/me/vehicles` devuelve el `Vehicle` del núcleo más el campo opcional `color` de la
 * extensión del contrato `trips` (docs/contracts/trips.md §10): el tipo del núcleo aún no lo declara.
 */
export type VehicleRecord = Vehicle & {
  color?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

/** Documento privado propio (`GET /v1/me/documents`). */
export type DocumentRecord = PrivateDocument;

export type ReviewState = "pending" | "approved" | "rejected";

/** Valores del formulario de vehículo (lo que escribe la persona; el servidor normaliza y valida de nuevo). */
export type VehicleFormValues = {
  make: string;
  model: string;
  plate: string;
  seats: number;
  color: string;
};

export type VehicleFormErrors = Partial<Record<keyof VehicleFormValues, string>>;

/** Cuerpo de `POST /v1/me/vehicles` y `PUT /v1/me/vehicles/:id`. */
export type VehicleBody = {
  make: string;
  model: string;
  plate: string;
  passengerSeats: number;
  color?: string;
};

/** Subida privada de un archivo del vehículo. */
export type VehicleUploadKind = "vehicle_photo" | "vehicle_insurance";
export type UploadPhase = "preparing" | "uploading" | "finishing";

export type LocalFile = {
  uri: string;
  contentType: string;
  sizeBytes: number;
};

/**
 * Solicitud de la bandeja. El contrato (`DriverRequestItem`) aún no informa de la retención de plaza de una solicitud ya
 * aceptada: la vista previa y, cuando exista, el servidor la añaden en `hold`. Si falta, la pantalla no inventa una cuenta
 * atrás (solo la muestra cuando ella misma acaba de aceptar y conoce `expiresAt`).
 */
export type InboxItem = DriverRequestItem & {
  hold?: { expiresAt: string } | null;
};

/** Plaza retenida conocida en este dispositivo (respuesta de la decisión): id de solicitud → instante de caducidad. */
export type HoldMap = Readonly<Record<string, string>>;
