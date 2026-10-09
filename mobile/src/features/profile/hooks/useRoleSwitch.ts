/**
 * Cambio de modo (Pasajero ⇄ Conductor) y activación de un modo que la persona aún no tiene.
 *
 *  - Tiene el rol: se cambia el modo activo al instante (se guarda por usuario).
 *  - No lo tiene: se pide confirmación, se añade a su cuenta (`PUT /v1/me/roles`, lo registra `auth`), se relee `/me` y se
 *    pasa a ese modo. Los roles que ya tenía se conservan.
 *
 * El mismo flujo sirve para «Mi vehículo» y «Plaza disponible (semanal)», que exigen el modo conductor.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { describeError } from "@/api";
import type { Role } from "@/api/types";
import { selfServiceRoles, useAuth } from "@/session";
import { showToast } from "@/ui";
import { saveRoles } from "../api";
import { profileStrings } from "../strings";

const copy = profileStrings.myProfile;
const offerCopy = profileStrings.favorites.offer;

/** Por qué se pide activar el modo: tocar su tarjeta, abrir «Mi vehículo» o ofrecer plaza semanal. */
export type ActivationReason = "role" | "vehicle" | "offer";

interface PendingActivation {
  role: Role;
  reason: ActivationReason;
  onActivated: (() => void) | undefined;
}

export interface RoleActivationDialog {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  /** Guardando: los botones se bloquean. */
  loading: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface UseRoleSwitch {
  activeRole: Role | null;
  /** Roles de viajero que ya tiene la persona. */
  ownedRoles: readonly Role[];
  owns(role: Role): boolean;
  /** Toque en una tarjeta de modo: cambia de modo, o pide activar el que no tiene. */
  selectRole(role: Role): void;
  /** Pide activar un modo antes de seguir; `onActivated` se llama cuando ya está activo. Si ya lo tiene, se llama sin preguntar. */
  ensureRole(role: Role, reason: ActivationReason, onActivated?: () => void): void;
  /** Propiedades de `<ConfirmDialog/>` para el aviso de activación. */
  dialog: RoleActivationDialog;
}

function dialogCopy(reason: ActivationReason, role: Role): { title: string; message: string; confirm: string } {
  if (reason === "vehicle") return copy.activate.vehicle;
  if (reason === "offer") return { title: offerCopy.activateTitle, message: offerCopy.activateMessage, confirm: offerCopy.activateConfirm };
  return role === "driver" ? copy.activate.driver : copy.activate.passenger;
}

export function useRoleSwitch(): UseRoleSwitch {
  const { me, activeRole, setActiveRole, refreshMe } = useAuth();
  const [pending, setPending] = useState<PendingActivation | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  const ownedRoles = useMemo<readonly Role[]>(() => (me === null ? [] : selfServiceRoles(me.roles)), [me]);
  const owns = useCallback((role: Role): boolean => ownedRoles.includes(role), [ownedRoles]);

  const ensureRole = useCallback(
    (role: Role, reason: ActivationReason, onActivated?: () => void) => {
      if (ownedRoles.includes(role)) {
        onActivated?.();
        return;
      }
      setPending({ role, reason, onActivated });
    },
    [ownedRoles],
  );

  const selectRole = useCallback(
    (role: Role) => {
      if (ownedRoles.includes(role)) {
        if (activeRole === role) return;
        if (setActiveRole(role)) showToast({ kind: "success", message: copy.roleSwitched(role), id: "profile.role-switch" });
        return;
      }
      setPending({ role, reason: "role", onActivated: undefined });
    },
    [ownedRoles, activeRole, setActiveRole],
  );

  const confirm = useCallback(async (): Promise<void> => {
    if (pending === null || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const { role, onActivated } = pending;
    try {
      const roles = Array.from(new Set<Role>([...ownedRoles, role]));
      await saveRoles(roles);
      await refreshMe();
      setActiveRole(role);
      setPending(null);
      showToast({ kind: "success", message: copy.activate.done(role), id: "profile.role-activated" });
      onActivated?.();
    } catch (error) {
      setPending(null);
      showToast({ kind: "error", message: describeError(error).message, id: "profile.role-activated" });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, [pending, ownedRoles, refreshMe, setActiveRole]);

  const cancel = useCallback(() => {
    if (!busyRef.current) setPending(null);
  }, []);

  const dialog = useMemo<RoleActivationDialog>(() => {
    const texts = pending !== null ? dialogCopy(pending.reason, pending.role) : { title: "", message: "", confirm: "" };
    return {
      visible: pending !== null,
      title: texts.title,
      message: texts.message,
      confirmLabel: texts.confirm,
      loading: busy,
      onConfirm: () => void confirm(),
      onCancel: cancel,
    };
  }, [pending, busy, confirm, cancel]);

  return { activeRole: activeRole, ownedRoles, owns, selectRole, ensureRole, dialog };
}
