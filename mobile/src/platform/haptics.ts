/** Respuesta háptica. Nunca lanza ni espera: si el dispositivo no vibra (o la persona lo desactivó), no hace nada. */
import * as Haptics from "expo-haptics";

let enabled = true;

/** Para el ajuste «Vibración» (si algún día se ofrece). Por defecto activado. */
export function setHapticsEnabled(value: boolean): void {
  enabled = value;
}

function fire(run: () => Promise<void>): void {
  if (!enabled) return;
  try {
    void run().catch(() => undefined);
  } catch {
    // sin háptica en este dispositivo
  }
}

/** Cambio de selección (segmented, picker). */
export function hapticSelection(): void {
  fire(() => Haptics.selectionAsync());
}

export function hapticImpact(style: "light" | "medium" | "heavy" = "light"): void {
  const map = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  } as const;
  fire(() => Haptics.impactAsync(map[style]));
}

export function hapticSuccess(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
}

export function hapticWarning(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
}

export function hapticError(): void {
  fire(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error));
}
