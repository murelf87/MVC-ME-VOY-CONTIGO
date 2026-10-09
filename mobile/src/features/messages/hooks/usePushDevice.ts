/**
 * Este móvil y los avisos fuera de la app: permiso del sistema, token push y registro en el servidor.
 * El servidor decide si el envío está disponible (`push.available`); aquí solo se prepara el dispositivo. Nunca lanza.
 */
import React from "react";
import { Platform } from "react-native";
import type { PushTokenInfo } from "@/api/types";
import { useApiMutation, useApiQuery, type UseApiQueryResult } from "@/hooks";
import { getDeviceId, getNotificationPermission, openAppSettings, registerForPushToken, requestNotificationPermission, resolveDevicePlatform, type PermissionResult } from "@/platform";
import { deletePushToken, listPushTokens, registerPushToken } from "../api";
import { PUSH_TOKENS_KEY } from "./keys";

export type RegisterOutcome = "registered" | "permission_denied" | "permission_blocked" | "no_project_id" | "unavailable" | "failed";

export interface PushDevice {
  permission: PermissionResult | null;
  tokens: UseApiQueryResult<PushTokenInfo[]>;
  busy: boolean;
  /** Pide el permiso (si el sistema aún puede preguntar) y registra el móvil. */
  enable: () => Promise<RegisterOutcome>;
  /** Vuelve a leer el permiso (p. ej. tras volver de Ajustes). */
  recheck: () => Promise<void>;
  openSystemSettings: () => Promise<boolean>;
  /** Da de baja un móvil registrado. */
  remove: (tokenId: string) => Promise<boolean>;
}

export function usePushDevice(): PushDevice {
  const [permission, setPermission] = React.useState<PermissionResult | null>(null);
  const [busy, setBusy] = React.useState(false);
  const tokens = useApiQuery<PushTokenInfo[]>(PUSH_TOKENS_KEY, async ({ signal }) => (await listPushTokens({ limit: 20 }, { signal })).items, { staleTimeMs: 15_000 });
  const register = useApiMutation<PushTokenInfo, Parameters<typeof registerPushToken>[0]>((body, { signal }) => registerPushToken(body, { signal }), { invalidates: [PUSH_TOKENS_KEY] });
  const unregister = useApiMutation<void, string>((id, { signal }) => deletePushToken(id, { signal }), { invalidates: [PUSH_TOKENS_KEY] });

  const recheck = React.useCallback(async (): Promise<void> => {
    setPermission(await getNotificationPermission());
  }, []);
  React.useEffect(() => {
    void recheck();
  }, [recheck]);

  const enable = React.useCallback(async (): Promise<RegisterOutcome> => {
    setBusy(true);
    try {
      let current = await getNotificationPermission();
      if (current.status === "denied" && current.canAskAgain) current = await requestNotificationPermission();
      setPermission(current);
      if (current.status === "unavailable") return "unavailable";
      if (current.status === "blocked") return "permission_blocked";
      if (current.status !== "granted") return "permission_denied";
      const result = await registerForPushToken();
      if (result.status !== "registered") {
        if ("reason" in result) return result.reason === "no_project_id" ? "no_project_id" : "unavailable";
        return result.status;
      }
      const saved = await register.mutate({
        token: result.token,
        provider: result.provider,
        platform: resolveDevicePlatform(Platform.OS),
        deviceId: await getDeviceId(),
      });
      return saved ? "registered" : "failed";
    } finally {
      setBusy(false);
    }
  }, [register]);

  const remove = React.useCallback(
    async (tokenId: string): Promise<boolean> => {
      try {
        await unregister.mutateAsync(tokenId);
        return true;
      } catch {
        return false;
      }
    },
    [unregister],
  );

  return { permission, tokens, busy: busy || register.isPending || unregister.isPending, enable, recheck, openSystemSettings: openAppSettings, remove };
}
