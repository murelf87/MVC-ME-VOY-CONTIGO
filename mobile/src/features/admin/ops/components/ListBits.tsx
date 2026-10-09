/** Piezas comunes de las listas del panel: esqueleto de tarjetas, «Cargar más» y aviso de error al cargar más. */
import React from "react";
import { StyleSheet, View } from "react-native";
import { colors } from "@/theme";
import { Button, Skeleton, Text } from "@/ui";
import { opsStrings } from "../strings";

export function ListSkeleton({ rows = 3, height = 120, testID }: { rows?: number; height?: number; testID: string }): React.JSX.Element {
  return (
    <View testID={testID} accessible accessibilityLabel={opsStrings.common.loading} accessibilityState={{ busy: true }}>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} height={height} radius={16} style={index > 0 ? styles.gap : null} />
      ))}
    </View>
  );
}

export interface LoadMoreProps {
  hasMore: boolean;
  loading: boolean;
  failed: boolean;
  onPress: () => void;
  testID: string;
}

export function LoadMore({ hasMore, loading, failed, onPress, testID }: LoadMoreProps): React.JSX.Element | null {
  if (!hasMore && !failed) return null;
  return (
    <View style={styles.more} testID={testID}>
      {failed ? (
        <Text variant="rowText" size={14} lineHeight={18} color={colors.error.text} align="center" style={styles.failed} accessibilityRole="alert">
          {opsStrings.common.loadMoreFailed}
        </Text>
      ) : null}
      <Button
        testID={`${testID}.button`}
        label={failed ? opsStrings.common.retry : opsStrings.common.loadMore}
        variant="outline"
        size="sm"
        inline
        chevron={false}
        loading={loading}
        onPress={onPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  gap: { marginTop: 9 },
  more: { alignItems: "center", marginTop: 14 },
  failed: { marginBottom: 8 },
});
