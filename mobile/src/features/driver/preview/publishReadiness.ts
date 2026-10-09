/**
 * Backend en memoria de la vista previa · slice `driver` · requisitos para publicar (`GET /v1/me/driver/readiness`,
 * pantalla 17). Es un port de `evaluateReadiness` (`src/modules/trips/driver-service.ts`): mismos estados, mismos textos y
 * mismo criterio de «vehículo más reciente».
 *
 * Una diferencia, a propósito: el servidor real da por «faltante» la foto o el seguro recién subidos (mira
 * `vehicle_photo_document_id` / `insurance_document_id`, que solo se rellenan al APROBAR). El contrato (`docs/contracts/trips.md`
 * §10.1) dice que `in_review` es «subido, pendiente de revisión»: aquí se cumple el contrato, de modo que lo recién subido
 * aparece «En revisión». Detalle en el informe del paquete.
 *
 * SIMULACIÓN: solo se carga con `EXPO_PUBLIC_PREVIEW=1`.
 */
import type { DriverReadiness, ReadinessItem, ReadinessKey } from "@/api/types/trips";
import { ApiFailure, utcToday, type PreviewDb, type PreviewRouter, type Principal } from "@/preview";

type Review = "pending" | "approved" | "rejected";
type State = ReadinessItem["state"];

const LABELS: Record<ReadinessKey, string> = {
  public_photo: "Foto pública",
  identity: "Identidad",
  vehicle: "Vehículo",
  vehicle_documents: "Documentación del vehículo",
  vehicle_photo: "Foto del vehículo",
  insurance: "Seguro (uso particular)",
  driver_license: "Permiso de conducir",
};

const DETAILS: Record<ReadinessKey, Record<State, string | null>> = {
  public_photo: {
    approved: null,
    in_review: "Foto en revisión",
    missing: "Añade una foto de perfil",
    rejected: "Foto rechazada: sube otra",
    expired: null,
  },
  identity: {
    approved: null,
    in_review: "Verificación en revisión",
    missing: "Verifica tu identidad",
    rejected: "Verificación rechazada",
    expired: null,
  },
  vehicle: {
    approved: null,
    in_review: "Vehículo en revisión",
    missing: "Añade tu vehículo",
    rejected: "Vehículo rechazado",
    expired: null,
  },
  vehicle_documents: {
    approved: null,
    in_review: "Documentación en revisión",
    missing: "Sube la documentación del vehículo",
    rejected: "Documentación rechazada",
    expired: null,
  },
  vehicle_photo: {
    approved: null,
    in_review: "Foto en revisión",
    missing: "Sube una foto del vehículo",
    rejected: "Foto rechazada: sube otra",
    expired: null,
  },
  insurance: {
    approved: "Documento subido",
    in_review: "Documento subido",
    missing: "Sube el seguro del vehículo",
    rejected: "Seguro rechazado: sube otro",
    expired: "Seguro caducado: sube la renovación",
  },
  driver_license: {
    approved: "Documento subido",
    in_review: "Documento subido",
    missing: "Sube tu permiso de conducir",
    rejected: "Documento rechazado",
    expired: null,
  },
};

function reviewState(status: Review, hasEvidence: boolean): State {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return hasEvidence ? "in_review" : "missing";
}

/** `vehicleDisplayName` del backend: «SEAT Arona». */
export function vehicleDisplayName(make: string, model: string): string {
  return `${make.trim()} ${model.trim()}`.replace(/\s+/g, " ").trim();
}

/** El conductor lo es (`requireRole` del backend: 403 `AUTH_FORBIDDEN` con el texto del endpoint). */
export function requireDriver(principal: Principal, message: string): void {
  if (!principal.roles.includes("driver")) throw new ApiFailure("AUTH_FORBIDDEN", message, 403);
}

/** ¿El vehículo puede recibir reservas? (`VEHICLE_BOOKABLE_SQL`: todo aprobado y seguro vigente). */
export function isVehicleBookable(db: PreviewDb, vehicleId: string): boolean {
  const vehicle = db.vehicles.get(vehicleId);
  if (!vehicle) return false;
  return (
    vehicle.review_status === "approved" &&
    vehicle.documentation_status === "approved" &&
    vehicle.vehicle_photo_status === "approved" &&
    vehicle.insurance_status === "approved" &&
    vehicle.insurance_expires_on !== null &&
    vehicle.insurance_expires_on >= utcToday(db)
  );
}

/**
 * Evalúa los requisitos con el vehículo indicado o, sin él, con el MÁS RECIENTE del conductor (`order by created_at desc,
 * id`). El permiso de conducir se informa pero no bloquea.
 */
export function evaluateReadiness(db: PreviewDb, userId: string, vehicleId: string | null): DriverReadiness {
  const profile = db.profiles.get(userId);
  const license = db.documents
    .filter((doc) => doc.owner_user_id === userId && doc.kind === "driver_license")
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? 1 : -1))[0];
  const vehicle = db.vehicles
    .filter((row) => row.driver_user_id === userId && (vehicleId === null || row.id === vehicleId))
    .sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1))[0];

  const items: ReadinessItem[] = [];
  const push = (key: ReadinessKey, state: State, blocking: boolean, expiresOn: string | null = null, detail?: string | null): void => {
    items.push({ key, label: LABELS[key], state, blocking, detail: detail !== undefined ? detail : DETAILS[key][state], expiresOn });
  };

  push("public_photo", profile ? reviewState(profile.public_photo_status, profile.public_photo_key !== null) : "missing", true);
  const identity: State = !profile
    ? "missing"
    : profile.identity_status === "verified"
      ? "approved"
      : profile.identity_status === "pending"
        ? "in_review"
        : profile.identity_status === "rejected"
          ? "rejected"
          : "missing";
  push("identity", identity, true);

  if (!vehicle) {
    push("vehicle", "missing", true);
    push("vehicle_documents", "missing", true);
    push("vehicle_photo", "missing", true);
    push("insurance", "missing", true);
  } else {
    const uploaded = (kind: "vehicle_registration" | "vehicle_photo" | "vehicle_insurance"): boolean =>
      db.documents.find((doc) => doc.vehicle_id === vehicle.id && doc.kind === kind && doc.review_status !== "rejected") !== undefined;
    push("vehicle", reviewState(vehicle.review_status, true), true);
    push("vehicle_documents", reviewState(vehicle.documentation_status, uploaded("vehicle_registration")), true);
    push("vehicle_photo", reviewState(vehicle.vehicle_photo_status, vehicle.vehicle_photo_document_id !== null || uploaded("vehicle_photo")), true);
    let insurance = reviewState(vehicle.insurance_status, vehicle.insurance_document_id !== null || uploaded("vehicle_insurance"));
    let insuranceDetail: string | null | undefined;
    if (insurance === "approved") {
      if (!vehicle.insurance_expires_on) {
        insurance = "in_review";
        insuranceDetail = "Falta verificar la fecha de caducidad del seguro";
      } else if (vehicle.insurance_expires_on < utcToday(db)) {
        insurance = "expired";
      }
    }
    push("insurance", insurance, true, vehicle.insurance_expires_on, insuranceDetail);
  }
  push("driver_license", license ? reviewState(license.review_status, true) : "missing", false);

  const blockers = items.filter((item) => item.blocking && item.state !== "approved").map((item) => item.key);
  return {
    canPublish: blockers.length === 0 && vehicle !== undefined,
    vehicle: vehicle
      ? {
          id: vehicle.id,
          displayName: vehicleDisplayName(vehicle.make, vehicle.model),
          plate: vehicle.plate,
          color: vehicle.color,
          passengerSeats: vehicle.passenger_seats,
        }
      : null,
    items,
    blockers,
  };
}

/** Puerta de publicación: `409 DRIVER_NOT_READY` con los bloqueos, o la evaluación del vehículo indicado. */
export function assertDriverReady(db: PreviewDb, userId: string, vehicleId: string): DriverReadiness {
  const readiness = evaluateReadiness(db, userId, vehicleId);
  if (!readiness.canPublish) {
    throw new ApiFailure("DRIVER_NOT_READY", "Todavía no cumples los requisitos para publicar rutas.", 409, { blockers: readiness.blockers });
  }
  return readiness;
}

export function registerReadiness(r: PreviewRouter, db: PreviewDb): void {
  r.get("/v1/me/driver/readiness", { summary: "Requisitos para publicar (pantalla 17)", tags: ["trips"] }, (req) => {
    const principal = req.auth();
    requireDriver(principal, "Necesitas el rol de conductor para publicar rutas.");
    return evaluateReadiness(db, principal.userId, null);
  });
}
