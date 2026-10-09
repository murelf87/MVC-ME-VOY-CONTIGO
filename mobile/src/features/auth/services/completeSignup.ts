/**
 * Lo que sigue a verificar el móvil en un ALTA nueva (en un inicio de sesión no hay borrador y no se hace nada).
 * Cada paso es independiente y se recuerda cuál ya se hizo: si uno falla, «Reintentar» solo repite los que faltan y la
 * persona puede «Entrar ahora» y terminarlos después (la app le pedirá lo que siga faltando: perfil, foto, aceptación).
 *
 *   profile  nombre visible        PATCH /v1/me/profile
 *   roles    pasajero / conductor  PUT   /v1/me/roles
 *   legal    Privacidad + Términos POST  /v1/me/legal/acceptances (versión vigente de cada documento de la cuenta)
 *   photo    foto de perfil        subida firmada → revisión humana
 *   province provincia elegida     preferencia local (la V1 solo tiene Sevilla)
 */
import { updateProfile } from "@/api";
import { preferences, setJson } from "@/platform";
import { acceptLegal, getLegalStatus, saveRoles, uploadProfilePhoto } from "../api";
import { acceptancePlan, missingAccountItems } from "../logic/legal";
import { composeDisplayName } from "../logic/registration";
import type { RegistrationDraft } from "../stores/registrationDraft";

export type SignupStep = "profile" | "roles" | "legal" | "photo" | "province";

export const SIGNUP_STEPS: readonly SignupStep[] = ["profile", "roles", "legal", "photo", "province"];
export const PROVINCE_PREFERENCE_KEY = "mvc.preferredProvinceId";

export interface SignupFailure {
  step: SignupStep;
  error: unknown;
}

/** ¿Es un alta con datos escritos en el formulario (y no un simple inicio de sesión)? */
export function isRegistration(draft: Pick<RegistrationDraft, "givenName" | "familyName">): boolean {
  return composeDisplayName(draft.givenName, draft.familyName) !== "";
}

/**
 * Ejecuta los pasos que faltan, en orden. Se detiene en el primer fallo y lo devuelve; `done` se va completando.
 * Un fallo de FOTO no impide el resto (la foto se puede subir después desde «Tu foto de perfil»).
 */
export async function completeSignup(input: {
  token: string;
  draft: RegistrationDraft;
  done: Set<SignupStep>;
  signal?: AbortSignal;
  onStep?: (step: SignupStep) => void;
}): Promise<SignupFailure | null> {
  const { token, draft, done, signal } = input;
  const base = signal !== undefined ? { token, signal } : { token };

  const run = async (step: SignupStep, action: () => Promise<void>): Promise<SignupFailure | null> => {
    if (done.has(step)) return null;
    input.onStep?.(step);
    try {
      await action();
      done.add(step);
      return null;
    } catch (error) {
      return { step, error };
    }
  };

  const profile = await run("profile", async () => {
    await updateProfile({ displayName: composeDisplayName(draft.givenName, draft.familyName) }, base);
  });
  if (profile !== null) return profile;

  const roles = await run("roles", async () => {
    await saveRoles(draft.roles.length > 0 ? draft.roles : ["passenger"], base);
  });
  if (roles !== null) return roles;

  const legal = await run("legal", async () => {
    const status = await getLegalStatus(base);
    for (const item of acceptancePlan(missingAccountItems(status))) {
      await acceptLegal({ kind: item.kind, version: item.version, context: "registration" }, base);
    }
  });
  if (legal !== null) return legal;

  if (draft.provinceId !== null) {
    const provinceId = draft.provinceId;
    const province = await run("province", async () => {
      await setJson(preferences, PROVINCE_PREFERENCE_KEY, provinceId);
    });
    if (province !== null) return province;
  } else {
    done.add("province");
  }

  const photo = draft.photo;
  if (photo !== null && photo.sizeBytes !== null) {
    const { uri, mimeType, sizeBytes } = photo;
    const failure = await run("photo", async () => {
      await uploadProfilePhoto({ uri, contentType: mimeType, sizeBytes }, base);
    });
    if (failure !== null) return failure;
  } else {
    done.add("photo");
  }
  return null;
}
