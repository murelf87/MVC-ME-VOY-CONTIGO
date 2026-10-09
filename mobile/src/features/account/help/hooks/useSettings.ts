import { useCallback } from "react";
import type { FontScale, UserSettings } from "@/api/types";
import { useApiQuery, type UseApiQueryResult } from "@/hooks";
import { useAuth } from "@/session";
import { getSettings } from "../api";
import { chooseFontScale } from "../fontScaleSync";
import {
  dismissSettingsSaveError,
  queueSettingsPatch,
  retrySettingsSave,
  useSettingsSaveState,
  type SettingsSaveState,
} from "../settingsSync";
import { helpKeys } from "./keys";

export interface UseSettingsResult {
  /** Consulta de `GET /v1/me/settings` (solo con sesión). */
  query: UseApiQueryResult<UserSettings>;
  settings: UserSettings | undefined;
  /** Estado del último guardado (`PATCH /v1/me/settings`). */
  save: SettingsSaveState;
  setShareLiveLocation(value: boolean): void;
  chooseFont(scale: FontScale): void;
  retrySave(): void;
  dismissSaveError(): void;
}

/** Ajustes de la cuenta con guardado optimista (lámina 34). Un invitado no tiene ajustes en el servidor. */
export function useSettings(): UseSettingsResult {
  const { status } = useAuth();
  const signedIn = status === "signedIn";
  const query = useApiQuery<UserSettings>(helpKeys.settings, ({ signal }) => getSettings({ signal }), {
    enabled: signedIn,
    staleTimeMs: 60_000,
  });
  const save = useSettingsSaveState();
  const setShareLiveLocation = useCallback((value: boolean) => queueSettingsPatch({ shareLiveLocationInTrip: value }), []);
  const chooseFont = useCallback((scale: FontScale) => chooseFontScale(scale, { saveToAccount: signedIn }), [signedIn]);
  return {
    query,
    settings: query.data,
    save,
    setShareLiveLocation,
    chooseFont,
    retrySave: retrySettingsSave,
    dismissSaveError: dismissSettingsSaveError,
  };
}
