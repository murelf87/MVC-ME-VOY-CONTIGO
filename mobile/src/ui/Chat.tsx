import React from "react";
import {
  Image,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type ImageSourcePropType,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { Icon, IconTile } from "@/icons";
import { colors, fontFamilies, radii } from "@/theme";
import { strings } from "@/i18n";
import { IconButton } from "./IconButton";
import { Text } from "./Text";

/** Estado de entrega de un mensaje propio. */
export type MessageDeliveryStatus = "pending" | "sent" | "delivered" | "read" | "failed";

const statusWords: Record<MessageDeliveryStatus, string> = {
  pending: "enviando",
  sent: "enviado",
  delivered: "entregado",
  read: "leído",
  failed: "no enviado",
};

function StatusMark({ status }: { status: MessageDeliveryStatus }): React.JSX.Element {
  switch (status) {
    case "pending":
      return <Icon name="clock" size={15} color={colors.text.inverseSoft} />;
    case "sent":
      return <Icon name="check" size={17} color={colors.onPrimary} />;
    case "delivered":
      return <Icon name="checkDouble" size={19} color={colors.text.inverseFaint} />;
    case "read":
      return <Icon name="checkDouble" size={19} color={colors.onPrimary} />;
    case "failed":
      return <Icon name="alertCircle" size={18} color={colors.onPrimary} />;
  }
}

export interface ChatBubbleProps {
  side: "incoming" | "outgoing";
  text: string;
  /** Hora ya formateada («07:18»). */
  time: string;
  /** Solo en mensajes propios. */
  status?: MessageDeliveryStatus;
  /** Foto del otro participante a la izquierda de un mensaje recibido (`<Avatar size="sm"/>`). */
  avatar?: React.ReactNode;
  /** Reintento de un mensaje `failed`. */
  onRetry?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Burbuja de chat (26): recibida gris con hora a la derecha; enviada azul con hora y doble visto. */
export function ChatBubble({ side, text, time, status, avatar, onRetry, testID, style }: ChatBubbleProps): React.JSX.Element {
  const outgoing = side === "outgoing";
  const label = outgoing
    ? `Tú: ${text}, ${time}${status !== undefined ? `, ${statusWords[status]}` : ""}`
    : `${text}, ${time}`;
  return (
    <View style={[styles.line, outgoing ? styles.lineOut : styles.lineIn, style]}>
      {!outgoing && avatar !== undefined ? <View style={styles.avatar}>{avatar}</View> : null}
      <View style={styles.column}>
        <View
          testID={testID}
          accessible
          accessibilityLabel={label}
          style={[styles.bubble, outgoing ? styles.bubbleOut : styles.bubbleIn, status === "failed" ? styles.bubbleFailed : null]}
        >
          <Text variant="body" color={outgoing ? "inverse" : "strong"} size={18} lineHeight={22}>
            {text}
          </Text>
          <View style={styles.meta}>
            <Text variant="rowText" color={outgoing ? "inverse" : colors.text.time} size={15} lineHeight={18} style={outgoing ? styles.timeOut : null}>
              {time}
            </Text>
            {outgoing && status !== undefined ? <View style={styles.mark}><StatusMark status={status} /></View> : null}
          </View>
        </View>
        {status === "failed" && onRetry !== undefined ? (
          <Pressable accessibilityRole="button" accessibilityLabel={strings.common.retry} onPress={onRetry} hitSlop={8} style={styles.retry}>
            <Text variant="rowTextStrong" color="error" underline size={15}>
              {`No enviado · ${strings.common.retry}`}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export interface ChatLocationCardProps {
  /** Línea fuerte («Aparcamiento P1»). */
  title: string;
  /** Resto de líneas («Isla Mágica», «Sevilla»). */
  lines?: readonly string[];
  /** Miniatura estática del mapa; sin ella se dibuja un icono de ubicación. */
  thumbnail?: ImageSourcePropType;
  time: string;
  status?: MessageDeliveryStatus;
  onPress?: () => void;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Mensaje de ubicación compartida (26): miniatura del mapa + dirección + chevron. */
export function ChatLocationCard({ title, lines = [], thumbnail, time, status, onPress, testID, style }: ChatLocationCardProps): React.JSX.Element {
  const content = (
    <>
      <View style={styles.locRow}>
        {thumbnail !== undefined ? (
          <Image source={thumbnail} style={styles.thumb} accessibilityIgnoresInvertColors />
        ) : (
          <IconTile name="pin" tone="blue" size={92} shape="square" iconSize={44} style={styles.thumb} />
        )}
        <View style={styles.locText}>
          <Text variant="rowTitle" color="heading" size={18} lineHeight={21}>
            {title}
          </Text>
          {lines.map((line) => (
            <Text key={line} variant="rowTitle" color="heading" size={18} lineHeight={21}>
              {line}
            </Text>
          ))}
        </View>
        {onPress !== undefined ? <Icon name="chevronRight" size={24} color={colors.primary} /> : null}
      </View>
      <View style={styles.locMeta}>
        <Text variant="rowText" color={colors.text.time} size={15} lineHeight={18}>
          {time}
        </Text>
        {status !== undefined ? (
          <View style={styles.mark}>
            <Icon name={status === "read" || status === "delivered" ? "checkDouble" : "check"} size={19} color={status === "read" ? colors.primary : colors.text.time} />
          </View>
        ) : null}
      </View>
    </>
  );
  const base: ViewStyle = { backgroundColor: colors.bg.tint, borderRadius: 20, padding: 10 };
  if (onPress === undefined) {
    return (
      <View testID={testID} style={[base, style]}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, ...lines, time].join(", ")}
      onPress={onPress}
      style={({ pressed }) => [base, pressed ? { opacity: 0.85 } : null, style]}
    >
      {content}
    </Pressable>
  );
}

export interface MessageComposerProps {
  value: string;
  onChangeText: (text: string) => void;
  onSend: () => void;
  /** Clip de adjuntar (a la izquierda). Sin handler no se dibuja. */
  onAttach?: () => void;
  /** Micrófono dentro del campo (dictado). Sin handler no se dibuja. */
  onDictate?: () => void;
  /** Con el campo vacío, el botón azul es el micrófono de nota de voz. Sin handler el botón queda desactivado. */
  onVoice?: () => void;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  sending?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

/** Barra de redacción (26): clip, campo redondeado con micrófono y botón azul (micrófono/enviar). */
export function MessageComposer({
  value,
  onChangeText,
  onSend,
  onAttach,
  onDictate,
  onVoice,
  placeholder = "Escribe un mensaje…",
  maxLength = 1000,
  disabled = false,
  sending = false,
  testID = "MessageComposer",
  style,
}: MessageComposerProps): React.JSX.Element {
  const canSend = value.trim().length > 0 && !disabled && !sending;
  const voiceMode = value.trim().length === 0 && onVoice !== undefined;
  const actionDisabled = voiceMode ? disabled : !canSend;
  return (
    <View style={[styles.composer, style]}>
      {onAttach !== undefined ? (
        <IconButton
          icon="attach"
          accessibilityLabel="Adjuntar"
          size={44}
          iconSize={30}
          color={colors.gray.help}
          onPress={onAttach}
          disabled={disabled}
          testID={`${testID}.attach`}
        />
      ) : null}
      <View style={[styles.field, disabled ? styles.fieldDisabled : null]}>
        <TextInput
          testID={`${testID}.input`}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.text.placeholder}
          editable={!disabled}
          multiline
          maxLength={maxLength}
          accessibilityLabel={placeholder}
          style={styles.input}
        />
        {onDictate !== undefined ? (
          <IconButton
            icon="mic"
            accessibilityLabel="Dictar"
            size={40}
            iconSize={26}
            color={colors.nav.iconInactive}
            onPress={onDictate}
            disabled={disabled}
            testID={`${testID}.dictate`}
          />
        ) : null}
      </View>
      <Pressable
        testID={`${testID}.send`}
        accessibilityRole="button"
        accessibilityLabel={voiceMode ? "Grabar nota de voz" : strings.common.send}
        accessibilityState={{ disabled: actionDisabled, busy: sending }}
        disabled={actionDisabled}
        onPress={voiceMode ? onVoice : onSend}
        style={({ pressed }) => [
          styles.action,
          { backgroundColor: actionDisabled ? colors.primaryDisabled : pressed ? colors.primaryPressed : colors.primary },
        ]}
      >
        <Icon name={voiceMode ? "mic" : "send"} size={26} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: "row", alignItems: "flex-end" },
  lineIn: { justifyContent: "flex-start", paddingRight: 36 },
  lineOut: { justifyContent: "flex-end", paddingLeft: 56 },
  avatar: { marginRight: 10 },
  column: { flexShrink: 1 },
  bubble: { borderRadius: 20, paddingTop: 10, paddingBottom: 8, paddingHorizontal: 14 },
  bubbleIn: { backgroundColor: colors.bg.bubble, borderBottomLeftRadius: 20 },
  bubbleOut: { backgroundColor: colors.primary, borderBottomRightRadius: 20 },
  bubbleFailed: { backgroundColor: colors.error.solid },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 2 },
  timeOut: { opacity: 0.95 },
  mark: { marginLeft: 6 },
  retry: { alignSelf: "flex-end", marginTop: 4, minHeight: 28, justifyContent: "center" },
  locRow: { flexDirection: "row", alignItems: "center" },
  thumb: { width: 110, height: 80, borderRadius: radii.md, overflow: "hidden", marginRight: 14 },
  locText: { flex: 1 },
  locMeta: { flexDirection: "row", alignItems: "center", justifyContent: "flex-end", marginTop: 4 },
  composer: { flexDirection: "row", alignItems: "center" },
  field: {
    flex: 1,
    minHeight: 48,
    marginHorizontal: 8,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.white,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    borderRadius: 26,
    paddingLeft: 16,
    paddingRight: 4,
  },
  fieldDisabled: { backgroundColor: colors.bg.disabled },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingVertical: 10,
    fontFamily: fontFamilies.regular,
    fontSize: 18,
    color: colors.text.strong,
  },
  action: { width: 48, height: 48, borderRadius: radii.lg + 2, alignItems: "center", justifyContent: "center" },
});
