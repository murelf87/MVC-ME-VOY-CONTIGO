import React, { useCallback, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { AccessibilityInfo, Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconTile, type IconName, type IconTileTone } from "@/icons";
import { colors, radii, shadows } from "@/theme";
import { Text } from "./Text";
import { useReducedMotion } from "./useReducedMotion";

export type ToastKind = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  message: string;
  title?: string;
  kind?: ToastKind;
  /** Milisegundos visible; `0` = hasta que se cierre (por defecto 4000, errores 6000). */
  durationMs?: number;
  actionLabel?: string;
  onAction?: () => void;
  /** Identificador estable: un `showToast` con el mismo `id` sustituye al anterior en vez de apilarse. */
  id?: string;
  testID?: string;
}

interface ToastItem {
  id: string;
  kind: ToastKind;
  title?: string;
  message: string;
  durationMs: number;
  actionLabel?: string;
  onAction?: () => void;
  testID?: string;
}

// ── Almacén global (sin Provider): `showToast()` puede llamarse desde cualquier sitio, también fuera de React ───────────

const MAX_QUEUED = 3;
let sequence = 0;
let current: ToastItem | null = null;
let queued: ToastItem[] = [];
/** Anfitriones montados, por orden de montaje: solo el primero dibuja (así no se duplican los avisos). */
let hosts: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getCurrent(): ToastItem | null {
  return current;
}

function getActiveHost(): string | null {
  return hosts[0] ?? null;
}

function advance(): void {
  current = queued.shift() ?? null;
}

/** Muestra un aviso breve. Devuelve su `id`. Con varios avisos seguidos se encolan (máx. 3) y se muestran de uno en uno. */
export function showToast(input: string | ToastOptions): string {
  const options: ToastOptions = typeof input === "string" ? { message: input } : input;
  const kind = options.kind ?? "info";
  sequence += 1;
  const item: ToastItem = {
    id: options.id ?? `toast-${sequence}`,
    kind,
    title: options.title,
    message: options.message,
    durationMs: options.durationMs ?? (kind === "error" ? 6000 : 4000),
    actionLabel: options.actionLabel,
    onAction: options.onAction,
    testID: options.testID,
  };
  if (current !== null && current.id === item.id) {
    current = item;
  } else if (current === null) {
    current = item;
  } else {
    const at = queued.findIndex((q) => q.id === item.id);
    if (at >= 0) {
      queued[at] = item;
    } else {
      queued = [...queued, item].slice(-MAX_QUEUED);
    }
  }
  emit();
  return item.id;
}

/** Cierra el aviso `id` (o el visible si no se indica) y muestra el siguiente de la cola. */
export function hideToast(id?: string): void {
  if (id === undefined || (current !== null && current.id === id)) {
    advance();
  } else {
    queued = queued.filter((q) => q.id !== id);
  }
  emit();
}

// ── Presentación ─────────────────────────────────────────────────────────────────────────────────────────────────────

const kindSpec: Record<ToastKind, { tone: IconTileTone; icon: IconName; border: string }> = {
  info: { tone: "solidBlue", icon: "infoMark", border: colors.border.default },
  success: { tone: "solidGreen", icon: "check", border: colors.success.border },
  warning: { tone: "solidOrange", icon: "exclaim", border: colors.warning.border },
  error: { tone: "solidRed", icon: "exclaim", border: colors.error.borderSoft },
};

const useNativeDriver = Platform.OS !== "web";

function ToastView({ item, topInset }: { item: ToastItem; topInset: number }): React.JSX.Element {
  const reduced = useReducedMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const closing = useRef(false);

  const dismiss = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    Animated.timing(progress, {
      toValue: 0,
      duration: reduced ? 0 : 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver,
    }).start(() => hideToast(item.id));
  }, [item.id, progress, reduced]);

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: reduced ? 0 : 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver,
    }).start();
  }, [progress, reduced]);

  useEffect(() => {
    if (Platform.OS === "ios") {
      AccessibilityInfo.announceForAccessibility([item.title, item.message].filter(Boolean).join(". "));
    }
  }, [item.title, item.message]);

  useEffect(() => {
    if (item.durationMs <= 0) return undefined;
    const timer = setTimeout(dismiss, item.durationMs);
    return () => clearTimeout(timer);
  }, [item.durationMs, dismiss]);

  const spec = kindSpec[item.kind];
  const translateY = progress.interpolate({ inputRange: [0, 1], outputRange: [-24, 0] });
  const label = [item.title, item.message].filter(Boolean).join(". ");
  return (
    <Animated.View
      pointerEvents="box-none"
      style={[styles.wrap, { top: topInset + 8, opacity: progress, transform: [{ translateY }] }]}
    >
      <Pressable
        testID={item.testID ?? "Toast"}
        accessibilityRole="alert"
        accessibilityLiveRegion={item.kind === "error" ? "assertive" : "polite"}
        accessibilityLabel={label}
        accessibilityHint="Toca para cerrar"
        onPress={dismiss}
        style={[styles.card, { borderColor: spec.border }]}
      >
        <IconTile name={spec.icon} tone={spec.tone} size={32} iconSize={20} />
        <View style={styles.text}>
          {item.title !== undefined ? (
            <Text variant="rowTitle" color="strong" size={16.5}>
              {item.title}
            </Text>
          ) : null}
          <Text variant="body" color="body" size={16} lineHeight={20}>
            {item.message}
          </Text>
        </View>
        {item.actionLabel !== undefined && item.onAction !== undefined ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.actionLabel}
            hitSlop={8}
            onPress={() => {
              item.onAction?.();
              dismiss();
            }}
            style={styles.action}
          >
            <Text variant="rowTextStrong" color="link" underline size={16}>
              {item.actionLabel}
            </Text>
          </Pressable>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

export interface ToastHostProps {
  /** Margen extra bajo el margen seguro superior (pt). */
  topOffset?: number;
}

/**
 * Monta UNA vez en la raíz de la app (dentro de `SafeAreaProvider`, por encima de la navegación). Dibuja el aviso actual de
 * `showToast()`. Sin Provider: el almacén es global. Si por error hay varios anfitriones montados, solo dibuja el primero.
 */
export function ToastHost({ topOffset = 0 }: ToastHostProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const id = useId();
  useEffect(() => {
    hosts = [...hosts, id];
    emit();
    return () => {
      hosts = hosts.filter((host) => host !== id);
      emit();
    };
  }, [id]);
  const activeHost = useSyncExternalStore(subscribe, getActiveHost, getActiveHost);
  const item = useSyncExternalStore(subscribe, getCurrent, getCurrent);
  if (item === null || activeHost !== id) return null;
  return <ToastView key={item.id} item={item} topInset={insets.top + topOffset} />;
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: 16, right: 16, alignItems: "center", zIndex: 1000 },
  card: {
    width: "100%",
    maxWidth: 520,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.white,
    borderRadius: radii.lg,
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    boxShadow: shadows.float,
  },
  text: { flex: 1, marginLeft: 12 },
  action: { marginLeft: 12, minHeight: 36, justifyContent: "center" },
});
