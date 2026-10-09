/**
 * «Mi acceso al panel»: hoja que abre el avatar de la cabecera. Dice quién eres, qué roles de personal tienes y qué
 * puedes hacer en cada área (lo que lee el servidor en `GET /v1/admin/me`), y lleva al inicio del panel.
 */
import React from "react";
import { StyleSheet, View } from "react-native";
import type { AdminMe, AdminPermission } from "@/api/types";
import { colors } from "@/theme";
import { BottomSheet, Button, Skeleton, StatusPill, Text, type StatusTone } from "@/ui";
import type { AdminErrorView } from "../logic/errors";
import { permissionLines, rolesText } from "../logic/permissions";
import { reviewStrings } from "../strings";

const a = reviewStrings.access;

const PERMISSION_TONE: Record<AdminPermission, StatusTone> = { none: "gray", read: "blue", write: "green" };

export interface StaffAccessSheetProps {
  visible: boolean;
  onClose: () => void;
  me: AdminMe | null;
  loading: boolean;
  error: AdminErrorView | null;
  onRetry: () => void;
  onGoHome: () => void;
}

export function StaffAccessSheet({ visible, onClose, me, loading, error, onRetry, onGoHome }: StaffAccessSheetProps): React.JSX.Element {
  const lines = permissionLines(me);
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={a.sheetTitle}
      subtitle={me?.displayName ?? undefined}
      testID="StaffAccessSheet"
      footer={<Button label={a.sheetHome} chevron={false} onPress={onGoHome} testID="StaffAccessSheet.home" />}
    >
      {loading ? (
        <View testID="StaffAccessSheet.loading" accessible accessibilityLabel={reviewStrings.common.loading} accessibilityState={{ busy: true }}>
          <Skeleton height={22} width="60%" />
          <Skeleton height={18} style={styles.skeleton} />
          <Skeleton height={18} style={styles.skeleton} />
          <Skeleton height={18} style={styles.skeleton} />
        </View>
      ) : me === null ? (
        <View testID="StaffAccessSheet.error">
          <Text variant="body" color="error">
            {error?.message ?? a.sheetLoadError}
          </Text>
          <Button label={reviewStrings.common.retry} variant="outline" size="sm" inline chevron={false} onPress={onRetry} style={styles.retry} testID="StaffAccessSheet.retry" />
        </View>
      ) : (
        <View testID="StaffAccessSheet.content">
          <Text variant="rowTitle" color="heading" size={17}>
            {a.sheetRoles}
          </Text>
          <Text variant="body" color="body" style={styles.roles} testID="StaffAccessSheet.roles">
            {rolesText(me)}
          </Text>
          <Text variant="rowTitle" color="heading" size={17} style={styles.sectionGap}>
            {a.sheetPermissions}
          </Text>
          <View accessibilityRole="list">
            {lines.map((line) => (
              <View
                key={line.resource}
                testID={`StaffAccessSheet.permission.${line.resource}`}
                accessible
                accessibilityLabel={`${line.label}: ${line.permissionLabel}`}
                style={styles.line}
              >
                <Text variant="body" color={line.permission === "none" ? "subtle" : "body"} size={16.5} style={styles.lineLabel} numberOfLines={2}>
                  {line.label}
                </Text>
                <StatusPill label={line.permissionLabel} tone={PERMISSION_TONE[line.permission]} size="sm" />
              </View>
            ))}
          </View>
          <Text variant="caption" color="subtle" size={13.5} lineHeight={18} style={styles.note}>
            {a.sheetNote}
          </Text>
        </View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  skeleton: { marginTop: 12 },
  retry: { marginTop: 12 },
  roles: { marginTop: 4 },
  sectionGap: { marginTop: 18 },
  line: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border.divider,
    paddingVertical: 6,
  },
  lineLabel: { flex: 1, paddingRight: 10 },
  note: { marginTop: 14 },
});
