import { useMemo } from "react";
import { useApiMutation, useApiQuery, type UseApiMutationResult, type UseApiQueryResult } from "@/hooks";
import { createVehicle, listDocuments, listVehicles, updateVehicle } from "../api";
import { publishKeys } from "../keys";
import { otherVehicles, pickVehicle } from "../logic/vehicle";
import type { DocumentRecord, VehicleBody, VehicleRecord } from "../types";

/** Mis vehículos (el más reciente primero). */
export function useVehicles(): UseApiQueryResult<VehicleRecord[]> {
  return useApiQuery<VehicleRecord[]>(publishKeys.vehicles, ({ signal }) => listVehicles({ signal }), { staleTimeMs: 20_000 });
}

/** Mis documentos privados (para saber qué se subió de cada vehículo). */
export function useDocuments(enabled = true): UseApiQueryResult<DocumentRecord[]> {
  return useApiQuery<DocumentRecord[]>(publishKeys.documents, ({ signal }) => listDocuments({ signal }), {
    enabled,
    staleTimeMs: 20_000,
  });
}

export interface SelectedVehicle {
  /** El vehículo que se enseña (el pedido por id si existe; si no, el más reciente). */
  vehicle: VehicleRecord | undefined;
  others: VehicleRecord[];
  all: readonly VehicleRecord[];
}

/** Elige qué vehículo enseñar de la lista. */
export function useSelectedVehicle(vehicles: readonly VehicleRecord[] | undefined, preferredId?: string): SelectedVehicle {
  return useMemo(() => {
    const all = vehicles ?? [];
    const vehicle = pickVehicle(all, preferredId);
    return { vehicle, others: otherVehicles(all, vehicle), all };
  }, [vehicles, preferredId]);
}

export interface SaveVehicleVars {
  /** Sin id = alta; con id = edición (reinicia la revisión). */
  vehicleId?: string;
  body: VehicleBody;
}

/** Guarda un vehículo (alta o edición) y refresca vehículos, documentos y requisitos. */
export function useSaveVehicle(): UseApiMutationResult<VehicleRecord, SaveVehicleVars> {
  return useApiMutation<VehicleRecord, SaveVehicleVars>(
    ({ vehicleId, body }, { signal }) =>
      vehicleId === undefined ? createVehicle(body, { signal }) : updateVehicle(vehicleId, body, { signal }),
    { invalidates: [publishKeys.vehicles, publishKeys.documents, publishKeys.readiness] },
  );
}
