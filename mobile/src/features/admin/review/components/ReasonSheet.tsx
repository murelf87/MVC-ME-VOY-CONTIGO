/**
 * Hoja para decisiones que piden un motivo: «Rechazar a Ana» (texto obligatorio de 3 a 1.000 caracteres), «Pedir otra
 * captura» (motivo estándar obligatorio) o rechazar un elemento con motivo estándar opcional.
 *
 * Valida en el dispositivo con las mismas reglas que el servidor (`REVIEW_REASON_REQUIRED`, `REVIEW_REASON_CODE_INVALID`)
 * y deja el error del servidor visible dentro de la hoja si el intento falla. Mientras se guarda no se puede cerrar.
 */
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Banner, BottomSheet, Button, RadioRow, Text, TextArea } from "@/ui";
import { useKeyboardInset } from "../hooks/useKeyboardInset";
import { REASON_MAX, REASON_MIN } from "../logic/reviewQueue";
import { reviewStrings } from "../strings";

export interface ReasonOption {
  value: string;
  label: string;
}

export interface ReasonInput {
  /** Texto libre, ya recortado; cadena vacía si no hay. */
  reason: string;
  /** Motivo estándar elegido, o `null`. */
  reasonCode: string | null;
}

export interface ReasonSheetProps {
  visible: boolean;
  title: string;
  subtitle?: string;
  confirmLabel: string;
  tone: "danger" | "primary";
  busy: boolean;
  /** Error devuelto por el servidor tras el último intento. */
  errorMessage: string | null;
  /** Motivos estándar; sin ellos solo hay texto libre. */
  codeOptions?: readonly ReasonOption[];
  codeLabel?: string;
  /** Hay que elegir un motivo estándar (pedir otra captura). */
  codeRequired?: boolean;
  /** El texto libre es obligatorio (rechazar). Si no, es opcional. */
  textRequired: boolean;
  textLabel: string;
  textPlaceholder: string;
  textHelper: string;
  onConfirm: (input: ReasonInput) => void;
  onClose: () => void;
  testID: string;
}

export function ReasonSheet({
  visible,
  title,
  subtitle,
  confirmLabel,
  tone,
  busy,
  errorMessage,
  codeOptions,
  codeLabel,
  codeRequired = false,
  textRequired,
  textLabel,
  textPlaceholder,
  textHelper,
  onConfirm,
  onClose,
  testID,
}: ReasonSheetProps): React.JSX.Element {
  const [text, setText] = useState("");
  const [code, setCode] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const keyboard = useKeyboardInset(visible);

  // Cada vez que se abre, empieza en blanco.
  useEffect(() => {
    if (visible) {
      setText("");
      setCode(null);
      setAttempted(false);
    }
  }, [visible]);

  const trimmed = text.trim();
  let codeError: string | undefined;
  let textError: string | undefined;
  if (codeRequired && code === null) codeError = reviewStrings.dossier.retryReasonRequired;
  if (textRequired) {
    if (trimmed.length < REASON_MIN) textError = reviewStrings.users.rejectReasonTooShort;
  } else if (trimmed.length > 0 && trimmed.length < REASON_MIN) {
    textError = reviewStrings.users.rejectReasonTooShort;
  }
  if (trimmed.length > REASON_MAX) textError = reviewStrings.users.rejectReasonTooLong;

  const submit = useCallback(() => {
    setAttempted(true);
    if (codeError !== undefined || textError !== undefined) return;
    onConfirm({ reason: trimmed, reasonCode: code });
  }, [codeError, textError, onConfirm, trimmed, code]);

  const close = useCallback(() => {
    if (!busy) onClose();
  }, [busy, onClose]);

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      dismissable={!busy}
      showClose={!busy}
      title={title}
      subtitle={subtitle}
      testID={testID}
      contentStyle={keyboard > 0 ? { paddingBottom: keyboard } : undefined}
      footer={
        <View>
          <Button
            label={confirmLabel}
            variant={tone === "danger" ? "danger" : "primary"}
            chevron={false}
            loading={busy}
            onPress={submit}
            testID={`${testID}.confirm`}
          />
          <Button label={reviewStrings.common.cancel} variant="outline" chevron={false} disabled={busy} onPress={close} style={styles.cancel} testID={`${testID}.cancel`} />
        </View>
      }
    >
      {errorMessage !== null ? <Banner kind="error" size="sm" title={reviewStrings.users.errorTitle} message={errorMessage} style={styles.banner} testID={`${testID}.error`} /> : null}
      {codeOptions !== undefined && codeOptions.length > 0 ? (
        <View testID={`${testID}.codes`} accessibilityRole="radiogroup">
          {codeLabel !== undefined ? (
            <Text variant="rowTitle" color="heading" size={17} style={styles.label}>
              {codeLabel}
            </Text>
          ) : null}
          {codeOptions.map((option, index) => (
            <RadioRow
              key={option.value}
              label={option.label}
              selected={code === option.value}
              onSelect={() => setCode(code === option.value && !codeRequired ? null : option.value)}
              disabled={busy}
              style={index > 0 ? styles.radioGap : undefined}
              testID={`${testID}.code.${option.value}`}
            />
          ))}
          {attempted && codeError !== undefined ? (
            <Text variant="rowText" color="error" style={styles.fieldError} accessibilityLiveRegion="polite">
              {codeError}
            </Text>
          ) : null}
        </View>
      ) : null}
      <Text variant="rowTitle" color="heading" size={17} style={[styles.label, codeOptions !== undefined && codeOptions.length > 0 ? styles.labelGap : null]}>
        {textLabel}
      </Text>
      <TextArea
        value={text}
        onChangeText={setText}
        placeholder={textPlaceholder}
        maxLength={REASON_MAX}
        minHeight={104}
        disabled={busy}
        error={attempted ? textError : undefined}
        helper={textHelper}
        accessibilityLabel={textLabel}
        testID={`${testID}.text`}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  banner: { marginBottom: 12 },
  label: { marginBottom: 8 },
  labelGap: { marginTop: 16 },
  radioGap: { marginTop: 8 },
  fieldError: { marginTop: 6, paddingHorizontal: 6 },
  cancel: { marginTop: 10 },
});
