import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { Page, SupportTripOption } from "@/api/types";
import { Icon } from "@/icons";
import type { UseApiQueryResult } from "@/hooks";
import { colors, radii } from "@/theme";
import { BottomSheet, Radio, SkeletonList, Spinner, Text } from "@/ui";
import { describeTripOption, tripRoleLabel } from "../logic/support";
import { helpStrings } from "../strings";
import { LoadError } from "./StateCards";

export interface TripSelectProps {
  /** Texto del viaje elegido (`Vie, 16 may · Sevilla → Camas`) o `null` si no hay ninguno. */
  label: string | null;
  loading: boolean;
  disabled?: boolean;
  onPress: () => void;
  testID?: string;
}

/**
 * Selector «Selecciona un viaje (opcional)» (36b): coche, viaje elegido y chevron. Mide 53,5 pt, con el contorno azul
 * claro de los campos.
 */
export function TripSelect({ label, loading, disabled = false, onPress, testID = "TripSelect" }: TripSelectProps): React.JSX.Element {
  const hasValue = label !== null;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={`${helpStrings.help.tripLabel}: ${hasValue ? label : helpStrings.help.tripPlaceholder}`}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.frame, { backgroundColor: pressed ? colors.bg.tintSoft : colors.bg.white }]}
    >
      <View style={styles.leading}>
        <Icon name="car" size={37} color={hasValue ? colors.text.link : colors.icon.field} />
      </View>
      <Text
        variant="rowTitle"
        color={hasValue ? "heading" : "placeholder"}
        weight={hasValue ? "semibold" : "regular"}
        size={18.5}
        lineHeight={24}
        numberOfLines={1}
        style={styles.value}
      >
        {hasValue ? label : helpStrings.help.tripPlaceholder}
      </Text>
      <View style={styles.trailing}>{loading ? <Spinner size="sm" /> : <Icon name="chevronDown" size={24.5} color={colors.heading} />}</View>
    </Pressable>
  );
}

export interface TripSheetProps {
  visible: boolean;
  trips: UseApiQueryResult<Page<SupportTripOption>>;
  selectedTripId: string | null;
  onSelect: (tripId: string | null) => void;
  onClose: () => void;
}

/** Hoja con los viajes en los que la persona ha participado, del más reciente al más antiguo, y la opción «Sin viaje». */
export function TripSheet({ visible, trips, selectedTripId, onSelect, onClose }: TripSheetProps): React.JSX.Element {
  const items = trips.data?.items ?? [];
  const failed = trips.data === undefined && (trips.isError || trips.isOffline);
  const loading = trips.data === undefined && !failed;
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={helpStrings.help.tripSheetTitle}
      subtitle={helpStrings.help.tripSheetSubtitle}
      testID="TripSheet"
    >
      <View accessibilityRole="radiogroup">
        <Option
          testID="TripSheet.option.none"
          title={helpStrings.help.tripNone}
          description={helpStrings.help.tripNoneDescription}
          selected={selectedTripId === null}
          onPress={() => onSelect(null)}
        />
        {loading ? <SkeletonList count={3} variant="card" /> : null}
        {failed ? (
          <LoadError
            testID="TripSheet.error"
            offline={trips.isOffline}
            message={helpStrings.help.tripLoadError}
            onRetry={() => void trips.refetch()}
          />
        ) : null}
        {!loading && !failed && items.length === 0 ? (
          <View style={styles.empty} accessible accessibilityLabel={`${helpStrings.help.tripEmptyTitle}. ${helpStrings.help.tripEmptyMessage}`}>
            <Text variant="rowTitle" color="heading" size={17}>
              {helpStrings.help.tripEmptyTitle}
            </Text>
            <Text variant="body" color="muted" size={15.5} lineHeight={20}>
              {helpStrings.help.tripEmptyMessage}
            </Text>
          </View>
        ) : null}
        {items.map((trip) => (
          <Option
            key={trip.tripId}
            testID={`TripSheet.option.${trip.tripId}`}
            title={describeTripOption(trip)}
            description={tripRoleLabel(trip.role)}
            selected={selectedTripId === trip.tripId}
            onPress={() => onSelect(trip.tripId)}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

function Option({
  title,
  description,
  selected,
  onPress,
  testID,
}: {
  title: string;
  description: string;
  selected: boolean;
  onPress: () => void;
  testID: string;
}): React.JSX.Element {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityLabel={`${title}. ${description}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [styles.option, { backgroundColor: selected || pressed ? colors.bg.tintStrong : colors.bg.tint }]}
    >
      <Radio selected={selected} look="strong" />
      <View style={styles.optionText}>
        <Text variant="rowTitle" color="heading" size={17.5} lineHeight={22} numberOfLines={2}>
          {title}
        </Text>
        <Text variant="body" color="muted" size={15} lineHeight={19}>
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    minHeight: 53.5,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.lg,
    borderWidth: 1.5,
    borderColor: colors.border.default,
    paddingLeft: 15.5,
    paddingRight: 12,
  },
  leading: { width: 37, alignItems: "center", justifyContent: "center" },
  value: { flex: 1, marginLeft: 18.5 },
  trailing: { marginLeft: 8, minWidth: 24, alignItems: "center", justifyContent: "center" },
  option: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radii.lg,
    paddingVertical: 10,
    paddingHorizontal: 16,
    marginTop: 8,
  },
  optionText: { flex: 1, marginLeft: 14 },
  empty: { marginTop: 12, paddingHorizontal: 4 },
});
