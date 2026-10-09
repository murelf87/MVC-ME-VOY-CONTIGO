import React, { useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import type { LivePickupCodeState } from "@/api/types";
import { describeError } from "@/api";
import { formatTime, strings } from "@/i18n";
import { Icon } from "@/icons";
import { colors } from "@/theme";
import { Button, Card, IconButton, showToast, Spinner, Text } from "@/ui";
import type { PickupCodeController } from "../hooks/usePickupCode";
import { spokenCode } from "../model/pickupCode";
import { liveStrings } from "../strings";
import { livePalette } from "./palette";

const copy = liveStrings.code;

export interface PickupCodeCardProps {
  controller: PickupCodeController;
  state: LivePickupCodeState;
  driverName: string;
  testID?: string;
}

/** Medidas de las casillas de la lámina 23 (4 casillas de 64 pt con 13,5 pt de hueco), escaladas para `count` dígitos. */
export function codeBoxMetrics(count: number, innerWidth: number): { size: number; gap: number; height: number; font: number } {
  const n = Math.max(1, count);
  const gap = n <= 4 ? 13.5 : 8;
  const raw = Math.floor((innerWidth - gap * (n - 1)) / n);
  const size = Math.max(34, Math.min(64, raw));
  return { size, gap, height: Math.round(size * 1.016), font: Math.round(size * 0.7) };
}

function CodeBoxes({ digits, testID }: { digits: readonly string[]; testID?: string }): React.JSX.Element {
  const [width, setWidth] = useState(336);
  const onLayout = (event: LayoutChangeEvent): void => {
    const next = Math.floor(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };
  const metrics = codeBoxMetrics(digits.length, width);
  return (
    <View onLayout={onLayout} style={[styles.boxes, { gap: metrics.gap }]} testID={testID}>
      {digits.map((digit, index) => (
        <View key={index} style={[styles.box, { width: metrics.size, height: metrics.height }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text variant="code" color="heading" size={metrics.font} lineHeight={Math.round(metrics.font * 1.1)}>
            {digit}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** Código de recogida de la lámina 23: «Díselo a Ana al subir» + casillas con los dígitos, copiable y con su estado. */
export function PickupCodeCard({ controller, state, driverName, testID }: PickupCodeCardProps): React.JSX.Element | null {
  const id = (suffix: string): string | undefined => (testID !== undefined ? `${testID}.${suffix}` : undefined);
  const { kind } = controller;

  if (kind === "hidden") return null;

  if (kind === "verified") {
    const time = state.verifiedAt === null ? null : formatTime(state.verifiedAt);
    return (
      <Card tone="green" radius={16} padding={16} testID={testID} style={styles.stateCard}>
        <View style={styles.stateRow} accessible accessibilityLabel={`${copy.verifiedTitle}. ${copy.verifiedMessage(time === "" ? null : time)}`}>
          <Icon name="checkCircle" size={34} color={colors.success.solid} />
          <View style={styles.stateTexts}>
            <Text variant="heading" weight="bold" color={colors.success.strong} size={19}>
              {copy.verifiedTitle}
            </Text>
            <Text variant="body" color={colors.success.text} size={16} lineHeight={21}>
              {copy.verifiedMessage(time === "" ? null : time)}
            </Text>
          </View>
        </View>
      </Card>
    );
  }

  if (kind === "notStarted") {
    return (
      <Card tone="blue" radius={16} padding={16} testID={testID} style={styles.stateCard}>
        <View style={styles.stateRow}>
          <Icon name="lock" size={28} color={colors.primary} />
          <View style={styles.stateTexts}>
            <Text variant="heading" weight="bold" color="heading" size={19}>
              {copy.title}
            </Text>
            <Text variant="body" color="deep" size={16} lineHeight={21}>
              {copy.notStartedMessage}
            </Text>
          </View>
        </View>
      </Card>
    );
  }

  if (kind === "lost" || kind === "locked") {
    const locked = kind === "locked";
    return (
      <Card tone={locked ? "amber" : "blue"} radius={16} padding={16} testID={testID} style={styles.stateCard}>
        <View style={styles.stateRow}>
          <Icon name={locked ? "warning" : "lock"} size={28} color={locked ? colors.warning.solid : colors.primary} />
          <View style={styles.stateTexts}>
            <Text variant="heading" weight="bold" color="heading" size={19}>
              {locked ? copy.lockedTitle : copy.lostTitle}
            </Text>
            <Text variant="body" color="deep" size={16} lineHeight={21}>
              {locked ? copy.lockedMessage : copy.lostMessage}
            </Text>
          </View>
        </View>
        <Button label={copy.generateNew} variant="primary" size="sm" chevron={false} onPress={controller.generate} style={styles.action} testID={id("generateNew")} />
      </Card>
    );
  }

  if (kind === "error") {
    const described = controller.error === null ? null : describeError(controller.error);
    return (
      <Card tone="red" radius={16} padding={16} testID={testID} style={styles.stateCard}>
        <View style={styles.stateRow}>
          <Icon name="exclaim" size={28} color={colors.error.solid} />
          <View style={styles.stateTexts}>
            <Text variant="heading" weight="bold" color={colors.error.strong} size={19}>
              {described?.title ?? copy.title}
            </Text>
            <Text variant="body" color={colors.error.text} size={16} lineHeight={21}>
              {described?.message ?? liveStrings.contact.callUnknown}
            </Text>
          </View>
        </View>
        {described === null || described.retryable ? (
          <Button label={strings.common.retry} variant="outline" size="sm" chevron={false} onPress={controller.generate} style={styles.action} testID={id("retry")} />
        ) : null}
      </Card>
    );
  }

  // ready | generating
  const ready = kind === "ready" && controller.plain !== null;
  return (
    <Card tone="blue" radius={16} padding={0} testID={testID} style={styles.card}>
      <Text variant="heading" weight="bold" color="heading" size={21.4} lineHeight={25} align="center">
        {copy.title}
      </Text>
      <Text variant="body" color="deep" size={17.2} lineHeight={21} align="center" style={styles.subtitle}>
        {controller.generating ? copy.generating : copy.subtitle(driverName)}
      </Text>
      <View
        style={styles.boxesWrap}
        accessible
        accessibilityLabel={ready && controller.plain !== null ? copy.a11y(spokenCode(controller.plain)) : copy.a11yHidden}
      >
        <CodeBoxes digits={controller.digits} testID={id("digits")} />
        {controller.generating ? (
          <View style={styles.spinner} pointerEvents="none">
            <Spinner />
          </View>
        ) : null}
      </View>
      {controller.attemptsLeft !== null && ready ? (
        <Text variant="rowText" color={colors.warning.text} size={14.5} align="center" style={styles.attempts} testID={id("attempts")}>
          {copy.attemptsLeft(controller.attemptsLeft)}
        </Text>
      ) : null}
      {ready ? (
        <IconButton
          icon="copy"
          variant="plain"
          size={44}
          iconSize={24}
          accessibilityLabel={copy.copy}
          onPress={() => {
            void controller.copy().then((ok) => showToast({ message: ok ? copy.copyDone : copy.copyFailed, kind: ok ? "success" : "error", id: "live-code-copy" }));
          }}
          style={styles.copy}
          testID={id("copy")}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { minHeight: 143, paddingTop: 10, paddingBottom: 14, paddingHorizontal: 16 },
  subtitle: { marginTop: -2 },
  boxesWrap: { marginTop: 10 },
  boxes: { flexDirection: "row", justifyContent: "center" },
  box: { borderRadius: 12, backgroundColor: livePalette.codeBox, alignItems: "center", justifyContent: "center" },
  spinner: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, alignItems: "center", justifyContent: "center" },
  attempts: { marginTop: 8 },
  copy: { position: "absolute", top: 2, right: 2 },
  stateCard: { alignSelf: "stretch" },
  stateRow: { flexDirection: "row", alignItems: "center" },
  stateTexts: { flex: 1, marginLeft: 14 },
  action: { marginTop: 14 },
});
