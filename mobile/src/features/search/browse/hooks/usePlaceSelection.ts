/**
 * Elegir un lugar en el buscador: comprueba que está dentro de una provincia disponible (solo para origen y destino;
 * el lugar genérico lo valida quien lo pidió: favoritos, paradas del conductor…), lo recuerda en «Recientes» y
 * cuenta qué pasó para que la pantalla pinte «fuera de provincia» o el error de comprobación.
 */
import { useCallback, useState } from "react";
import type { PlaceParam } from "../../routes";
import { checkPlaceProvince } from "../api";
import type { PlaceField } from "../logic/places";
import { useProvinces } from "./useProvinces";

export type SelectionState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "outside"; provinceName: string | null }
  | { kind: "error"; error: unknown };

export interface UsePlaceSelectionResult {
  state: SelectionState;
  /** `true` si el lugar es válido y se puede devolver; `false` deja el motivo en `state`. */
  validate(place: PlaceParam): Promise<boolean>;
  reset(): void;
}

export function usePlaceSelection(field: PlaceField): UsePlaceSelectionResult {
  const [state, setState] = useState<SelectionState>({ kind: "idle" });
  const { province } = useProvinces();
  const provinceName = province?.name ?? null;

  const validate = useCallback(
    async (place: PlaceParam): Promise<boolean> => {
      if (field === "place") return true;
      setState({ kind: "checking" });
      const verdict = await checkPlaceProvince(place);
      if (verdict.ok) {
        setState({ kind: "idle" });
        return true;
      }
      setState(verdict.reason === "outside" ? { kind: "outside", provinceName } : { kind: "error", error: verdict.error });
      return false;
    },
    [field, provinceName],
  );

  const reset = useCallback(() => setState({ kind: "idle" }), []);

  return { state, validate, reset };
}
