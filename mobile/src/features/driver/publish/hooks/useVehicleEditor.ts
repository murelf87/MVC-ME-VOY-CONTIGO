import { useCallback, useMemo, useRef, useState } from "react";
import { describePublishError, type PublishErrorView } from "../logic/errors";
import {
  clampSeats,
  emptyValues,
  formatPlateInput,
  hasErrors,
  isDirty,
  isListed,
  needsReviewWarning,
  toBody,
  validateVehicle,
  valuesFromVehicle,
} from "../logic/vehicle";
import { publishStrings } from "../strings";
import type { VehicleFormErrors, VehicleFormValues, VehicleRecord } from "../types";
import { useSaveVehicle } from "./useVehicles";

function withoutKeys(errors: VehicleFormErrors, keys: readonly (keyof VehicleFormValues)[]): VehicleFormErrors {
  if (keys.every((key) => errors[key] === undefined)) return errors;
  const next: VehicleFormErrors = { ...errors };
  for (const key of keys) delete next[key];
  return next;
}

export type SubmitOutcome =
  | { status: "invalid"; message: string }
  | { status: "clean" }
  /** El vehículo ya estaba aprobado: guardar reinicia la revisión. La pantalla pide confirmación y llama de nuevo con `confirmed`. */
  | { status: "needs_confirm" }
  | { status: "saved"; vehicle: VehicleRecord; created: boolean }
  | { status: "failed" };

export interface VehicleEditor {
  values: VehicleFormValues;
  /** Errores a la vista: los de validación (tras intentar guardar o salir de un campo) y los del servidor. */
  errors: VehicleFormErrors;
  dirty: boolean;
  isSaving: boolean;
  /** Error que no pertenece a un campo (sin conexión, servidor…). */
  banner: PublishErrorView | null;
  setMake(make: string): void;
  setModel(model: string): void;
  setPlate(plate: string): void;
  setSeats(seats: number): void;
  setColor(color: string): void;
  /** Marca un campo como visitado para enseñar su error al salir de él. */
  touch(field: keyof VehicleFormValues): void;
  submit(options?: { confirmed?: boolean }): Promise<SubmitOutcome>;
  dismissBanner(): void;
}

/**
 * Estado del formulario de un vehículo (el de la 17 y el de «Datos del vehículo»): valores, validación local, aviso de
 * «lo revisaremos de nuevo» y guardado (alta o edición). Un guardado se ignora si ya hay otro en curso (doble toque).
 */
export function useVehicleEditor(vehicle: VehicleRecord | undefined, options: { withColor: boolean }): VehicleEditor {
  const { withColor } = options;
  const [values, setValues] = useState<VehicleFormValues>(() => (vehicle !== undefined ? valuesFromVehicle(vehicle) : emptyValues()));
  const [baseKey, setBaseKey] = useState<string>(vehicle?.id ?? "new");
  const [attempted, setAttempted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<keyof VehicleFormValues>>(new Set());
  const [serverErrors, setServerErrors] = useState<VehicleFormErrors>({});
  const [banner, setBanner] = useState<PublishErrorView | null>(null);
  const save = useSaveVehicle();
  const saving = useRef(false);

  // Cambia de vehículo (por ejemplo, desde «Otros vehículos»): se empieza de cero con sus datos.
  const currentKey = vehicle?.id ?? "new";
  if (currentKey !== baseKey) {
    setBaseKey(currentKey);
    setValues(vehicle !== undefined ? valuesFromVehicle(vehicle) : emptyValues());
    setAttempted(false);
    setTouched(new Set());
    setServerErrors({});
    setBanner(null);
  }

  const localErrors = useMemo(() => validateVehicle(values, { withColor }), [values, withColor]);
  const errors = useMemo<VehicleFormErrors>(() => {
    const visible: VehicleFormErrors = {};
    for (const key of Object.keys(localErrors) as (keyof VehicleFormValues)[]) {
      if (attempted || touched.has(key)) visible[key] = localErrors[key];
    }
    return { ...visible, ...serverErrors };
  }, [localErrors, attempted, touched, serverErrors]);

  const dirty = useMemo(() => isDirty(values, vehicle, { withColor }), [values, vehicle, withColor]);

  const change = useCallback((patch: Partial<VehicleFormValues>) => {
    setValues((previous) => ({ ...previous, ...patch }));
    setServerErrors((previous) => withoutKeys(previous, Object.keys(patch) as (keyof VehicleFormValues)[]));
    setBanner(null);
  }, []);

  const setMake = useCallback((make: string) => {
    setValues((previous) => {
      // Cambiar de marca invalida el modelo elegido (salvo que sea la misma marca escrita de otra forma).
      const sameMake = isListed([make], previous.make);
      return { ...previous, make, model: sameMake ? previous.model : "" };
    });
    setServerErrors((previous) => withoutKeys(previous, ["make", "model"]));
    setBanner(null);
  }, []);

  const submit = useCallback(
    async (submitOptions?: { confirmed?: boolean }): Promise<SubmitOutcome> => {
      if (saving.current) return { status: "failed" };
      setAttempted(true);
      const found = validateVehicle(values, { withColor });
      if (hasErrors(found)) return { status: "invalid", message: Object.values(found)[0] ?? publishStrings.vehicle.makeError };
      if (vehicle !== undefined && !isDirty(values, vehicle, { withColor })) return { status: "clean" };
      if (vehicle !== undefined && needsReviewWarning(vehicle) && submitOptions?.confirmed !== true) return { status: "needs_confirm" };

      saving.current = true;
      setBanner(null);
      setServerErrors({});
      try {
        const body = toBody(values, { withColor });
        const saved = await save.mutateAsync(vehicle === undefined ? { body } : { vehicleId: vehicle.id, body });
        setValues(valuesFromVehicle(saved));
        setAttempted(false);
        setTouched(new Set());
        return { status: "saved", vehicle: saved, created: vehicle === undefined };
      } catch (raised) {
        const view = describePublishError(raised);
        if (view.code === "VEHICLE_PLATE_ALREADY_EXISTS") setServerErrors({ plate: publishStrings.vehicle.plateErrorTaken });
        else setBanner(view);
        return { status: "failed" };
      } finally {
        saving.current = false;
      }
    },
    [values, vehicle, withColor, save],
  );

  return {
    values,
    errors,
    dirty,
    isSaving: save.isPending,
    banner,
    setMake,
    setModel: useCallback((model: string) => change({ model }), [change]),
    setPlate: useCallback((plate: string) => change({ plate: formatPlateInput(plate) }), [change]),
    setSeats: useCallback((seats: number) => change({ seats: clampSeats(seats) }), [change]),
    setColor: useCallback((color: string) => change({ color }), [change]),
    touch: useCallback((field: keyof VehicleFormValues) => setTouched((previous) => new Set(previous).add(field)), []),
    submit,
    dismissBanner: useCallback(() => setBanner(null), []),
  };
}
