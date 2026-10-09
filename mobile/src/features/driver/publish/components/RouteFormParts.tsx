import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { Icon, type IconName } from "@/icons";
import { colors, radii } from "@/theme";
import { Text } from "@/ui";

export interface PlaceRowProps {
  icon: IconName;
  label: string;
  value: string;
  placeholder: string;
  error?: string | null;
  onPress: () => void;
  testID: string;
}

/** Fila «icono + Origen/Destino + campo blanco con chevron» de la lámina 18. */
export function PlaceRow({ icon, label, value, placeholder, error, onPress, testID }: PlaceRowProps): React.JSX.Element {
  const hasError = error !== undefined && error !== null && error !== "";
  return (
    <View style={styles.placeRow}>
      <View style={styles.placeIcon}>
        <View style={styles.placeDisc}>
          <Icon name={icon} size={28} color={colors.primary} />
        </View>
      </View>
      <View style={styles.placeBody}>
        <Text variant="rowTitle" color="deep" size={19.5} lineHeight={24} letterSpacing={-0.3}>
          {label}
        </Text>
        <Pressable
          testID={testID}
          accessibilityRole="button"
          accessibilityLabel={`${label}, ${value !== "" ? value : placeholder}`}
          onPress={onPress}
          style={({ pressed }) => [styles.field, hasError ? styles.fieldError : null, pressed ? styles.fieldPressed : null]}
        >
          <Text variant="lead" color={value !== "" ? "strong" : "placeholder"} size={18} lineHeight={22} letterSpacing={-0.3} numberOfLines={1} style={styles.fieldText}>
            {value !== "" ? value : placeholder}
          </Text>
          <Icon name="chevronRight" size={24} color={colors.primary} />
        </Pressable>
        {hasError ? (
          <Text variant="caption" color="error" size={14} lineHeight={18} accessibilityRole="alert" style={styles.error} testID={`${testID}.error`}>
            {error}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

export interface SelectBoxProps {
  value: string;
  label: string;
  onPress: () => void;
  testID: string;
}

/** Campo blanco con chevron suelto («5 min ›»). */
export function SelectBox({ value, label, onPress, testID }: SelectBoxProps): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${value}`}
      onPress={onPress}
      style={({ pressed }) => [styles.box, pressed ? styles.fieldPressed : null]}
    >
      <Text variant="rowTitle" color="strong" size={19.5} lineHeight={24} letterSpacing={-0.3} style={styles.fieldText}>
        {value}
      </Text>
      <Icon name="chevronRight" size={26} color={colors.primary} />
    </Pressable>
  );
}

export interface TimeCardProps {
  /** Partes del título: «Ida» y «(hacia Sevilla)». */
  strong: string;
  light: string;
  value: string | null;
  placeholder: string;
  error?: string | null;
  onPress: () => void;
  testID: string;
}

/** Tarjeta blanca «Ida (hacia Sevilla) 07:00 ›» / «Vuelta (desde Sevilla) 15:00 ›». */
export function TimeCard({ strong, light, value, placeholder, error, onPress, testID }: TimeCardProps): React.JSX.Element {
  const hasError = error !== undefined && error !== null && error !== "";
  return (
    <View style={styles.timeWrap}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${strong} ${light}, ${value ?? placeholder}`}
        onPress={onPress}
        style={({ pressed }) => [styles.timeCard, hasError ? styles.fieldError : null, pressed ? styles.fieldPressed : null]}
      >
        <Text variant="rowTitle" color="deep" size={15} lineHeight={19} letterSpacing={-0.3} numberOfLines={2}>
          {strong}
          <Text variant="body" color="deep" size={15} lineHeight={19} letterSpacing={-0.3}>{light !== "" ? ` ${light}` : ""}</Text>
        </Text>
        <View style={styles.timeLine}>
          <Text variant="kpi" color={value !== null ? "strong" : "placeholder"} size={value !== null ? 24 : 18} lineHeight={30} letterSpacing={-0.4} style={styles.timeValue}>
            {value ?? placeholder}
          </Text>
          <Icon name="chevronRight" size={28} color={colors.primary} />
        </View>
      </Pressable>
      {hasError ? (
        <Text variant="caption" color="error" size={14} lineHeight={18} accessibilityRole="alert" style={styles.error} testID={`${testID}.error`}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  placeRow: { flexDirection: "row", alignItems: "flex-start", marginVertical: 3 },
  placeIcon: { width: 56, height: 46, alignItems: "center", justifyContent: "center", marginTop: 6 },
  placeDisc: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.bg.white, alignItems: "center", justifyContent: "center" },
  placeBody: { flex: 1, paddingRight: 4 },
  field: {
    height: 30,
    marginTop: 1,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.bg.white,
    borderRadius: radii.md,
    paddingLeft: 10.5,
    paddingRight: 6,
    borderWidth: 1,
    borderColor: "transparent",
  },
  box: { height: 46, flexDirection: "row", alignItems: "center", backgroundColor: colors.bg.white, borderRadius: radii.md, paddingLeft: 12, paddingRight: 6 },
  fieldPressed: { backgroundColor: colors.bg.tintSoft },
  fieldError: { borderColor: colors.error.solid },
  fieldText: { flex: 1 },
  error: { marginTop: 3 },
  timeWrap: { flex: 1 },
  timeCard: {
    minHeight: 62,
    backgroundColor: colors.bg.white,
    borderRadius: radii.lg,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
  timeLine: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  timeValue: { flex: 1 },
});

export interface FrequencyToggleProps {
  value: "daily_workdays" | "one_off";
  dailyLabel: string;
  oneOffLabel: string;
  groupLabel: string;
  onChange: (value: "daily_workdays" | "one_off") => void;
  testID: string;
}

/** «Diaria (laborables) | Puntual» de la lámina 18: la opción activa en azul pleno, la otra con borde; la diaria es más ancha. */
export function FrequencyToggle({ value, dailyLabel, oneOffLabel, groupLabel, onChange, testID }: FrequencyToggleProps): React.JSX.Element {
  const daily = value === "daily_workdays";
  return (
    <View accessibilityRole="tablist" accessibilityLabel={groupLabel} style={freq.row} testID={testID}>
      <Pressable
        testID={`${testID}.daily`}
        accessibilityRole="tab"
        accessibilityState={{ selected: daily }}
        accessibilityLabel={dailyLabel}
        onPress={() => onChange("daily_workdays")}
        style={[freq.daily, daily ? freq.on : freq.off]}
      >
        <Icon name="clock" size={26} color={daily ? colors.onPrimary : colors.primary} />
        <Text variant="rowTitle" color={daily ? colors.onPrimary : colors.heading} size={17} lineHeight={21} letterSpacing={-0.3} style={freq.label} numberOfLines={1}>
          {dailyLabel}
        </Text>
      </Pressable>
      <Pressable
        testID={`${testID}.oneOff`}
        accessibilityRole="tab"
        accessibilityState={{ selected: !daily }}
        accessibilityLabel={oneOffLabel}
        onPress={() => onChange("one_off")}
        style={[freq.oneOff, !daily ? freq.on : freq.off]}
      >
        <Text variant="rowTitle" color={!daily ? colors.onPrimary : colors.heading} size={17} lineHeight={21} letterSpacing={-0.3} numberOfLines={1}>
          {oneOffLabel}
        </Text>
      </Pressable>
    </View>
  );
}

const freq = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "stretch" },
  daily: { flex: 1.45, height: 48, borderRadius: radii.md, borderWidth: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", paddingHorizontal: 8 },
  oneOff: { flex: 1, height: 48, borderRadius: radii.md, borderWidth: 1, alignItems: "center", justifyContent: "center", marginLeft: 8 },
  on: { backgroundColor: colors.primary, borderColor: colors.primary },
  off: { backgroundColor: colors.bg.white, borderColor: colors.border.default },
  label: { marginLeft: 8, flexShrink: 1 },
});
