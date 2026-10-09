/**
 * «Tamaño de letra»: aplica, recuerda y sincroniza la preferencia.
 *
 *  - Se aplica a TODA la app al instante (`@/theme` → `setFontScale`; `Text` y los campos de texto lo leen).
 *  - Se recuerda en este móvil (`preferences`, clave `mvc.settings.fontScale`) para arrancar ya con el tamaño elegido,
 *    incluso antes de entrar o sin Internet.
 *  - Con sesión se guarda también en la cuenta (`PATCH /v1/me/settings`, ver `settingsSync.ts`) y, al entrar en otro
 *    móvil, el valor guardado en la cuenta manda — solo si la persona guardó algo alguna vez (`updatedAt`); unos ajustes
 *    «por defecto» no pisan lo elegido antes de entrar (en ese caso se sube la elección de este móvil).
 *
 * El módulo se arranca solo al importarse (la app importa todos los slices al iniciar).
 */
import type { FontScale, UserSettings } from "@/api/types";
import { queryCache } from "@/hooks";
import { getSettings } from "./api";
import { helpKeys } from "./hooks/keys";
import { serverFontScaleWins } from "./logic/settings";
import { queueSettingsPatch } from "./settingsSync";
import { getFontScale, isFontScaleName, setFontScale } from "@/theme";
import { preferences } from "@/platform";
import { sessionStore } from "@/session";

export const FONT_SCALE_STORAGE_KEY = "mvc.settings.fontScale";

let hydrated: Promise<void> | null = null;

/** Lee el tamaño recordado en este móvil (una sola vez). Nunca lanza. */
export function hydrateFontScale(): Promise<void> {
  hydrated ??= (async () => {
    const stored = await preferences.get(FONT_SCALE_STORAGE_KEY);
    if (isFontScaleName(stored)) setFontScale(stored);
  })();
  return hydrated;
}

/** Aplica el tamaño ahora y lo recuerda en este móvil. No toca la cuenta. */
export function applyFontScaleLocally(scale: FontScale): void {
  setFontScale(scale);
  void preferences.set(FONT_SCALE_STORAGE_KEY, scale);
}

/** Cambio hecho por la persona: se aplica, se recuerda y (con sesión) se guarda en la cuenta. */
export function chooseFontScale(scale: FontScale, options: { saveToAccount: boolean }): void {
  applyFontScaleLocally(scale);
  if (options.saveToAccount) queueSettingsPatch({ fontScale: scale });
}

/** Tras entrar: trae los ajustes de la cuenta y decide quién manda. Silencioso si falla (sin red, servidor caído). */
async function syncFromAccount(): Promise<void> {
  await hydrateFontScale();
  const settings = await queryCache.fetch<UserSettings>(helpKeys.settings, ({ signal }) => getSettings({ signal }), { staleTimeMs: 60_000 });
  if (!settings) return;
  if (serverFontScaleWins(settings)) {
    if (settings.fontScale !== getFontScale()) applyFontScaleLocally(settings.fontScale);
  } else if (getFontScale() !== "normal") {
    queueSettingsPatch({ fontScale: getFontScale() });
  }
}

let started = false;
let lastToken: string | null = null;

/** Arranca la hidratación y la sincronización con la sesión. Idempotente. */
export function startFontScaleSync(): void {
  if (started) return;
  started = true;
  void hydrateFontScale();
  const check = (): void => {
    const { status, token } = sessionStore.getState();
    if (status !== "signedIn" || token === null) {
      lastToken = null;
      return;
    }
    if (token === lastToken) return;
    lastToken = token;
    void syncFromAccount();
  };
  sessionStore.subscribe(check);
  check();
}

startFontScaleSync();
