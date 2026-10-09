import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, IconTile, type IconName, type IconTileTone } from "@/icons";
import { colors, radii, shadows } from "@/theme";
import { strings } from "@/i18n";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Radio } from "./Controls";
import { Text } from "./Text";
import { useReducedMotion } from "./useReducedMotion";

const useNativeDriver = Platform.OS !== "web";

/** Mantiene montado el `Modal` mientras dura la animación de salida y expone el progreso 0 → 1 de la entrada. */
function useModalPresence(visible: boolean, enterMs: number, exitMs: number): { mounted: boolean; progress: Animated.Value } {
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  useEffect(() => {
    if (visible) {
      setMounted(true);
      Animated.timing(progress, {
        toValue: 1,
        duration: reduced ? 0 : enterMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver,
      }).start();
      return;
    }
    Animated.timing(progress, {
      toValue: 0,
      duration: reduced ? 0 : exitMs,
      easing: Easing.in(Easing.cubic),
      useNativeDriver,
    }).start(({ finished }) => {
      if (finished) setMounted(false);
    });
  }, [visible, reduced, enterMs, exitMs, progress]);
  return { mounted, progress };
}

// ── BottomSheet ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children?: React.ReactNode;
  /** Zona fija bajo el contenido (botones de acción). */
  footer?: React.ReactNode;
  /** Permite cerrar tocando el fondo, arrastrando hacia abajo y con el botón «Atrás» de Android (por defecto sí). */
  dismissable?: boolean;
  /** Dibuja la «×» de la cabecera (por defecto sí). */
  showClose?: boolean;
  /** Contenido desplazable si no cabe (por defecto sí). */
  scroll?: boolean;
  testID?: string;
  contentStyle?: StyleProp<ViewStyle>;
}

/**
 * Hoja modal inferior. Se cierra con `onClose` (fondo, arrastre, «×» o «Atrás»); el padre decide el estado `visible`.
 * `testID` base: `BottomSheet` → `.backdrop`, `.close`.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  dismissable = true,
  showClose = true,
  scroll = true,
  testID = "BottomSheet",
  contentStyle,
}: BottomSheetProps): React.JSX.Element | null {
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { mounted, progress } = useModalPresence(visible, 280, 200);
  const dragY = useRef(new Animated.Value(0)).current;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissableRef = useRef(dismissable);
  dismissableRef.current = dismissable;

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) => dismissableRef.current && gesture.dy > 6 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        dragY.setValue(Math.max(0, gesture.dy));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dy > 90 || gesture.vy > 0.9) {
          closeRef.current();
          dragY.setValue(0);
        } else {
          Animated.spring(dragY, { toValue: 0, useNativeDriver }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(dragY, { toValue: 0, useNativeDriver }).start();
      },
    }),
  ).current;

  if (!mounted) return null;

  const slide = progress.interpolate({ inputRange: [0, 1], outputRange: [windowHeight, 0] });
  const hasHeader = title !== undefined || subtitle !== undefined;
  const body = scroll ? (
    <ScrollView
      bounces={false}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      style={styles.scroll}
      contentContainerStyle={[styles.bodyContent, contentStyle]}
    >
      {children}
    </ScrollView>
  ) : (
    <View style={[styles.bodyContent, contentStyle]}>{children}</View>
  );

  return (
    <Modal
      transparent
      visible
      animationType="none"
      statusBarTranslucent
      onRequestClose={dismissable ? onClose : undefined}
    >
      <View style={styles.fill} testID={testID} accessibilityViewIsModal>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
          <Pressable
            testID={`${testID}.backdrop`}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
            disabled={!dismissable}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            { maxHeight: Math.round(windowHeight * 0.9), paddingBottom: Math.max(insets.bottom, 16) },
            { transform: [{ translateY: Animated.add(slide, dragY) }] },
          ]}
        >
          <View {...pan.panHandlers} style={styles.grabber}>
            <View style={styles.handle} />
            {hasHeader ? (
              <View style={styles.header}>
                <View style={styles.headerText}>
                  {title !== undefined ? (
                    <Text variant="title" color="heading" accessibilityRole="header" size={22} lineHeight={27}>
                      {title}
                    </Text>
                  ) : null}
                  {subtitle !== undefined ? (
                    <Text variant="body" color="muted" size={16.5} lineHeight={21}>
                      {subtitle}
                    </Text>
                  ) : null}
                </View>
                {showClose ? (
                  <IconButton
                    icon="close"
                    accessibilityLabel={strings.common.close}
                    size={44}
                    iconSize={26}
                    onPress={onClose}
                    testID={`${testID}.close`}
                  />
                ) : null}
              </View>
            ) : null}
          </View>
          {body}
          {footer !== undefined ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ── Dialog / ConfirmDialog ─────────────────────────────────────────────────────────────────────────────────────────

export interface DialogProps {
  visible: boolean;
  /** Se llama con el fondo y con «Atrás» de Android si `dismissable`. */
  onClose?: () => void;
  dismissable?: boolean;
  icon?: IconName;
  iconTone?: IconTileTone;
  title: string;
  message?: string;
  children?: React.ReactNode;
  /** Botones (apilados a todo el ancho). */
  actions?: React.ReactNode;
  testID?: string;
}

/** Diálogo centrado de bordes redondeados con título, texto y botones apilados. */
export function Dialog({
  visible,
  onClose,
  dismissable = true,
  icon,
  iconTone = "solidBlue",
  title,
  message,
  children,
  actions,
  testID = "Dialog",
}: DialogProps): React.JSX.Element | null {
  const { mounted, progress } = useModalPresence(visible, 200, 150);
  if (!mounted) return null;
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={dismissable ? onClose : undefined}>
      <View style={styles.centered} testID={testID} accessibilityViewIsModal>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity: progress }]}>
          <Pressable
            testID={`${testID}.backdrop`}
            accessibilityRole="button"
            accessibilityLabel={strings.common.close}
            disabled={!dismissable || onClose === undefined}
            onPress={onClose}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <Animated.View
          accessibilityRole={Platform.OS === "web" ? undefined : "alert"}
          style={[styles.dialog, { opacity: progress, transform: [{ scale }] }]}
        >
          {icon !== undefined ? <IconTile name={icon} tone={iconTone} size={56} iconSize={30} style={styles.dialogIcon} /> : null}
          <Text variant="title" color="heading" align="center" size={22} lineHeight={27} accessibilityRole="header">
            {title}
          </Text>
          {message !== undefined ? (
            <Text variant="body" color="body" align="center" size={17} lineHeight={22} style={styles.dialogMessage}>
              {message}
            </Text>
          ) : null}
          {children}
          {actions !== undefined ? <View style={styles.dialogActions}>{actions}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  );
}

export interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Acción destructiva (eliminar cuenta, cancelar reserva): botón rojo e icono de aviso. */
  destructive?: boolean;
  /** Bloquea los botones y muestra progreso en «confirmar» mientras se ejecuta la acción. */
  loading?: boolean;
  icon?: IconName;
  onConfirm: () => void;
  onCancel: () => void;
  testID?: string;
}

/** Confirmación con dos botones apilados: acción principal y «Cancelar» (contorno). */
export function ConfirmDialog({
  visible,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = strings.common.cancel,
  destructive = false,
  loading = false,
  icon,
  onConfirm,
  onCancel,
  testID = "ConfirmDialog",
}: ConfirmDialogProps): React.JSX.Element | null {
  return (
    <Dialog
      visible={visible}
      onClose={loading ? undefined : onCancel}
      dismissable={!loading}
      icon={icon ?? (destructive ? "exclaim" : "infoMark")}
      iconTone={destructive ? "solidRed" : "solidBlue"}
      title={title}
      message={message}
      testID={testID}
      actions={
        <>
          <Button
            label={confirmLabel}
            variant={destructive ? "danger" : "primary"}
            chevron={false}
            loading={loading}
            onPress={onConfirm}
            testID={`${testID}.confirm`}
          />
          <Button
            label={cancelLabel}
            variant="outline"
            chevron={false}
            disabled={loading}
            onPress={onCancel}
            testID={`${testID}.cancel`}
            style={styles.secondAction}
          />
        </>
      }
    />
  );
}

// ── OptionSheet ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface OptionSheetOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
}

export interface OptionSheetProps<T extends string> {
  visible: boolean;
  title?: string;
  options: readonly OptionSheetOption<T>[];
  /** Opción marcada (con radio). Sin `selected`, las filas son acciones (chevron). */
  selected?: T;
  onSelect: (value: T) => void;
  onClose: () => void;
  testID?: string;
}

/** Hoja con una lista de opciones: elegir provincia, ordenar, acciones de un ⋮ (compartir, denunciar…). */
export function OptionSheet<T extends string>({
  visible,
  title,
  options,
  selected,
  onSelect,
  onClose,
  testID = "OptionSheet",
}: OptionSheetProps<T>): React.JSX.Element | null {
  const choosing = selected !== undefined;
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} testID={testID}>
      <View accessibilityRole={choosing ? "radiogroup" : "menu"}>
        {options.map((option, index) => {
          const isSelected = choosing && option.value === selected;
          const tint = option.destructive === true ? colors.error.text : colors.heading;
          return (
            <Pressable
              key={option.value}
              testID={`${testID}.option.${option.value}`}
              accessibilityRole={choosing ? "radio" : "menuitem"}
              accessibilityLabel={[option.label, option.description].filter(Boolean).join(". ")}
              accessibilityState={{ selected: isSelected, disabled: option.disabled === true }}
              disabled={option.disabled === true}
              onPress={() => onSelect(option.value)}
              style={({ pressed }) => [
                styles.option,
                index > 0 ? styles.optionGap : null,
                { backgroundColor: isSelected || pressed ? colors.bg.tintStrong : colors.bg.tint },
                option.disabled === true ? styles.disabled : null,
              ]}
            >
              {choosing ? (
                <View style={styles.optionLead}>
                  <Radio selected={isSelected} />
                </View>
              ) : null}
              {option.icon !== undefined ? (
                <View style={styles.optionLead}>
                  <Icon name={option.icon} size={26} color={option.destructive === true ? colors.error.solid : colors.primary} />
                </View>
              ) : null}
              <View style={styles.optionText}>
                <Text variant="rowTitle" color={tint} size={18} lineHeight={22}>
                  {option.label}
                </Text>
                {option.description !== undefined ? (
                  <Text variant="body" color="muted" size={15.5} lineHeight={20}>
                    {option.description}
                  </Text>
                ) : null}
              </View>
              {!choosing ? <Icon name="chevronRight" size={24} color={option.destructive === true ? colors.error.solid : colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: colors.bg.overlay },
  sheet: {
    width: "100%",
    maxWidth: 640,
    alignSelf: "center",
    backgroundColor: colors.bg.white,
    borderTopLeftRadius: radii.xxl,
    borderTopRightRadius: radii.xxl,
    boxShadow: shadows.sheet,
  },
  grabber: { paddingTop: 8, paddingHorizontal: 20 },
  handle: { alignSelf: "center", width: 44, height: 5, borderRadius: 3, backgroundColor: colors.border.default, marginBottom: 8 },
  header: { flexDirection: "row", alignItems: "flex-start", paddingBottom: 8 },
  headerText: { flex: 1, paddingRight: 8, paddingTop: 6 },
  scroll: { flexGrow: 0 },
  bodyContent: { paddingHorizontal: 20, paddingTop: 4, paddingBottom: 8 },
  footer: { paddingHorizontal: 20, paddingTop: 8 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  dialog: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.bg.white,
    borderRadius: radii.xxl,
    paddingTop: 24,
    paddingBottom: 20,
    paddingHorizontal: 22,
    alignItems: "stretch",
    boxShadow: shadows.sheet,
  },
  dialogIcon: { alignSelf: "center", marginBottom: 14 },
  dialogMessage: { marginTop: 8 },
  dialogActions: { marginTop: 20 },
  secondAction: { marginTop: 10 },
  option: { minHeight: 60, flexDirection: "row", alignItems: "center", borderRadius: radii.lg, paddingVertical: 12, paddingHorizontal: 16 },
  optionGap: { marginTop: 8 },
  optionLead: { marginRight: 14 },
  optionText: { flex: 1 },
  disabled: { opacity: 0.5 },
});
