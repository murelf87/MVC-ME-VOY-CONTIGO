/**
 * Borrador del alta (en memoria, nunca en disco): lo que la persona va escribiendo entre «Elige tu perfil», «Tu cuenta» y
 * «Confirma tu móvil». Así «Cambiar número de móvil» vuelve al formulario con todo lo escrito y el código SMS puede
 * completar el alta (nombre, aceptación legal, foto) sin llevar datos personales en los parámetros de navegación.
 *
 * Almacén externo mínimo (`useSyncExternalStore`): sin dependencias. Se vacía al abrir sesión y al volver a Bienvenida.
 */
import { useSyncExternalStore } from "react";
import type { Role } from "@/api/types";

export interface DraftPhoto {
  uri: string;
  mimeType: string;
  /** Bytes; `null` si no se pudo medir. */
  sizeBytes: number | null;
}

/** Último código pedido: permite retomarlo si la persona vuelve atrás y pide otro para el mismo número sin esperar. */
export interface DraftChallenge {
  phoneE164: string;
  challengeId: string;
  expiresAt: string;
}

export interface RegistrationDraft {
  roles: Role[];
  givenName: string;
  familyName: string;
  /** Tal como se escribe: «612 345 678». */
  phone: string;
  provinceId: string | null;
  accepted: boolean;
  photo: DraftPhoto | null;
  lastChallenge: DraftChallenge | null;
}

const EMPTY: RegistrationDraft = {
  roles: [],
  givenName: "",
  familyName: "",
  phone: "",
  provinceId: null,
  accepted: false,
  photo: null,
  lastChallenge: null,
};

let state: RegistrationDraft = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

export const registrationDraft = {
  get(): RegistrationDraft {
    return state;
  },
  set(patch: Partial<RegistrationDraft>): void {
    state = { ...state, ...patch };
    emit();
  },
  reset(): void {
    if (state === EMPTY) return;
    state = EMPTY;
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useRegistrationDraft(): RegistrationDraft {
  return useSyncExternalStore(registrationDraft.subscribe, registrationDraft.get, registrationDraft.get);
}
